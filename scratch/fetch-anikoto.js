const fs = require('fs');
const { net } = require('electron');
const { app } = require('electron');

app.whenReady().then(async () => {
  try {
    const query = "Witch Hat Atelier";
    const BASE_URL = "https://anikototv.to";
    const resp = await net.fetch(`${BASE_URL}/filter?keyword=${encodeURIComponent(query)}`);
    const html = await resp.text();
    fs.writeFileSync('scratch/anikoto.html', html);
  } catch(e) {
    console.error(e);
  }
  app.quit();
});
