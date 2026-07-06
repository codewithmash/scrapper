import "./logger.js";
import express from "express";
import { config } from "./config.js";
import listingsRouter from "./routes/listings.js";
import adminRouter from "./routes/admin.js";
import { startScheduler } from "./scheduler.js";

import path from "node:path";
import { syncAccountsWithDisk } from "./db.js";
import { loadCookieFiles } from "./sessions.js";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.use("/api/listings", listingsRouter);
app.use("/api/admin", adminRouter);

const server = app.listen(config.port, () => {
  console.log(`[server] listening on :${config.port}`);
  if (!config.apiKey) {
    console.warn("[server] API_KEY is empty — REST endpoint is UNAUTHENTICATED. Set one before production.");
  }
  
  // Synchronize FB accounts database table with physical cookie files on disk
  try {
    const filenames = loadCookieFiles().map(p => path.basename(p));
    syncAccountsWithDisk(filenames);
    console.log(`[db] Synced ${filenames.length} Facebook accounts from disk`);
  } catch (err) {
    console.error("[db] Failed to sync accounts from disk:", err.message);
  }

  startScheduler();
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[server] ❌ Error: Port ${config.port} is already in use by another process.`);
    console.error(`[server] Please stop any other running instances of the scraper or change the PORT in your .env file.`);
    process.exit(1);
  } else {
    console.error("[server] Server startup error:", err.message);
    process.exit(1);
  }
});
