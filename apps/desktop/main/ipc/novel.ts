import { ipcMain, type BrowserWindow } from "electron";
import {
  isNovelChapterId,
  isNovelSource,
  isNovelTitleId,
  NOVEL_GENRES,
  NOVEL_IPC,
  NOVEL_MAX_CHAPTERS,
  NOVEL_MAX_PARAGRAPHS,
  NOVEL_SORTS,
  NOVEL_SOURCES,
  NOVEL_STATUSES,
  rankNovelMatches,
  sameNovel,
  type NovelChapter,
  type NovelDetail,
  type NovelFindResult,
  type NovelResult,
  type NovelSearchFilters,
  type NovelSourceId,
  type NovelStatus,
  type NovelUpdate,
} from "../../../../packages/shared/novel";
import {
  novelSyncList,
  novelSyncReading,
  type NovelSyncRemovals,
  type NovelSyncTitle,
} from "../../../../packages/shared/novel-sync";
import {
  cancelNovelDownloads,
  downloadedTitle,
  enqueueNovelChapters,
  listNovelDownloads,
  localChapter,
  onNovelDownload,
  removeNovelDownloads,
  savedChapterIds,
} from "../services/novel/downloads";
import { NovelSourceError, novelChapter, novelChapters, novelHome, novelSearch, novelTitle, savedNovelTitle } from "../services/novel/sources";
import * as store from "../services/novel/store";

function source(value: unknown): NovelSourceId {
  if (!isNovelSource(value)) throw new Error("Invalid source");
  return value;
}

function titleId(sourceId: NovelSourceId, value: unknown): string {
  if (typeof value !== "string" || !isNovelTitleId(sourceId, value)) throw new Error("Invalid title id");
  return value;
}

function chapterId(sourceId: NovelSourceId, value: unknown): string {
  if (typeof value !== "string" || !isNovelChapterId(sourceId, value)) throw new Error("Invalid chapter id");
  return value;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid text");
  return value;
}

const optionalText = (value: unknown, max: number): string | null => (typeof value === "string" && value.length <= max ? value : null);

function count(value: unknown, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error("Invalid number");
  return n;
}

function filters(value: unknown): NovelSearchFilters {
  const o = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const page = Number(o.page);
  return {
    sourceId: source(o.sourceId),
    query: optionalText(o.query, 120) ?? undefined,
    genre: (NOVEL_GENRES as readonly string[]).includes(o.genre as string) ? (o.genre as string) : undefined,
    status: o.status === "ongoing" || o.status === "completed" ? o.status : undefined,
    sort: NOVEL_SORTS.some((s) => s.id === o.sort) ? (o.sort as NovelSearchFilters["sort"]) : undefined,
    page: Number.isInteger(page) && page >= 1 && page <= 500 ? page : 1,
  };
}

/** Chapters from the renderer: ids of the source's shape only. */
function chapterList(sourceId: NovelSourceId, value: unknown): NovelChapter[] {
  return (Array.isArray(value) ? value : []).slice(0, NOVEL_MAX_CHAPTERS).map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    return { id: chapterId(sourceId, o.id), order: count(o.order, NOVEL_MAX_CHAPTERS), label: text(o.label, 200), updatedAt: null };
  });
}

async function guarded<T>(work: () => Promise<T>): Promise<NovelResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof NovelSourceError) return { ok: false, error: error.message };
    return { ok: false, error: "Something went wrong reaching the source. Try again." };
  }
}

/** Details fetched for a title page are remembered, which links copies of the same novel. */
async function titleWithLinks(sourceId: NovelSourceId, id: string): Promise<NovelDetail> {
  const detail = await novelTitle(sourceId, id);
  store.registerTitle(detail);
  return detail;
}

/**
 * A title's copy on [target]: linked already, found and linked now (same name and
 * author), or candidates for the user to choose from.
 */
async function findOn(sourceId: NovelSourceId, id: string, target: NovelSourceId): Promise<NovelFindResult> {
  const linked = () => store.group(sourceId, id).members.find((m) => m.sourceId === target);
  const already = linked();
  if (already) return { state: "linked", member: already };
  const detail = await titleWithLinks(sourceId, id);
  const queries = [detail.title, ...detail.altNames.filter((n) => /^[\x20-\x7e]{3,}$/.test(n))].slice(0, 2);
  let ranked: ReturnType<typeof rankNovelMatches> = [];
  for (const query of queries) {
    ranked = rankNovelMatches(detail.title, detail.altNames, (await novelSearch({ sourceId: target, query })).items);
    const close = ranked.filter((c) => sameNovel(detail, { title: c.title, altNames: [], author: null }) !== "no").slice(0, 3);
    for (const candidate of close) {
      const other = await novelTitle(target, candidate.id).catch(() => null);
      if (!other) continue;
      store.registerTitle(other);
      if (!linked() && sameNovel(detail, other) === "yes") store.link({ sourceId, titleId: id }, { sourceId: target, titleId: other.id });
      const member = linked();
      if (member) return { state: "linked", member };
    }
    if (ranked.length) break;
  }
  return ranked.length ? { state: "candidates", items: ranked.slice(0, 8) } : { state: "none" };
}

// ── New chapters (background lane, cached) ───────────────────────────────────

let updatesCache: { at: number; value: NovelUpdate[] } | null = null;
let updatesRun: Promise<NovelUpdate[]> | null = null;
const UPDATES_TTL_MS = 20 * 60 * 1000;

function novelUpdates(force = false): Promise<NovelUpdate[]> {
  if (!force && updatesCache && Date.now() - updatesCache.at < UPDATES_TTL_MS) return Promise.resolve(updatesCache.value);
  updatesRun ??= (async () => {
    const out: NovelUpdate[] = [];
    for (const row of store.continueReading(20)) {
      const detail = await novelTitle(row.sourceId, row.titleId, "back").catch(() => null);
      if (!detail?.latest) continue;
      store.registerTitle(detail);
      // New since the chapter list was last shown (not every unread chapter of a long backlog).
      const seen = store.seenCount(row.sourceId, row.titleId);
      const newCount = seen == null ? 0 : detail.latest.count - seen;
      if (newCount > 0) {
        out.push({
          sourceId: row.sourceId, titleId: row.titleId, title: detail.title, cover: detail.cover,
          newCount, latestLabel: detail.latest.label, latestAt: detail.latest.at,
        });
      }
    }
    out.sort((a, b) => (b.latestAt ?? 0) - (a.latestAt ?? 0));
    updatesCache = { at: Date.now(), value: out };
    return out;
  })().finally(() => { updatesRun = null; });
  return updatesRun;
}

// ── Sync payloads from the renderer: validated like the gist file itself ──

const COPY_KEY = /^(novelbuddy|novelarchive):[A-Za-z0-9]{4,24}$/;
const shownText = (o: Record<string, unknown>) => ({ title: optionalText(o.title, 300) ?? "", cover: optionalText(o.cover, 2048) });
const list = (value: unknown) => (Array.isArray(value) ? value : []).slice(0, 20_000).map((v) => (v ?? {}) as Record<string, unknown>);

function syncChange(value: unknown) {
  const o = (value ?? {}) as Record<string, any>;
  const reading = (o.reading ?? {}) as Record<string, unknown>;
  const listPart = (o.list ?? {}) as Record<string, unknown>;
  const must = <T>(row: T | null): T => { if (!row) throw new Error("Invalid sync row"); return row; };
  return {
    reading: {
      upsert: list(reading.upsert).map((r) => ({ ...must(novelSyncReading(r)), ...shownText(r) })),
      remove: list(reading.remove).map((r) => {
        const src = source(r.sourceId);
        return { sourceId: src, titleId: titleId(src, r.titleId), chapterId: chapterId(src, r.chapterId) };
      }),
    },
    list: {
      upsert: list(listPart.upsert).map((r) => ({ ...must(novelSyncList(r)), ...shownText(r) })),
      remove: list(listPart.remove).map((r) => {
        const src = source(r.sourceId);
        return { sourceId: src, titleId: titleId(src, r.titleId) };
      }),
    },
    titles: list(o.titles).map((t): NovelSyncTitle => {
      const src = source(t.sourceId);
      const linkAt = t.linkAt == null ? null : count(t.linkAt, Number.MAX_SAFE_INTEGER);
      const seen = t.seen == null ? null : count(t.seen, 20_000);
      if (typeof t.novelKey !== "string" || !COPY_KEY.test(t.novelKey)) throw new Error("Invalid novel key");
      return { sourceId: src, titleId: titleId(src, t.titleId), ...shownText(t), novelKey: t.novelKey, linkAt, seen };
    }),
  };
}

function removals(value: unknown): NovelSyncRemovals {
  const o = (value ?? {}) as Record<string, unknown>;
  const part = (v: unknown) => {
    const out: Record<string, number> = {};
    for (const [key, at] of Object.entries((v ?? {}) as Record<string, unknown>).slice(0, 40_000)) {
      if (/^(novelbuddy|novelarchive):[A-Za-z0-9]{4,24}(:[A-Za-z0-9]{1,24})?$/.test(key)) out[key] = count(at, Number.MAX_SAFE_INTEGER);
    }
    return out;
  };
  return { reading: part(o.reading), list: part(o.list) };
}

/** A NovelDetail from the renderer (for a download's saved metadata): known fields only. */
function detailArg(value: unknown): NovelDetail {
  const o = (value ?? {}) as Record<string, unknown>;
  const sourceId = source(o.sourceId);
  const id = titleId(sourceId, o.id);
  const strings = (v: unknown, n: number) => (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string").slice(0, n).map((x) => x.slice(0, 300));
  return {
    sourceId, id,
    title: optionalText(o.title, 300) ?? "Unknown",
    cover: optionalText(o.cover, 2048),
    status: o.status === "ongoing" || o.status === "completed" ? o.status : null,
    chapters: Number.isInteger(o.chapters) ? (o.chapters as number) : null,
    rating: typeof o.rating === "number" && Number.isFinite(o.rating) ? o.rating : null,
    genres: strings(o.genres, 12),
    mtl: o.mtl === true,
    synopsis: optionalText(o.synopsis, 6000),
    author: optionalText(o.author, 300),
    altNames: strings(o.altNames, 8),
    url: optionalText(o.url, 2048) ?? "",
    latest: null,
  };
}

export function registerNovelIpc(getMainWindow: () => BrowserWindow | null) {
  onNovelDownload((event) => getMainWindow()?.webContents.send(NOVEL_IPC.DOWNLOAD_EVENT, event));

  ipcMain.handle(NOVEL_IPC.SOURCES, () => NOVEL_SOURCES);
  ipcMain.handle(NOVEL_IPC.HOME, () => guarded(() => novelHome()));
  ipcMain.handle(NOVEL_IPC.SEARCH, (_e, value: unknown) => guarded(() => novelSearch(filters(value))));
  ipcMain.handle(NOVEL_IPC.TITLE, (_e, sourceId: unknown, id: unknown) => {
    const src = source(sourceId);
    return guarded(() => titleWithLinks(src, titleId(src, id)));
  });
  ipcMain.handle(NOVEL_IPC.TITLE_SAVED, async (_e, sourceId: unknown, id: unknown) => {
    const src = source(sourceId);
    const tid = titleId(src, id);
    // The browsing cache first, then what a download kept.
    const cached = await savedNovelTitle(src, tid);
    const downloaded = cached?.chapters.length ? null : await downloadedTitle(src, tid);
    if (!cached) return downloaded;
    return downloaded && downloaded.chapters.length ? { detail: cached.detail, chapters: downloaded.chapters } : cached;
  });
  ipcMain.handle(NOVEL_IPC.CHAPTERS, (_e, sourceId: unknown, id: unknown) => {
    const src = source(sourceId);
    const tid = titleId(src, id);
    return guarded(async () => {
      const list = await novelChapters(src, tid);
      // The list is on screen now: its chapters stop counting as new.
      if (list.length && store.seenCount(src, tid) !== list.length) {
        store.markSeen(src, tid, list.length);
        updatesCache = null;
      }
      return list;
    });
  });
  ipcMain.handle(NOVEL_IPC.CHAPTER, (_e, sourceId: unknown, id: unknown, chapter: unknown) => {
    const src = source(sourceId);
    const tid = titleId(src, id);
    const cid = chapterId(src, chapter);
    return guarded(async () => (await localChapter(src, tid, cid)) ?? novelChapter(src, tid, cid));
  });

  // ── Linked sources ──
  ipcMain.handle(NOVEL_IPC.GROUP, (_e, sourceId: unknown, id: unknown) => {
    const src = source(sourceId);
    return store.group(src, titleId(src, id));
  });
  ipcMain.handle(NOVEL_IPC.FIND_ON, (_e, sourceId: unknown, id: unknown, target: unknown) => {
    const src = source(sourceId);
    const tid = titleId(src, id);
    const to = source(target);
    if (to === src) throw new Error("Same source");
    return guarded(() => findOn(src, tid, to));
  });
  ipcMain.handle(NOVEL_IPC.LINK, (_e, a: unknown, b: unknown) => {
    const ra = (a ?? {}) as Record<string, unknown>;
    const rb = (b ?? {}) as Record<string, unknown>;
    const sa = source(ra.sourceId);
    const sb = source(rb.sourceId);
    if (sa === sb) throw new Error("Link copies on different sources");
    const left = { sourceId: sa, titleId: titleId(sa, ra.id) };
    const right = { sourceId: sb, titleId: titleId(sb, rb.id) };
    // One copy per source: a copy already linked on [sb] is taken out first.
    const clash = store.group(left.sourceId, left.titleId).members.find((m) => m.sourceId === sb && m.id !== right.titleId);
    if (clash) store.unlink({ sourceId: clash.sourceId, titleId: clash.id });
    store.link(left, right);
    return store.group(left.sourceId, left.titleId);
  });
  ipcMain.handle(NOVEL_IPC.UNLINK, (_e, sourceId: unknown, id: unknown) => {
    const src = source(sourceId);
    store.unlink({ sourceId: src, titleId: titleId(src, id) });
    return { ok: true };
  });
  ipcMain.handle(NOVEL_IPC.UPDATES, (_e, force: unknown) => guarded(() => novelUpdates(force === true)));

  // ── Progress ──
  ipcMain.handle(NOVEL_IPC.READING_GET, (_e, sourceId: unknown, id: unknown) => {
    const src = source(sourceId);
    return store.progressFor(src, titleId(src, id));
  });
  ipcMain.handle(NOVEL_IPC.READING_SAVE, (_e, value: unknown) => {
    const o = (value ?? {}) as Record<string, unknown>;
    const src = source(o.sourceId);
    const paragraphCount = count(o.paragraphCount, NOVEL_MAX_PARAGRAPHS);
    store.saveReading({
      sourceId: src,
      titleId: titleId(src, o.titleId),
      chapterId: chapterId(src, o.chapterId),
      chapterOrder: count(o.chapterOrder, NOVEL_MAX_CHAPTERS),
      chapterLabel: text(o.chapterLabel, 200),
      paragraph: Math.min(count(o.paragraph, NOVEL_MAX_PARAGRAPHS), Math.max(0, paragraphCount - 1)),
      paragraphCount,
      title: optionalText(o.title, 300) ?? "Unknown",
      cover: optionalText(o.cover, 2048),
      updatedAt: Date.now(),
    });
    updatesCache = null;
    return { ok: true };
  });
  ipcMain.handle(NOVEL_IPC.READING_MARK, (_e, sourceId: unknown, id: unknown, chapters: unknown, read: unknown, title: unknown, cover: unknown) => {
    const src = source(sourceId);
    store.markChapters(src, titleId(src, id), chapterList(src, chapters), read === true, optionalText(title, 300) ?? "Unknown", optionalText(cover, 2048));
    updatesCache = null;
    return { ok: true };
  });
  ipcMain.handle(NOVEL_IPC.CONTINUE, () => store.continueReading(30));
  ipcMain.handle(NOVEL_IPC.READING_FORGET, (_e, sourceId: unknown, id: unknown) => {
    const src = source(sourceId);
    store.forgetReading(src, titleId(src, id));
    updatesCache = null;
    return { ok: true };
  });

  // ── List ──
  ipcMain.handle(NOVEL_IPC.LIST_GET, (_e, sourceId: unknown, id: unknown) => {
    const src = source(sourceId);
    return store.novelStatus(src, titleId(src, id));
  });
  ipcMain.handle(NOVEL_IPC.LIST_SET, (_e, sourceId: unknown, id: unknown, status: unknown, title: unknown, cover: unknown) => {
    const src = source(sourceId);
    const next = status == null ? null : (NOVEL_STATUSES as readonly string[]).includes(status as string) ? (status as NovelStatus) : undefined;
    if (next === undefined) throw new Error("Invalid status");
    store.setNovelStatus(src, titleId(src, id), next, optionalText(title, 300) ?? "Unknown", optionalText(cover, 2048));
    return { ok: true };
  });
  ipcMain.handle(NOVEL_IPC.LIST_ALL, () => store.novelList());

  // ── Cross-device sync (the gist itself is read and written by the renderer) ──
  ipcMain.handle(NOVEL_IPC.SYNC_SNAPSHOT, () => store.novelSyncSnapshot());
  ipcMain.handle(NOVEL_IPC.SYNC_APPLY, (_e, change: unknown) => {
    const applied = store.applyNovelSync(syncChange(change));
    if (applied) updatesCache = null;
    return { applied };
  });
  ipcMain.handle(NOVEL_IPC.SYNC_ACK, (_e, sent: unknown, known: unknown) => {
    store.ackNovelSync(removals(sent), removals(known));
    return { ok: true };
  });

  // ── Downloads ──
  ipcMain.handle(NOVEL_IPC.DOWNLOADS, () => listNovelDownloads());
  ipcMain.handle(NOVEL_IPC.DOWNLOADED, (_e, sourceId: unknown, id: unknown) => {
    const src = source(sourceId);
    return savedChapterIds(src, titleId(src, id));
  });
  ipcMain.handle(NOVEL_IPC.DOWNLOAD, async (_e, detail: unknown, chapters: unknown) => {
    const d = detailArg(detail);
    const picked = chapterList(d.sourceId, chapters);
    const full = await novelChapters(d.sourceId, d.id).catch(() => picked);
    return enqueueNovelChapters(d, picked, full);
  });
  ipcMain.handle(NOVEL_IPC.DOWNLOAD_CANCEL, (_e, sourceId: unknown, id: unknown) => {
    const src = source(sourceId);
    return cancelNovelDownloads(src, titleId(src, id));
  });
  ipcMain.handle(NOVEL_IPC.DOWNLOAD_REMOVE, (_e, sourceId: unknown, id: unknown, chapterIds: unknown) => {
    const src = source(sourceId);
    const ids = Array.isArray(chapterIds) ? chapterIds.slice(0, NOVEL_MAX_CHAPTERS).map((c) => chapterId(src, c)) : undefined;
    return removeNovelDownloads(src, titleId(src, id), ids);
  });
}
