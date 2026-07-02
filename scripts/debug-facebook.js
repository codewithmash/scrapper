import { chromium } from "playwright";
import fs from "node:fs";

// Load fixed cookie
const dir = "secrets/fb-cookies";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
const cookieObj = files.length ? JSON.parse(fs.readFileSync(dir+"/"+files[0], "utf-8")) : { cookies: [], origins: [] };

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({
  storageState: cookieObj,
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  locale: "en-US"
});
const page = await context.newPage();

let graphqlCount = 0;
page.on("response", async (res) => {
  const url = res.url();
  const status = res.status();
  if (url.includes("facebook.com")) {
    console.log(`[${status}] ${url.slice(0, 100)}`);
  }
  if (url.includes("/api/graphql")) {
    graphqlCount++;
    try {
      const text = await res.text();
      console.log("\n>>> GraphQL response snippet:", text.slice(0, 300));
    } catch {}
  }
});

console.log("Navigating to Facebook Marketplace...");
await page.goto("https://www.facebook.com/marketplace/search/?query=iphone", {
  waitUntil: "domcontentloaded", timeout: 30000
});

const finalUrl = page.url();
const bodyText = await page.locator("body").innerText().catch(() => "");

console.log("\n=== Final URL:", finalUrl);
console.log("=== Blocked?", /login|checkpoint|unavailable|not available/i.test(finalUrl + bodyText));
console.log("=== GraphQL responses captured:", graphqlCount);
console.log("=== Body snippet:", bodyText.slice(0, 300));

await page.screenshot({ path: "public/fb-debug.png" });
console.log("\nScreenshot saved to public/fb-debug.png - open http://localhost:3000/fb-debug.png");

await browser.close();
