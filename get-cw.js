const { app } = require("electron");
const path = require("path");
const { Database } = require("node-sqlite3-wasm");

app.whenReady().then(async () => {
  const dbFile = path.join(process.env.APPDATA, "AniTrack", "anitrack.db");
  console.log("DB File:", dbFile);
  
  try {
    const db = new Database(dbFile);
    
    // Run the new count query
    const countRow = db.get(`
      SELECT COUNT(DISTINCT LOWER(TRIM(a.title))) AS cnt
      FROM playback p
      JOIN anime a ON a.id = p.anime_id
    `);
    console.log("Total unique continue watching shows:", countRow?.cnt);

    // Run the main paginated query with size=8 offset=0 (page 1)
    const page1 = db.all(`
      WITH latest_per_title AS (
        SELECT LOWER(TRIM(a2.title)) AS clean_title, MAX(p2.updated_at) AS max_updated
        FROM playback p2
        JOIN anime a2 ON a2.id = p2.anime_id
        GROUP BY LOWER(TRIM(a2.title))
      )
      SELECT
        p.anime_id     AS pb_anime_id,
        p.episode      AS pb_episode,
        a.title
      FROM playback p
      JOIN anime a ON a.id = p.anime_id
      JOIN latest_per_title lpt ON LOWER(TRIM(a.title)) = lpt.clean_title AND p.updated_at = lpt.max_updated
      ORDER BY p.updated_at DESC
      LIMIT ? OFFSET ?
    `, [8, 0]);
    console.log("Page 1 (first 8):", page1);

    // Page 2 (offset 8)
    const page2 = db.all(`
      WITH latest_per_title AS (
        SELECT LOWER(TRIM(a2.title)) AS clean_title, MAX(p2.updated_at) AS max_updated
        FROM playback p2
        JOIN anime a2 ON a2.id = p2.anime_id
        GROUP BY LOWER(TRIM(a2.title))
      )
      SELECT
        p.anime_id     AS pb_anime_id,
        p.episode      AS pb_episode,
        a.title
      FROM playback p
      JOIN anime a ON a.id = p.anime_id
      JOIN latest_per_title lpt ON LOWER(TRIM(a.title)) = lpt.clean_title AND p.updated_at = lpt.max_updated
      ORDER BY p.updated_at DESC
      LIMIT ? OFFSET ?
    `, [8, 8]);
    console.log("Page 2 (next 8):", page2);

  } catch (e) {
    console.error("DB Query failed", e);
  }
  
  app.quit();
});

