import fs from "node:fs";
import admin from "firebase-admin";
import { config } from "./config.js";

let messaging = null;

/** Lazily initialize the Firebase Admin SDK from the service account file. */
function getMessaging() {
  if (messaging) return messaging;
  const file = config.fcm.serviceAccountFile;
  if (!file || !fs.existsSync(file)) {
    console.warn("[notify] FCM service account not configured — push disabled.");
    return null;
  }
  const serviceAccount = JSON.parse(fs.readFileSync(file, "utf8"));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  messaging = admin.messaging();
  return messaging;
}

/**
 * Send one FCM push per new listing to a topic. Your mobile app subscribes
 * clients to topics (e.g. per-city or per-search) and Firebase fans out.
 * @param {Array<object>} listings normalized listings
 * @param {string} [topic] override the default topic
 */
export async function pushNewListings(listings, topic = config.fcm.defaultTopic) {
  if (listings.length === 0) return;

  const m = getMessaging();
  const { botToken, chatId } = config.telegram;

  for (const l of listings) {
    // 1. Send FCM Push if configured
    if (m) {
      const message = {
        topic,
        notification: {
          title: `New on ${l.platform}: ${l.title ?? "listing"}`,
          body: [l.price != null ? `$${l.price}` : null, l.location].filter(Boolean).join(" · "),
        },
        data: {
          id: String(l.id ?? ""),
          url: l.url ?? "",
          image: l.image ?? "",
          platform: l.platform ?? "",
          listed_at: l.listed_at ?? "",
        },
      };
      try {
        await m.send(message);
      } catch (err) {
        console.error(`[notify] FCM send failed for ${l.platform}:${l.id}:`, err.message);
      }
    }

    // 2. Send Telegram Message if configured
    if (botToken && chatId) {
      const text = `🚨 **New on ${l.platform}**\n\n**${l.title}**\n💰 Price: ${l.price != null ? `$${l.price}` : "N/A"}\n📍 Location: ${l.location || "N/A"}\n\n🔗 [View Listing](${l.url})`;
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: "Markdown"
          }),
        });
      } catch (err) {
        console.error(`[notify] Telegram send failed for ${l.platform}:${l.id}:`, err.message);
      }
    }
  }
}

/**
 * Sends a health alert notification to operators via Telegram and FCM.
 * @param {string} text the message text
 */
export async function pushAlert(text) {
  const m = getMessaging();
  const { botToken, chatId } = config.telegram;

  // 1. Send FCM Alert
  if (m) {
    const message = {
      topic: "alerts",
      notification: {
        title: "⚠️ Scraper Alert",
        body: text,
      },
    };
    try {
      await m.send(message);
      console.log("[notify] Sent FCM health alert");
    } catch (err) {
      console.error("[notify] FCM health alert send failed:", err.message);
    }
  }

  // 2. Send Telegram Alert
  if (botToken && chatId) {
    const markdownText = `⚠️ **Scraper System Alert**\n\n${text}`;
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: markdownText,
          parse_mode: "Markdown"
        }),
      });
      console.log("[notify] Sent Telegram health alert");
    } catch (err) {
      console.error("[notify] Telegram health alert send failed:", err.message);
    }
  }
}
