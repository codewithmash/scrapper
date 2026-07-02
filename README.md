# Marketplace Alert Backend

Real-time new-listing monitor for **eBay**, **OfferUp**, and **Facebook Marketplace**.
Polls each platform on its own interval, deduplicates against already-seen listing
IDs, exposes a REST endpoint your existing dashboard can poll, and sends push
notifications via Firebase Cloud Messaging (FCM).

Output for every platform matches this exact shape:

```json
{
  "id": "listing_id",
  "title": "Item title",
  "price": 150,
  "location": "Toronto, Ontario",
  "url": "https://...",
  "image": "https://...",
  "platform": "facebook",
  "listed_at": "2026-06-30T12:00:00Z"
}
```

---

## Architecture

```
scheduler.js ──> scrapers/{ebay,offerup,facebook}.js ──> normalize.js
     │                                                        │
     │                                          filterAndRecordNew() (db.js, SQLite dedup)
     │                                                        │
     └────────────> only NEW listings ──> notify.js (FCM push)
                                        └─> stored, served by routes/listings.js (REST)
```

- **Dedup** lives in SQLite (`data/seen.db`), keyed on `(platform, listing_id)`.
- **Scheduler** uses self-rescheduling `setTimeout` loops (no overlap) with ±20% jitter.
- **REST**: your dashboard polls `GET /api/listings/new` and fans out to users.

---

## Quick start (local)

```bash
npm install                 # also runs `playwright install chromium`
cp .env.example .env        # then edit values
npm start
```

Test an individual scraper without running the whole server:

```bash
npm run test:ebay "iphone 15"
npm run test:offerup "dyson"
npm run test:facebook "bike" "toronto"   # needs a cookie file, see below
```

---

## Configuration (`.env`)

| Var | Meaning |
|-----|---------|
| `PORT` | HTTP port (default 3000) |
| `API_KEY` | Shared secret; callers must send it as `x-api-key`. Leave empty only for local testing. |
| `EBAY_POLL_SECONDS` / `OFFERUP_POLL_SECONDS` / `FACEBOOK_POLL_SECONDS` | Poll intervals per the spec (60 / 150 / 210 defaults). |
| `SEARCHES` | JSON array of unique searches to poll (see below). |
| `FB_COOKIES_DIR` | Folder of Facebook session cookie files. |
| `FB_PROXY_FILE` | Proxy list, one `host:port:user:pass` per line. |
| `FCM_SERVICE_ACCOUNT_FILE` | Firebase service-account JSON path. |
| `FCM_DEFAULT_TOPIC` | Topic new-listing pushes are published to. |
| `DB_PATH` | SQLite file path. |

### Defining searches

`SEARCHES` is a deduplicated list of what to monitor. Poll the *unique* searches
once and let your dashboard fan each result out to every subscribed user — this
keeps request volume (and detection risk) far lower than polling per-user.

```json
[
  { "platform": "ebay",     "keyword": "iphone 15", "location": "US",      "minPrice": 0, "maxPrice": 800 },
  { "platform": "offerup",  "keyword": "dyson",     "location": "toronto", "minPrice": 0, "maxPrice": 400 },
  { "platform": "facebook", "keyword": "bike",      "location": "toronto", "minPrice": 0, "maxPrice": 500 }
]
```

- **eBay** `location` is informational (RSS doesn't filter by city); use keyword + price.
- **OfferUp** `location` is the city as OfferUp slugs it.
- **Facebook** `location` is the Marketplace place slug in the URL
  (`facebook.com/marketplace/<slug>/search`), e.g. `toronto`, `nyc`, or a numeric place id.

---

## REST API

Auth: send `x-api-key: <API_KEY>` on every request.

```
GET /api/listings/new?sinceSeconds=600&platform=ebay&limit=500
```

- `sinceSeconds` — how far back to return newly-seen listings (default 600, max 86400).
- `platform` — optional filter (`ebay` | `offerup` | `facebook`).
- `limit` — max rows (default 500, max 2000).

Returns a JSON array of listing objects in the shape above — the same structure
your current Apify setup produces, so the dashboard needs no changes.

```
GET /health   ->  { "ok": true, "ts": "..." }
```

---

## Firebase Cloud Messaging

1. In the Firebase console: Project settings → Service accounts → **Generate new private key**.
2. Save the JSON to `secrets/firebase-service-account.json` (or set `FCM_SERVICE_ACCOUNT_FILE`).
3. Your app subscribes each client to a topic (default `new-listings`, or per-city topics).
4. When new listings appear, one push is sent per listing to that topic, with a
   `data` payload (`id`, `url`, `image`, `platform`, `listed_at`) for deep-linking.

If the service account isn't configured, the app still runs and serves the REST
endpoint — it just logs that push is disabled.

---

## eBay

Uses eBay's public search **RSS** feed (`&_rss=1`, sorted by newly-listed
`_sop=10`). Free, no accounts, no proxies. If eBay ever degrades the RSS feed,
switch to the official **Browse API** (`/buy/browse/v1/item_summary/search`,
free app token, filter `sort=newlyListed`) — it returns the same fields and the
normalizer won't need to change.

## OfferUp

Lightweight Playwright scraper that loads the search results page and captures
the JSON the page fetches, then normalizes it. Filters by keyword and price band.

## Facebook Marketplace — scope & limitations (READ THIS)

This scraper uses **standard Playwright** with the session cookies and proxy you
supply. It:

- loads one or more cookie files (Playwright `storageState` format) from `FB_COOKIES_DIR`,
- routes traffic through the proxies in `FB_PROXY_FILE`,
- opens the Marketplace search sorted by newest, intercepts the `/api/graphql`
  responses, and parses listing nodes,
- rotates to the next cookie file if a session hits a login/checkpoint wall
  (ordinary failover across the accounts you provide).

**It deliberately does NOT include:**

- stealth / device-fingerprint spoofing,
- CAPTCHA / checkpoint solving or any challenge bypass,
- account "warming" or creation.

Facebook actively detects automation. Because this code does not attempt to
defeat that detection, sessions **can be rate-limited or blocked**, and the
page/GraphQL structure changes periodically, which means the Facebook parser
will need occasional maintenance. That fragility is inherent to this target, not
a bug in the code. Plan operationally for it: monitor the logs, keep valid
cookie files fresh, and treat Facebook as best-effort rather than guaranteed.

### Adding / rotating Facebook cookies

1. Log into an account in a real browser, then export its storage state to JSON
   (Playwright `context.storageState({ path: 'acct1.json' })`, or any cookie
   exporter that produces the Playwright storageState format).
2. Drop the file(s) into `FB_COOKIES_DIR` (e.g. `secrets/fb-cookies/acct1.json`).
   Any number of `*.json` files are picked up automatically and round-robined.
3. When a session stops working, replace or remove that file — no code change or
   redeploy needed; the rotator re-reads the directory each cycle.

### Rotating proxies

Put one proxy per line in `FB_PROXY_FILE`:

```
host:port:username:password
host:port:username:password
```

They're assigned round-robin alongside cookie files. Edit the file to add/remove
proxies; no redeploy required.

---

## Deployment (Railway / Render)

Chromium needs real memory — **the free tiers will OOM**. Use a paid starter
instance (≈512MB–1GB+). Two supported paths:

**A. Dockerfile (recommended, most reliable for Playwright)**
Both platforms can build from the included `Dockerfile`, which is based on the
official Playwright image (Chromium + all system libs preinstalled). Point the
service at the repo and it builds automatically.

**B. Native buildpack**
- **Render**: `render.yaml` is included (`buildCommand: npm install`,
  `startCommand: npm start`, health check `/health`, 1GB persistent disk for the DB).
- **Railway**: `railway.json` is included. Ensure Chromium system deps are
  present — the Dockerfile path avoids this entirely, so prefer it on Railway.

### Secrets on the host

Do **not** commit `secrets/` or `.env` (both are gitignored). On the host,
create the files at deploy time (Railway/Render secret files or a small startup
step) so these paths exist:

```
secrets/firebase-service-account.json
secrets/fb-cookies/*.json
secrets/proxies.txt
```

Set `API_KEY` and `SEARCHES` as environment variables in the dashboard.

---

## Operational notes for reliable, fast alerts

- **Dedup unique searches, fan out downstream.** One poll per unique search, not
  per user. This is the biggest lever for both cost and staying under rate limits.
- **eBay is your fastest, most reliable feed** (official RSS, 60s). Lean on it.
- **Jitter is on by default** (±20%) so polling isn't a rigid, botlike cadence.
- **Watch the logs** for `[facebook] session blocked` / `all sessions exhausted`
  — that's your signal to refresh cookies. Wire these to an uptime/alerting tool
  (e.g. healthchecks.io free tier) so you hear about outages immediately.
- **Legal/ToS:** automated scraping of Facebook and OfferUp is against their
  terms of service. eBay RSS/Browse API is permitted. Make sure the project
  owner understands and accepts that risk for the FB/OfferUp portions.
```
