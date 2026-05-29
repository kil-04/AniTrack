const fs = require('fs');

async function run() {
  const serversParam = 'OUorNXVLd0svZkpNOHljVER2SlVGd1BXb0hCdzJMNEFvNEFGbFd4Ym4xZ3NxOFZ4VFBMSURJSmdyQlcvUS8vMEY0WCtlQ0JlbFhFK0xxYUhVdzlKZW8wcG1SeWc0VStNU0dCdFlGR3J4RVVUR2ZJTGRzZk9DbHpacVdlazlnM0h0TllyWHBtOUxEdTI4S0c1Szh4VGNnPT0';
  const url = `https://anikototv.to/ajax/server/list?servers=${encodeURIComponent(serversParam)}`;
  console.log('Fetching One Piece servers:', url);
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    const json = await resp.json();
    fs.writeFileSync('scratch/op_servers.json', JSON.stringify(json, null, 2));
    console.log('Result HTML:', json.result);
  } catch (err) {
    console.error(err);
  }
}

run();
