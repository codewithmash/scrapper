import { config } from "./config.js";
import { filterAndRecordNew, getSearches, recordPollingMetric } from "./db.js";
import { pushNewListings } from "./notify.js";
import { scrapeEbay } from "./scrapers/ebay.js";
import { scrapeOfferUp } from "./scrapers/offerup.js";
import { scrapeFacebook } from "./scrapers/facebook.js";

const SCRAPERS = {
  ebay: scrapeEbay,
  offerup: scrapeOfferUp,
  facebook: scrapeFacebook,
};

/** Add +/- 20% jitter so we never fire a rigid, botlike burst on a fixed clock. */
function jitter(seconds) {
  const delta = seconds * 0.2;
  return Math.round((seconds - delta + Math.random() * 2 * delta) * 1000);
}

/** Run every search for one platform once, record new items, push alerts. */
async function runPlatform(platform) {
  const searches = getSearches().filter((s) => s.platform === platform);
  if (searches.length === 0) return;

  for (const search of searches) {
    const startTime = Date.now();
    try {
      console.log(`[${platform}] 🔍 Scraping "${search.keyword}"...`);
      const listings = await SCRAPERS[platform](search);
      const fresh = filterAndRecordNew(listings);
      console.log(`[${platform}] ✅ Found ${listings.length} total, ${fresh.length} NEW — "${search.keyword}"`);
      if (fresh.length > 0) {
        await pushNewListings(fresh);
      }
      if (platform !== "facebook") {
        recordPollingMetric(platform, search.id, 1, Date.now() - startTime, listings.length, null);
      }
    } catch (err) {
      console.error(`[${platform}] ❌ search "${search.keyword}" failed:`, err.message);
      if (platform !== "facebook") {
        recordPollingMetric(platform, search.id, 0, Date.now() - startTime, 0, null);
      }
    }
    // Small stagger between searches on the same platform.
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/** Self-rescheduling loop for a platform (setTimeout, not setInterval, to avoid overlap). */
function loop(platform, intervalSeconds) {
  const tick = async () => {
    await runPlatform(platform).catch((e) => console.error(`[${platform}] loop error:`, e.message));
    setTimeout(tick, jitter(intervalSeconds));
  };
  // Stagger platform starts a little so they don't all fire at t=0.
  setTimeout(tick, Math.random() * 3000);
}

export function startScheduler() {
  console.log("[scheduler] starting polling loops:", config.poll);
  loop("ebay", config.poll.ebay);
  loop("offerup", config.poll.offerup);
  loop("facebook", config.poll.facebook);
}
