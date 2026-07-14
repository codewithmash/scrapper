import fs from "node:fs";
import admin from "firebase-admin";
import { config } from "./config.js";
import { addNotificationEvent } from "./notificationEvents.js";

// Firebase Admin initialized with renamed root file

let messaging = null;

/** Lazily initialize the Firebase Admin SDK from the service account file. */
function getMessaging() {
  if (messaging) return messaging;
  const file = config.fcm.serviceAccountFile;
  if (!file || !fs.existsSync(file)) {
    console.warn("[notify] FCM service account not configured \u2014 push disabled.");
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
          body: [l.price != null ? `${l.currency || '$'}${l.price}` : null, l.location].filter(Boolean).join(" \u00b7 "),
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
        addNotificationEvent({ channel: 'FCM', status: 'sent', title: `New: ${l.title?.slice(0, 50)}`, platform: l.platform });
      } catch (err) {
        console.error(`[notify] FCM send failed for ${l.platform}:${l.id}:`, err.message);
        addNotificationEvent({ channel: 'FCM', status: 'failed', title: `FCM failed: ${err.message?.slice(0, 60)}`, platform: l.platform });
      }
    }

    // 2. Send Telegram Message if configured
    if (botToken && chatId) {
      const caption = `\u{1F6A8} *New on ${l.platform}*\n\n*${l.title}*\n\ud83d\udcb0 Price: ${l.price != null ? `${l.currency || '$'}${l.price}` : "N/A"}\n\ud83d\udccd Location: ${l.location || "N/A"}\n\n\u{1F517} [View Listing](${l.url})`;
      try {
        // Try sendPhoto first if image is available
        if (l.image) {
          const photoRes = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              photo: l.image,
              caption,
              parse_mode: "Markdown"
            }),
          });
          const photoJson = await photoRes.json();
          // If sendPhoto fails (e.g. bad URL), fall back to text message
          if (!photoJson.ok) throw new Error(photoJson.description || "sendPhoto failed");
        } else {
          throw new Error("no image"); // Skip to sendMessage
        }
        addNotificationEvent({ channel: 'Telegram', status: 'sent', title: `New: ${l.title?.slice(0, 50)}`, platform: l.platform });
      } catch (_photoErr) {
        // Fallback: plain text message
        try {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: caption,
              parse_mode: "Markdown"
            }),
          });
          addNotificationEvent({ channel: 'Telegram', status: 'sent', title: `New: ${l.title?.slice(0, 50)}`, platform: l.platform });
        } catch (err) {
          console.error(`[notify] Telegram send failed for ${l.platform}:${l.id}:`, err.message);
          addNotificationEvent({ channel: 'Telegram', status: 'failed', title: `TG failed: ${err.message?.slice(0, 60)}`, platform: l.platform });
        }
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
        title: "\u26a0\ufe0f Scraper Alert",
        body: text,
      },
    };
    try {
      await m.send(message);
      console.log("[notify] Sent FCM health alert");
      addNotificationEvent({ channel: 'FCM', status: 'sent', title: `Alert: ${text?.slice(0, 300)}`, platform: 'system' });
    } catch (err) {
      console.error("[notify] FCM health alert send failed:", err.message);
      addNotificationEvent({ channel: 'FCM', status: 'failed', title: `FCM alert failed: ${err.message?.slice(0, 60)}`, platform: 'system' });
    }
  }

  // 2. Send Telegram Alert
  if (botToken && chatId) {
    const markdownText = `\u26a0\ufe0f **Scraper System Alert**\n\n${text}`;
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
      addNotificationEvent({ channel: 'Telegram', status: 'sent', title: `Alert: ${text?.slice(0, 300)}`, platform: 'system' });
    } catch (err) {
      console.error("[notify] Telegram health alert send failed:", err.message);
      addNotificationEvent({ channel: 'Telegram', status: 'failed', title: `TG alert failed: ${err.message?.slice(0, 60)}`, platform: 'system' });
    }
  }
}
