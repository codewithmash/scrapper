import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { loadProxies } from "./sessions.js";

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

  CREATE TABLE IF NOT EXISTS facebook_accounts (
    id                   TEXT PRIMARY KEY,
    status               TEXT NOT NULL DEFAULT 'healthy',
    assigned_search_id   INTEGER DEFAULT NULL,
    error_count          INTEGER DEFAULT 0,
    success_count        INTEGER DEFAULT 0,
    last_used            TEXT,
    created_at           TEXT DEFAULT CURRENT_TIMESTAMP,
    assigned_proxy       TEXT,
    fallback_for_account_id TEXT DEFAULT NULL,
    FOREIGN KEY(assigned_search_id) REFERENCES searches(id) ON DELETE SET NULL,
    FOREIGN KEY(fallback_for_account_id) REFERENCES facebook_accounts(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS health_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id   TEXT,
    timestamp    TEXT DEFAULT CURRENT_TIMESTAMP,
    type         TEXT NOT NULL,
    message      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS polling_metrics (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp    TEXT DEFAULT CURRENT_TIMESTAMP,
    platform     TEXT NOT NULL,
    search_id    INTEGER NOT NULL,
    success      INTEGER NOT NULL,
    duration_ms  INTEGER NOT NULL,
    items_found  INTEGER NOT NULL,
    account_id   TEXT DEFAULT NULL
  );
`);

// Migration: add assigned_proxy column to facebook_accounts if not exists
try {
  db.exec("ALTER TABLE facebook_accounts ADD COLUMN assigned_proxy TEXT;");
} catch (e) {}

try {
  db.exec("ALTER TABLE facebook_accounts ADD COLUMN fallback_for_account_id TEXT DEFAULT NULL;");
} catch (e) {}


const getSearchesStmt = db.prepare("SELECT * FROM searches ORDER BY created_at ASC");
const addSearchStmt = db.prepare(`
  INSERT INTO searches (platform, keyword, location, minPrice, maxPrice)
  VALUES (@platform, @keyword, @location, @minPrice, @maxPrice)
`);
const deleteSearchStmt = db.prepare("DELETE FROM searches WHERE id = @id");

const addAccountStmt = db.prepare(`
  INSERT OR IGNORE INTO facebook_accounts (id, status)
  VALUES (@id, @status)
`);
const getAccountsStmt = db.prepare(`
  SELECT a.id, a.status, a.assigned_search_id, a.error_count, a.success_count, a.last_used, a.created_at, a.assigned_proxy, a.fallback_for_account_id, s.keyword as assigned_keyword, s.location as assigned_location
  FROM facebook_accounts a
  LEFT JOIN searches s ON a.assigned_search_id = s.id
  ORDER BY a.created_at DESC
`);
const updateAccountStatusStmt = db.prepare(`
  UPDATE facebook_accounts
  SET status = @status
  WHERE id = @id
`);
const updateAccountStatsSuccessStmt = db.prepare(`
  UPDATE facebook_accounts
  SET success_count = success_count + 1, error_count = 0, last_used = @last_used, status = 'healthy'
  WHERE id = @id
`);
const updateAccountStatsFailureStmt = db.prepare(`
  UPDATE facebook_accounts
  SET error_count = error_count + 1, last_used = @last_used
  WHERE id = @id
`);
const updateAccountAssignmentStmt = db.prepare("UPDATE facebook_accounts SET assigned_search_id = @searchId WHERE id = @id");
const updateAccountFallbackStmt = db.prepare("UPDATE facebook_accounts SET fallback_for_account_id = @fallbackId WHERE id = @id");
const updateAccountProxyStmt = db.prepare(`
  UPDATE facebook_accounts
  SET assigned_proxy = @proxy
  WHERE id = @id
`);
const updateAccountStatusWithErrorStmt = db.prepare(`
  UPDATE facebook_accounts
  SET error_count = @error_count, status = @status, last_used = @last_used
  WHERE id = @id
`);
const deleteAccountStmt = db.prepare(`
  DELETE FROM facebook_accounts
  WHERE id = @id
`);

const logHealthEventStmt = db.prepare(`
  INSERT INTO health_logs (account_id, type, message)
  VALUES (@account_id, @type, @message)
`);
const recordPollingMetricStmt = db.prepare(`
  INSERT INTO polling_metrics (platform, search_id, success, duration_ms, items_found, account_id)
  VALUES (@platform, @search_id, @success, @duration_ms, @items_found, @account_id)
`);

const insertStmt = db.prepare(
  `INSERT OR IGNORE INTO seen_listings (platform, listing_id, first_seen, payload)
   VALUES (@platform, @listing_id, @first_seen, @payload)`
);

const recentStmt = db.prepare(
  `SELECT payload FROM seen_listings
   WHERE first_seen >= @since
   ORDER BY COALESCE(json_extract(payload, '$.listed_at'), first_seen) DESC, first_seen DESC
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
  return rows.map((r) => {
    const item = JSON.parse(r.payload);
    item.first_seen = r.first_seen;
    return item;
  });
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

export function getAccounts() {
  return getAccountsStmt.all();
}

export function updateAccountStatus(id, status) {
  updateAccountStatusStmt.run({ id, status });
}

export function updateAccountStats(id, success) {
  const now = new Date().toISOString();
  if (success) {
    updateAccountStatsSuccessStmt.run({ id, last_used: now });
  } else {
    updateAccountStatsFailureStmt.run({ id, last_used: now });
  }
}

export function updateAccountAssignment(id, searchId) {
  // Map searchId correctly since we updated the statement parameter
  updateAccountAssignmentStmt.run({ id, searchId });
}

export function updateAccountFallback(id, fallbackId) {
  updateAccountFallbackStmt.run({ id, fallbackId: fallbackId || null });
}

export function updateAccountProxy(id, proxy) {
  updateAccountProxyStmt.run({ id, proxy: proxy || null });
}

/**
 * Mark a Facebook account as failed. Automatically escalates status:
 * - 1-2 errors => 'flagged'
 * - 3+ errors  => 'dead'
 * Returns the new status string so callers can log/alert.
 */
export function markAccountFailed(id, currentErrorCount) {
  const newErrCount = currentErrorCount + 1;
  const newStatus = newErrCount >= 3 ? "dead" : "flagged";
  updateAccountStatusWithErrorStmt.run({
    id,
    error_count: newErrCount,
    status: newStatus,
    last_used: new Date().toISOString(),
  });
  return { newErrCount, newStatus };
}

/**
 * Mark a Facebook account as having succeeded. Resets error_count to 0
 * and sets status back to 'healthy'.
 */
export function markAccountSuccess(id) {
  updateAccountStatsSuccessStmt.run({ id, last_used: new Date().toISOString() });
}

export function deleteAccount(id) {
  deleteAccountStmt.run({ id });
}

export function logHealthEvent(accountId, type, message) {
  logHealthEventStmt.run({ account_id: accountId, type, message });
}

export function recordPollingMetric(platform, searchId, success, durationMs, itemsFound, accountId) {
  recordPollingMetricStmt.run({
    platform,
    search_id: searchId,
    success: success ? 1 : 0,
    duration_ms: durationMs,
    items_found: itemsFound,
    account_id: accountId || null
  });
}

export function syncAccountsWithDisk(diskFiles) {
  const existing = db.prepare("SELECT id FROM facebook_accounts").all().map(a => a.id);
  const diskSet = new Set(diskFiles);
  
  const proxies = loadProxies();
  
  db.transaction(() => {
    // Add new ones
    for (const file of diskFiles) {
      if (!existing.includes(file)) {
        addAccountStmt.run({ id: file, status: "healthy" });
        // Assign a random proxy permanently to this new account
        if (proxies.length > 0) {
          const randomProxy = proxies[Math.floor(Math.random() * proxies.length)].key;
          updateAccountProxyStmt.run({ id: file, proxy: randomProxy });
        }
      }
    }
    // Delete retired ones
    for (const id of existing) {
      if (!diskSet.has(id)) {
        deleteAccountStmt.run({ id });
      }
    }
    // Reset status of all remaining accounts to healthy on startup so we retry them
    db.prepare("UPDATE facebook_accounts SET status = 'healthy', error_count = 0").run();
  })();
}

export function getPollingMetrics() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  // 1. Success Rate & Avg Duration per Search
  const metrics = db.prepare(`
    SELECT platform, search_id, success, duration_ms, items_found, timestamp 
    FROM polling_metrics 
    WHERE timestamp >= ?
  `).all(since);
  
  // 2. Health logs
  const logs = db.prepare(`
    SELECT id, account_id, timestamp, type, message 
    FROM health_logs 
    ORDER BY timestamp DESC 
    LIMIT 50
  `).all();
  
  // 3. Capture Latency from seen_listings
  const listings = db.prepare(`
    SELECT platform, first_seen, payload 
    FROM seen_listings 
    WHERE first_seen >= ?
  `).all(since);
  
  return { metrics, logs, listings };
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
