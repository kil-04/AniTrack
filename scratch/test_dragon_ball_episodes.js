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
  console.log("Fetching watch page...");
  try {
    const resp = await get(`https://anikoto.cz/watch/${animeId}`);
    if (!resp.ok) {
      console.error("Watch page request failed, status:", resp.status);
      return;
    }
    const html = await resp.text();
    console.log("Watch page html length:", html.length);

    // Extract show/anime ID (data-id) from watch page HTML
    const idMatch = html.match(/id="watch-main"[^>]*data-id="([^"]+)"/) || html.match(/data-id="([^"]+)"/);
    if (!idMatch) {
      console.error("Failed to extract anime show ID from watch page HTML!");
      return;
    }
    const showId = idMatch[1];
    console.log("Extracted showId:", showId);

    // Direct AJAX fetch to get episodes list
    console.log("Fetching episodes list AJAX...");
    const listResp = await get(`https://anikoto.cz/ajax/episode/list/${showId}`, {
      'X-Requested-With': 'XMLHttpRequest'
    });
    if (!listResp.ok) {
      console.error("Episodes list AJAX failed, status:", listResp.status);
      return;
    }
    const listJson = await listResp.json();
    const listHtml = listJson.result || "";
    console.log("AJAX result length:", listHtml.length);

    // Parse episodes from returned HTML using fast regex
    const episodes = [];
    const regex = /<a[^>]+data-id="([^"]+)"[^>]+data-slug="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = regex.exec(listHtml)) !== null) {
      const dataId = match[1];
      const dataSlug = match[2];
      const text = match[3].trim();
      
      const tag = match[0];
      const numM = /data-num="([^"]*)"/.exec(tag);
      const titleM = /title="([^"]*)"/.exec(tag);
      
      const num = numM ? numM[1] : text;
      const title = titleM ? titleM[1] : `Episode ${num}`;
      
      const idsM = /data-ids="([^"]*)"/.exec(tag);
      const serversParam = idsM ? idsM[1] : "";
      
      const slugStr = `ep-${dataSlug}`;
      const id = `${slugStr}:${dataId}:${serversParam}`;
      
      episodes.push({
        id,
        episodeNumber: parseFloat(num) || 0,
        title
      });
    }

    console.log(`Parsed ${episodes.length} episodes.`);
    if (episodes.length > 0) {
      console.log("First episode:", episodes[0]);
      console.log("Last episode:", episodes[episodes.length - 1]);
    } else {
      console.log("AJAX response result text preview:", listHtml.slice(0, 1000));
    }
  } catch (e) {
    console.error("Error:", e);
  }
}

main();
