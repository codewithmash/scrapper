import { launchBrowser, defaultContextOptions } from "../browser.js";
import { normalize, withinPrice } from "../normalize.js";
import { loadProxies } from "../sessions.js";

/**
 * OfferUp now server-side renders listing results via Next.js.
 * The full search result JSON is embedded in the __NEXT_DATA__ script tag.
 * We extract it directly from the page HTML — no network interception needed.
 */
export async function scrapeOfferUp(search) {
  const proxies = loadProxies();
  // Try proxies in random order, stop on first success
  const shuffled = proxies.length > 0
    ? [...proxies].sort(() => Math.random() - 0.5)
    : [null];

  for (const proxy of shuffled) {
    if (proxy) console.log(`[offerup] trying proxy: ${proxy.server}`);

    const browser = await launchBrowser({ proxy });
    const context = await browser.newContext(defaultContextOptions());
    const page = await context.newPage();

    const params = new URLSearchParams({ q: search.keyword });
    if (search.minPrice != null) params.set("price_min", String(search.minPrice));
    if (search.maxPrice != null) params.set("price_max", String(search.maxPrice));
    const url = `https://offerup.com/search?${params.toString()}`;

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(5000);

      const html = await page.content();
      const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!match) {
        console.warn(`[offerup] geo-blocked or no data via ${proxy?.server || 'no proxy'}, trying next...`);
        await browser.close();
        continue;
      }

      const nextData = JSON.parse(match[1]);
      const rawListings = [];
      collectListingTiles(nextData, rawListings);

      const listings = rawListings.map((l) =>
        normalize({
          id: l.listingId,
          title: l.title,
          price: l.price != null ? parseFloat(String(l.price).replace(/[^0-9.]/g, "")) : null,
          location: l.locationName ?? search.location ?? null,
          url: l.listingId ? `https://offerup.com/item/detail/${l.listingId}` : null,
          image: l.image?.url ?? null,
          platform: "offerup",
          listed_at: null,
        })
      );

      await browser.close();

      // De-dupe within this batch and apply the price band.
      const seen = new Set();
      const unique = listings.filter((l) => {
        if (!l.id || seen.has(l.id)) return false;
        seen.add(l.id);
        return true;
      });
      return withinPrice(unique, search.minPrice, search.maxPrice);

    } catch (err) {
      console.error(`[offerup] failed via ${proxy?.server || 'no proxy'}:`, err.message);
      await browser.close().catch(() => {});
    }
  }

  console.warn("[offerup] all proxies exhausted, returning empty");
  return [];
}

/**
 * Recursively walk the Next.js data tree and collect all objects
 * that look like OfferUp listing tiles (have listingId + title + price).
 */
function collectListingTiles(node, out, depth = 0) {
  if (!node || depth > 20) return;
  if (Array.isArray(node)) {
    for (const el of node) collectListingTiles(el, out, depth + 1);
    return;
  }
  if (typeof node === "object") {
    // Match the ModularFeedListing shape
    if (node.listingId && node.title && node.price != null) {
      out.push(node);
      return; // don't recurse into the listing itself
    }
    // If it's a tile wrapper, dive into the nested listing
    if (node.listing && node.listing.listingId) {
      out.push(node.listing);
      return;
    }
    for (const val of Object.values(node)) {
      collectListingTiles(val, out, depth + 1);
    }
  }
}
