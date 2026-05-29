const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  try {
    const url = 'https://anikoto.cz/filter?keyword=City%20Hunter';
    console.log("Fetching", url);
    const resp = await net.fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html = await resp.text();
    fs.writeFileSync(path.join(__dirname, 'anikoto_search_output.html'), html, 'utf8');
    console.log("Saved HTML. Size:", html.length);
  } catch (e) {
    console.error(e);
  }
  app.quit();
});
