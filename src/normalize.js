/**
 * Shared normalizer. Every scraper returns objects in this exact shape so the
 * REST API, dedup store, and dashboard all speak the same language.
 *
 * {
 *   "id": "listing_id",
 *   "title": "Item title",
 *   "price": 150,
 *   "location": "Toronto, Ontario",
 *   "url": "https://...",
 *   "image": "https://...",
 *   "platform": "facebook" | "offerup" | "ebay",
 *   "listed_at": "2026-06-30T12:00:00Z"
 * }
 */

/** Coerce a messy price string/number into a plain number (or null). */
export function parsePrice(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const digits = String(raw).replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = parseFloat(digits);
  return Number.isFinite(n) ? n : null;
}

/** Coerce any date-ish value to an ISO 8601 string, defaulting to now. */
export function toIso(value) {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Build a normalized listing. Missing optional fields become null so the
 * output shape is always stable.
 */
export function normalize({ id, title, price, location, url, image, platform, listed_at }) {
  return {
    id: id != null ? String(id) : null,
    title: title ? String(title).trim() : null,
    price: parsePrice(price),
    location: location ? String(location).trim() : null,
    url: url || null,
    image: image || null,
    platform,
    listed_at: toIso(listed_at),
  };
}

/**
 * Apply the caller's price band to a normalized list. Listings with an unknown
 * price are kept (so you don't silently drop items eBay/FB didn't price cleanly).
 */
export function withinPrice(listings, minPrice, maxPrice) {
  const min = minPrice ?? -Infinity;
  const max = maxPrice ?? Infinity;
  return listings.filter((l) => l.price == null || (l.price >= min && l.price <= max));
}
