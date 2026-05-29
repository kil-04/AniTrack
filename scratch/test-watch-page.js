const fs = require('fs');

async function run() {
  const animeId = 'city-hunter-2-zxpcu';
  const url = `https://anikototv.to/watch/${animeId}`;
  console.log('Fetching watch page:', url);
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    });
    console.log('Status:', resp.status);
    const html = await resp.text();
    fs.writeFileSync('watch_page.html', html);
    console.log('Saved to watch_page.html');
    
    // Let's see if we can find episodes list and their classes
    const listMatch = html.match(/<div class="episodes[^>]*>([\s\S]*?)<\/div>/);
    if (listMatch) {
      console.log('Found .episodes block:', listMatch[1].substring(0, 1000));
    } else {
      console.log('No .episodes block found!');
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
