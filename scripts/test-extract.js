import fs from "node:fs";

function extractCreationTime(html, itemId) {
  const idStr = String(itemId);
  let pos = html.indexOf(idStr);
  while (pos !== -1) {
    const sub = html.substring(pos, pos + 5000);
    const match = sub.match(/"creation_time":\s*(\d+)/);
    if (match) {
      const ts = parseInt(match[1], 10);
      if (ts > 1500000000 && ts < 2000000000) {
        return ts;
      }
    }
    pos = html.indexOf(idStr, pos + 1);
  }
  return null;
}

function run() {
  const html = fs.readFileSync("scratch/details_html.html", "utf8");
  const itemId = "1349027693960596";
  const ts = extractCreationTime(html, itemId);
  console.log(`Extracted timestamp for item ${itemId}:`, ts);
  if (ts) {
    console.log("Formatted Date:", new Date(ts * 1000).toLocaleString());
  }
}

run();
