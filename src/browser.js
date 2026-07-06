import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { FingerprintGenerator } from "fingerprint-generator";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { FingerprintInjector } = require("fingerprint-injector");

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

export function generateFingerprint() {
  const fingerprintGenerator = new FingerprintGenerator({
    browsers: [{ name: 'chrome', minVersion: 110 }],
    devices: ['desktop'],
    operatingSystems: ['windows', 'macos']
  });
  return fingerprintGenerator.getFingerprint();
}

export const fingerprintInjector = new FingerprintInjector();

export function defaultContextOptions(fingerprintData, extra = {}) {
  return {
    userAgent: fingerprintData.fingerprint.navigator.userAgent,
    viewport: { 
      width: fingerprintData.fingerprint.screen.width, 
      height: fingerprintData.fingerprint.screen.height 
    },
    locale: fingerprintData.fingerprint.navigator.language || "en-US",
    ignoreHTTPSErrors: true,
    ...extra,
  };
}
