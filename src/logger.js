import fs from 'fs';
import path from 'path';

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
