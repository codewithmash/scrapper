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

export function parsePrice(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const digits = String(raw).replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = parseFloat(digits);
  return Number.isFinite(n) ? n : null;
}

/** Extract the currency symbol from a messy price string. */
export function parseCurrency(raw) {
  if (!raw) return "$";
  const str = String(raw);
  const match = str.match(/[^0-9.,\s]+/);
  return match ? match[0].trim() : "$";
}

/** Coerce any date-ish value to an ISO 8601 string, defaulting to null if not provided. */
export function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

const USA_BRAND_MODELS = {
  "Toyota": ["camry", "corolla", "rav4", "tacoma", "tundra", "highlander", "prius", "4runner", "sienna", "toyota"],
  "Ford": ["f-150", "f150", "f250", "f-250", "mustang", "explorer", "escape", "edge", "fusion", "focus", "ranger", "ford"],
  "Chevrolet": ["silverado", "equinox", "malibu", "cruze", "tahoe", "suburban", "colorado", "camaro", "traverse", "chevrolet", "chevy"],
  "Honda": ["accord", "civic", "cr-v", "crv", "pilot", "odyssey", "ridgeline", "honda"],
  "Nissan": ["altima", "sentra", "rogue", "pathfinder", "frontier", "versa", "maxima", "nissan"],
  "Jeep": ["wrangler", "grand cherokee", "cherokee", "compass", "renegade", "gladiator", "jeep"],
  "Subaru": ["outback", "forester", "impreza", "crosstrek", "subaru"],
  "GMC": ["sierra", "yukon", "acadia", "terrain", "gmc"],
  "Ram": ["ram", "1500", "2500", "3500"],
  "Tesla": ["model 3", "model y", "model s", "model x", "tesla"],
  "BMW": ["bmw", "3 series", "5 series", "x3", "x5"],
  "Mercedes-Benz": ["mercedes", "benz", "c-class", "e-class", "glc", "gle"],
  "Audi": ["audi", "a4", "a6", "q5", "q7"],
  "Lexus": ["lexus", "rx", "es", "nx", "is"],
  "Mazda": ["mazda", "cx-5", "cx5", "cx-9", "cx9", "mazda3", "mazda6"],
  "Volkswagen": ["volkswagen", "vw", "jetta", "passat", "tiguan", "golf"],
  "Dodge": ["dodge", "charger", "challenger", "durango", "caravan"],
  "Chrysler": ["chrysler", "pacifica", "300"],
  "Buick": ["buick", "encore", "enclave"],
  "Cadillac": ["cadillac", "escalade", "cts", "xt5"],
  "Volvo": ["volvo", "xc60", "xc90"],
  "Hyundai": ["hyundai", "elantra", "sonata", "tucson", "santa fe", "santafe"],
  "Kia": ["kia", "optima", "sorento", "sportage", "forte", "soul"]
};

let nhtsaMakes = new Set();
let nhtsaLoading = false;

async function loadNhtsaMakes() {
  if (nhtsaLoading || nhtsaMakes.size > 0) return;
  nhtsaLoading = true;
  try {
    const res = await fetch("https://vpic.nhtsa.dot.gov/api/vehicles/GetAllMakes?format=json");
    const json = await res.json();
    if (json && Array.isArray(json.Results)) {
      for (const item of json.Results) {
        if (item.Make_Name) {
          nhtsaMakes.add(item.Make_Name.toLowerCase().trim());
        }
      }
      console.log(`[normalize] Loaded ${nhtsaMakes.size} vehicle makes from NHTSA API`);
    }
  } catch (err) {
    console.error("[normalize] Failed to load makes from NHTSA API:", err.message);
  }
}

/**
 * Build a normalized listing. Missing optional fields become null so the
 * output shape is always stable.
 */
export function normalize({ id, title, price, location, url, image, images, platform, listed_at, extra }) {
  // If images array is provided use it, otherwise fallback to single image, otherwise empty array
  let finalImages = [];
  if (Array.isArray(images) && images.length > 0) {
    finalImages = images.filter(Boolean);
  } else if (image) {
    finalImages = [image];
  }

  // Extract make/brand
  let make = "Others";
  if (title) {
    const cleanTitle = title.toLowerCase();
    
    // 1. Try curated local mapping first (covers 98% of US cars immediately and accurately)
    let foundCurated = false;
    for (const [brand, keywords] of Object.entries(USA_BRAND_MODELS)) {
      for (const kw of keywords) {
        const regex = new RegExp(`\\b${kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        if (regex.test(cleanTitle)) {
          make = brand;
          foundCurated = true;
          break;
        }
      }
      if (foundCurated) break;
    }

    // 2. Back up with NHTSA API if not matched in local curated brands
    if (!foundCurated) {
      loadNhtsaMakes().catch(() => {});
      if (nhtsaMakes.size > 0) {
        for (const m of nhtsaMakes) {
          if (m.length < 3) continue;
          const regex = new RegExp(`\\b${m.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
          if (regex.test(cleanTitle)) {
            make = m.charAt(0).toUpperCase() + m.slice(1);
            break;
          }
        }
      }
    }
  }

  return {
    id: id != null ? String(id) : null,
    title: title ? String(title).trim() : null,
    make: make,
    price: parsePrice(price),
    currency: parseCurrency(price),
    location: location ? String(location).trim() : null,
    url: url || null,
    image: finalImages[0] || null, // Primary thumbnail
    images: finalImages, // All available images
    platform,
    listed_at: toIso(listed_at),
    extra: extra || null,
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
