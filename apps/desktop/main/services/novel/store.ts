import { getDb, runInTransaction } from "../db";
import {
  NOVEL_SYNC_TOMBSTONE_TTL_MS,
  novelCopyKey,
  novelRowKey,
  type NovelSyncList,
  type NovelSyncLocal,
  type NovelSyncReading,
  type NovelSyncRemovals,
  type NovelSyncTitle,
} from "../../../../../packages/shared/novel-sync";
import {
  chapterKey,
  isNovelSource,
  NOVEL_STATUSES,
  novelTitleKey,
  sameNovel,
  type NovelDetail,
  type NovelGroup,
  type NovelListEntry,
  type NovelMember,
  type NovelProgressMap,
  type NovelReadingRow,
  type NovelSourceId,
  type NovelStatus,
} from "../../../../../packages/shared/novel";

/*
 * Novels are stored per source copy (source + that source's title id). Copies of
 * the same novel on different sources share a novel_key in novel_title — the
 * smallest "source:id" among them, so two devices linking the same copies agree
 * on it — and everything that reads progress or the list looks at the whole
 * group, matching chapters by label (chapterKey). Removals are also written to
 * novel_sync_removed so the sync gist can hide them on other devices.
 */

type Ref = { sourceId: NovelSourceId; titleId: string };

// ── Linked copies ─────────────────────────────────────────────────────────────

/** The novel a source copy belongs to (its own key until it's linked). */
export function groupKeyOf(sourceId: NovelSourceId, titleId: string): string {
  const row: any = getDb().get(`SELECT novel_key FROM novel_title WHERE source_id = ? AND title_id = ?`, [sourceId, titleId]);
  return row?.novel_key ?? novelTitleKey(sourceId, titleId);
}

function membersOf(key: string): Ref[] {
  const rows: any[] = getDb().all(`SELECT source_id, title_id FROM novel_title WHERE novel_key = ?`, [key]);
  const refs = rows.filter((r) => isNovelSource(r.source_id)).map((r) => ({ sourceId: r.source_id as NovelSourceId, titleId: r.title_id as string }));
  // An unregistered copy is its own group.
  const [source, ...rest] = key.split(":");
  const id = rest.join(":");
  if (!refs.length && isNovelSource(source) && id) refs.push({ sourceId: source, titleId: id });
  return refs;
}

/** A copy's group: every linked copy, its own first. */
export function group(sourceId: NovelSourceId, titleId: string): NovelGroup {
  const key = groupKeyOf(sourceId, titleId);
  const rows: any[] = getDb().all(`SELECT source_id, title_id, title, cover FROM novel_title WHERE novel_key = ?`, [key]);
  const members: NovelMember[] = rows
    .filter((r) => isNovelSource(r.source_id))
    .map((r) => ({ sourceId: r.source_id, id: r.title_id, title: r.title ?? "", cover: r.cover ?? null }));
  if (!members.some((m) => m.sourceId === sourceId && m.id === titleId)) members.push({ sourceId, id: titleId, title: "", cover: null });
  members.sort((a, b) => Number(b.sourceId === sourceId && b.id === titleId) - Number(a.sourceId === sourceId && a.id === titleId));
  return { key, members };
}

/**
 * Remembers a copy whose details were fetched, then links it to a copy of the
 * same novel already known on another source (same name and author).
 */
export function registerTitle(detail: NovelDetail): void {
  const db = getDb();
  const existing: any = db.get(`SELECT novel_key, link_at FROM novel_title WHERE source_id = ? AND title_id = ?`, [detail.sourceId, detail.id]);
  // Keeps the link and the count last seen; a copy seen for the first time starts at today's count.
  db.run(
    `INSERT INTO novel_title (source_id, title_id, novel_key, title, author, alt_names, cover, seen_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (source_id, title_id) DO UPDATE SET
       title = excluded.title, author = excluded.author, alt_names = excluded.alt_names, cover = excluded.cover,
       seen_count = COALESCE(novel_title.seen_count, excluded.seen_count), updated_at = excluded.updated_at`,
    [
      detail.sourceId, detail.id, existing?.novel_key ?? novelTitleKey(detail.sourceId, detail.id),
      detail.title.slice(0, 300), detail.author?.slice(0, 300) ?? null, JSON.stringify(detail.altNames.slice(0, 8)),
      detail.cover?.slice(0, 2048) ?? null, detail.latest?.count ?? null, Date.now(),
    ],
  );
  // Already placed: linked, or linked/unlinked on purpose (here or on another device).
  if (existing && (existing.link_at != null || membersOf(existing.novel_key).length > 1)) return;
  const others: any[] = db.all(`SELECT source_id, title_id, novel_key, title, author, alt_names FROM novel_title WHERE source_id != ?`, [detail.sourceId]);
  for (const other of others) {
    let altNames: string[] = [];
    try { altNames = JSON.parse(other.alt_names ?? "[]"); } catch { /* ignore */ }
    if (sameNovel(detail, { title: other.title, altNames, author: other.author }) !== "yes") continue;
    // One copy per source in a novel.
    const taken: any = db.get(`SELECT 1 FROM novel_title WHERE novel_key = ? AND source_id = ?`, [other.novel_key, detail.sourceId]);
    if (taken) continue;
    link({ sourceId: other.source_id, titleId: other.title_id }, { sourceId: detail.sourceId, titleId: detail.id });
    return;
  }
}

/** Notes a removal for the sync gist ("reading": a copy or one chapter row; "list": a copy's entry). */
function remember(kind: "reading" | "list", key: string, at = Date.now()): void {
  getDb().run(`INSERT OR REPLACE INTO novel_sync_removed (kind, key, at, sent) VALUES (?, ?, ?, 0)`, [kind, key, at]);
}

/** The newest removal known for a reading row (its own, or its whole copy's), or 0. */
function removedAt(sourceId: string, titleId: string, chapterId: string): number {
  const row: any = getDb().get(
    `SELECT MAX(at) AS at FROM novel_sync_removed WHERE kind = 'reading' AND key IN (?, ?)`,
    [novelCopyKey(sourceId, titleId), novelRowKey(sourceId, titleId, chapterId)],
  );
  return row?.at ?? 0;
}

/** Puts [b]'s novel into [a]'s: progress and list status are shared from now on. */
export function link(a: Ref, b: Ref): void {
  runInTransaction(() => {
    const db = getDb();
    const ka = groupKeyOf(a.sourceId, a.titleId);
    const kb = groupKeyOf(b.sourceId, b.titleId);
    if (ka === kb) return;
    const now = Date.now();
    for (const ref of [a, b]) {
      db.run(
        `INSERT OR IGNORE INTO novel_title (source_id, title_id, novel_key, title, updated_at) VALUES (?, ?, ?, '', ?)`,
        [ref.sourceId, ref.titleId, groupKeyOf(ref.sourceId, ref.titleId), now],
      );
    }
    // The smallest key names the novel, so every device that links these copies agrees.
    const key = ka < kb ? ka : kb;
    db.run(`UPDATE novel_title SET novel_key = ?, link_at = ? WHERE novel_key IN (?, ?)`, [key, now, ka, kb]);
    // One list entry per novel: keep the newest.
    for (const extra of listRowsOf(key).slice(1)) {
      db.run(`DELETE FROM novel_list WHERE source_id = ? AND title_id = ?`, [extra.source_id, extra.title_id]);
      remember("list", novelCopyKey(extra.source_id, extra.title_id), now);
    }
  });
}

/** Takes a copy out of its novel (its own progress rows go with it). */
export function unlink(ref: Ref): void {
  runInTransaction(() => {
    const db = getDb();
    const key = groupKeyOf(ref.sourceId, ref.titleId);
    const own = novelTitleKey(ref.sourceId, ref.titleId);
    const now = Date.now();
    const rest = membersOf(key).filter((m) => !(m.sourceId === ref.sourceId && m.titleId === ref.titleId));
    db.run(`UPDATE novel_title SET novel_key = ?, link_at = ? WHERE source_id = ? AND title_id = ?`, [own, now, ref.sourceId, ref.titleId]);
    if (key === own && rest.length) {
      // The novel was named after this copy: the others carry on under the smallest of theirs.
      const next = rest.map((m) => novelTitleKey(m.sourceId, m.titleId)).sort()[0];
      db.run(`UPDATE novel_title SET novel_key = ?, link_at = ? WHERE novel_key = ? AND NOT (source_id = ? AND title_id = ?)`, [next, now, key, ref.sourceId, ref.titleId]);
    }
  });
}

/** Records how many chapters a copy had when its list was last shown, so "N new" counts from there. */
export function markSeen(sourceId: NovelSourceId, titleId: string, count: number): void {
  getDb().run(`UPDATE novel_title SET seen_count = ? WHERE source_id = ? AND title_id = ?`, [count, sourceId, titleId]);
}

/** The chapter count last seen for a copy, or null when it was never registered. */
export function seenCount(sourceId: NovelSourceId, titleId: string): number | null {
  const row: any = getDb().get(`SELECT seen_count FROM novel_title WHERE source_id = ? AND title_id = ?`, [sourceId, titleId]);
  return row?.seen_count ?? null;
}

// ── Reading progress ──────────────────────────────────────────────────────────

const inGroup = (refs: Ref[]) => ({
  where: refs.map(() => "(source_id = ? AND title_id = ?)").join(" OR "),
  args: refs.flatMap((r) => [r.sourceId, r.titleId]),
});

/** The novel's progress on every linked source, newest per chapter (matched by label). */
export function progressFor(sourceId: NovelSourceId, titleId: string): NovelProgressMap {
  const { where, args } = inGroup(membersOf(groupKeyOf(sourceId, titleId)));
  const rows: any[] = getDb().all(
    `SELECT source_id, chapter_id, chapter_order, chapter_label, paragraph, paragraph_count, updated_at FROM novel_reading WHERE ${where}`,
    args,
  );
  const out: NovelProgressMap = {};
  for (const row of rows) {
    if (!isNovelSource(row.source_id)) continue;
    const key = chapterKey(row.chapter_label);
    if (out[key] && out[key].updatedAt >= row.updated_at) continue;
    out[key] = {
      sourceId: row.source_id, chapterId: row.chapter_id, chapterLabel: row.chapter_label, chapterOrder: row.chapter_order,
      paragraph: row.paragraph, paragraphCount: row.paragraph_count, updatedAt: row.updated_at,
    };
  }
  return out;
}

export function saveReading(row: NovelReadingRow): void {
  getDb().run(
    `INSERT OR REPLACE INTO novel_reading
       (source_id, title_id, chapter_id, chapter_order, chapter_label, paragraph, paragraph_count, title, cover, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.sourceId, row.titleId, row.chapterId, row.chapterOrder, row.chapterLabel, row.paragraph, row.paragraphCount, row.title, row.cover, row.updatedAt],
  );
}

/**
 * Marks chapters read or, with [read] false, forgets them on every linked source.
 * Marked chapters stay older than a chapter read later for real, so Continue keeps
 * pointing at that one.
 */
export function markChapters(
  sourceId: NovelSourceId,
  titleId: string,
  chapters: { id: string; order: number; label: string }[],
  read: boolean,
  title: string,
  cover: string | null,
): void {
  runInTransaction(() => {
    const db = getDb();
    if (!read) {
      const keys = new Set(chapters.map((c) => chapterKey(c.label)));
      const { where, args } = inGroup(membersOf(groupKeyOf(sourceId, titleId)));
      const rows: any[] = db.all(`SELECT source_id, title_id, chapter_id, chapter_label FROM novel_reading WHERE ${where}`, args);
      const now = Date.now();
      for (const row of rows) {
        if (keys.has(chapterKey(row.chapter_label))) {
          db.run(`DELETE FROM novel_reading WHERE source_id = ? AND title_id = ? AND chapter_id = ?`, [row.source_id, row.title_id, row.chapter_id]);
          remember("reading", novelRowKey(row.source_id, row.title_id, row.chapter_id), now);
        }
      }
      return;
    }
    const sorted = [...chapters].sort((a, b) => a.order - b.order);
    const { where, args } = inGroup(membersOf(groupKeyOf(sourceId, titleId)));
    const newest: any = db.get(`SELECT source_id, chapter_order, updated_at FROM novel_reading WHERE ${where} ORDER BY updated_at DESC LIMIT 1`, args);
    const highest = sorted.at(-1)?.order ?? 0;
    const later = newest && newest.source_id === sourceId && newest.chapter_order > highest;
    const base = later ? newest.updated_at - sorted.length - 1 : Date.now() - sorted.length;
    // A marked chapter's paragraph count isn't known; 1 of 1 reads as finished. A mark is
    // never dated under a removal of that chapter, or the next sync would undo it.
    sorted.forEach((c, i) => {
      saveReading({
        sourceId, titleId, chapterId: c.id, chapterOrder: c.order, chapterLabel: c.label,
        paragraph: 1, paragraphCount: 1, title, cover, updatedAt: Math.max(base + i, removedAt(sourceId, titleId, c.id) + 1),
      });
    });
  });
}

const toRow = (row: any): NovelReadingRow => ({
  sourceId: row.source_id, titleId: row.title_id, chapterId: row.chapter_id, chapterOrder: row.chapter_order,
  chapterLabel: row.chapter_label, paragraph: row.paragraph, paragraphCount: row.paragraph_count,
  title: row.title ?? "Unknown", cover: row.cover ?? null, updatedAt: row.updated_at,
});

/** One row per novel (all linked sources together) — its most recently read chapter, newest first. */
export function continueReading(limit = 30): NovelReadingRow[] {
  const rows: any[] = getDb().all(
    `SELECT r.*, COALESCE(t.novel_key, r.source_id || ':' || r.title_id) AS novel_key
       FROM novel_reading r
       LEFT JOIN novel_title t ON t.source_id = r.source_id AND t.title_id = r.title_id
      ORDER BY r.updated_at DESC`,
  );
  const seen = new Set<string>();
  const out: NovelReadingRow[] = [];
  for (const row of rows) {
    if (seen.has(row.novel_key)) continue;
    seen.add(row.novel_key);
    out.push(toRow(row));
    if (out.length >= limit) break;
  }
  return out;
}

export function forgetReading(sourceId: NovelSourceId, titleId: string): void {
  runInTransaction(() => {
    const members = membersOf(groupKeyOf(sourceId, titleId));
    const { where, args } = inGroup(members);
    getDb().run(`DELETE FROM novel_reading WHERE ${where}`, args);
    const now = Date.now();
    for (const m of members) remember("reading", novelCopyKey(m.sourceId, m.titleId), now);
  });
}

// ── Novel list ────────────────────────────────────────────────────────────────

function listRowsOf(key: string): any[] {
  const { where, args } = inGroup(membersOf(key));
  return getDb().all(`SELECT source_id, title_id, status, updated_at FROM novel_list WHERE ${where} ORDER BY updated_at DESC`, args);
}

export function novelStatus(sourceId: NovelSourceId, titleId: string): NovelStatus | null {
  const row = listRowsOf(groupKeyOf(sourceId, titleId))[0];
  return row && (NOVEL_STATUSES as readonly string[]).includes(row.status) ? row.status : null;
}

/** Sets a novel's status (one entry for all its sources), or removes it with a null status. */
export function setNovelStatus(sourceId: NovelSourceId, titleId: string, status: NovelStatus | null, title: string, cover: string | null): void {
  if (status != null && !(NOVEL_STATUSES as readonly string[]).includes(status)) throw new Error("Invalid status");
  runInTransaction(() => {
    const db = getDb();
    const now = Date.now();
    for (const row of listRowsOf(groupKeyOf(sourceId, titleId))) {
      db.run(`DELETE FROM novel_list WHERE source_id = ? AND title_id = ?`, [row.source_id, row.title_id]);
      // The entry that's replaced below needs no removal (the new one is newer anyway).
      if (status == null || row.source_id !== sourceId || row.title_id !== titleId) remember("list", novelCopyKey(row.source_id, row.title_id), now);
    }
    if (status == null) return;
    db.run(
      `INSERT OR REPLACE INTO novel_list (source_id, title_id, status, title, cover, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [sourceId, titleId, status, title, cover, Date.now()],
    );
  });
}

export function novelList(): NovelListEntry[] {
  const rows: any[] = getDb().all(`SELECT source_id, title_id, status, title, cover, updated_at FROM novel_list ORDER BY updated_at DESC`);
  return rows.map((row) => ({
    sourceId: row.source_id, titleId: row.title_id, status: row.status, title: row.title ?? "Unknown", cover: row.cover ?? null, updatedAt: row.updated_at,
  }));
}

// ── Sync (see packages/shared/novel-sync.ts) ──────────────────────────────────

/** This device's novel tables, and the removals the sync gist hasn't received yet. */
export function novelSyncSnapshot(): NovelSyncLocal & { pending: NovelSyncRemovals } {
  const db = getDb();
  const reading = (db.all(
    `SELECT source_id, title_id, chapter_id, chapter_order, chapter_label, paragraph, paragraph_count, title, cover, updated_at FROM novel_reading`,
  ) as any[]).filter((r) => isNovelSource(r.source_id)).map((r) => ({
    sourceId: r.source_id, titleId: r.title_id, chapterId: r.chapter_id, chapterOrder: r.chapter_order, chapterLabel: r.chapter_label,
    paragraph: r.paragraph, paragraphCount: r.paragraph_count, updatedAt: r.updated_at, title: r.title ?? "", cover: r.cover ?? null,
  }));
  const list = (db.all(`SELECT source_id, title_id, status, title, cover, updated_at FROM novel_list`) as any[])
    .filter((r) => isNovelSource(r.source_id))
    .map((r) => ({ sourceId: r.source_id, titleId: r.title_id, status: r.status, updatedAt: r.updated_at, title: r.title ?? "", cover: r.cover ?? null }));
  const titles = (db.all(`SELECT source_id, title_id, title, cover, novel_key, link_at, seen_count FROM novel_title`) as any[])
    .filter((r) => isNovelSource(r.source_id))
    .map((r): NovelSyncTitle => ({
      sourceId: r.source_id, titleId: r.title_id, title: r.title ?? "", cover: r.cover ?? null,
      novelKey: r.novel_key, linkAt: r.link_at ?? null, seen: r.seen_count ?? null,
    }));
  const pending: NovelSyncRemovals = { reading: {}, list: {} };
  for (const r of db.all(`SELECT kind, key, at FROM novel_sync_removed WHERE sent = 0`) as any[]) {
    if (r.kind === "reading" || r.kind === "list") pending[r.kind as "reading" | "list"][r.key] = r.at;
  }
  return { reading, list, titles, pending };
}

/** Applies a reconcile's local side: rows and links from other devices, and rows a removal hides. */
export function applyNovelSync(change: {
  reading: { upsert: (NovelSyncReading & { title: string; cover: string | null })[]; remove: { sourceId: string; titleId: string; chapterId: string }[] };
  list: { upsert: (NovelSyncList & { title: string; cover: string | null })[]; remove: { sourceId: string; titleId: string }[] };
  titles: NovelSyncTitle[];
}): number {
  let changed = 0;
  runInTransaction(() => {
    const db = getDb();
    for (const r of change.reading.upsert) {
      saveReading({ ...r, title: r.title.slice(0, 300) || "Unknown", cover: r.cover });
      changed++;
    }
    for (const r of change.reading.remove) {
      db.run(`DELETE FROM novel_reading WHERE source_id = ? AND title_id = ? AND chapter_id = ?`, [r.sourceId, r.titleId, r.chapterId]);
      changed++;
    }
    for (const r of change.list.upsert) {
      db.run(
        `INSERT OR REPLACE INTO novel_list (source_id, title_id, status, title, cover, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [r.sourceId, r.titleId, r.status, r.title.slice(0, 300) || "Unknown", r.cover, r.updatedAt],
      );
      changed++;
    }
    for (const r of change.list.remove) {
      db.run(`DELETE FROM novel_list WHERE source_id = ? AND title_id = ?`, [r.sourceId, r.titleId]);
      changed++;
    }
    for (const t of change.titles) {
      const known: any = db.get(`SELECT 1 FROM novel_title WHERE source_id = ? AND title_id = ?`, [t.sourceId, t.titleId]);
      if (known) {
        db.run(
          `UPDATE novel_title SET novel_key = ?, link_at = ?, seen_count = ?,
             title = CASE WHEN title = '' THEN ? ELSE title END, cover = COALESCE(cover, ?)
           WHERE source_id = ? AND title_id = ?`,
          [t.novelKey, t.linkAt, t.seen, t.title.slice(0, 300), t.cover, t.sourceId, t.titleId],
        );
      } else {
        db.run(
          `INSERT INTO novel_title (source_id, title_id, novel_key, title, cover, link_at, seen_count, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [t.sourceId, t.titleId, t.novelKey, t.title.slice(0, 300), t.cover, t.linkAt, t.seen, Date.now()],
        );
      }
      changed++;
    }
  });
  return changed;
}

/**
 * After an upload: the removals it carried are sent, and every removal the gist
 * holds is remembered (so a later mark is never dated under one); old ones go.
 */
export function ackNovelSync(sent: NovelSyncRemovals, known: NovelSyncRemovals): void {
  runInTransaction(() => {
    const db = getDb();
    for (const kind of ["reading", "list"] as const) {
      for (const [key, at] of Object.entries(sent[kind])) {
        db.run(`UPDATE novel_sync_removed SET sent = 1 WHERE kind = ? AND key = ? AND at = ?`, [kind, key, at]);
      }
      for (const [key, at] of Object.entries(known[kind])) {
        db.run(
          `INSERT INTO novel_sync_removed (kind, key, at, sent) VALUES (?, ?, ?, 1)
           ON CONFLICT (kind, key) DO UPDATE SET at = MAX(at, excluded.at), sent = CASE WHEN excluded.at > at THEN 1 ELSE sent END`,
          [kind, key, at],
        );
      }
    }
    db.run(`DELETE FROM novel_sync_removed WHERE sent = 1 AND at < ?`, [Date.now() - NOVEL_SYNC_TOMBSTONE_TTL_MS]);
  });
}
