const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'anitrack', 'anitrack.db');
console.log('Opening database:', dbPath);

const db = new Database(dbPath);

console.log('\n--- PLAYBACK RECORDS ---');
const playbackRows = db.all('SELECT anime_id, episode, position_sec, duration_sec, datetime(updated_at/1000, \'unixepoch\', \'localtime\') as updated, pahe_session FROM playback ORDER BY updated_at DESC');
console.table(playbackRows);

console.log('\n--- ANIME RECORDS ---');
const animeRows = db.all('SELECT id, title, cover_image FROM anime');
console.table(animeRows);

console.log('\n--- JOINED CONTINUE WATCHING ---');
const joinedRows = db.all(`
  WITH latest_per_anime AS (
    SELECT anime_id, MAX(updated_at) AS max_updated
    FROM playback
    GROUP BY anime_id
  )
  SELECT p.anime_id, p.episode, p.position_sec, p.duration_sec, a.title
  FROM playback p
  JOIN latest_per_anime lpa ON lpa.anime_id = p.anime_id AND lpa.max_updated = p.updated_at
  JOIN anime a ON a.id = p.anime_id
  ORDER BY p.updated_at DESC
`);
console.table(joinedRows);
