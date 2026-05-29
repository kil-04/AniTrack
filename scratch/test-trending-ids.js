const { app } = require('electron');
const path = require('path');

app.setPath("userData", path.join(app.getPath("appData"), "anitrack"));

app.whenReady().then(async () => {
  try {
    const anilistPath = path.resolve(__dirname, '../dist-electron/electron/services/anilist');
    const { trending } = require(anilistPath);

    console.log("Fetching trending anime...");
    const list = await trending();
    console.log(`Found ${list.length} trending items.`);
    const idsAndTitles = list.map(a => ({ id: a.id, title: a.title, typeOfId: typeof a.id }));
    console.log(JSON.stringify(idsAndTitles.slice(0, 5), null, 2));

  } catch (e) {
    console.error("Test error:", e);
  }
  app.quit();
});
