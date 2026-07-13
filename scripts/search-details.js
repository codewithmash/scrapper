import fs from "node:fs";

function run() {
  const html = fs.readFileSync("scratch/details_html.html", "utf8");
  
  const regex = /"creation_time":\s*(\d+)/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const start = Math.max(0, match.index - 300);
    const end = Math.min(html.length, match.index + 300);
    console.log("\n--- Match ---");
    console.log(html.slice(start, end));
  }
}

run();
