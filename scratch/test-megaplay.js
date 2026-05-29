const fs = require('fs');

async function run() {
  const url = 'https://megaplay.buzz/stream/s-2/9734/sub?autostart=true';
  console.log('Fetching', url);
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://anikototv.to/'
      }
    });
    console.log('Status:', resp.status);
    const html = await resp.text();
    fs.writeFileSync('megaplay_response.html', html);
    console.log('Saved response to megaplay_response.html');
    
    // Let's see if we can find megaplay-player or data-id
    const match = html.match(/id="megaplay-player"[^>]*data-id="([^"]+)"/) || html.match(/data-id="([^"]+)"/);
    console.log('Match data-id:', match ? match[1] : 'Not found');
    
    // Let's search for any player container
    const idMatches = html.match(/id="[^"]*"/g);
    console.log('All IDs in HTML:', idMatches);
  } catch (err) {
    console.error('Error fetching megaplay:', err);
  }
}

run();
