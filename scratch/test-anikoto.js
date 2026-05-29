const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  await win.loadURL("https://anikototv.to/watch/city-hunter-2-zxpcu/ep-1");

  const episodes = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      let attempts = 0;
      const check = () => {
        const items = document.querySelectorAll('.episodes a[data-id]');
        if (items.length > 0) {
          const eps = [];
          items.forEach(a => {
            eps.push({
              id: a.getAttribute('data-id'),
              num: a.getAttribute('data-num'),
              sub: a.getAttribute('data-sub'),
              dub: a.getAttribute('data-dub'),
              slug: a.getAttribute('data-slug'),
              text: a.textContent.trim(),
              className: a.className
            });
          });
          resolve(eps);
        } else if (attempts < 20) {
          attempts++;
          setTimeout(check, 500);
        } else {
          resolve([]);
        }
      };
      check();
    });
  `);

  console.log("Total episodes:", episodes.length);
  console.log("First 5:", JSON.stringify(episodes.slice(0, 5), null, 2));
  
  // Check for duplicates
  const nums = episodes.map(e => e.num);
  const unique = [...new Set(nums)];
  console.log("Unique episode numbers:", unique.length);

  win.destroy();
  app.quit();
});
