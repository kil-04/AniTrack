const fs = require('fs');

async function run() {
  const serversParam = 'U2RBeFFaRmRUd2psWWpsQy9LODJrbXF4aEt5VzAxV2FZUHo5L2gyNDNpdFh3U3Z2SFBpNmU3OTNDZCtNcGZBM3QvRTd2NDlxTm9sTHJka0NRVjZsMlU0WkFaSTNXS3FqMnJ4V3MxUEJVa3owS2hUdW5SM01KbUx5SXRiem1CQzU1Wk00ejcvUzFLenFoK0x3TkJzTG1RPT0';
  const url = `https://anikototv.to/ajax/server/list?servers=${encodeURIComponent(serversParam)}`;
  console.log('Fetching servers list ajax:', url);
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    console.log('Servers status:', resp.status);
    const json = await resp.json();
    fs.writeFileSync('scratch/servers_ajax.json', JSON.stringify(json, null, 2));
    console.log('Saved to scratch/servers_ajax.json');
    console.log('JSON Status:', json.status);
    if (json.result) {
      console.log('Result sample (first 1000 chars):', json.result.substring(0, 1000));
    }
  } catch (err) {
    console.error('Error fetching servers list ajax:', err);
  }
}

run();
