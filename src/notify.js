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
  const m = getMessaging();
  if (!m || listings.length === 0) return;

  for (const l of listings) {
    const message = {
      topic,
      notification: {
        title: `New on ${l.platform}: ${l.title ?? "listing"}`,
        body: [l.price != null ? `$${l.price}` : null, l.location].filter(Boolean).join(" · "),
      },
      // Data payload lets the app deep-link straight to the listing.
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
}
