import { scrapeOfferUp } from "../src/scrapers/offerup.js";

const search = {
  keyword: process.argv[2] || "dyson",
  location: "toronto",
  minPrice: 0,
  maxPrice: 1000,
};
const items = await scrapeOfferUp(search);
console.log(`OfferUp returned ${items.length} listings`);
console.log(JSON.stringify(items.slice(0, 5), null, 2));
