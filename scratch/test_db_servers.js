const https = require("https");

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ...headers
      }
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ ok: res.statusCode === 200, text: () => Promise.resolve(data), status: res.statusCode, json: () => Promise.resolve(JSON.parse(data)) }));
    }).on("error", reject);
  });
}

async function main() {
  const animeId = "dragon-ball-gxrfm";
  // Episode 1 parameters from test_dragon_ball_episodes.js:
  // id: ep-1:21759:MFdpN1dzYlhkZUNsRUtCcjg2RUMzY3NrbTNEaHNOYUhmSlVOclpXRVR1SHVhZTZYT0dyajBKUTJmSlBOYkQ5VnR2N0w5aUVTSW1pbnRSYk5vYzQ0VTVYeHBSQ2lKb1ViT0M3STVtaUQ3ajBSbXFpRkJKQXdYL3ZSeFVrdklmSWtkUnNQRFlhdUlPakZHVVVESUs1SFVBPT0
  const dataId = "21759";
  const serversParam = "MFdpN1dzYlhkZUNsRUtCcjg2RUMzY3NrbTNEaHNOYUhmSlVOclpXRVR1SHVhZTZYT0dyajBKUTJmSlBOYkQ5VnR2N0w5aUVTSW1pbnRSYk5vYzQ0VTVYeHBSQ2lKb1ViT0M3STVtaUQ3ajBSbXFpRkJKQXdYL3ZSeFVrdklmSWtkUnNQRFlhdUlPakZHVVVESUs1SFVBPT0";

  console.log("Fetching servers list AJAX...");
  try {
    const serversResp = await get(`https://anikoto.cz/ajax/server/list?servers=${encodeURIComponent(serversParam)}`, {
      'X-Requested-With': 'XMLHttpRequest'
    });
    if (!serversResp.ok) {
      console.error("Servers list AJAX failed, status:", serversResp.status);
      return;
    }
    const serversJson = await serversResp.json();
    const serversHtml = serversJson.result || "";
    
    console.log("=== SERVERS LIST HTML ===");
    console.log(serversHtml);

    // Parse types and servers
    const types = [];
    const typeRe = /<div class="type"[^>]*>([\s\S]*?)<\/ul>\s*<\/div>/g;
    let typeMatch;
    while ((typeMatch = typeRe.exec(serversHtml)) !== null) {
      const typeHtml = typeMatch[1];
      const labelM = /<label[^>]*>([\s\S]*?)<\/label>/.exec(typeHtml);
      const label = labelM ? labelM[1].replace(/<[^>]+>/g, '').trim() : '';
      
      const liRe = /<li[^>]+data-link-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g;
      let liMatch;
      const items = [];
      while ((liMatch = liRe.exec(typeHtml)) !== null) {
        items.push({
          linkId: liMatch[1],
          name: liMatch[2].replace(/<[^>]+>/g, '').trim()
        });
      }
      types.push({ label, items });
    }

    console.log("\n=== PARSED TYPES ===");
    console.log(JSON.stringify(types, null, 2));

  } catch (e) {
    console.error("Error:", e);
  }
}

main();
