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
  const ajaxLinkId = "MTF1dkFtaW9BRTZPbzJJRElFZUZrOWdjeldjOERLaWNMMXFNbVB3WUJqOGdCT1JkdmlSZzZXQUg2ZjhSZ2RuMENYbUhCZkZZL0JkV0FuMzduUk9iRkE9PQ";

  try {
    console.log("Resolving server get...");
    const serverGetResp = await get(`https://anikoto.cz/ajax/server?get=${encodeURIComponent(ajaxLinkId)}`, {
      'X-Requested-With': 'XMLHttpRequest'
    });
    const serverGetJson = await serverGetResp.json();
    let iframeUrl = serverGetJson.result?.url || "";
    console.log("Found player iframe URL:", iframeUrl);

    if (iframeUrl.includes('plyr.php') || iframeUrl.includes('mewcdn.online/player/')) {
      const parts = iframeUrl.split('#');
      if (parts.length >= 2) {
        const decodedUrl = Buffer.from(parts[1], 'base64').toString('utf-8');
        console.log("Decoded stream URL from hash:", decodedUrl);
        return;
      }
    }

    console.log("Fetching player iframe page...");
    const megaplayResp = await get(iframeUrl, {
      'Referer': 'https://anikoto.cz/'
    });
    const megaplayHtml = await megaplayResp.text();
    const match = megaplayHtml.match(/id="megaplay-player"[^>]*data-id="([^"]+)"/) || megaplayHtml.match(/data-id="([^"]+)"/);
    if (!match) {
      console.error("Failed to extract data-id from Megaplay iframe HTML!");
      return;
    }
    const megaplayId = match[1];
    console.log("Extracted Megaplay ID:", megaplayId);

    console.log("Fetching stream sources...");
    const resp = await get(`https://megaplay.buzz/stream/getSources?id=${megaplayId}`, {
      'Referer': iframeUrl,
      'X-Requested-With': 'XMLHttpRequest'
    });
    const json = await resp.json();
    console.log("Stream sources response JSON:");
    console.log(JSON.stringify(json, null, 2));

  } catch (e) {
    console.error("Error:", e);
  }
}

main();
