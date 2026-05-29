const { app } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  try {
    const { providerManager } = require(path.join(__dirname, '../dist-electron/electron/services/providers/index.js'));

    console.log("\n--- Searching for 'City Hunter '91' ---");
    const r1 = await providerManager.searchAll("City Hunter '91");
    console.log("Results count:", r1.length);
    console.log(JSON.stringify(r1.map(p => ({ providerId: p.providerId, id: p.id, title: p.title, year: p.year })), null, 2));

    console.log("\n--- Searching for 'City Hunter 91' ---");
    const r2 = await providerManager.searchAll("City Hunter 91");
    console.log("Results count:", r2.length);
    console.log(JSON.stringify(r2.map(p => ({ providerId: p.providerId, id: p.id, title: p.title, year: p.year })), null, 2));

    console.log("\n--- Full Results for 'City Hunter' (AnimePahe only) ---");
    const r3 = await providerManager.searchAll("City Hunter");
    const paheResults = r3.filter(p => p.providerId === 'animepahe');
    console.log("AnimePahe Results count:", paheResults.length);
    console.log(JSON.stringify(paheResults.map(p => ({ id: p.id, title: p.title, year: p.year })), null, 2));

  } catch (e) {
    console.error("Error during test:", e);
  }
  app.quit();
});
