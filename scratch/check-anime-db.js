const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const os = require('os');

try {
  const dbFile = path.join(os.homedir(), 'AppData/Roaming/AniTrack/anitrack.db');
  console.log("Checking DB at:", dbFile);
  const db = new Database(dbFile);
  
  // Search for any rows where title is 'Unknown' or 'Untitled'
  const stubs = db.all("SELECT id, mal_id, title, cover_image FROM anime WHERE title = 'Unknown' OR title = 'Untitled'");
  console.log("Found Unknown/Untitled anime rows:", stubs);

  // Search for the specific IDs from trending
  const trendingIds = [182205, 170019, 192808, 21, 199221];
  for (const id of trendingIds) {
    const row = db.get("SELECT * FROM anime WHERE id = ?", [id]);
    console.log(`ID ${id} in DB:`, row);
  }

} catch (e) {
  console.error("Error:", e);
}
