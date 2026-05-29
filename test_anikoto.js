const { app, net } = require('electron');

app.whenReady().then(async () => {
  try {
    const resp = await net.fetch('https://megaplay.buzz/stream/getSources?id=176517', {
      headers: {
        'Referer': 'https://megaplay.buzz/stream/s-2/250435/sub?autostart=true',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const body = await resp.text();
    console.log("getSources STATUS:", resp.status);
    console.log("getSources BODY:", body);
  } catch (err) {
    console.error("Fetch failed", err);
  }
  
  app.quit();
});
