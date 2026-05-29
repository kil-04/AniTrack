const { app } = require("electron");
const path = require("path");
const fs = require("fs");

app.whenReady().then(() => {
  const { Database } = require("node-sqlite3-wasm");
  const file = path.join(app.getPath("appData"), "AniTrack", "anitrack.db");
  const db = new Database(file);
  try {
    const rows = db.prepare("SELECT id, mal_id, title, title_english, title_romaji, year, episodes, status FROM anime WHERE title LIKE '%City Hunter%' OR title_english LIKE '%City Hunter%'").all();
    console.log("MATCHING ANIME IN DB:");
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    console.error("DB Query Error:", e);
  }
  app.quit();
});
