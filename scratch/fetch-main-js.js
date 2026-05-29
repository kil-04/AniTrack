const fs = require('fs');

async function run() {
  const url = 'https://anikototv.to/anikoto/js/main.js?v=1.111';
  console.log('Fetching', url);
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    });
    const js = await resp.text();
    fs.writeFileSync('scratch/main.js', js);
    console.log('Saved main.js to scratch/main.js');

    // Find any AJAX endpoints or fetch requests in main.js
    const regex = /\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+/g;
    const matches = js.match(/\/ajax\/[a-zA-Z0-9_/.-]+/g) || [];
    console.log('Ajax matches in main.js:', [...new Set(matches)]);
  } catch (err) {
    console.error(err);
  }
}

run();
