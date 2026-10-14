import { getDb, runInTransaction } from "../db";
import {
  MANGA_STATUSES,
  type MangaListEntry,
  type MangaStatus,
  type ReadingRow,
  type ReadState,
  type SourceTitle,
} from "../../../../../packages/shared/manga";

// ── Reading progress ──────────────────────────────────────────────────────────

/** Chapter number → read state, for the chapter list and the resume target. */
export function readingFor(mangaId: number): Record<string, ReadState> {
  const rows: any[] = getDb().all(
    `SELECT chapter, page, page_count, updated_at FROM manga_reading WHERE manga_id = ?`,
    [mangaId],
  );
  const out: Record<string, ReadState> = {};
  for (const row of rows) out[String(row.chapter)] = { page: row.page, pageCount: row.page_count, updatedAt: row.updated_at };
  return out;
}

export function saveReading(row: ReadingRow): void {
  getDb().run(
    `INSERT OR REPLACE INTO manga_reading
       (manga_id, chapter, chapter_id, page, page_count, title, cover, source_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.mangaId, row.chapter, row.chapterId, row.page, row.pageCount, row.title, row.cover, row.sourceId, row.updatedAt],
  );
}

/**
 * Marks chapters read (their last page reached) or, with [read] false, forgets them.
 * Marked chapters stay older than a later chapter read for real, so Continue
 * Reading keeps pointing at that one.
 */
export function markChapters(
  mangaId: number,
  chapters: { number: number; id: string; pageCount: number }[],
  read: boolean,
  title: string,
  cover: string | null,
  sourceId: string,
): void {
  runInTransaction(() => {
    const db = getDb();
    if (!read) {
      for (const c of chapters) db.run(`DELETE FROM manga_reading WHERE manga_id = ? AND chapter = ?`, [mangaId, c.number]);
      return;
    }
    const sorted = [...chapters].sort((a, b) => a.number - b.number);
    const newest: any = db.get(
      `SELECT chapter, updated_at FROM manga_reading WHERE manga_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [mangaId],
    );
    const highest = sorted.at(-1)?.number ?? 0;
    const base = newest && newest.chapter > highest ? newest.updated_at - sorted.length - 1 : Date.now() - sorted.length;
    sorted.forEach((c, i) => {
      const count = Math.max(1, c.pageCount);
      saveReading({
        mangaId, chapter: c.number, chapterId: c.id, page: count - 1, pageCount: count,
        title, cover, sourceId, updatedAt: base + i,
      });
    });
  });
}

/** One row per manga — its most recently read chapter, newest first. */
export function continueReading(limit = 30): ReadingRow[] {
  const rows: any[] = getDb().all(
    `SELECT r.manga_id, r.chapter, r.chapter_id, r.page, r.page_count, r.title, r.cover, r.source_id, r.updated_at
       FROM manga_reading r
       JOIN (SELECT manga_id, MAX(updated_at) mu FROM manga_reading GROUP BY manga_id) l
         ON r.manga_id = l.manga_id AND r.updated_at = l.mu
      ORDER BY r.updated_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({
    mangaId: row.manga_id, chapter: row.chapter, chapterId: row.chapter_id, page: row.page, pageCount: row.page_count,
    title: row.title ?? "Unknown", cover: row.cover ?? null, sourceId: row.source_id, updatedAt: row.updated_at,
  }));
}

export function forgetReading(mangaId: number): void {
  getDb().run(`DELETE FROM manga_reading WHERE manga_id = ?`, [mangaId]);
}

/** Every reading row, newest first, for cross-device sync. */
export function allReading(limit = 20_000): ReadingRow[] {
  const rows: any[] = getDb().all(
    `SELECT manga_id, chapter, chapter_id, page, page_count, title, cover, source_id, updated_at
       FROM manga_reading ORDER BY updated_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({
    mangaId: row.manga_id, chapter: row.chapter, chapterId: row.chapter_id, page: row.page, pageCount: row.page_count,
    title: row.title ?? "Unknown", cover: row.cover ?? null, sourceId: row.source_id, updatedAt: row.updated_at,
  }));
}

/** One sync reconcile: newer rows from another device, and rows a removal hides, in one transaction. */
export function applySyncedReading(upserts: ReadingRow[], removes: { mangaId: number; chapter: number }[]): void {
  runInTransaction(() => {
    const db = getDb();
    for (const row of removes) db.run(`DELETE FROM manga_reading WHERE manga_id = ? AND chapter = ?`, [row.mangaId, row.chapter]);
    for (const row of upserts) saveReading(row);
  });
}

/** The furthest chapter read (or marked read) per manga, for Updates' "N NEW". */
export function lastReadChapters(): Record<number, number> {
  const rows: any[] = getDb().all(`SELECT manga_id, MAX(chapter) AS chapter FROM manga_reading GROUP BY manga_id`);
  const out: Record<number, number> = {};
  for (const row of rows) out[row.manga_id] = row.chapter;
  return out;
}

// ── Manga list ────────────────────────────────────────────────────────────────

export function mangaStatus(mangaId: number): MangaStatus | null {
  const row: any = getDb().get(`SELECT status FROM manga_list WHERE manga_id = ?`, [mangaId]);
  return row && (MANGA_STATUSES as readonly string[]).includes(row.status) ? row.status : null;
}

/** Sets a manga's status, or removes it from the list with a null status. */
export function setMangaStatus(mangaId: number, status: MangaStatus | null, title: string, cover: string | null): void {
  if (status == null) {
    getDb().run(`DELETE FROM manga_list WHERE manga_id = ?`, [mangaId]);
    return;
  }
  if (!(MANGA_STATUSES as readonly string[]).includes(status)) throw new Error("Invalid status");
  getDb().run(
    `INSERT OR REPLACE INTO manga_list (manga_id, status, title, cover, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [mangaId, status, title, cover, Date.now()],
  );
}

export function mangaList(): MangaListEntry[] {
  const rows: any[] = getDb().all(`SELECT manga_id, status, title, cover, updated_at FROM manga_list ORDER BY updated_at DESC`);
  return rows.map((row) => ({
    mangaId: row.manga_id, status: row.status, title: row.title ?? "Unknown", cover: row.cover ?? null, updatedAt: row.updated_at,
  }));
}

// ── Confirmed source matches ──────────────────────────────────────────────────

export function savedMatch(mangaId: number, sourceId: string): SourceTitle | null {
  const row: any = getDb().get(
    `SELECT title_id, title FROM manga_match WHERE manga_id = ? AND source_id = ?`,
    [mangaId, sourceId],
  );
  return row ? { sourceId, id: row.title_id, title: row.title ?? "" } : null;
}

export function saveMatch(mangaId: number, title: SourceTitle): void {
  getDb().run(
    `INSERT OR REPLACE INTO manga_match (manga_id, source_id, title_id, title, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [mangaId, title.sourceId, title.id, title.title.slice(0, 200), Date.now()],
  );
}
