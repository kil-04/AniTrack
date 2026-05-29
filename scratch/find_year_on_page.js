const https = require("https");

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

async function main() {
  try {
    const html = await get("https://anikoto.cz/watch/city-hunter-u0627");
    
    // Find all occurrences of 4-digit numbers starting with 19 or 20
    const matches = [];
    const regex = /\b(19\d\d|20[0-2]\d)\b/g;
    let m;
    while ((m = regex.exec(html)) !== null) {
      const idx = m.index;
      const context = html.slice(Math.max(0, idx - 100), Math.min(html.length, idx + 100)).replace(/\s+/g, " ");
      matches.push({ year: m[1], context });
    }
    
    console.log("Found year matches on page:");
    console.log(JSON.stringify(matches, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}

main();
