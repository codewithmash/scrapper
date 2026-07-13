import { execFile } from "child_process";
import { promisify } from "util";
import Parser from "rss-parser";
import { normalize, withinPrice, parsePrice } from "../normalize.js";

const execFileAsync = promisify(execFile);
const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "media", { keepArray: true }],
      ["enclosure", "enclosure"],
    ],
  },
});

/**
 * eBay exposes an RSS feed for any search results page by appending &_rss=1.
 * We sort by newly-listed (_sop=10) so the freshest items are at the top.
 * This is a public, official feed — no proxies or accounts needed.
 */
function buildFeedUrl({ keyword, minPrice, maxPrice }) {
  const params = new URLSearchParams({
    _nkw: keyword,
    _sop: "10", // 10 = Time: newly listed
    _rss: "1",
  });
  if (minPrice != null) params.set("_udlo", String(minPrice));
  if (maxPrice != null) params.set("_udhi", String(maxPrice));
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

/** Pull an image URL out of whatever RSS field eBay populated. */
function extractImage(item) {
  if (Array.isArray(item.media) && item.media[0]?.$?.url) return item.media[0].$.url;
  if (item.enclosure?.url) return item.enclosure.url;
  const m = /<img[^>]+src="([^"]+)"/i.exec(item.content || item["content:encoded"] || "");
  return m ? m[1] : null;
}

/** Price sometimes only appears in the item description/title. */
function extractPrice(item) {
  const fromField = parsePrice(item.price);
  if (fromField != null) return fromField;
  const text = `${item.title || ""} ${item.contentSnippet || item.content || ""}`;
  const m = /(?:US\s*)?\$\s*([\d,]+(?:\.\d{2})?)/.exec(text);
  return m ? parsePrice(m[1]) : null;
}

/**
 * Scrape eBay newly-listed items for a search.
 * @param {{keyword:string, location?:string, minPrice?:number, maxPrice?:number}} search
 * @returns {Promise<Array<object>>} normalized listings
 */
export async function scrapeEbay(search) {
  const url = buildFeedUrl(search);
  const { stdout } = await execFileAsync("curl", ["-sL", "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", url]);
  const feed = await parser.parseString(stdout);

  const listings = (feed.items || []).map((item) => {
    // Extract multiple images from the media:content tags if available
    const images = [];
    const enclosureImage = item.enclosure?.url || null;
    if (enclosureImage) images.push(enclosureImage);
    
    if (Array.isArray(item.media)) {
      for (const m of item.media) {
        const url = m?.$?.url;
        if (url && !images.includes(url)) images.push(url);
      }
    }

    // eBay item GUID/link contains the numeric item id: .../itm/1234567890
    const idMatch = /\/(\d{9,})(?:[?#]|$)/.exec(item.link || item.guid || "");
    const id = idMatch ? idMatch[1] : item.guid || item.link;

    return normalize({
      id,
      title: item.title,
      price: extractPrice(item),
      location: search.location || null, // eBay RSS rarely gives item location
      url: item.link,
      image: images[0] || extractImage(item),
      images: images.length > 0 ? images : null,
      platform: "ebay",
      listed_at: item.isoDate || item.pubDate,
    });
  });

  return withinPrice(listings, search.minPrice, search.maxPrice);
}
