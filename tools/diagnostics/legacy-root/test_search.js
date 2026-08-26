const { app } = require('electron');
app.whenReady().then(async () => {
  try {
    const pahe = require('./dist-electron/electron/services/animepahe');
    const res = await pahe.search('Welcome Demon');
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error(e);
  }
  app.quit();
});
