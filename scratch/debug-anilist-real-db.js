const { app } = require('electron');
const path = require('path');

// Set the user data path to match the real application
app.setPath("userData", path.join(app.getPath("appData"), "anitrack"));

app.whenReady().then(async () => {
  try {
    const dbPath = path.resolve(__dirname, '../dist-electron/electron/services/db');
    const anilistPath = path.resolve(__dirname, '../dist-electron/electron/services/anilist');
    
    const { getAnime, getDb } = require(dbPath);
    const { getById } = require(anilistPath);

    console.log("UserData Path set to:", app.getPath("userData"));

    // Test a few AniList IDs
    const testIds = [1535, 21, 223]; // Death Note, One Piece, Dragon Ball
    for (const id of testIds) {
      console.log(`\n--- Testing ID: ${id} ---`);
      const cached = getAnime(id);
      console.log(`Cached:`, cached ? cached.title : "null");
      
      console.log(`Fetching from AniList...`);
      try {
        const fetched = await getById(id);
        console.log(`Fetched:`, fetched ? fetched.title : "null");
      } catch (err) {
        console.error(`Fetch failed for ${id}:`, err.message);
      }
    }

  } catch (e) {
    console.error("ERROR during test:", e);
  }
  app.quit();
});
