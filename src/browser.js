import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";

// Inject stealth plugin to bypass bot detection (specifically for Facebook)
chromium.use(stealthPlugin());

/**
 * Small helper to launch a Chromium browser, optionally through a proxy.
 * Uses stealth evasion to prevent instant blocking on Facebook/OfferUp.
 *
 * @param {{ proxy?: {server:string, username?:string, password?:string} }} opts
 */
export async function launchBrowser({ proxy } = {}) {
  const browser = await chromium.launch({
    headless: true,
    proxy: proxy || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  return browser;
}

/** Standard, honest desktop context options. */
export function defaultContextOptions(extra = {}) {
  return {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    ...extra,
  };
}
