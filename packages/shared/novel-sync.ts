/**
 * Cross-device novel sync: reading progress, the novel list, and which source
 * copies are linked as one novel (plus how many chapters each list showed last).
 *
 * Lives in its own file of the same private GitHub gist as Continue Watching and
 * manga reading (`anitrack-novel-sync.json`). A gist PATCH replaces only the files
 * it names, so app versions without novels never touch it, and this never touches theirs.
 *
 * Wire format (identical on desktop and Android; see NovelSyncMerge.kt):
 *   {
 *     "v": 1,
 *     "titles":  { "<source>:<titleId>": { "title", "cover", "novelKey", "linkAt", "seen" } },
 *     "reading": { "<source>:<titleId>:<chapterId>": NovelSyncReading },
 *     "list":    { "<source>:<titleId>": NovelSyncList },
 *     "deleted": { "reading": { "<source>:<titleId>[:<chapterId>]": ms }, "list": { "<source>:<titleId>": ms } }
 *   }
 * Everything is keyed per source copy, like each app's local tables. Rows merge
 * last-write-wins by `updatedAt`; a removal hides the copy's rows (or the one row)
 * not newer than it, so the other device's copy cannot resurrect them. A copy's
 * link (`novelKey`, the group's smallest copy key, the same on every device) merges
 * by `linkAt`, the time it was last linked or unlinked; `seen` merges by maximum.
 */

export const NOVEL_SYNC_FILE = "anitrack-novel-sync.json";
export const NOVEL_SYNC_TOMBSTONE_TTL_MS = 90 * 24 * 3600 * 1000;
export const NOVEL_SYNC_MAX_ROWS = 20_000;

const SOURCES = ["novelbuddy", "novelarchive"] as const;
type Source = (typeof SOURCES)[number];
const STATUSES = ["reading", "completed", "on_hold", "dropped", "plan_to_read"];
const TITLE_ID = /^[A-Za-z0-9]{4,24}$/;
const CHAPTER_ID = /^[A-Za-z0-9]{1,24}$/;
const COPY_KEY = /^(novelbuddy|novelarchive):([A-Za-z0-9]{4,24})$/;
const ROW_KEY = /^(novelbuddy|novelarchive):([A-Za-z0-9]{4,24}):([A-Za-z0-9]{1,24})$/;

export interface NovelSyncReading {
  sourceId: Source;
  titleId: string;
  chapterId: string;
  chapterOrder: number;
  chapterLabel: string;
  paragraph: number;
  paragraphCount: number;
  updatedAt: number;
}

export interface NovelSyncList {
  sourceId: Source;
  titleId: string;
  status: string;
  updatedAt: number;
}

/** One source copy's details and link, as both the gist and each device keep them. */
export interface NovelSyncTitle {
  sourceId: Source;
  titleId: string;
  title: string;
  cover: string | null;
  /** The novel this copy belongs to: the smallest "source:id" among its linked copies. */
  novelKey: string;
  /** When this copy was last linked or unlinked; null when never. */
  linkAt: number | null;
  /** How many chapters its list had when last shown (for "N new"). */
  seen: number | null;
}

type Shown = { title: string; cover: string | null };

export interface NovelSyncDoc {
  titles: Record<string, Omit<NovelSyncTitle, "sourceId" | "titleId">>;
  reading: Record<string, NovelSyncReading>;
  list: Record<string, NovelSyncList>;
  deleted: { reading: Record<string, number>; list: Record<string, number> };
}

/** This device's tables, as one reconcile reads them. */
export interface NovelSyncLocal {
  reading: (NovelSyncReading & Shown)[];
  list: (NovelSyncList & Shown)[];
  titles: NovelSyncTitle[];
}

/** Removals made on this device that the gist may not have yet: key → when. */
export interface NovelSyncRemovals {
  reading: Record<string, number>;
  list: Record<string, number>;
}

/** What one reconcile does: local writes and deletes, and the merged gist file. */
export interface NovelSyncPlan {
  reading: { upsert: (NovelSyncReading & Shown)[]; remove: { sourceId: Source; titleId: string; chapterId: string }[] };
  list: { upsert: (NovelSyncList & Shown)[]; remove: { sourceId: Source; titleId: string }[] };
  /** Local copies to add, or whose link or seen count changed. */
  titles: NovelSyncTitle[];
  doc: NovelSyncDoc;
  /** Whether [doc] differs from the remote file and must be uploaded. */
  changed: boolean;
}

export const novelCopyKey = (sourceId: string, titleId: string) => `${sourceId}:${titleId}`;
export const novelRowKey = (sourceId: string, titleId: string, chapterId: string) => `${sourceId}:${titleId}:${chapterId}`;

export const emptyNovelSyncDoc = (): NovelSyncDoc => ({ titles: {}, reading: {}, list: {}, deleted: { reading: {}, list: {} } });

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const isSource = (value: unknown): value is Source => SOURCES.includes(value as Source);
const int = (value: unknown, min: number, max: number) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const time = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** A validated reading row, or null. */
export function novelSyncReading(value: unknown): NovelSyncReading | null {
  const row = record(value);
  if (!row) return null;
  const { sourceId, titleId, chapterId, chapterOrder, chapterLabel, paragraph, paragraphCount, updatedAt } = row;
  if (!isSource(sourceId) || typeof titleId !== "string" || !TITLE_ID.test(titleId)) return null;
  if (typeof chapterId !== "string" || !CHAPTER_ID.test(chapterId)) return null;
  if (!int(chapterOrder, 0, 20_000) || typeof chapterLabel !== "string" || !chapterLabel || chapterLabel.length > 200) return null;
  if (!int(paragraphCount, 0, 5_000) || !int(paragraph, 0, paragraphCount as number) || !time(updatedAt)) return null;
  return {
    sourceId, titleId, chapterId, chapterOrder: chapterOrder as number, chapterLabel,
    paragraph: paragraph as number, paragraphCount: paragraphCount as number, updatedAt: updatedAt as number,
  };
}

/** A validated list row, or null. */
export function novelSyncList(value: unknown): NovelSyncList | null {
  const row = record(value);
  if (!row) return null;
  const { sourceId, titleId, status, updatedAt } = row;
  if (!isSource(sourceId) || typeof titleId !== "string" || !TITLE_ID.test(titleId)) return null;
  if (typeof status !== "string" || !STATUSES.includes(status) || !time(updatedAt)) return null;
  return { sourceId, titleId, status, updatedAt: updatedAt as number };
}

/**
 * The gist file's content. An absent file is an empty document; a malformed one
 * throws, so a reconcile never uploads over data it could not read. Unknown
 * sections (from a newer app) are ignored.
 */
export function parseNovelSyncDoc(content: string | null | undefined): NovelSyncDoc {
  if (content == null || !content.trim()) return emptyNovelSyncDoc();
  const json = record(JSON.parse(content));
  if (!json) throw new Error("The novel sync file is not an object.");
  const section = (name: string) => (json[name] == null ? {} : record(json[name]));
  const titles = section("titles");
  const reading = section("reading");
  const list = section("list");
  const deleted = section("deleted");
  if (!titles || !reading || !list || !deleted) throw new Error("The novel sync file has an invalid section.");
  const deletedReading = deleted.reading == null ? {} : record(deleted.reading);
  const deletedList = deleted.list == null ? {} : record(deleted.list);
  if (!deletedReading || !deletedList) throw new Error("The novel sync file has an invalid removal section.");
  if (Object.keys(reading).length > NOVEL_SYNC_MAX_ROWS || Object.keys(titles).length > NOVEL_SYNC_MAX_ROWS) {
    throw new Error("The novel sync file has too many rows.");
  }

  const doc = emptyNovelSyncDoc();
  for (const [key, value] of Object.entries(reading)) {
    const row = novelSyncReading(value);
    if (!row || key !== novelRowKey(row.sourceId, row.titleId, row.chapterId)) throw new Error("The novel sync file has an invalid reading row.");
    doc.reading[key] = row;
  }
  for (const [key, value] of Object.entries(list)) {
    const row = novelSyncList(value);
    if (!row || key !== novelCopyKey(row.sourceId, row.titleId)) throw new Error("The novel sync file has an invalid list row.");
    doc.list[key] = row;
  }
  for (const [key, value] of Object.entries(titles)) {
    const t = record(value);
    if (!COPY_KEY.test(key) || !t || typeof t.title !== "string" || t.title.length > 300
      || (t.cover != null && (typeof t.cover !== "string" || t.cover.length > 2048))
      || typeof t.novelKey !== "string" || !COPY_KEY.test(t.novelKey)
      || (t.linkAt != null && !time(t.linkAt)) || (t.seen != null && !int(t.seen, 0, 20_000))) {
      throw new Error("The novel sync file has invalid title details.");
    }
    doc.titles[key] = {
      title: t.title, cover: typeof t.cover === "string" ? t.cover : null, novelKey: t.novelKey,
      linkAt: (t.linkAt as number | null | undefined) ?? null, seen: (t.seen as number | null | undefined) ?? null,
    };
  }
  for (const [key, ts] of Object.entries(deletedReading)) {
    if (!(COPY_KEY.test(key) || ROW_KEY.test(key)) || !time(ts)) throw new Error("The novel sync file has an invalid removal.");
    doc.deleted.reading[key] = ts as number;
  }
  for (const [key, ts] of Object.entries(deletedList)) {
    if (!COPY_KEY.test(key) || !time(ts)) throw new Error("The novel sync file has an invalid removal.");
    doc.deleted.list[key] = ts as number;
  }
  return doc;
}

/** The document with keys in a fixed order, so equal content always serializes the same. */
function ordered(doc: NovelSyncDoc) {
  const sort = <T>(o: Record<string, T>) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return {
    v: 1,
    titles: sort(Object.fromEntries(Object.entries(doc.titles).map(([k, t]) => [k, { title: t.title, cover: t.cover, novelKey: t.novelKey, linkAt: t.linkAt, seen: t.seen }]))),
    reading: sort(Object.fromEntries(Object.entries(doc.reading).map(([k, r]) => [k, {
      sourceId: r.sourceId, titleId: r.titleId, chapterId: r.chapterId, chapterOrder: r.chapterOrder,
      chapterLabel: r.chapterLabel, paragraph: r.paragraph, paragraphCount: r.paragraphCount, updatedAt: r.updatedAt,
    }]))),
    list: sort(Object.fromEntries(Object.entries(doc.list).map(([k, r]) => [k, { sourceId: r.sourceId, titleId: r.titleId, status: r.status, updatedAt: r.updatedAt }]))),
    deleted: { reading: sort(doc.deleted.reading), list: sort(doc.deleted.list) },
  };
}

export function serializeNovelSyncDoc(doc: NovelSyncDoc): string {
  return JSON.stringify(ordered(doc));
}

/** Whether a removal hides this reading row: its copy or the row was removed at or after it was read. */
export function readingRemoved(deleted: Record<string, number>, row: Pick<NovelSyncReading, "sourceId" | "titleId" | "chapterId" | "updatedAt">): boolean {
  const whole = deleted[novelCopyKey(row.sourceId, row.titleId)];
  const one = deleted[novelRowKey(row.sourceId, row.titleId, row.chapterId)];
  return (whole != null && row.updatedAt <= whole) || (one != null && row.updatedAt <= one);
}

const listRemoved = (deleted: Record<string, number>, row: Pick<NovelSyncList, "sourceId" | "titleId" | "updatedAt">) => {
  const ts = deleted[novelCopyKey(row.sourceId, row.titleId)];
  return ts != null && row.updatedAt <= ts;
};

const bare = (r: NovelSyncReading): NovelSyncReading => ({
  sourceId: r.sourceId, titleId: r.titleId, chapterId: r.chapterId, chapterOrder: r.chapterOrder,
  chapterLabel: r.chapterLabel, paragraph: r.paragraph, paragraphCount: r.paragraphCount, updatedAt: r.updatedAt,
});

function mergeRemovals(remote: Record<string, number>, pending: Record<string, number>): Record<string, number> {
  const out = { ...remote };
  for (const [key, ts] of Object.entries(pending)) if (!(key in out) || ts > out[key]) out[key] = ts;
  return out;
}

/**
 * One two-way reconcile. [pending] holds removals made on this device that may
 * not be in the gist yet. Newer remote rows and links are written locally, rows a
 * removal hides are deleted locally, and the merged file is uploaded when it differs.
 */
export function planNovelSync(input: NovelSyncLocal, remote: NovelSyncDoc, pending: NovelSyncRemovals, now: number): NovelSyncPlan {
  // Only rows the other device's parser accepts are ever uploaded (it refuses a whole file otherwise).
  const local: NovelSyncLocal = {
    reading: input.reading.filter((r) => novelSyncReading(r) != null),
    list: input.list.filter((r) => novelSyncList(r) != null),
    titles: input.titles.filter((t) => isSource(t.sourceId) && TITLE_ID.test(t.titleId) && COPY_KEY.test(t.novelKey)
      && (t.linkAt == null || time(t.linkAt)) && (t.seen == null || int(t.seen, 0, 20_000))),
  };
  const deletedReading = mergeRemovals(remote.deleted.reading, pending.reading);
  const deletedList = mergeRemovals(remote.deleted.list, pending.list);
  const localTitles = new Map(local.titles.map((t) => [novelCopyKey(t.sourceId, t.titleId), t]));
  // Rows carry their card's name too: the newest per copy, for copies without a title row.
  const rowNames = new Map<string, Shown & { at: number }>();
  for (const r of [...local.reading, ...local.list]) {
    const key = novelCopyKey(r.sourceId, r.titleId);
    const held = rowNames.get(key);
    if (r.title && (!held || r.updatedAt > held.at)) rowNames.set(key, { title: r.title, cover: r.cover, at: r.updatedAt });
  }
  /** A copy's name and cover: this device's, else the gist's. */
  const nameOf = (key: string): Shown | null => {
    const mine = localTitles.get(key);
    if (mine?.title) return { title: mine.title, cover: mine.cover };
    const row = rowNames.get(key);
    if (row) return { title: row.title, cover: row.cover };
    const theirs = remote.titles[key];
    return theirs?.title ? { title: theirs.title, cover: theirs.cover } : null;
  };
  const shown = (key: string): Shown => nameOf(key) ?? { title: "Unknown", cover: null };

  // ── Reading ──
  const localReading = new Map(local.reading.map((r) => [novelRowKey(r.sourceId, r.titleId, r.chapterId), r]));
  const readingUpsert: NovelSyncPlan["reading"]["upsert"] = [];
  for (const [key, row] of Object.entries(remote.reading)) {
    if (readingRemoved(deletedReading, row)) continue;
    const mine = localReading.get(key);
    if (mine && mine.updatedAt >= row.updatedAt) continue;
    readingUpsert.push({ ...bare(row), ...shown(novelCopyKey(row.sourceId, row.titleId)) });
  }
  const readingRemove = local.reading.filter((r) => readingRemoved(deletedReading, r))
    .map((r) => ({ sourceId: r.sourceId, titleId: r.titleId, chapterId: r.chapterId }));
  const reading: Record<string, NovelSyncReading> = {};
  for (const [key, row] of Object.entries(remote.reading)) if (!readingRemoved(deletedReading, row)) reading[key] = bare(row);
  for (const [key, row] of localReading) {
    if (readingRemoved(deletedReading, row)) continue;
    if (!reading[key] || row.updatedAt > reading[key].updatedAt) reading[key] = bare(row);
  }

  // ── List ──
  const localList = new Map(local.list.map((r) => [novelCopyKey(r.sourceId, r.titleId), r]));
  const listUpsert: NovelSyncPlan["list"]["upsert"] = [];
  for (const [key, row] of Object.entries(remote.list)) {
    if (listRemoved(deletedList, row)) continue;
    const mine = localList.get(key);
    if (mine && mine.updatedAt >= row.updatedAt) continue;
    listUpsert.push({ ...row, ...shown(key) });
  }
  const listRemove = local.list.filter((r) => listRemoved(deletedList, r)).map((r) => ({ sourceId: r.sourceId, titleId: r.titleId }));
  const list: Record<string, NovelSyncList> = {};
  for (const [key, row] of Object.entries(remote.list)) if (!listRemoved(deletedList, row)) list[key] = { ...row };
  for (const [key, row] of localList) {
    if (listRemoved(deletedList, row)) continue;
    if (!list[key] || row.updatedAt > list[key].updatedAt) list[key] = { sourceId: row.sourceId, titleId: row.titleId, status: row.status, updatedAt: row.updatedAt };
  }

  // ── Copies: links by linkAt, seen counts by maximum ──
  const titleUpdates: NovelSyncTitle[] = [];
  const merged: NovelSyncDoc["titles"] = {};
  const referenced = new Set([...Object.values(reading).map((r) => novelCopyKey(r.sourceId, r.titleId)), ...Object.keys(list)]);
  const keys = new Set<string>([...localTitles.keys(), ...Object.keys(remote.titles), ...referenced]);
  for (const key of keys) {
    const mine = localTitles.get(key);
    const theirs = remote.titles[key];
    const [sourceId, titleId] = key.split(":") as [Source, string];
    const theirsWin = !!theirs && (theirs.linkAt ?? 0) > (mine?.linkAt ?? 0);
    const link = theirsWin || (!mine && theirs) ? { novelKey: theirs!.novelKey, linkAt: theirs!.linkAt }
      : mine ? { novelKey: mine.novelKey, linkAt: mine.linkAt } : { novelKey: key, linkAt: null };
    const seens = [mine?.seen, theirs?.seen].filter((s): s is number => s != null);
    const seen = seens.length ? Math.max(...seens) : null;
    const info = nameOf(key) ?? { title: "", cover: mine?.cover ?? theirs?.cover ?? null };
    const row: NovelSyncTitle = { sourceId, titleId, title: info.title, cover: info.cover, ...link, seen };
    // A copy the gist knows only by name changes nothing here; a link, unlink or seen count does.
    const informative = !!theirs && (theirs.linkAt != null || theirs.novelKey !== key || theirs.seen != null);
    if (theirs && (mine ? theirsWin || (seen ?? -1) > (mine.seen ?? -1) : informative)) titleUpdates.push(row);
    // The gist keeps copies that were linked (or unlinked) or that rows refer to.
    if (row.linkAt != null || row.novelKey !== key || referenced.has(key)) {
      merged[key] = { title: row.title.slice(0, 300), cover: row.cover && row.cover.length <= 2048 ? row.cover : null, novelKey: row.novelKey, linkAt: row.linkAt, seen: row.seen };
    }
  }

  // ── Removals older than the TTL are dropped (unless still pending here) ──
  const cutoff = now - NOVEL_SYNC_TOMBSTONE_TTL_MS;
  for (const [key, ts] of Object.entries(deletedReading)) if (ts < cutoff && pending.reading[key] !== ts) delete deletedReading[key];
  for (const [key, ts] of Object.entries(deletedList)) if (ts < cutoff && pending.list[key] !== ts) delete deletedList[key];

  const doc: NovelSyncDoc = { titles: merged, reading, list, deleted: { reading: deletedReading, list: deletedList } };
  return {
    reading: { upsert: readingUpsert, remove: readingRemove },
    list: { upsert: listUpsert, remove: listRemove },
    titles: titleUpdates,
    doc,
    changed: serializeNovelSyncDoc(doc) !== serializeNovelSyncDoc(remote),
  };
}
