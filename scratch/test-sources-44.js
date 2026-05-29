const fs = require('fs');

async function run() {
  const megaplayId = '176549';
  const referer = 'https://megaplay.buzz/stream/s-2/364051/sub?autostart=true';
  const url = `https://megaplay.buzz/stream/getSources?id=${megaplayId}`;
  console.log('Fetching', url);
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': referer,
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    console.log('Status:', resp.status);
    const text = await resp.text();
    console.log('Response text:', text);
    const json = JSON.parse(text);
    console.log('Parsed JSON:', json);
  } catch (err) {
    console.error('Error fetching getSources:', err);
  }
}

run();
