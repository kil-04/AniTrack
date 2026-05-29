const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'anitrack', 'anitrack.db');
const db = new Database(dbPath);

const getDupCount = () => {
  return db.get(`
    SELECT COUNT(*) as count FROM playback p
    WHERE p.anime_id < 0
      AND EXISTS (
          SELECT 1 FROM playback p2
          LEFT JOIN anime a2 ON a2.id = p2.anime_id
          LEFT JOIN anime a1 ON a1.id = p.anime_id
          WHERE p2.anime_id > 0
            AND p2.episode = p.episode
            AND (
              (p2.pahe_session IS NOT NULL AND p2.pahe_session = p.pahe_session)
              OR
              (COALESCE(a2.title, '') != '' AND LOWER(TRIM(a2.title)) = LOWER(TRIM(COALESCE(a1.title, ''))))
            )
      )
  `).count;
};

console.log('Duplicates matching positive IDs:', getDupCount());
