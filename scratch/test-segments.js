const fs = require('fs');

async function run() {
  const masterUrl = 'https://cdn.mewstream.buzz/anime/d07e70efcfab08731a97e7b91be644de/8ff7025ccc26090b198370454515a962/master.m3u8';
  console.log('Fetching master playlist:', masterUrl);
  try {
    const resp = await fetch(masterUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://megaplay.buzz/',
        'Origin': 'https://megaplay.buzz'
      }
    });
    console.log('Master playlist status:', resp.status);
    const content = await resp.text();
    console.log('Master content:\n', content);
    
    // Find any relative/absolute paths in the playlist
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.trim() && !line.startsWith('#')) {
        const variantUrl = new URL(line.trim(), masterUrl).toString();
        console.log('\n--- Fetching variant playlist:', variantUrl);
        const vResp = await fetch(variantUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://megaplay.buzz/',
            'Origin': 'https://megaplay.buzz'
          }
        });
        console.log('Variant status:', vResp.status);
        const vContent = await vResp.text();
        const vLines = vContent.split('\n');
        
        // Let's print the first few non-comment lines of the variant playlist (the segment URLs)
        let printed = 0;
        for (const vLine of vLines) {
          if (vLine.trim() && !vLine.startsWith('#')) {
            const segmentUrl = new URL(vLine.trim(), variantUrl).toString();
            console.log('Segment URL:', segmentUrl);
            printed++;
            if (printed >= 5) break;
          }
        }
        break; // just check the first variant
      }
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
