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
  const page = await context.newPage();
  
  const itemId = "1349027693960596";
  const url = `https://www.facebook.com/marketplace/item/${itemId}`;
  console.log(`Navigating to ${url}...`);
  
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);
  
  const text = await page.locator("body").innerText();
  fs.writeFileSync("scratch/details_text.txt", text);
  console.log("Body text saved to scratch/details_text.txt");
  
  const html = await page.content();
  fs.writeFileSync("scratch/details_html.html", html);
  console.log("HTML saved to scratch/details_html.html");
  
  await page.screenshot({ path: "scratch/details_screenshot.png" });
  console.log("Screenshot saved to scratch/details_screenshot.png");
  
  await browser.close();
}

run();
