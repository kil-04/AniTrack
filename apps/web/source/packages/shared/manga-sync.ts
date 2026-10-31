/**
 * Cross-device manga reading sync (Continue Reading and read marks).
 *
 * Lives in its own file of the same private GitHub gist as Continue Watching
 * (`anitrack-sync.json`). A gist PATCH replaces only the files it names, so the
 * anime writers of older app versions can never erase manga data, or the reverse.
 *
 * Wire format (identical on desktop and Android; see MangaSyncMerge.kt):
 *   {
 *     "v": 1,
 *     "manga":   { "<mangaId>": { "title": string, "cover": string | null } },
 *     "reading": { "<mangaId>:<chapterKey>": SyncReadingRow },
 *     "deleted": { "<mangaId>": ms, "<mangaId>:<chapterKey>": ms }
 *   }
 * A row is one chapter's reading position, keyed by AniList id and chapter
 * number, like each app's local `reading` table. Rows merge last-write-wins by
 * `updatedAt`. A tombstone hides every row of that manga (Continue Reading
 * removal) or that one chapter (marked unread) that is not newer than it, so
 * the other device's copy cannot resurrect it; reading again afterwards wins.
 */

export const MANGA_SYNC_FILE = "anitrack-manga-sync.json";
export const MANGA_SYNC_TOMBSTONE_TTL_MS = 90 * 24 * 3600 * 1000;
export const MANGA_SYNC_MAX_ROWS = 20_000;

export interface SyncReadingRow {
  mangaId: number;
  chapter: number;
  chapterId: string;
  page: number;
  pageCount: number;
  sourceId: string;
  updatedAt: number;
}

export interface SyncMangaMeta {
  title: string;
  cover: string | null;
}

/** A local reading-table row: the synced fields plus the card's title and cover. */
export interface LocalReadingRow extends SyncReadingRow {
  title: string;
  cover: string | null;
}

export interface MangaSyncDoc {
  manga: Record<string, SyncMangaMeta>;
  reading: Record<string, SyncReadingRow>;
  deleted: Record<string, number>;
}

/** What one reconcile does: rows to write or delete locally, and the merged gist file. */
export interface MangaSyncPlan {
  upsert: LocalReadingRow[];
  remove: { mangaId: number; chapter: number }[];
  doc: MangaSyncDoc;
  /** Whether [doc] differs from the remote file and must be uploaded. */
  changed: boolean;
}

/** Canonical chapter number text, the same on both apps: 4 decimals, no trailing zeros. */
export function chapterKey(chapter: number): string {
  return String(Math.round(chapter * 1e4) / 1e4);
}

export function readingKey(mangaId: number, chapter: number): string {
  return `${mangaId}:${chapterKey(chapter)}`;
}

export const emptyMangaSyncDoc = (): MangaSyncDoc => ({ manga: {}, reading: {}, deleted: {} });

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const SOURCE_ID = /^[a-z0-9]{1,20}$/;
const DELETED_KEY = /^\d{1,9}(:\d{1,6}(\.\d{1,4})?)?$/;

/** A validated row, or null. */
export function syncReadingRow(value: unknown): SyncReadingRow | null {
  const row = record(value);
  if (!row) return null;
  const { mangaId, chapter, chapterId, page, pageCount, sourceId, updatedAt } = row;
  if (typeof mangaId !== "number" || !Number.isSafeInteger(mangaId) || mangaId <= 0) return null;
  if (typeof chapter !== "number" || !Number.isFinite(chapter) || chapter < 0 || chapter > 100_000) return null;
  if (typeof chapterId !== "string" || !chapterId || chapterId.length > 64) return null;
  if (typeof pageCount !== "number" || !Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 2000) return null;
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 0 || page >= pageCount) return null;
  if (typeof sourceId !== "string" || !SOURCE_ID.test(sourceId)) return null;
  if (typeof updatedAt !== "number" || !Number.isSafeInteger(updatedAt) || updatedAt <= 0) return null;
  return { mangaId, chapter: Math.round(chapter * 1e4) / 1e4, chapterId, page, pageCount, sourceId, updatedAt };
}

/**
 * The gist file's content. An absent file is an empty document; a malformed one
 * throws, so a reconcile never uploads over data it could not read.
 */
export function parseMangaSyncDoc(content: string | null | undefined): MangaSyncDoc {
  if (content == null || !content.trim()) return emptyMangaSyncDoc();
  const json = record(JSON.parse(content));
  if (!json) throw new Error("The manga sync file is not an object.");
  const doc = emptyMangaSyncDoc();
  const reading = json.reading == null ? {} : record(json.reading);
  const manga = json.manga == null ? {} : record(json.manga);
  const deleted = json.deleted == null ? {} : record(json.deleted);
  if (!reading || !manga || !deleted) throw new Error("The manga sync file has an invalid section.");
  const entries = Object.values(reading);
  if (entries.length > MANGA_SYNC_MAX_ROWS) throw new Error("The manga sync file has too many rows.");
  for (const value of entries) {
    const row = syncReadingRow(value);
    if (!row) throw new Error("The manga sync file has an invalid reading row.");
    const key = readingKey(row.mangaId, row.chapter);
    if (!doc.reading[key] || row.updatedAt > doc.reading[key].updatedAt) doc.reading[key] = row;
  }
  for (const [id, value] of Object.entries(manga)) {
    const meta = record(value);
    if (!/^\d{1,9}$/.test(id) || !meta || typeof meta.title !== "string" || meta.title.length > 300
      || (meta.cover != null && (typeof meta.cover !== "string" || meta.cover.length > 2048))) {
      throw new Error("The manga sync file has invalid manga details.");
    }
    doc.manga[id] = { title: meta.title, cover: typeof meta.cover === "string" ? meta.cover : null };
  }
  for (const [key, ts] of Object.entries(deleted)) {
    if (!DELETED_KEY.test(key) || typeof ts !== "number" || !Number.isSafeInteger(ts) || ts <= 0) {
      throw new Error("The manga sync file has an invalid removal.");
    }
    doc.deleted[key] = ts;
  }
  return doc;
}

export function serializeMangaSyncDoc(doc: MangaSyncDoc): string {
  return JSON.stringify({ v: 1, manga: doc.manga, reading: doc.reading, deleted: doc.deleted });
}

/** Whether a removal hides this row: its manga or chapter was removed at or after it was read. */
export function coveredByRemoval(deleted: Record<string, number>, row: { mangaId: number; chapter: number; updatedAt: number }): boolean {
  const whole = deleted[String(row.mangaId)];
  const one = deleted[readingKey(row.mangaId, row.chapter)];
  return (whole != null && row.updatedAt <= whole) || (one != null && row.updatedAt <= one);
}

const synced = (row: SyncReadingRow): SyncReadingRow => ({
  mangaId: row.mangaId, chapter: row.chapter, chapterId: row.chapterId, page: row.page,
  pageCount: row.pageCount, sourceId: row.sourceId, updatedAt: row.updatedAt,
});

const sameRow = (a: SyncReadingRow, b: SyncReadingRow) =>
  a.mangaId === b.mangaId && a.chapter === b.chapter && a.chapterId === b.chapterId && a.page === b.page
  && a.pageCount === b.pageCount && a.sourceId === b.sourceId && a.updatedAt === b.updatedAt;

function sameDoc(a: MangaSyncDoc, b: MangaSyncDoc): boolean {
  const aRows = Object.keys(a.reading), bRows = Object.keys(b.reading);
  if (aRows.length !== bRows.length || aRows.some((k) => !b.reading[k] || !sameRow(a.reading[k], b.reading[k]))) return false;
  const aDel = Object.keys(a.deleted), bDel = Object.keys(b.deleted);
  if (aDel.length !== bDel.length || aDel.some((k) => b.deleted[k] !== a.deleted[k])) return false;
  const aMeta = Object.keys(a.manga), bMeta = Object.keys(b.manga);
  return aMeta.length === bMeta.length
    && aMeta.every((k) => b.manga[k] && b.manga[k].title === a.manga[k].title && b.manga[k].cover === a.manga[k].cover);
}

/**
 * One two-way reconcile. [pending] holds removals made on this device that may
 * not be in the gist yet. Newer remote rows are written locally, rows a removal
 * hides are deleted locally, and the merged file is uploaded when it differs.
 */
export function planMangaSync(
  local: LocalReadingRow[],
  remote: MangaSyncDoc,
  pending: Record<string, number>,
  now: number,
): MangaSyncPlan {
  const deleted: Record<string, number> = { ...remote.deleted };
  for (const [key, ts] of Object.entries(pending)) if (!(key in deleted) || ts > deleted[key]) deleted[key] = ts;

  const localByKey = new Map<string, LocalReadingRow>();
  for (const row of local) localByKey.set(readingKey(row.mangaId, row.chapter), row);

  const upsert: LocalReadingRow[] = [];
  for (const [key, row] of Object.entries(remote.reading)) {
    if (coveredByRemoval(deleted, row)) continue;
    const mine = localByKey.get(key);
    if (mine && mine.updatedAt >= row.updatedAt) continue;
    const meta = remote.manga[String(row.mangaId)];
    upsert.push({ ...synced(row), title: meta?.title ?? mine?.title ?? "Unknown", cover: meta ? meta.cover : mine?.cover ?? null });
  }
  const remove = local.filter((row) => coveredByRemoval(deleted, row)).map((row) => ({ mangaId: row.mangaId, chapter: row.chapter }));

  const reading: Record<string, SyncReadingRow> = {};
  for (const [key, row] of Object.entries(remote.reading)) if (!coveredByRemoval(deleted, row)) reading[key] = synced(row);
  const newestLocal = new Map<number, LocalReadingRow>();
  for (const [key, row] of localByKey) {
    if (coveredByRemoval(deleted, row)) continue;
    if (!reading[key] || row.updatedAt > reading[key].updatedAt) reading[key] = synced(row);
    const seen = newestLocal.get(row.mangaId);
    if (!seen || row.updatedAt > seen.updatedAt) newestLocal.set(row.mangaId, row);
  }

  const manga: Record<string, SyncMangaMeta> = {};
  for (const row of Object.values(reading)) {
    const id = String(row.mangaId);
    if (manga[id]) continue;
    const mine = newestLocal.get(row.mangaId);
    manga[id] = mine ? { title: mine.title.slice(0, 300), cover: mine.cover && mine.cover.length <= 2048 ? mine.cover : null }
      : remote.manga[id] ?? { title: "Unknown", cover: null };
  }

  const cutoff = now - MANGA_SYNC_TOMBSTONE_TTL_MS;
  for (const [key, ts] of Object.entries(deleted)) if (ts < cutoff && pending[key] !== ts) delete deleted[key];

  const doc: MangaSyncDoc = { manga, reading, deleted };
  return { upsert, remove, doc, changed: !sameDoc(remote, doc) };
}
