const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  const url = 'https://anikototv.to/watch/city-hunter-2-zxpcu/ep-1';
  console.log('Loading watch page in BrowserWindow:', url);
  try {
    await win.loadURL(url);
    
    // Wait 5 seconds for JS to execute and render episodes list
    await new Promise(r => setTimeout(r, 5000));
    
    const data = await win.webContents.executeJavaScript(`
      (() => {
        const results = [];
        const container = document.querySelector('.episodes');
        if (!container) return { error: '.episodes not found' };
        
        const items = container.querySelectorAll('a');
        items.forEach((a, i) => {
          if (i < 5 || i === items.length - 1) {
            results.push({
              tagName: a.tagName,
              className: a.className,
              outerHTML: a.outerHTML,
              id: a.getAttribute('data-id'),
              num: a.getAttribute('data-num'),
              href: a.getAttribute('href')
            });
          }
        });
        return { count: items.length, items: results };
      })()
    `);
    console.log('DOM Data:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    win.destroy();
    app.quit();
  }
});
