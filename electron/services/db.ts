import { Database } from "node-sqlite3-wasm";
import path from "node:path";
import { app } from "electron";
import type {
  AnimeMeta,
  ContinueWatchingItem,
  ListEntry,
  LocalEpisode,
  PlaybackProgress,
  WatchStatus,
} from "../../shared/types";

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;
  const file = path.join(app.getPath("userData"), "anitrack.db");
  db = new Database(file);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA cache_size = -8000"); // 8 MB page cache
  db.run("PRAGMA synchronous = NORMAL"); // safe with WAL, faster than FULL
  initSchema(db);
  return db;
}

// Bump CURRENT_SCHEMA_VERSION whenever you add a new migration below.
// Each migration runs exactly once per user and is idempotent.
const CURRENT_SCHEMA_VERSION = 3;

const MIGRATIONS: Array<(d: Database) => void> = [
  // v1 — initial schema
  (d) => {
    d.run(`CREATE TABLE IF NOT EXISTS anime (
      id INTEGER PRIMARY KEY,
      mal_id INTEGER,
      title TEXT NOT NULL,
      title_english TEXT,
      title_romaji TEXT,
      synopsis TEXT,
      episodes INTEGER,
      duration INTEGER,
      status TEXT,
      cover_image TEXT,
      banner_image TEXT,
      genres TEXT,
      average_score REAL,
      year INTEGER,
      studios TEXT,
      updated_at INTEGER NOT NULL
    )`);
    d.run(`CREATE TABLE IF NOT EXISTS list_entry (
      anime_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      episodes_watched INTEGER NOT NULL DEFAULT 0,
      score REAL,
      updated_at INTEGER NOT NULL,
      mal_dirty INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(anime_id) REFERENCES anime(id)
    )`);
    d.run(`CREATE TABLE IF NOT EXISTS local_episode (
      anime_id INTEGER NOT NULL,
      episode INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      duration_sec REAL,
      PRIMARY KEY (anime_id, episode)
    )`);
    d.run(`CREATE TABLE IF NOT EXISTS playback (
      anime_id INTEGER NOT NULL,
      episode INTEGER NOT NULL,
      position_sec REAL NOT NULL,
      duration_sec REAL NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (anime_id, episode)
    )`);
    d.run(`CREATE TABLE IF NOT EXISTS library_folder (
      path TEXT PRIMARY KEY,
      added_at INTEGER NOT NULL
    )`);
    d.run(`CREATE INDEX IF NOT EXISTS idx_playback_updated ON playback(updated_at DESC)`);
    d.run(`CREATE INDEX IF NOT EXISTS idx_list_status ON list_entry(status)`);
  },
  // v2 — playback.pahe_session for tracking AnimePahe-only watches
  (d) => {
    try { d.run(`ALTER TABLE playback ADD COLUMN pahe_session TEXT`); } catch {}
  },
  // v3 — local_episode.updated_at (was referenced in INSERT but missing from CREATE)
  (d) => {
    try { d.run(`ALTER TABLE local_episode ADD COLUMN updated_at INTEGER`); } catch {}
  },
];

function initSchema(d: Database) {
  d.run(`CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL)`);
  const row: any = d.get(`SELECT version FROM _schema_version LIMIT 1`);
  let current = row?.version ?? 0;

  // If this is a brand-new DB (no version row), seed it at 0 so the loop
  // applies every migration including v1.
  if (!row) d.run(`INSERT INTO _schema_version (version) VALUES (0)`);

  while (current < CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS[current];
    if (!migration) break;
    try {
      migration(d);
      current++;
      d.run(`UPDATE _schema_version SET version = ?`, [current]);
    } catch (e) {
      console.error(`Migration to v${current + 1} failed:`, e);
      throw e;
    }
  }
}

// ---- Anime ----

export function upsertAnime(a: AnimeMeta) {
  getDb().run(
    `INSERT INTO anime (id, mal_id, title, title_english, title_romaji, synopsis,
      episodes, duration, status, cover_image, banner_image, genres, average_score,
      year, studios, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       mal_id=COALESCE(excluded.mal_id, anime.mal_id),
       title=excluded.title,
       title_english=COALESCE(excluded.title_english, anime.title_english),
       title_romaji=COALESCE(excluded.title_romaji, anime.title_romaji),
       synopsis=COALESCE(excluded.synopsis, anime.synopsis),
       episodes=COALESCE(excluded.episodes, anime.episodes),
       duration=COALESCE(excluded.duration, anime.duration),
       status=COALESCE(excluded.status, anime.status),
       cover_image=COALESCE(excluded.cover_image, anime.cover_image),
       banner_image=COALESCE(excluded.banner_image, anime.banner_image),
       genres=COALESCE(excluded.genres, anime.genres),
       average_score=COALESCE(excluded.average_score, anime.average_score),
       year=COALESCE(excluded.year, anime.year),
       studios=COALESCE(excluded.studios, anime.studios),
       updated_at=excluded.updated_at`,
    [
      a.id,
      a.malId ?? null,
      a.title,
      a.titleEnglish ?? null,
      a.titleRomaji ?? null,
      a.synopsis ?? null,
      a.episodes ?? null,
      a.duration ?? null,
      a.status ?? null,
      a.coverImage ?? null,
      a.bannerImage ?? null,
      a.genres ? JSON.stringify(a.genres) : null,
      a.averageScore ?? null,
      a.year ?? null,
      a.studios ? JSON.stringify(a.studios) : null,
      Date.now(),
    ],
  );
}

function rowToAnime(row: any): AnimeMeta {
  return {
    id: row.id,
    malId: row.mal_id,
    title: row.title,
    titleEnglish: row.title_english,
    titleRomaji: row.title_romaji,
    synopsis: row.synopsis,
    episodes: row.episodes,
    duration: row.duration,
    status: row.status,
    coverImage: row.cover_image,
    bannerImage: row.banner_image,
    genres: row.genres ? JSON.parse(row.genres) : [],
    averageScore: row.average_score,
    year: row.year,
    studios: row.studios ? JSON.parse(row.studios) : [],
  };
}

export function getAnime(id: number): AnimeMeta | null {
  const row = getDb().get(`SELECT * FROM anime WHERE id = ?`, [id]);
  return row ? rowToAnime(row) : null;
}

export function getAnimeByMalId(malId: number): AnimeMeta | null {
  const row = getDb().get(`SELECT * FROM anime WHERE mal_id = ?`, [malId]);
  return row ? rowToAnime(row) : null;
}

// ---- List ----

export function setListEntry(
  e: ListEntry,
  opts: { markDirty?: boolean } = {},
) {
  getDb().run(
    `INSERT INTO list_entry (anime_id, status, episodes_watched, score, updated_at, mal_dirty)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(anime_id) DO UPDATE SET
       status=excluded.status,
       episodes_watched=excluded.episodes_watched,
       score=excluded.score,
       updated_at=excluded.updated_at,
       mal_dirty=CASE WHEN excluded.mal_dirty=1 THEN 1 ELSE list_entry.mal_dirty END`,
    [
      e.animeId,
      e.status,
      e.episodesWatched,
      e.score ?? null,
      e.updatedAt,
      opts.markDirty ? 1 : 0,
    ],
  );
}

export function getListEntry(animeId: number): ListEntry | null {
  const row: any = getDb().get(
    `SELECT * FROM list_entry WHERE anime_id = ?`,
    [animeId],
  );
  if (!row) return null;
  return {
    animeId: row.anime_id,
    status: row.status as WatchStatus,
    episodesWatched: row.episodes_watched,
    score: row.score,
    updatedAt: row.updated_at,
  };
}

export function getAllListEntries(): ListEntry[] {
  const rows: any[] = getDb().all(
    `SELECT * FROM list_entry ORDER BY updated_at DESC`,
  );
  return rows.map((row) => ({
    animeId: row.anime_id,
    status: row.status,
    episodesWatched: row.episodes_watched,
    score: row.score,
    updatedAt: row.updated_at,
  }));
}

export function getDirtyEntries(): ListEntry[] {
  const rows: any[] = getDb().all(
    `SELECT * FROM list_entry WHERE mal_dirty = 1`,
  );
  return rows.map((row) => ({
    animeId: row.anime_id,
    status: row.status,
    episodesWatched: row.episodes_watched,
    score: row.score,
    updatedAt: row.updated_at,
  }));
}

export function clearDirty(animeId: number) {
  getDb().run(`UPDATE list_entry SET mal_dirty = 0 WHERE anime_id = ?`, [
    animeId,
  ]);
}

/** Remove a list entry — used to clean up stub entries after stub→real-id migration. */
export function deleteListEntry(animeId: number): void {
  getDb().run(`DELETE FROM list_entry WHERE anime_id = ?`, [animeId]);
}

// ---- Playback ----

export function setProgress(p: PlaybackProgress) {
  getDb().run(
    `INSERT INTO playback (anime_id, episode, position_sec, duration_sec, updated_at, pahe_session)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(anime_id, episode) DO UPDATE SET
       position_sec=excluded.position_sec,
       duration_sec=excluded.duration_sec,
       updated_at=excluded.updated_at,
       pahe_session=COALESCE(excluded.pahe_session, playback.pahe_session)`,
    [p.animeId, p.episode, p.positionSec, p.durationSec, p.updatedAt, p.animePaheSession ?? null],
  );
}

export function dismissFromContinueWatching(animeId: number) {
  // Delete playback rows for this anime AND any other anime with the same title
  // so that synthetic-ID duplicates are also cleared in one shot.
  const anime = getAnime(animeId);
  if (anime) {
    const rows = getDb().all(
      `SELECT id FROM anime WHERE LOWER(TRIM(title)) = LOWER(TRIM(?))`,
      [anime.title],
    ) as any[];
    for (const row of rows) {
      getDb().run(`DELETE FROM playback WHERE anime_id = ?`, [row.id]);
    }
  } else {
    getDb().run(`DELETE FROM playback WHERE anime_id = ?`, [animeId]);
  }
}

export function getProgress(
  animeId: number,
  episode: number,
): PlaybackProgress | null {
  const row: any = getDb().get(
    `SELECT * FROM playback WHERE anime_id = ? AND episode = ?`,
    [animeId, episode],
  );
  if (!row) return null;
  return {
    animeId: row.anime_id,
    episode: row.episode,
    positionSec: row.position_sec,
    durationSec: row.duration_sec,
    updatedAt: row.updated_at,
  };
}

export function getContinueWatching(limit = 20, offset = 0): ContinueWatchingItem[] {
  // CTE picks the single most-recently-watched episode per anime (no completion
  // filter here — we always want to show the latest episode the user touched,
  // even if they finished it).  The outer query then joins anime + local_episode
  // for display data.
  const rows: any[] = getDb().all(
    `WITH latest_per_anime AS (
       SELECT anime_id, MAX(updated_at) AS max_updated
       FROM playback
       GROUP BY anime_id
     )
     SELECT
       p.anime_id     AS pb_anime_id,
       p.episode      AS pb_episode,
       p.position_sec AS pb_position_sec,
       p.duration_sec AS pb_duration_sec,
       p.updated_at   AS pb_updated_at,
       p.pahe_session AS pb_pahe_session,
       a.id           AS a_id,
       a.mal_id, a.title, a.title_english, a.title_romaji,
       a.synopsis, a.episodes AS a_episodes, a.duration,
       a.status, a.cover_image, a.banner_image,
       a.genres, a.average_score, a.year, a.studios,
       le.file_path   AS le_file_path
     FROM playback p
     JOIN latest_per_anime lpa ON lpa.anime_id = p.anime_id AND lpa.max_updated = p.updated_at
     JOIN anime a ON a.id = p.anime_id
     LEFT JOIN local_episode le ON le.anime_id = p.anime_id AND le.episode = p.episode
     ORDER BY p.updated_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );

  const seen = new Set<string>();
  const items: ContinueWatchingItem[] = [];
  for (const r of rows) {
    // Reconstruct AnimeMeta from aliased columns
    const anime: AnimeMeta = {
      id: r.a_id,
      malId: r.mal_id,
      title: r.title,
      titleEnglish: r.title_english,
      titleRomaji: r.title_romaji,
      synopsis: r.synopsis,
      episodes: r.a_episodes,
      duration: r.duration,
      status: r.status,
      coverImage: r.cover_image,
      bannerImage: r.banner_image,
      genres: r.genres ? JSON.parse(r.genres) : [],
      averageScore: r.average_score,
      year: r.year,
      studios: r.studios ? JSON.parse(r.studios) : [],
    };

    // One card per show — deduplicate by title, keeping the most-recently
    // watched episode (query is already ordered by updated_at DESC).
    const dedupKey = anime.title.trim().toLowerCase();
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const percent = r.pb_duration_sec
      ? (r.pb_position_sec / r.pb_duration_sec) * 100
      : 0;
    items.push({
      anime,
      episode: r.pb_episode,
      positionSec: r.pb_position_sec,
      durationSec: r.pb_duration_sec,
      filePath: r.le_file_path ?? null,
      percent,
      animePaheSession: r.pb_pahe_session ?? null,
    });
  }
  return items;
}

/** Total distinct anime in the continue-watching list (for pagination). */
export function countContinueWatching(): number {
  const row: any = getDb().get(
    `SELECT COUNT(DISTINCT anime_id) AS cnt FROM playback`,
  );
  return row?.cnt ?? 0;
}

/** Paginated continue-watching — returns one page of items plus the total count. */
export function getContinueWatchingPaged(
  page: number,
  pageSize: number,
): { items: ContinueWatchingItem[]; total: number } {
  const total = countContinueWatching();
  const offset = (page - 1) * pageSize;
  const items = getContinueWatching(pageSize, offset);
  return { items, total };
}

// ---- Library ----

export function addLibraryFolder(p: string) {
  getDb().run(
    `INSERT OR IGNORE INTO library_folder (path, added_at) VALUES (?, ?)`,
    [p, Date.now()],
  );
}

export function removeLibraryFolder(p: string) {
  getDb().run(`DELETE FROM library_folder WHERE path = ?`, [p]);
}

export function listLibraryFolders(): string[] {
  return (getDb().all(`SELECT path FROM library_folder`) as any[]).map(
    (r) => r.path,
  );
}

export function upsertLocalEpisode(ep: LocalEpisode) {
  getDb().run(
    `INSERT INTO local_episode (anime_id, episode, file_path, duration_sec, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (anime_id, episode) DO UPDATE SET
       file_path    = excluded.file_path,
       duration_sec = excluded.duration_sec,
       updated_at   = excluded.updated_at`,
    [ep.animeId, ep.episode, ep.filePath, ep.durationSec ?? null, Date.now()],
  );
}

export function getEpisodesFor(animeId: number): LocalEpisode[] {
  return (
    getDb().all(
      `SELECT anime_id, episode, file_path, duration_sec FROM local_episode WHERE anime_id = ? ORDER BY episode`,
      [animeId],
    ) as any[]
  ).map((r) => ({
    animeId: r.anime_id,
    episode: r.episode,
    filePath: r.file_path,
    durationSec: r.duration_sec,
  }));
}

export function clearLocalEpisodes() {
  getDb().run(`DELETE FROM local_episode`);
}

/** Find an existing anime row by title (case-insensitive, checks all title columns). */
export function findAnimeByTitle(title: string): AnimeMeta | null {
  const q = title.toLowerCase().trim();
  const row = getDb().get(
    `SELECT * FROM anime
     WHERE LOWER(TRIM(title))         = ?
        OR LOWER(TRIM(title_english)) = ?
        OR LOWER(TRIM(title_romaji))  = ?
     LIMIT 1`,
    [q, q, q],
  );
  return row ? rowToAnime(row) : null;
}

/** All playback progress rows for a given anime (for watched-episode indicators). */
export function getProgressForAnime(animeId: number): PlaybackProgress[] {
  const rows: any[] = getDb().all(
    `SELECT * FROM playback WHERE anime_id = ? ORDER BY episode`,
    [animeId],
  );
  return rows.map((row) => ({
    animeId: row.anime_id,
    episode: row.episode,
    positionSec: row.position_sec,
    durationSec: row.duration_sec,
    updatedAt: row.updated_at,
  }));
}

/** Delete local_episode rows whose file_path is not in the provided set. */
export function removeStaleLocalEpisodes(validPaths: Set<string>): number {
  const rows = getDb().all(`SELECT rowid, file_path FROM local_episode`) as any[];
  let removed = 0;
  for (const row of rows) {
    if (!validPaths.has(row.file_path)) {
      getDb().run(`DELETE FROM local_episode WHERE rowid = ?`, [row.rowid]);
      removed++;
    }
  }
  return removed;
}
