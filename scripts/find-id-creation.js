import fs from "node:fs";

function run() {
  const html = fs.readFileSync("scratch/details_html.html", "utf8");
  const itemId = "1349027693960596";
  
  // Find all positions of itemId
  const idPositions = [];
  let pos = html.indexOf(itemId);
  while (pos !== -1) {
    idPositions.push(pos);
    pos = html.indexOf(itemId, pos + 1);
  }
  console.log(`Found ${idPositions.length} positions of Item ID ${itemId}:`, idPositions);
  
  // Find all positions of creation_time
  const creationTimes = [];
  const regex = /"creation_time":\s*(\d+)/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    creationTimes.push({ time: match[1], index: match.index });
  }
  
  // For each position of creation_time, find the nearest item ID position and print it
  creationTimes.forEach(ct => {
    let minDistance = Infinity;
    let closestIdPos = -1;
    idPositions.forEach(idPos => {
      const dist = Math.abs(ct.index - idPos);
      if (dist < minDistance) {
        minDistance = dist;
        closestIdPos = idPos;
      }
    });
    console.log(`creation_time ${ct.time} (at ${ct.index}) is closest to ID position at ${closestIdPos} (distance: ${minDistance})`);
  });
}

run();
