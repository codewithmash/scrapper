// src/scrapers/facebook.js
import { launchBrowser, defaultContextOptions, generateFingerprint, fingerprintInjector, getTimezoneForLocation } from "../browser.js";
import { createCursor } from "ghost-cursor";
import { normalize, withinPrice } from "../normalize.js";
import { loadProxies } from "../sessions.js";
import { config } from "../config.js";
import db, { logHealthEvent, recordPollingMetric, markAccountFailed, markAccountSuccess, getAccounts, deleteAccount, updateListingTimestamp, updateListingDetails } from "../db.js";
import { pushAlert } from "../notify.js";
import fs from "node:fs";
import path from "node:path";

function buildSearchUrl({ keyword, location, minPrice, maxPrice }) {
  const params = new URLSearchParams({ query: keyword, sortBy: "creation_time_descend" });
  if (minPrice != null) params.set("minPrice", String(minPrice));
  if (maxPrice != null) params.set("maxPrice", String(maxPrice));
  
  if (location) {
    // Facebook accepts city names without spaces, e.g., 'sanfrancisco', 'newyork'
    const city = encodeURIComponent(location.toLowerCase().replace(/[^a-z0-9]/g, ''));
    return `https://www.facebook.com/marketplace/${city}/search/?${params.toString()}`;
  }
  
  // Use default www.facebook.com marketplace search (defaults to IP location)
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
  
  // Smooth scroll scrollbar simulation
  await smoothScroll(page, 0, 800);
  await page.waitForTimeout(800 + Math.random() * 400);
  await smoothScroll(page, 800, 1600);
  await page.waitForTimeout(600 + Math.random() * 400);
}

async function smoothScroll(page, from, to) {
  await page.evaluate(async ({ start, end }) => {
    await new Promise((resolve) => {
      let current = start;
      const step = 25; // Smaller steps for smoothness
      const timer = setInterval(() => {
        current += step + Math.floor(Math.random() * 10 - 5); // Add jitter to steps
        if (current >= end) {
          window.scrollTo(0, end);
          clearInterval(timer);
          resolve();
        } else {
          window.scrollTo(0, current);
        }
      }, 15 + Math.random() * 15); // Jittery interval speed
    });
  }, { start: from, end: to });
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
    for (const [key, val] of Object.entries(node)) {
      if (/suggested|related|sponsored|outside_search|more_listings/i.test(key)) {
        continue;
      }
      collectListings(val, out, depth + 1);
    }
  }
}

function mapNode(n, search) {
  const price = n.listing_price?.formatted_amount ?? n.formatted_price?.text ?? n.listing_price?.amount ?? null;
  const primaryImage = n.primary_listing_photo?.image?.uri || n.listing_photos?.[0]?.image?.uri || null;
  const city = n.location?.reverse_geocode?.city_page?.display_name || n.location_text?.text || null;

  // Extract all available images
  const images = [];
  if (primaryImage) images.push(primaryImage);
  if (Array.isArray(n.listing_photos)) {
    for (const photo of n.listing_photos) {
      if (photo?.image?.uri && !images.includes(photo.image.uri)) {
        images.push(photo.image.uri);
      }
    }
  }

  const extra = {
    sellerName: n.marketplace_listing_seller?.name || null,
    sellerId: n.marketplace_listing_seller?.id || null,
    categoryId: n.marketplace_listing_category_id || null,
    deliveryTypes: n.delivery_types || null,
    isPending: n.is_pending || false,
    isSold: n.is_sold || false,
    strikethroughPrice: n.strikethrough_price?.formatted_amount || null,
  };

  return normalize({
    id: n.id || n.legacy_id,
    title: n.marketplace_listing_title || n.custom_title,
    price,
    location: city || search.location,
    url: n.id ? `https://www.facebook.com/marketplace/item/${n.id}` : null,
    image: primaryImage,
    images: images,
    platform: "facebook",
    listed_at: n.creation_time ? new Date(n.creation_time * 1000).toISOString() : null,
    extra,
  });
}

export async function scrapeFacebook(search) {
  const startTime = Date.now();
  
  // 1. Get proxies and accounts
  const proxies = loadProxies();
  const activeAccounts = getAccounts().filter(a => a.status !== 'dead');
  
  if (activeAccounts.length === 0) {
    console.warn("[facebook] No active Facebook accounts found in database.");
    recordPollingMetric("facebook", search.id, 0, Date.now() - startTime, 0, null);
    return [];
  }
  
  // 2. Select candidates based on assignment & load balance
  let candidates = [];
  
  const assigned = activeAccounts.filter(a => a.assigned_search_id === search.id);
  
  if (assigned.length > 0) {
    // If we have assigned accounts, try them first. If they fail, fall back to explicit fallback accounts
    const explicitFallbacks = activeAccounts.filter(a => assigned.some(assignedAcc => a.fallback_for_account_id === assignedAcc.id));
    candidates = [...assigned, ...explicitFallbacks];
  } else {
    // If no assigned accounts, just use the unassigned pool (not acting as fallbacks)
    const unassigned = activeAccounts.filter(a => a.assigned_search_id === null && a.fallback_for_account_id === null);
    if (unassigned.length > 0) {
      unassigned.sort((a, b) => {
        if (!a.last_used) return -1;
        if (!b.last_used) return 1;
        return new Date(a.last_used) - new Date(b.last_used);
      });
      candidates = unassigned;
    } else {
      // Last resort fallback: rotate across any active account
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
    if (account.assigned_proxy) {
      proxy = proxies.find(p => p.key === account.assigned_proxy);
      if (proxy) {
        console.log(`[facebook] Using assigned proxy ${proxy.key} (${proxy.label || 'no label'}) for account ${account.id}`);
      } else {
        console.warn(`[facebook] Assigned proxy ${account.assigned_proxy} not found in proxy list. Falling back to random.`);
      }
    }
    if (!proxy && proxies.length > 0) {
      proxy = proxies[Math.floor(Math.random() * proxies.length)];
      if (proxy) {
        console.log(`[facebook] Using random proxy ${proxy.key} for account ${account.id}`);
      }
    }
    
    let browser;
    try {
      if (!fs.existsSync(cookieFile)) {
        console.warn(`[facebook] Cookie file not found: ${cookieFile}`);
        deleteAccount(account.id);
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
          return {
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite,
            expires: c.expires ?? c.expirationDate
          };
        });
      } catch (err) {
        console.warn(`[facebook] Failed to read cookie ${cookieFile}:`, err.message);
      }

      // Timezone selection matching the search location or proxy label
      const tzId = getTimezoneForLocation(search.location) || getTimezoneForLocation(proxy?.label) || undefined;
      if (tzId) {
        console.log(`[facebook] Matching timezone found: ${tzId} for search location: ${search.location || 'none'}, proxy label: ${proxy?.label || 'none'}`);
      }

      const fingerprintData = generateFingerprint();
      const context = await browser.newContext({
        ...defaultContextOptions(fingerprintData, { timezoneId: tzId }),
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

      await page.goto(buildSearchUrl(search), { waitUntil: "domcontentloaded", timeout: 45000 });
      // Wait for the main container or an item to show up, give it a bit more time for slow proxies
      await page.waitForSelector('div[role="main"]', { timeout: 15000 }).catch(() => {});
      // Add a hard wait for the React hydration and listings to actually paint on the screen
      await page.waitForTimeout(5000);

      if (await isBlocked(page)) {
        const blockedUrl = page.url();
        console.warn(`[facebook] Session blocked → ${blockedUrl} (cookie: ${account.id})`);
        try { await page.screenshot({ path: `data/fb-blocked-debug.png` }); } catch(e) {}
        await browser.close();
        
        // Handle account failure using db helper
        const { newErrCount, newStatus } = markAccountFailed(account.id, account.error_count);
        
        logHealthEvent(account.id, "error", `Session blocked (login/captcha/block). URL: ${blockedUrl}. Consecutive errors: ${newErrCount}. Status updated to: ${newStatus}`);
        
        // Send immediate alert!
        await pushAlert(`Facebook Account "${account.id}" marked as ${newStatus.toUpperCase()} due to blocks/login walls (errors: ${newErrCount}).`);
        
        recordPollingMetric("facebook", search.id, 0, Date.now() - startTime, 0, account.id);
        continue; // Try next candidate
      }

      await simulateHumanBehavior(page, cursor);
      // Deduplicate captured raw nodes first
      const seen = new Set();
      const uniqueNodes = captured.filter(n => {
        const id = n.id || n.legacy_id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      // Map raw nodes to listings with category IDs
      const mappedListings = uniqueNodes.map(n => ({
        ...mapNode(n, search),
        categoryId: n.marketplace_listing_category_id
      }));

      // Determine allowed category IDs based on the top 10 listings (the actual search query matches)
      const allowedCategories = new Set();
      const topCount = Math.min(mappedListings.length, 10);
      for (let i = 0; i < topCount; i++) {
        if (mappedListings[i].categoryId) {
          allowedCategories.add(mappedListings[i].categoryId);
        }
      }

      // Filter listings to only match the top categories
      const filteredListings = mappedListings.filter(l => {
        if (allowedCategories.size > 0 && l.categoryId) {
          return allowedCategories.has(l.categoryId);
        }
        return true;
      });

      // Remove categoryId field from final objects
      const unique = filteredListings.map(({ categoryId, ...rest }) => rest);

      if (unique.length === 0) {
        console.warn(`[facebook] Found 0 listings, taking debug screenshot`);
        try { await page.screenshot({ path: `data/fb-empty-debug.png` }); } catch(e) {}
      }

      // Check which items are new/unseen to fetch details in background
      const checkStmt = db.prepare("SELECT 1 FROM seen_listings WHERE platform = 'facebook' AND listing_id = ?");
      const newItemsToFetch = [];
      for (const item of unique) {
        if (!item.id || !item.url) continue;
        const exists = checkStmt.get(String(item.id));
        if (!exists) {
          newItemsToFetch.push(item);
        }
      }

      if (newItemsToFetch.length > 0) {
        console.log(`[facebook] Found ${newItemsToFetch.length} new items. Fetching creation times in background...`);
        // Start background process
        (async () => {
          try {
            for (const item of newItemsToFetch) {
              console.log(`[facebook background] Fetching creation_time for new listing ${item.id}...`);
              try {
                const detailPage = await context.newPage();
                // Block stylesheets, images, media and fonts to load page extremely fast
                await detailPage.route('**/*', (route) => {
                  const type = route.request().resourceType();
                  if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
                    route.abort();
                  } else {
                    route.continue();
                  }
                });
                await detailPage.goto(item.url, { waitUntil: "domcontentloaded", timeout: 15000 });
                const html = await detailPage.content();
                await detailPage.close().catch(() => {});
                
                // Extract creation_time robustly using ID proximity
                const idStr = String(item.id);
                let pos = html.indexOf(idStr);
                let extractedTs = null;
                while (pos !== -1) {
                  const sub = html.substring(pos, pos + 5000);
                  const match = sub.match(/"creation_time":\s*(\d+)/);
                  if (match) {
                    const ts = parseInt(match[1], 10);
                    if (ts > 1500000000 && ts < 2000000000) {
                      extractedTs = ts;
                      break;
                    }
                  }
                  pos = html.indexOf(idStr, pos + 1);
                }

                // Extract description and attributes from HTML page content
                let description = null;
                const descMatch = html.match(/"description"\s*:\s*\{\s*"text"\s*:\s*"([^"]+)"\s*\}/);
                if (descMatch) {
                  try { description = JSON.parse(`"${descMatch[1]}"`); } catch(e) {}
                }
                if (!description) {
                  const redactedMatch = html.match(/"redacted_description"\s*:\s*\{\s*"text"\s*:\s*"([^"]+)"\s*\}/);
                  if (redactedMatch) {
                    try { description = JSON.parse(`"${redactedMatch[1]}"`); } catch(e) {}
                  }
                }
                
                let mileage = null;
                const mileageMatch = html.match(/Driven\s+([\d,]+)\s*(?:km|miles|mi)/i) || html.match(/([\d,]+)\s*(?:km|miles|mi)\s+driven/i);
                if (mileageMatch) mileage = mileageMatch[1] + (html.match(/miles|mi/i) ? " miles" : " km");

                let transmission = null;
                const transMatch = html.match(/(Manual|Automatic)\s+transmission/i) || html.match(/(Manual|Automatic)\s+gearbox/i);
                if (transMatch) transmission = transMatch[1];

                let color = null;
                const colorMatch = html.match(/Exterior\s+color:\s*([a-zA-Z]{3,20})/i) || html.match(/\bColor:\s*([a-zA-Z]{3,20})/i);
                if (colorMatch && colorMatch[1].toLowerCase() !== 'var') color = colorMatch[1];

                let fuelType = null;
                const fuelMatch = html.match(/(Gasoline|Diesel|Electric|Hybrid)\s+fuel/i) || html.match(/Fuel\s+type:\s*([a-zA-Z]+)/i);
                if (fuelMatch) fuelType = fuelMatch[1];

                let year = null;
                const yearMatch = item.title.match(/\b(19\d{2}|20\d{2})\b/) || html.match(/Year:\s*(\d{4})/i) || html.match(/"manufacture_year"\s*:\s*(\d{4})/i);
                if (yearMatch) year = yearMatch[1];

                let condition = null;
                const condMatch = html.match(/Condition:\s*([a-zA-Z\s]{3,20})/i) || html.match(/"vehicle_condition"\s*:\s*"([^"]+)"/i);
                if (condMatch) condition = condMatch[1].trim();

                let titleStatus = null;
                const tsMatch = html.match(/(Clean|Rebuilt|Salvage)\s+title/i) || html.match(/Title\s+status:\s*([a-zA-Z\s]{3,20})/i);
                if (tsMatch) titleStatus = tsMatch[1].trim();

                // Extract additional images from detail page HTML
                const detailImages = [];
                let photoPos = html.indexOf('listing_photos');
                if (photoPos !== -1) {
                  const sub = html.substring(photoPos, photoPos + 30000);
                  const uriMatches = sub.matchAll(/uri["\\]+\s*:\s*["\\]+(https?:[^"\\]+)/gi);
                  for (const match of uriMatches) {
                    let cleanUrl = match[1].replace(/\\/g, ''); // Remove escape characters
                    if (cleanUrl.startsWith('http') && !detailImages.includes(cleanUrl)) {
                      detailImages.push(cleanUrl);
                    }
                  }
                }

                const updates = { extra: {} };
                if (extractedTs) {
                  updates.listed_at = new Date(extractedTs * 1000).toISOString();
                }
                if (detailImages.length > 0) {
                  updates.images = detailImages;
                  updates.image = detailImages[0];
                }
                if (description) updates.extra.description = description;
                if (mileage) updates.extra.mileage = mileage;
                if (transmission) updates.extra.transmission = transmission;
                if (color) updates.extra.color = color;
                if (fuelType) updates.extra.fuelType = fuelType;
                if (year) updates.extra.year = year;
                if (condition) updates.extra.condition = condition;
                if (titleStatus) updates.extra.titleStatus = titleStatus;

                console.log(`[facebook background] Extracted details for ${item.id}:`, JSON.stringify(updates.extra));
                await updateListingDetails("facebook", item.id, updates);
              } catch (e) {
                console.warn(`[facebook background] Failed to fetch details for ${item.id}:`, e.message);
              }
            }
          } finally {
            // Close the browser when background fetching is complete or fails
            await browser.close().catch(() => {});
            markAccountSuccess(account.id);
            logHealthEvent(account.id, "success", `Scraped search "${search.keyword}" successfully. Background fetching finished.`);
          }
        })();
      } else {
        // No new items to fetch creation time for, close browser immediately
        await browser.close().catch(() => {});
        markAccountSuccess(account.id);
        logHealthEvent(account.id, "success", `Scraped search "${search.keyword}" successfully. Found 0 new items.`);
      }

      const filtered = withinPrice(unique, search.minPrice, search.maxPrice);
      recordPollingMetric("facebook", search.id, 1, Date.now() - startTime, filtered.length, account.id);
      
      return filtered;

    } catch (err) {
      console.error(`[facebook] Attempt with ${account.id} failed:`, err.message);
      if (browser) await browser.close().catch(() => {});
      
      // Update account stats on exception using db helper
      const { newErrCount, newStatus } = markAccountFailed(account.id, account.error_count);
        
      logHealthEvent(account.id, "error", `Playwright exception: ${err.message}. Consecutive errors: ${newErrCount}. Status updated to: ${newStatus}`);
      
      await pushAlert(`Facebook Account "${account.id}" marked as ${newStatus.toUpperCase()} due to Playwright exception: ${err.message}.`);
      
      recordPollingMetric("facebook", search.id, 0, Date.now() - startTime, 0, account.id);
    }
  }

  console.warn("[facebook] All sessions exhausted.");
  return [];
}