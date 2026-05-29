const { app } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  try {
    const dbPath = path.resolve(__dirname, '../dist-electron/electron/services/db');
    const anilistPath = path.resolve(__dirname, '../dist-electron/electron/services/anilist');
    
    const { getAnime, getDb } = require(dbPath);
    const { getById } = require(anilistPath);

    console.log("UserData Path:", app.getPath("userData"));
    console.log("Database file:", path.join(app.getPath("userData"), "anitrack.db"));

    // Test getAnime (SQLite cache)
    const cached = getAnime(1535);
    console.log("Cached entry for 1535 (Death Note):", cached);

    // Test getById (GraphQL request)
    console.log("Fetching getById(1535)...");
    const fetched = await getById(1535);
    console.log("Fetched entry for 1535:", fetched);

  } catch (e) {
    console.error("ERROR during test:", e);
  }
  app.quit();
});
