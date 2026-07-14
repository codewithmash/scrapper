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
 * Keeps browser headless as requested.
 *
 * @param {{ proxy?: {server:string, username?:string, password?:string} }} opts
 */
export async function launchBrowser({ proxy } = {}) {
  const browser = await chromium.launch({
    headless: true,
    proxy: proxy || undefined,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--window-position=0,0",
      "--ignore-certificate-errors",
      "--ignore-certificate-errors-spki-list",
      // Prevent WebRTC from leaking the local/ISP IP addresses
      "--disable-features=WebRtcHideLocalIpsWithMdns",
      "--disable-webrtc",
    ],
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

/**
 * Map location or proxy labels to matching IANA timezone IDs to align with proxy locations
 */
export function getTimezoneForLocation(location) {
  if (!location) return null;
  const loc = String(location).toLowerCase().replace(/[^a-z0-9]/g, "");
  
  if (loc.includes("toronto") || loc.includes("ontario") || loc.includes("ca")) return "America/Toronto";
  if (loc.includes("newyork") || loc.includes("nyc") || loc.includes("ny") || loc.includes("us")) return "America/New_York";
  if (loc.includes("chicago") || loc.includes("il")) return "America/Chicago";
  if (loc.includes("losangeles") || loc.includes("la") || loc.includes("ca")) return "America/Los_Angeles";
  if (loc.includes("vancouver") || loc.includes("bc")) return "America/Vancouver";
  if (loc.includes("london") || loc.includes("uk") || loc.includes("gb")) return "Europe/London";
  if (loc.includes("paris") || loc.includes("fr")) return "Europe/Paris";
  if (loc.includes("berlin") || loc.includes("de")) return "Europe/Berlin";
  if (loc.includes("tokyo") || loc.includes("jp")) return "Asia/Tokyo";
  if (loc.includes("sydney") || loc.includes("au")) return "Australia/Sydney";
  
  return null;
}

export function defaultContextOptions(fingerprintData, extra = {}) {
  const locale = fingerprintData.fingerprint.navigator.language || "en-US";
  return {
    userAgent: fingerprintData.fingerprint.navigator.userAgent,
    viewport: { 
      width: fingerprintData.fingerprint.screen.width, 
      height: fingerprintData.fingerprint.screen.height 
    },
    locale,
    timezoneId: extra.timezoneId || undefined,
    permissions: ["geolocation"],
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      "accept-language": `${locale},en;q=0.9`,
    },
    ...extra,
  };
}
