const fs = require('fs');

async function run() {
  const linkId = 'MTF1dkFtaW9BRTZPbzJJRElFZUZrOWdjeldjOERLaWNMMXFNbVB3WUJqOEZ4cFNpMDdQbnV1S3dNdklpRkhWb09KRjJXZktBQ1BhMysrZkpQUm1CNFE9PQ';
  const url = `https://anikototv.to/ajax/server?get=${encodeURIComponent(linkId)}`;
  console.log('Fetching server url ajax:', url);
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    console.log('Server URL status:', resp.status);
    const json = await resp.json();
    fs.writeFileSync('scratch/server_url_ajax.json', JSON.stringify(json, null, 2));
    console.log('Saved to scratch/server_url_ajax.json');
    console.log('JSON:', json);
  } catch (err) {
    console.error('Error fetching server url ajax:', err);
  }
}

run();
