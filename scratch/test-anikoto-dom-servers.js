const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  console.log("Creating BrowserWindow...");
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const animeId = 'one-piece-odmau';
  const watchUrl = `https://anikototv.to/watch/${animeId}`;
  console.log("Loading watch page:", watchUrl);
  await win.loadURL(watchUrl);

  console.log("Waiting 5 seconds for page load...");
  await new Promise(r => setTimeout(r, 5000));

  // Let's print out what we see in the episodes list first
  const hasEp1045 = await win.webContents.executeJavaScript(`
    (() => {
      const ep = document.querySelector('.episodes a[data-num="1045"]');
      if (ep) {
        return {
          found: true,
          dataId: ep.getAttribute('data-id'),
          dataIds: ep.getAttribute('data-ids'),
          href: ep.getAttribute('href'),
          outerHTML: ep.outerHTML
        };
      }
      return { found: false };
    })()
  `);

  console.log("Episode 1045 info in DOM:", hasEp1045);

  if (!hasEp1045.found) {
    console.log("Episode 1045 not found in DOM!");
    win.destroy();
    app.quit();
    return;
  }

  const dataId = hasEp1045.dataId;

  // Let's click the episode 1045 link
  console.log("Clicking episode 1045...");
  await win.webContents.executeJavaScript(`
    (() => {
      const ep = document.querySelector('.episodes a[data-num="1045"]');
      if (ep) ep.click();
    })()
  `);

  // Let's poll and print servers every 1 second for 5 seconds
  for (let i = 1; i <= 5; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const serversInfo = await win.webContents.executeJavaScript(`
      (() => {
        const servers = document.querySelector('.servers');
        if (!servers) return "NOT FOUND";
        
        // Find if there is an active servers element
        const activeLi = document.querySelector('.servers li[data-ep-id="${dataId}"]');
        
        return {
          outerHTML: servers.outerHTML,
          activeLiFound: !!activeLi,
          text: servers.textContent.trim()
        };
      })()
    `);
    console.log(`\n--- Poll ${i}s ---`);
    console.log(serversInfo);
  }

  win.destroy();
  app.quit();
});
