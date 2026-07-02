import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/**
 * Session/config plumbing for the Facebook scraper.
 *
 * NOTE ON SCOPE: this module only *loads* the cookie files and proxy list that
 * the operator supplies. It does not create accounts, "warm" them, spoof device
 * fingerprints, or solve challenges. Those anti-detection concerns are out of
 * scope for this codebase (see README > Scope & limitations).
 */

/** Load every *.json cookie file (Playwright storageState format) from a dir. */
export function loadCookieFiles() {
  const dir = config.facebook.cookiesDir;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f));
}

/** Parse a proxy list file with lines of the form host:port:user:pass. */
export function loadProxies() {
  const file = config.facebook.proxyFile;
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [host, port, username, password] = line.split(":");
      if (!host || !port) return null;
      return {
        server: `http://${host}:${port}`,
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
      };
    })
    .filter(Boolean);
}

/**
 * Round-robin selector shared across poll cycles. Given N cookie files and
 * M proxies, hands out a (cookieFile, proxy) pair each call. This is ordinary
 * failover/round-robin session management, not detection evasion.
 */
export function makeRotator() {
  let cIdx = 0;
  let pIdx = 0;
  return {
    next() {
      const cookies = loadCookieFiles();
      const proxies = loadProxies();
      if (cookies.length === 0) return { cookieFile: null, proxy: proxies[0] || null };
      const cookieFile = cookies[cIdx % cookies.length];
      const proxy = proxies.length ? proxies[pIdx % proxies.length] : null;
      cIdx++;
      pIdx++;
      return { cookieFile, proxy };
    },
    count() {
      return loadCookieFiles().length;
    },
  };
}
