const { app } = require('electron');
app.whenReady().then(async () => {
  try {
    const pahe = require('./dist-electron/electron/services/animepahe');
    const ids = await pahe.getIds(0, '4f6020134ca978a72fdabdc592a2c76af10f23a790e5d33efe9c5bfac0010502'); // Iruma-kun S4 session from my earlier test
    console.log('IDS:', ids);
  } catch (e) {
    console.error(e);
  }
  app.quit();
});
