const fs = require('fs');

async function run() {
  const linkId = 'MTF1dkFtaW9BRTZPbzJJRElFZUZrOWdjeldjOERLaWNMMXFNbVB3WUJqOHZoTmFvRkZwdFlNWkZKMUJNRzVKTkc5d3ozSVJ1TmtVRFFQRTZZTVl4OHc9PQ';
  const url = `https://anikototv.to/ajax/server?get=${encodeURIComponent(linkId)}`;
  console.log('Fetching server get URL:', url);
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    const getJson = await resp.json();
    const iframeUrl = getJson.result?.url || "";
    console.log('Iframe URL:', iframeUrl);

    if (iframeUrl) {
      const megaplayResp = await fetch(iframeUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://anikototv.to/'
        }
      });
      const megaplayHtml = await megaplayResp.text();
      const match = megaplayHtml.match(/id="megaplay-player"[^>]*data-id="([^"]+)"/) || megaplayHtml.match(/data-id="([^"]+)"/);
      const megaplayId = match ? match[1] : null;
      console.log('Megaplay ID:', megaplayId);

      if (megaplayId) {
        const sourcesResp = await fetch(`https://megaplay.buzz/stream/getSources?id=${megaplayId}`, {
          headers: {
            'Referer': iframeUrl,
            'X-Requested-With': 'XMLHttpRequest',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        const sourcesJson = await sourcesResp.json();
        fs.writeFileSync('scratch/op_sources.json', JSON.stringify(sourcesJson, null, 2));
        console.log('Sources JSON:', JSON.stringify(sourcesJson, null, 2));
      }
    }
  } catch (err) {
    console.error(err);
  }
}

run();
