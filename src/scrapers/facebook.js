// src/scrapers/facebook.js
import { launchBrowser, defaultContextOptions, generateFingerprint, fingerprintInjector } from "../browser.js";
import { createCursor } from "ghost-cursor";
import { normalize, withinPrice } from "../normalize.js";
import { loadProxies } from "../sessions.js";
import { config } from "../config.js";
import db, { logHealthEvent, recordPollingMetric } from "../db.js";
import { pushAlert } from "../notify.js";
import fs from "node:fs";
import path from "node:path";

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
  const startTime = Date.now();
  
  // 1. Get proxies and accounts
  const proxies = loadProxies();
  const activeAccounts = db.prepare("SELECT * FROM facebook_accounts WHERE status != 'dead'").all();
  
  if (activeAccounts.length === 0) {
    console.warn("[facebook] No active Facebook accounts found in database.");
    recordPollingMetric("facebook", search.id, 0, Date.now() - startTime, 0, null);
    return [];
  }
  
  // 2. Select candidates based on assignment & load balance
  let candidates = [];
  
  // Search for accounts assigned to this specific search
  const assigned = activeAccounts.filter(a => a.assigned_search_id === search.id);
  if (assigned.length > 0) {
    candidates = assigned;
  } else {
    // Round-robin / rotate across unassigned active accounts (sorted by last_used oldest first)
    const unassigned = activeAccounts.filter(a => a.assigned_search_id === null);
    if (unassigned.length > 0) {
      unassigned.sort((a, b) => {
        if (!a.last_used) return -1;
        if (!b.last_used) return 1;
        return new Date(a.last_used) - new Date(b.last_used);
      });
      candidates = unassigned;
    } else {
      // Fallback: rotate across any active account
      activeAccounts.sort((a, b) => {
        if (!a.last_used) return -1;
        if (!b.last_used) return 1;
        return new Date(a.last_used) - new Date(b.last_used);
      });
      candidates = activeAccounts;
    }
  }

  // 3. Try candidates one by one
  for (const account of candidates) {
    const cookieFile = path.join(config.facebook.cookiesDir, account.id);
    let proxy = null;
    if (proxies.length > 0) {
      proxy = proxies[Math.floor(Math.random() * proxies.length)];
    }
    
    let browser;
    try {
      if (!fs.existsSync(cookieFile)) {
        console.warn(`[facebook] Cookie file not found: ${cookieFile}`);
        db.prepare("DELETE FROM facebook_accounts WHERE id = ?").run(account.id);
        continue;
      }
      
      browser = await launchBrowser({ proxy });

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
        console.warn(`[facebook] Session blocked → ${blockedUrl} (cookie: ${account.id})`);
        try { await page.screenshot({ path: `public/fb-blocked-debug.png` }); } catch(e) {}
        await browser.close();
        
        // Handle account failure
        const newErrCount = account.error_count + 1;
        let newStatus = "flagged";
        if (newErrCount >= 3) {
          newStatus = "dead";
        }
        db.prepare("UPDATE facebook_accounts SET error_count = ?, status = ?, last_used = ? WHERE id = ?")
          .run(newErrCount, newStatus, new Date().toISOString(), account.id);
        
        logHealthEvent(account.id, "error", `Session blocked (login/captcha/block). URL: ${blockedUrl}. Consecutive errors: ${newErrCount}. Status updated to: ${newStatus}`);
        
        // Send immediate alert!
        await pushAlert(`Facebook Account "${account.id}" marked as ${newStatus.toUpperCase()} due to blocks/login walls (errors: ${newErrCount}).`);
        
        recordPollingMetric("facebook", search.id, 0, Date.now() - startTime, 0, account.id);
        continue; // Try next candidate
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

      // Successful scraping!
      db.prepare("UPDATE facebook_accounts SET error_count = 0, success_count = success_count + 1, status = 'healthy', last_used = ? WHERE id = ?")
        .run(new Date().toISOString(), account.id);
      
      logHealthEvent(account.id, "success", `Scraped search "${search.keyword}" for ${search.location || "default location"} successfully. Found ${unique.length} items.`);
      
      const filtered = withinPrice(unique, search.minPrice, search.maxPrice);
      recordPollingMetric("facebook", search.id, 1, Date.now() - startTime, filtered.length, account.id);
      
      return filtered;

    } catch (err) {
      console.error(`[facebook] Attempt with ${account.id} failed:`, err.message);
      if (browser) await browser.close().catch(() => {});
      
      // Update account stats on exception
      const newErrCount = account.error_count + 1;
      let newStatus = "flagged";
      if (newErrCount >= 3) {
        newStatus = "dead";
      }
      db.prepare("UPDATE facebook_accounts SET error_count = ?, status = ?, last_used = ? WHERE id = ?")
        .run(newErrCount, newStatus, new Date().toISOString(), account.id);
        
      logHealthEvent(account.id, "error", `Playwright exception: ${err.message}. Consecutive errors: ${newErrCount}. Status updated to: ${newStatus}`);
      
      await pushAlert(`Facebook Account "${account.id}" marked as ${newStatus.toUpperCase()} due to Playwright exception: ${err.message}.`);
      
      recordPollingMetric("facebook", search.id, 0, Date.now() - startTime, 0, account.id);
    }
  }

  console.warn("[facebook] All sessions exhausted.");
  return [];
}