const { app } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  try {
    console.log("Loading services...");
    const { providerManager } = require(path.join(__dirname, '../dist-electron/electron/services/providers/index.js'));
    const { searchAnime } = require(path.join(__dirname, '../dist-electron/electron/services/anilist.js'));

    console.log("\n--- Testing AniList search for 'City Hunter' ---");
    const alResults = await searchAnime('City Hunter');
    console.log("AniList Results count:", alResults.length);
    console.log(JSON.stringify(alResults.slice(0, 5).map(a => ({ id: a.id, title: a.title, titleEnglish: a.titleEnglish, year: a.year })), null, 2));

    console.log("\n--- Testing Provider search for 'City Hunter' ---");
    const provResults = await providerManager.searchAll('City Hunter');
    console.log("Provider Results count:", provResults.length);
    console.log(JSON.stringify(provResults.map(p => ({ providerId: p.providerId || 'animepahe', id: p.id, title: p.title, year: p.year })), null, 2));

  } catch (e) {
    console.error("Error during test:", e);
  }
  app.quit();
});
