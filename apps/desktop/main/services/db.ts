import { Database } from "node-sqlite3-wasm";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type {
  AnimeMeta,
  ContinueWatchingItem,
  ListEntry,
  PlaybackProgress,
  WatchStatus,
} from "../../../../packages/shared/types";

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;
  const file = path.join(app.getPath("userData"), "anitrack.db");
  // node-sqlite3-wasm locks the DB via a sibling ".lock" file. If a previous
  // run was terminated hard (dev reload, crash, task kill), the file is left
  // behind and every query fails with "database is locked". The app's
  // single-instance lock guarantees no other AniTrack is running, so any lock
  // file present at first open is stale — remove it.
  try { fs.rmSync(`${file}.lock`, { force: true, recursive: true }); } catch {}
  db = new Database(file);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA cache_size = -8000"); // 8 MB page cache
  db.run("PRAGMA synchronous = NORMAL"); // safe with WAL, faster than FULL
  initSchema(db);
  return db;
}

let transactionActive = false;

export function runInTransaction<T>(fn: () => T): T {
  const d = getDb();
  const wasActive = transactionActive;
  if (!wasActive) {
    d.run("BEGIN TRANSACTION");
    transactionActive = true;
  }
  try {
    const result = fn();
    if (!wasActive) {
      d.run("COMMIT");
      transactionActive = false;
    }
    return result;
  } catch (e) {
    if (!wasActive) {
      try {
        d.run("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Rollback failed:", rollbackErr);
      }
      transactionActive = false;
    }
    throw e;
  }
}


// Bump CURRENT_SCHEMA_VERSION whenever you add a new migration below.
// Each migration runs exactly once per user and is idempotent.
const CURRENT_SCHEMA_VERSION = 5;

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
  // v4 — case-insensitive title indexes + mal_id index for fast lookup/imports
  (d) => {
    try { d.run(`CREATE INDEX IF NOT EXISTS idx_anime_mal_id ON anime(mal_id)`); } catch {}
    try { d.run(`CREATE INDEX IF NOT EXISTS idx_anime_title ON anime(title COLLATE NOCASE)`); } catch {}
    try { d.run(`CREATE INDEX IF NOT EXISTS idx_anime_title_english ON anime(title_english COLLATE NOCASE)`); } catch {}
    try { d.run(`CREATE INDEX IF NOT EXISTS idx_anime_title_romaji ON anime(title_romaji COLLATE NOCASE)`); } catch {}
  },
  // v5 — identify the connector that owns the legacy session value.
  (d) => {
    try { d.run(`ALTER TABLE playback ADD COLUMN provider_id TEXT`); } catch {}
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

// Tolerate malformed JSON in a column (e.g. a partial write) — return [] instead
// of throwing, so a single bad row can't break an entire list query.
function safeJsonArray(s: any): string[] {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
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
    genres: safeJsonArray(row.genres),
    averageScore: row.average_score,
    year: row.year,
    studios: safeJsonArray(row.studios),
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
  const d = getDb();
  d.run(
    `INSERT INTO playback (anime_id, episode, position_sec, duration_sec, updated_at, pahe_session, provider_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(anime_id, episode) DO UPDATE SET
       position_sec=excluded.position_sec,
       duration_sec=excluded.duration_sec,
       updated_at=excluded.updated_at,
       pahe_session=COALESCE(excluded.pahe_session, playback.pahe_session),
       provider_id=COALESCE(excluded.provider_id, playback.provider_id)`,
    [p.animeId, p.episode, p.positionSec, p.durationSec, p.updatedAt, p.animePaheSession ?? null, p.providerId ?? null],
  );

  // Clean up duplicate negative ID stubs. The dedup scan below joins anime
  // twice per playback row — skip it entirely unless stub rows actually exist
  // (setProgress fires every ~5s during playback and in bulk from Supabase merge).
  const hasStubs: any = d.get(`SELECT 1 AS x FROM playback WHERE anime_id < 0 LIMIT 1`);
  if (!hasStubs) return;

  d.run(
    `DELETE FROM playback
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
       )`
  );

  d.run(
    `DELETE FROM anime
     WHERE id < 0
       AND NOT EXISTS (SELECT 1 FROM playback WHERE anime_id = anime.id)
       AND NOT EXISTS (SELECT 1 FROM list_entry WHERE anime_id = anime.id)`
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
  // CTE picks the single most-recently-watched episode per unique anime title (case-insensitive)
  // (no completion filter here — we always want to show the latest episode the user touched,
  // even if they finished it).  The outer query then joins anime + local_episode
  // for display data.
  const rows: any[] = getDb().all(
    `WITH latest_per_title AS (
       SELECT LOWER(TRIM(a2.title)) AS clean_title, MAX(p2.updated_at) AS max_updated
       FROM playback p2
       JOIN anime a2 ON a2.id = p2.anime_id
       GROUP BY LOWER(TRIM(a2.title))
     )
     SELECT
       p.anime_id     AS pb_anime_id,
       p.episode      AS pb_episode,
       p.position_sec AS pb_position_sec,
       p.duration_sec AS pb_duration_sec,
       p.updated_at   AS pb_updated_at,
       p.pahe_session AS pb_pahe_session,
       p.provider_id  AS pb_provider_id,
       a.id           AS a_id,
       a.mal_id, a.title, a.title_english, a.title_romaji,
       a.synopsis, a.episodes AS a_episodes, a.duration,
       a.status, a.cover_image, a.banner_image,
       a.genres, a.average_score, a.year, a.studios,
       le.file_path   AS le_file_path
     FROM playback p
     JOIN anime a ON a.id = p.anime_id
     JOIN latest_per_title lpt ON LOWER(TRIM(a.title)) = lpt.clean_title AND p.updated_at = lpt.max_updated
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
      genres: safeJsonArray(r.genres),
      averageScore: r.average_score,
      year: r.year,
      studios: safeJsonArray(r.studios),
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
      providerId: r.pb_provider_id ?? null,
      animePaheSession: r.pb_pahe_session ?? null,
      updatedAt: r.pb_updated_at,
    });
  }
  return items;
}

/** Total distinct anime in the continue-watching list (for pagination). */
export function countContinueWatching(): number {
  const row: any = getDb().get(
    `SELECT COUNT(DISTINCT LOWER(TRIM(a.title))) AS cnt
     FROM playback p
     JOIN anime a ON a.id = p.anime_id`,
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

export function findAnimeByTitle(title: string): AnimeMeta | null {
  const q = title.trim();
  const row = getDb().get(
    `SELECT * FROM anime
     WHERE title         = ? COLLATE NOCASE
        OR title_english = ? COLLATE NOCASE
        OR title_romaji  = ? COLLATE NOCASE
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

/** Migrate playback progress, local episodes, and watch lists from an old/stub ID to a new/real ID. */
export function migrateAnimeId(oldId: number, newId: number): void {
  runInTransaction(() => {
    const d = getDb();
    // 1. Move playback rows. If conflict, take the one with larger updated_at.
    const oldPlayback = d.all(`SELECT * FROM playback WHERE anime_id = ?`, [oldId]) as any[];
    for (const pb of oldPlayback) {
      d.run(
        `INSERT INTO playback (anime_id, episode, position_sec, duration_sec, updated_at, pahe_session, provider_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(anime_id, episode) DO UPDATE SET
           position_sec = CASE WHEN excluded.updated_at > playback.updated_at THEN excluded.position_sec ELSE playback.position_sec END,
           duration_sec = CASE WHEN excluded.updated_at > playback.updated_at THEN excluded.duration_sec ELSE playback.duration_sec END,
           updated_at = MAX(excluded.updated_at, playback.updated_at),
           pahe_session = COALESCE(excluded.pahe_session, playback.pahe_session),
           provider_id = COALESCE(excluded.provider_id, playback.provider_id)`,
        [newId, pb.episode, pb.position_sec, pb.duration_sec, pb.updated_at, pb.pahe_session, pb.provider_id]
      );
    }
    d.run(`DELETE FROM playback WHERE anime_id = ?`, [oldId]);

    // 2. Move local_episode rows.
    d.run(`UPDATE OR REPLACE local_episode SET anime_id = ? WHERE anime_id = ?`, [newId, oldId]);

    // 3. Move list_entry.
    const stubEntry = getListEntry(oldId);
    if (stubEntry) {
      setListEntry(
        { ...stubEntry, animeId: newId },
        { markDirty: true }
      );
      deleteListEntry(oldId);
    }

    // 4. Optionally clean up the old stub anime row if it was a synthetic ID (negative).
    if (oldId < 0) {
      d.run(`DELETE FROM anime WHERE id = ?`, [oldId]);
    }
  });
}
