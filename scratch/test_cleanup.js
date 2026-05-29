const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'anitrack', 'anitrack.db');
const db = new Database(dbPath);

console.log('Duplicates before cleanup:');
const before = db.all(`
  SELECT p.anime_id, p.episode, a.title
  FROM playback p
  LEFT JOIN anime a ON a.id = p.anime_id
  WHERE p.anime_id < 0
`);
console.table(before);

try {
  db.run('BEGIN TRANSACTION');

  db.run(`
    DELETE FROM playback
    WHERE anime_id < 0
      AND EXISTS (
          SELECT 1 FROM playback p2
          LEFT JOIN anime a2 ON a2.id = p2.anime_id
          LEFT JOIN anime a1 ON a1.id = playback.anime_id
          WHERE p2.anime_id > 0
            AND p2.episode = playback.episode
            AND (
              (p2.pahe_session IS NOT NULL AND p2.pahe_session = playback.pahe_session)
              OR
              (COALESCE(a2.title, '') != '' AND LOWER(TRIM(a2.title)) = LOWER(TRIM(COALESCE(a1.title, ''))))
            )
      )
  `);

  db.run(`
    DELETE FROM anime
    WHERE id < 0
      AND NOT EXISTS (SELECT 1 FROM playback WHERE anime_id = anime.id)
      AND NOT EXISTS (SELECT 1 FROM list_entry WHERE anime_id = anime.id)
  `);

  console.log('Cleanup executed successfully.');
  
  console.log('Duplicates after cleanup:');
  const after = db.all(`
    SELECT p.anime_id, p.episode, a.title
    FROM playback p
    LEFT JOIN anime a ON a.id = p.anime_id
    WHERE p.anime_id < 0
  `);
  console.table(after);

  db.run('COMMIT');
} catch (e) {
  console.error('Error during cleanup:', e);
  db.run('ROLLBACK');
}
