import fs from 'fs';
import path from 'path';
import { addNotificationEvent } from './notificationEvents.js';

const logDir = './data';
const logFile = path.join(logDir, 'system.log');

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Clear old log file on startup
try {
  fs.writeFileSync(logFile, '', 'utf8');
} catch (e) {
  console.error("Failed to clear log file:", e.message);
}

const buffer = [];
const MAX_LINES = 200;

/**
 * Detect important system events from console output and add them
 * to the notification events system so they appear in the dashboard.
 */
function detectSystemEvent(type, message) {
  const lowMsg = message.toLowerCase();
  
  // --- Scraper lifecycle events ---
  if (lowMsg.includes('starting polling loops')) {
    addNotificationEvent({ channel: 'System', status: 'info', title: 'Scheduler Started', message: 'All polling loops initialized', platform: 'system' });
    return;
  }
  
  // Scraping started
  const scrapeStartMatch = message.match(/\[(\w+)\] 🔍 Scraping "(.+?)"\.\.\./);
  if (scrapeStartMatch) {
    addNotificationEvent({ channel: 'System', status: 'info', title: `${scrapeStartMatch[1].toUpperCase()} Scraping`, message: `Started: "${scrapeStartMatch[2]}"`, platform: scrapeStartMatch[1] });
    return;
  }
  
  // Scraping completed with results
  const scrapeDoneMatch = message.match(/\[(\w+)\] ✅ Found (\d+) total, (\d+) NEW — "(.+?)"/);
  if (scrapeDoneMatch) {
    const platform = scrapeDoneMatch[1];
    const total = parseInt(scrapeDoneMatch[2]);
    const fresh = parseInt(scrapeDoneMatch[3]);
    const keyword = scrapeDoneMatch[4];
    if (fresh > 0) {
      addNotificationEvent({ channel: 'System', status: 'sent', title: `✅ ${platform.toUpperCase()} scraped ${fresh} new items`, message: `"${keyword}" — ${total} total found`, platform });
    } else {
      addNotificationEvent({ channel: 'System', status: 'info', title: `${platform.toUpperCase()} scrape complete`, message: `"${keyword}" — ${total} items, 0 new`, platform });
    }
    return;
  }
  
  // Scraping failed
  const scrapeFailMatch = message.match(/\[(\w+)\] ❌ search "(.+?)" failed:/);
  if (scrapeFailMatch) {
    addNotificationEvent({ channel: 'System', status: 'error', title: `❌ ${scrapeFailMatch[1].toUpperCase()} scrape failed`, message: `"${scrapeFailMatch[2]}" — ${type === 'error' ? 'Error occurred' : 'Check logs'}`, platform: scrapeFailMatch[1] });
    return;
  }
  
  // Loop error
  const loopErrMatch = message.match(/\[(\w+)\] loop error:/);
  if (loopErrMatch) {
    addNotificationEvent({ channel: 'System', status: 'error', title: `⚠️ ${loopErrMatch[1].toUpperCase()} loop error`, message: message.slice(0, 100), platform: loopErrMatch[1] });
    return;
  }
  
  // --- Facebook account events ---
  if (lowMsg.includes('no active facebook accounts')) {
    addNotificationEvent({ channel: 'System', status: 'error', title: 'No Active FB Accounts', message: 'No active Facebook accounts available for scraping', platform: 'facebook' });
    return;
  }
  
  if (lowMsg.includes('all sessions exhausted')) {
    addNotificationEvent({ channel: 'System', status: 'error', title: 'All FB Sessions Exhausted', message: 'All Facebook accounts failed — scraping halted for this cycle', platform: 'facebook' });
    return;
  }
  
  if (lowMsg.includes('session blocked')) {
    const blockMatch = message.match(/Session blocked → ([^\s]+)/);
    addNotificationEvent({ channel: 'System', status: 'error', title: 'FB Session Blocked', message: blockMatch ? `Blocked at: ${blockMatch[1]}` : 'Login/captcha/block page detected', platform: 'facebook' });
    return;
  }
  
  if (lowMsg.includes('found 0 listings') && lowMsg.includes('taking debug')) {
    addNotificationEvent({ channel: 'System', status: 'warning', title: 'FB Found 0 Listings', message: 'Search returned no results — possible geo/account issue', platform: 'facebook' });
    return;
  }
  
  // Account attempt failure
  const attemptFailMatch = message.match(/\[facebook\] Attempt with ([^ ]+) failed:/);
  if (attemptFailMatch) {
    addNotificationEvent({ channel: 'System', status: 'error', title: `FB Account Failed: ${attemptFailMatch[1]}`, message: message.slice(0, 120), platform: 'facebook' });
    return;
  }
  
  // --- OfferUp events ---
  if (lowMsg.includes('geo-blocked') || lowMsg.includes('no data via')) {
    addNotificationEvent({ channel: 'System', status: 'warning', title: 'OfferUp Geo-Blocked', message: 'OfferUp blocked request — trying next proxy', platform: 'offerup' });
    return;
  }
  
  if (lowMsg.includes('all proxies exhausted') && lowMsg.includes('offerup')) {
    addNotificationEvent({ channel: 'System', status: 'error', title: 'OfferUp All Proxies Exhausted', message: 'All proxies failed for OfferUp scraping', platform: 'offerup' });
    return;
  }
  
  // --- Server events ---
  const serverListenMatch = message.match(/listening on :(\d+)/);
  if (serverListenMatch) {
    addNotificationEvent({ channel: 'System', status: 'info', title: 'Server Started', message: `Listening on port ${serverListenMatch[1]}`, platform: 'system' });
    return;
  }
  
  // API_KEY is empty warning
  if (lowMsg.includes('api_key is empty')) {
    addNotificationEvent({ channel: 'System', status: 'warning', title: '⚠️ API Key Not Set', message: 'REST endpoints are UNAUTHENTICATED! Set API_KEY in .env before production.', platform: 'system' });
    return;
  }
  
  // FCM not configured
  if (lowMsg.includes('fcm service account not configured')) {
    addNotificationEvent({ channel: 'System', status: 'warning', title: 'FCM Not Configured', message: 'Firebase Cloud Messaging push notifications are disabled', platform: 'system' });
    return;
  }
  
  const syncMatch = message.match(/Synced (\d+) Facebook accounts from disk/);
  if (syncMatch) {
    addNotificationEvent({ channel: 'System', status: 'info', title: 'FB Accounts Synced', message: `${syncMatch[1]} accounts loaded from disk`, platform: 'facebook' });
    return;
  }
  
  // Account status changes (marked as dead/flagged)
  if (lowMsg.includes('marked as ') && (lowMsg.includes('dead') || lowMsg.includes('flagged'))) {
    addNotificationEvent({ channel: 'System', status: 'error', title: '⚠️ ' + (message.match(/Account "([^"]+)"/)?.[1] || 'Account') + ' Status Changed', message: message.slice(0, 120), platform: 'facebook' });
    return;
  }
  
  // Background fetch details
  if (lowMsg.includes('extracted details for')) {
    addNotificationEvent({ channel: 'System', status: 'info', title: 'FB Details Fetched', message: message.slice(0, 100), platform: 'facebook' });
    return;
  }
}

function appendToLog(type, args) {
  const message = args.map(arg => {
    if (typeof arg === 'object') {
      try { return JSON.stringify(arg); } catch (e) { return String(arg); }
    }
    return String(arg);
  }).join(' ');

  const timestamp = new Date().toISOString();
  // Strip ANSI color codes
  const cleanMessage = message.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  const logLine = {
    timestamp,
    type, // 'info', 'warn' or 'error'
    message: cleanMessage
  };

  buffer.push(logLine);
  if (buffer.length > MAX_LINES) {
    buffer.shift();
  }

  // Detect and record system events for the dashboard
  // Fast-path: skip verbose logs that don't start with '[' or aren't important
  if (cleanMessage.startsWith('[') || cleanMessage.includes('listening') || cleanMessage.includes('Synced') || cleanMessage.includes('API_KEY')) {
    try { detectSystemEvent(type, cleanMessage); } catch (_) { /* don't break logging */ }
  }

  // Also write to file for persistence if needed
  try {
    fs.appendFileSync(logFile, `[${timestamp}] [${type.toUpperCase()}] ${cleanMessage}\n`, 'utf8');
  } catch (e) {
    // avoid infinite loop of console.error
  }
}

// Save original console functions
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

// Intercept console.log
console.log = (...args) => {
  originalLog(...args);
  appendToLog('info', args);
};

// Intercept console.warn
console.warn = (...args) => {
  originalWarn(...args);
  appendToLog('warn', args);
};

// Intercept console.error
console.error = (...args) => {
  originalError(...args);
  appendToLog('error', args);
};

export function getSystemLogs() {
  return buffer;
}
