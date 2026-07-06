import { scrapeFacebook } from "../src/scrapers/facebook.js";
import * as sessions from "../src/sessions.js";

// Force loadProxies to return empty array so it uses the local Indian IP
sessions.loadProxies = () => [];

console.log("🚀 Starting Facebook test on local INDIAN IP...");

async function test() {
  const search = { keyword: "iphone", location: "mumbai", minPrice: 0, maxPrice: 100000 };
  const items = await scrapeFacebook(search);
  console.log(`\n✅ Done! Found ${items.length} items`);
  if (items.length > 0) {
    console.log(items.slice(0, 3));
  }
}

test();
