const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const os = require('os');

try {
  const dbFile = path.join(os.homedir(), 'AppData/Roaming/anitrack/anitrack.db');
  console.log("Checking DB at:", dbFile);
  const db = new Database(dbFile);
  const rows = db.all("SELECT id, mal_id, title, cover_image, banner_image FROM anime LIMIT 50");
  console.log("Found rows:", rows.length);
  console.log(JSON.stringify(rows, null, 2));
} catch (e) {
  console.error("Error:", e);
}
