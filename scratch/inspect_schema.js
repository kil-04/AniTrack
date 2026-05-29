const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'anitrack', 'anitrack.db');
const db = new Database(dbPath);

console.log('Playback schema:');
console.table(db.all('PRAGMA table_info(playback)'));

console.log('Anime schema:');
console.table(db.all('PRAGMA table_info(anime)'));
