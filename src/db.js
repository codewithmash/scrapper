import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

// Ensure the directory for the SQLite file exists.
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS seen_listings (
    platform     TEXT NOT NULL,
    listing_id   TEXT NOT NULL,
    first_seen   TEXT NOT NULL,
    payload      TEXT NOT NULL,
    PRIMARY KEY (platform, listing_id)
  );
  CREATE INDEX IF NOT EXISTS idx_seen_first_seen ON seen_listings (first_seen);

  CREATE TABLE IF NOT EXISTS searches (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    platform     TEXT NOT NULL,
    keyword      TEXT NOT NULL,
    location     TEXT,
    minPrice     REAL,
    maxPrice     REAL,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

const getSearchesStmt = db.prepare("SELECT * FROM searches ORDER BY created_at ASC");
const addSearchStmt = db.prepare(`
  INSERT INTO searches (platform, keyword, location, minPrice, maxPrice)
  VALUES (@platform, @keyword, @location, @minPrice, @maxPrice)
`);
const deleteSearchStmt = db.prepare("DELETE FROM searches WHERE id = @id");

const insertStmt = db.prepare(
  `INSERT OR IGNORE INTO seen_listings (platform, listing_id, first_seen, payload)
   VALUES (@platform, @listing_id, @first_seen, @payload)`
);

const recentStmt = db.prepare(
  `SELECT payload FROM seen_listings
   WHERE first_seen >= @since
   ORDER BY first_seen DESC
   LIMIT @limit`
);

/**
 * Filters a batch of normalized listings down to the ones we have never seen,
 * and records the new ones. Returns only the genuinely new listings.
 * @param {Array<object>} listings normalized listing objects (must have id + platform)
 * @returns {Array<object>} the subset that is new
 */
export function filterAndRecordNew(listings) {
  const now = new Date().toISOString();
  const fresh = [];
  const tx = db.transaction((items) => {
    for (const item of items) {
      if (!item || !item.id || !item.platform) continue;
      const res = insertStmt.run({
        platform: item.platform,
        listing_id: String(item.id),
        first_seen: now,
        payload: JSON.stringify(item),
      });
      if (res.changes > 0) fresh.push(item);
    }
  });
  tx(listings);
  return fresh;
}

/**
 * Returns listings first seen within the last `sinceMs` milliseconds.
 * Used by the REST endpoint so the dashboard can poll for new items.
 */
export function getRecent({ sinceMs = 10 * 60 * 1000, limit = 500 } = {}) {
  const since = new Date(Date.now() - sinceMs).toISOString();
  const rows = recentStmt.all({ since, limit });
  return rows.map((r) => JSON.parse(r.payload));
}

export function getSearches() {
  return getSearchesStmt.all();
}

export function addSearch(search) {
  const res = addSearchStmt.run({
    platform: search.platform,
    keyword: search.keyword,
    location: search.location || null,
    minPrice: search.minPrice != null ? search.minPrice : null,
    maxPrice: search.maxPrice != null ? search.maxPrice : null
  });
  return res.lastInsertRowid;
}

export function deleteSearch(id) {
  deleteSearchStmt.run({ id });
}

// Migration from config on startup
const existing = getSearchesStmt.all();
if (existing.length === 0 && config.searches && config.searches.length > 0) {
  console.log("[db] Migrating searches from .env into SQLite...");
  const tx = db.transaction((searches) => {
    for (const s of searches) addSearch(s);
  });
  tx(config.searches);
}

export default db;
