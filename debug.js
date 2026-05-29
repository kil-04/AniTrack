const puppeteer = require('puppeteer-core');
(async () => {
  try {
    const browser = await puppeteer.connect({ browserURL: 'http://localhost:8315' }); // Wait, is electron running with remote-debugging-port?
  } catch (e) {
    console.error(e);
  }
})();
