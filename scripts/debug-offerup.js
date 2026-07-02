import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  proxy: { server: "http://31.59.20.176:6754", username: "fyakkgcc", password: "7ifgkd7c1whe" }
});
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
});
const page = await context.newPage();

const allUrls = [];
page.on("response", async (res) => {
  const url = res.url();
  const status = res.status();
  const ct = res.headers()["content-type"] || "";
  // Log everything
  console.log(`[${status}] ${ct.split(';')[0].padEnd(30)} ${url.slice(0, 100)}`);
  if (ct.includes("json") && url.includes("offerup")) {
    allUrls.push(url);
    try {
      const json = await res.json();
      console.log("  BODY:", JSON.stringify(json).slice(0, 300));
    } catch {}
  }
});

console.log("Navigating to OfferUp...");
await page.goto("https://offerup.com/search?q=iphone", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(3000);

console.log("\n\nAll JSON URLs captured:", allUrls.length);
allUrls.forEach(u => console.log(" -", u.slice(0, 120)));

await browser.close();
