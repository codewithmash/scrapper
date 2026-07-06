import "dotenv/config";

function num(name, fallback) {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

function parseSearches() {
  try {
    const arr = JSON.parse(process.env.SEARCHES ?? "[]");
    if (!Array.isArray(arr)) throw new Error("SEARCHES must be a JSON array");
    return arr;
  } catch (err) {
    console.error("Failed to parse SEARCHES env var:", err.message);
    return [];
  }
}

export const config = {
  port: num("PORT", 3000),
  apiKey: process.env.API_KEY || "",

  poll: {
    ebay: num("EBAY_POLL_SECONDS", 60),
    offerup: num("OFFERUP_POLL_SECONDS", 150),
    facebook: num("FACEBOOK_POLL_SECONDS", 210),
  },

  searches: parseSearches(),

  facebook: {
    cookiesDir: process.env.FB_COOKIES_DIR || "./secrets/fb-cookies",
    proxyFile: process.env.FB_PROXY_FILE || "./secrets/proxies.txt",
  },

  fcm: {
    serviceAccountFile: process.env.FCM_SERVICE_ACCOUNT_FILE || "",
    defaultTopic: process.env.FCM_DEFAULT_TOPIC || "new-listings",
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
  },

  dbPath: process.env.DB_PATH || "./data/seen.db",
};
