import express from "express";
import { getRecent } from "../db.js";
import { config } from "../config.js";

const router = express.Router();

// Simple shared-secret auth so only your dashboard can poll the endpoint.
router.use((req, res, next) => {
  if (!config.apiKey) return next(); // auth disabled if no key set
  const provided = req.get("x-api-key");
  if (provided !== config.apiKey) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

/**
 * GET /api/listings/new?sinceSeconds=600&platform=ebay&limit=500
 * Returns listings first seen recently, in the exact Apify-compatible JSON shape.
 * Your dashboard polls this and fans results out to subscribed users.
 */
router.get("/new", (req, res) => {
  const sinceSeconds = Math.min(parseInt(req.query.sinceSeconds ?? "600", 10) || 600, 86400);
  const limit = Math.min(parseInt(req.query.limit ?? "500", 10) || 500, 2000);
  const platform = req.query.platform;

  let items = getRecent({ sinceMs: sinceSeconds * 1000, limit });
  if (platform) items = items.filter((i) => i.platform === platform);

  res.json(items);
});

export default router;
