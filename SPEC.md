# Marketplace Alert Backend — System Specification

This document describes the backend as built: what each part does, how data flows,
configuration, and deployment. It is the honest scope of the delivered code.

## Purpose

Monitor eBay, OfferUp, and Facebook Marketplace for new listings by keyword /
location / price, deduplicate against already-seen listings, expose the results
to an existing dashboard over REST, and push alerts via Firebase Cloud Messaging.

## Data flow

1. `scheduler.js` runs one self-rescheduling loop per platform (eBay 60s,
   OfferUp 150s, Facebook 210s by default), each with ±20% jitter and no overlap.
2. Each loop runs every configured search for its platform through the matching
   scraper in `src/scrapers/`.
3. Every scraper returns listings through the shared `normalize.js`, producing
   this exact shape:
   `{ id, title, price, location, url, image, platform, listed_at }`.
4. `db.js` (`filterAndRecordNew`) inserts into SQLite keyed on
   `(platform, listing_id)`; only genuinely new rows pass through.
5. New rows are pushed via `notify.js` (FCM) and stored for the REST endpoint.
6. `routes/listings.js` serves `GET /api/listings/new` to the dashboard.

## Modules

- `config.js` — loads and validates env vars (intervals, searches, paths, keys).
- `browser.js` — plain Playwright Chromium launcher with optional proxy and a
  normal desktop context. No fingerprint spoofing.
- `sessions.js` — loads FB cookie files + proxy list and round-robins them
  (ordinary failover; no account creation or warming).
- `scrapers/ebay.js` — parses eBay's official search RSS feed (`&_rss=1`,
  `_sop=10` newest-first). Free, no accounts/proxies. Fully functional.
- `scrapers/offerup.js` — Playwright loads the search page and captures the JSON
  the page fetches; filters keyword/location/price.
- `scrapers/facebook.js` — Playwright loads Marketplace search (newest sort),
  intercepts `/api/graphql` responses, parses listing nodes, uses the
  operator-supplied cookies/proxies, and rotates cookie files on a login wall
  (stops, does not bypass).
- `db.js` — SQLite dedup store + recent-listings query.
- `normalize.js` — shared normalizer + price/date coercion + price-band filter.
- `notify.js` — Firebase Admin FCM topic push, one per new listing.
- `routes/listings.js` — API-key-guarded REST endpoint.
- `index.js` — Express app + starts the scheduler.

## Configuration

All via `.env` (see `.env.example`): `PORT`, `API_KEY`, the three
`*_POLL_SECONDS`, `SEARCHES` (JSON array of unique searches), `FB_COOKIES_DIR`,
`FB_PROXY_FILE`, `FCM_SERVICE_ACCOUNT_FILE`, `FCM_DEFAULT_TOPIC`, `DB_PATH`.

## REST API

`GET /api/listings/new?sinceSeconds=&platform=&limit=` (header `x-api-key`) →
JSON array of listings in the shape above. `GET /health` → liveness.

## Deployment

`Dockerfile` (official Playwright image, recommended), plus `render.yaml` and
`railway.json`. Requires a paid instance with real RAM (Chromium OOMs on free
tiers). Secrets (`secrets/…`) supplied on the host, never committed.

## Status of deliverables

- Built and syntax-clean: all modules above.
- NOT yet verified against live sites: no scraper has been executed end-to-end;
  expect selector/JSON-shape adjustments on first real run (esp. OfferUp / FB).
- NOT deployed: configs provided; deployment is an operator step.

## Out of scope (operator-provided)

- Facebook anti-bot **detection evasion**: stealth/fingerprint spoofing,
  CAPTCHA/checkpoint solving, ban circumvention, and account warming/creation.
  These are intentionally NOT part of this codebase. The Facebook scraper works
  with operator-supplied valid sessions and proxies and degrades gracefully
  (skip + rotate) when blocked; it does not attempt to defeat detection.
