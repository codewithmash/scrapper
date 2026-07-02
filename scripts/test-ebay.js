import { scrapeEbay } from "../src/scrapers/ebay.js";

const search = { keyword: process.argv[2] || "iphone 15", minPrice: 0, maxPrice: 1000, location: "US" };
const items = await scrapeEbay(search);
console.log(`eBay returned ${items.length} listings`);
console.log(JSON.stringify(items.slice(0, 5), null, 2));
