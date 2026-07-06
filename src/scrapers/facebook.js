// src/scrapers/facebook.js
import { launchBrowser, defaultContextOptions, generateFingerprint, fingerprintInjector } from "../browser.js";
import { createCursor } from "ghost-cursor";
import { normalize, withinPrice } from "../normalize.js";
import { makeRotator } from "../sessions.js";
import fs from "node:fs";

const rotator = makeRotator();

function buildSearchUrl({ keyword, minPrice, maxPrice }) {
  const params = new URLSearchParams({ query: keyword, sortBy: "creation_time_descend" });
  if (minPrice != null) params.set("minPrice", String(minPrice));
  if (maxPrice != null) params.set("maxPrice", String(maxPrice));
  // Use www.facebook.com marketplace search
  return `https://www.facebook.com/marketplace/search/?${params.toString()}`;
}

async function isBlocked(page) {
  const url = page.url();
  if (/login|checkpoint|challenge|ineligible/i.test(url)) return true;
  // Splash screen = page still loading, not necessarily blocked
  const text = await page.locator("body").innerText().catch(() => "");
  return /temporarily blocked|security check|confirm your identity|unusual activity/i.test(text);
}

async function simulateHumanBehavior(page, cursor) {
  if (cursor) {
    try {
      await cursor.moveTo({ x: 100 + Math.random() * 800, y: 200 + Math.random() * 600 });
      await page.waitForTimeout(250 + Math.random() * 500);
      await cursor.moveTo({ x: 200 + Math.random() * 800, y: 400 + Math.random() * 500 });
      await page.waitForTimeout(250 + Math.random() * 500);
    } catch(e) {}
  }
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 1600));
  await page.waitForTimeout(900);
}

function collectListings(node, out, depth = 0) {
  if (!node || depth > 12) return;
  if (Array.isArray(node)) {
    node.forEach(el => collectListings(el, out, depth + 1));
    return;
  }
  if (typeof node === "object" && node !== null) {
    const id = node.id || node.legacy_id || node.story_key;
    const title = node.marketplace_listing_title || node.custom_title;
    if (id && title) out.push(node);
    Object.values(node).forEach(v => collectListings(v, out, depth + 1));
  }
}

function mapNode(n, search) {
  const price = n.listing_price?.amount ?? n.formatted_price?.text ?? null;
  const image = n.primary_listing_photo?.image?.uri || n.listing_photos?.[0]?.image?.uri || null;
  const city = n.location?.reverse_geocode?.city_page?.display_name || n.location_text?.text || null;

  return normalize({
    id: n.id || n.legacy_id,
    title: n.marketplace_listing_title || n.custom_title,
    price,
    location: city || search.location,
    url: n.id ? `https://www.facebook.com/marketplace/item/${n.id}` : null,
    image,
    platform: "facebook",
    listed_at: n.creation_time ? new Date(n.creation_time * 1000).toISOString() : null,
  });
}

export async function scrapeFacebook(search) {
  const maxSessions = Math.min(rotator.count() || 1, 10);

  for (let attempt = 0; attempt < maxSessions; attempt++) {
    const { cookieFile, proxy } = rotator.next();
    let browser;

    try {
      browser = await launchBrowser({ proxy });

      // Read and aggressively normalize the cookie on-the-fly to prevent Playwright crashes
      let cookieObj = { cookies: [], origins: [] };
      try {
        const raw = JSON.parse(fs.readFileSync(cookieFile, "utf-8"));
        const list = Array.isArray(raw) ? raw : (raw.cookies || []);
        cookieObj.cookies = list.map(c => {
          let sameSite = "None";
          if (typeof c.sameSite === "string") {
            const lower = c.sameSite.toLowerCase();
            if (lower === "lax") sameSite = "Lax";
            else if (lower === "strict") sameSite = "Strict";
          }
          return { ...c, sameSite };
        });
      } catch (err) {
        console.warn(`[facebook] Failed to read cookie ${cookieFile}:`, err.message);
      }

      const fingerprintData = generateFingerprint();
      const context = await browser.newContext({
        ...defaultContextOptions(fingerprintData),
        storageState: cookieObj,
      });
      await fingerprintInjector.attachFingerprintToPlaywright(context, fingerprintData);

      const page = await context.newPage();
      const cursor = createCursor(page);

      const captured = [];
      page.on("response", async (res) => {
        if (res.url().includes("/api/graphql")) {
          try {
            const text = await res.text();
            for (const chunk of text.split("\n")) {
              if (chunk.trim()) collectListings(JSON.parse(chunk), captured);
            }
          } catch {}
        }
      });

      await page.goto(buildSearchUrl(search), { waitUntil: "domcontentloaded", timeout: 60000 });

      if (await isBlocked(page)) {
        const blockedUrl = page.url();
        console.warn(`[facebook] Session blocked → ${blockedUrl} (cookie: ${cookieFile})`);
        try { await page.screenshot({ path: `public/fb-blocked-debug.png` }); } catch(e) {}
        await browser.close();
        continue;
      }

      await simulateHumanBehavior(page, cursor);
      const listings = captured.map(n => mapNode(n, search));
      const seen = new Set();
      const unique = listings.filter(l => !seen.has(l.id) && seen.add(l.id));

      if (unique.length === 0) {
        console.warn(`[facebook] Found 0 listings, taking debug screenshot`);
        try { await page.screenshot({ path: `public/fb-empty-debug.png` }); } catch(e) {}
      }

      await browser.close();

      return withinPrice(unique, search.minPrice, search.maxPrice);

    } catch (err) {
      console.error(`[facebook] Attempt failed:`, err.message);
      if (browser) await browser.close().catch(() => {});
    }
  }

  console.warn("[facebook] All sessions exhausted.");
  return [];
}