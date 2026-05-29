const fs = require('fs');

async function run() {
  const showId = '1205'; // City Hunter 2
  const url = `https://anikototv.to/ajax/episode/list/${showId}`;
  console.log('Fetching episodes list ajax:', url);
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    console.log('Episodes status:', resp.status);
    const json = await resp.json();
    fs.writeFileSync('scratch/episodes_ajax.json', JSON.stringify(json, null, 2));
    console.log('Saved to scratch/episodes_ajax.json');
    console.log('JSON Status:', json.status);
    if (json.result) {
      console.log('Result sample (first 500 chars):', json.result.substring(0, 500));
    }
  } catch (err) {
    console.error('Error fetching episodes list ajax:', err);
  }
}

run();
