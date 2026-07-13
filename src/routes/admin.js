import express from "express";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { 
  getSearches, 
  addSearch, 
  deleteSearch, 
  getAccounts, 
  updateAccountStatus, 
  updateAccountAssignment, 
  updateAccountFallback,
  deleteAccount, 
  getPollingMetrics, 
  syncAccountsWithDisk
} from "../db.js";
import { loadCookieFiles } from "../sessions.js";
import { getSystemLogs } from "../logger.js";

const router = express.Router();

// Middleware to protect admin routes
router.use((req, res, next) => {
  const key = req.headers["x-api-key"];
  if (config.apiKey && key !== config.apiKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// --- Searches ---
router.get("/searches", (req, res) => {
  res.json(getSearches());
});

router.post("/searches", (req, res) => {
  const { platform, keyword, location, minPrice, maxPrice, fbAccountId } = req.body;
  if (!platform || !keyword) {
    return res.status(400).json({ error: "platform and keyword are required" });
  }
  const id = addSearch({ platform, keyword, location, minPrice, maxPrice });

  // If a specific Facebook account was selected, assign it to this new search
  if (platform === "facebook" && fbAccountId) {
    updateAccountAssignment(fbAccountId, id);
  }

  res.json({ success: true, id });
});

router.delete("/searches/:id", (req, res) => {
  deleteSearch(req.params.id);
  res.json({ success: true });
});

// --- Proxies ---
router.get("/proxies", (req, res) => {
  try {
    const proxies = fs.readFileSync(config.facebook.proxyFile, "utf-8");
    res.json({ proxies });
  } catch (err) {
    res.json({ proxies: "" }); // file might not exist
  }
});

router.post("/proxies", (req, res) => {
  const { proxies } = req.body;
  try {
    fs.mkdirSync(path.dirname(config.facebook.proxyFile), { recursive: true });
    fs.writeFileSync(config.facebook.proxyFile, proxies || "");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Facebook Cookies ---
router.get("/cookies", (req, res) => {
  try {
    const files = fs.readdirSync(config.facebook.cookiesDir).filter(f => f.endsWith(".json"));
    res.json({ cookies: files });
  } catch (err) {
    res.json({ cookies: [] });
  }
});

router.post("/cookies", (req, res) => {
  const { filename, content } = req.body;
  if (!filename || !content) {
    return res.status(400).json({ error: "filename and content required" });
  }
  try {
    let normalizedContent = content;
    if (Array.isArray(content)) {
      // Convert EditThisCookie array format to Playwright storageState format
      normalizedContent = { cookies: content, origins: [] };
    }
    
    // Normalize sameSite attributes to match Playwright's strict schema (Strict, Lax, None)
    if (normalizedContent.cookies && Array.isArray(normalizedContent.cookies)) {
      normalizedContent.cookies = normalizedContent.cookies.map(c => {
        let sameSite = "None";
        if (typeof c.sameSite === "string") {
          const lower = c.sameSite.toLowerCase();
          if (lower === "lax") sameSite = "Lax";
          else if (lower === "strict") sameSite = "Strict";
          else if (lower === "none" || lower === "no_restriction" || lower === "unspecified") sameSite = "None";
        }
        return { ...c, sameSite };
      });
    }

    fs.mkdirSync(config.facebook.cookiesDir, { recursive: true });
    fs.writeFileSync(path.join(config.facebook.cookiesDir, filename), JSON.stringify(normalizedContent, null, 2));
    
    // Sync DB with disk
    const filenames = loadCookieFiles().map(p => path.basename(p));
    syncAccountsWithDisk(filenames);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/cookies/:filename", (req, res) => {
  try {
    const target = path.join(config.facebook.cookiesDir, path.basename(req.params.filename));
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
    
    // Sync DB with disk
    const filenames = loadCookieFiles().map(p => path.basename(p));
    syncAccountsWithDisk(filenames);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Accounts ---
router.get("/accounts", (req, res) => {
  res.json(getAccounts());
});

router.post("/accounts/status", (req, res) => {
  const { id, status } = req.body;
  if (!id || !status) {
    return res.status(400).json({ error: "id and status required" });
  }
  updateAccountStatus(id, status);
  res.json({ success: true });
});

router.post("/accounts/assign", (req, res) => {
  const { id, searchId } = req.body;
  if (!id) {
    return res.status(400).json({ error: "id required" });
  }
  try {
    updateAccountAssignment(id, searchId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/accounts/fallback", (req, res) => {
  const { id, fallbackId } = req.body;
  if (!id) {
    return res.status(400).json({ error: "id required" });
  }
  try {
    updateAccountFallback(id, fallbackId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Metrics ---
router.get("/metrics", (req, res) => {
  res.json(getPollingMetrics());
});

router.get("/logs", (req, res) => {
  res.json({ logs: getSystemLogs() });
});

export default router;
