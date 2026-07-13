import { chromium } from "playwright";
import fs from "node:fs";

async function run() {
  const cookieFile = "secrets/fb-cookies/www_facebook_com_cookies.json";
  if (!fs.existsSync(cookieFile)) {
    console.error("Cookie file not found");
    return;
  }
  const cookies = JSON.parse(fs.readFileSync(cookieFile, "utf-8"));
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: cookies });
  
  const itemId = "1349027693960596"; // One of the items scraped in Bhopal
  const url = `https://www.facebook.com/marketplace/item/${itemId}`;
  console.log(`Fetching details for item ${itemId} from ${url}...`);
  
  const response = await context.request.get(url);
  const text = await response.text();
  
  fs.writeFileSync("scratch/item_details.html", text);
  console.log("Details HTML saved to scratch/item_details.html");
  
  // Search for "Listed " or similar in the text
  const listedMatches = [...text.matchAll(/Listed [^<]+/g)].map(m => m[0]);
  console.log("Listed matches:", listedMatches);
  
  // Search for creation_time or similar
  const creationTimeMatches = [...text.matchAll(/creation_time[^:]*:\s*(\d+)/g)].map(m => m[0]);
  console.log("creation_time matches:", creationTimeMatches);
  
  // Let's also search for "creation_time" in the whole text case insensitively
  const count = (text.match(/creation_time/gi) || []).length;
  console.log("creation_time occurrences:", count);
  
  await browser.close();
}

run();
