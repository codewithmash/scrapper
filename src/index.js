import express from "express";
import { config } from "./config.js";
import listingsRouter from "./routes/listings.js";
import adminRouter from "./routes/admin.js";
import { startScheduler } from "./scheduler.js";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.use("/api/listings", listingsRouter);
app.use("/api/admin", adminRouter);

app.listen(config.port, () => {
  console.log(`[server] listening on :${config.port}`);
  if (!config.apiKey) {
    console.warn("[server] API_KEY is empty — REST endpoint is UNAUTHENTICATED. Set one before production.");
  }
  startScheduler();
});
