// scripts/test-facebook.js
import { scrapeFacebook } from "../src/scrapers/facebook.js";

console.log("🚀 Starting Facebook Marketplace Test...\n");

const search = {
  keyword: process.argv[2] || "iphone",     // Change this to test different keywords
  location: process.argv[3] || "toronto",   // e.g. "newyork", "london", etc.
  minPrice: parseInt(process.argv[4]) || 0,
  maxPrice: parseInt(process.argv[5]) || 2000,
};

async function test() {
  try {
    console.log(`Searching for "${search.keyword}" in ${search.location}...`);
    
    const startTime = Date.now();
    const items = await scrapeFacebook(search);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n✅ Done! Took ${duration}s`);
    console.log(`📊 Found ${items.length} unique listings\n`);

    if (items.length > 0) {
      console.log("Sample listings:");
      console.log(JSON.stringify(items.slice(0, 3), null, 2));
    } else {
      console.log("⚠️ No listings returned. Possible reasons:");
      console.log("   - Sessions are blocked");
      console.log("   - Bad proxies");
      console.log("   - Check your cookies");
    }

  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

test();