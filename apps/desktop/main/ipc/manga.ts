import { ipcMain, protocol, type BrowserWindow } from "electron";
import {
  isSourceChapterId,
  MANGA_IPC,
  MANGA_STATUSES,
  MAX_PAGES,
  trackedTitles,
  UPDATES_MAX,
  type DownloadManga,
  type MangaChapter,
  type MangaSearchFilters,
  type MangaStatus,
  type ReadingRow,
  type SourceResult,
  type SourceTitle,
} from "../../../../packages/shared/manga";
import { animeAdaptations, mangaById, mangaFeed, searchManga } from "../services/manga/anilist-manga";
import * as downloads from "../services/manga/downloads";
import { connectMangaSource, latestFor, MangaSourceError, savedChapters, servePageImage, sourceById, sourceInfos } from "../services/manga/sources";
import * as store from "../services/manga/store";

function id(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 1_000_000_000) throw new Error(`Invalid ${name}`);
  return n;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.length > max) throw new Error(`Invalid ${name}`);
  return value;
}

function optionalText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function chapterNumber(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n >= 100_000) throw new Error("Invalid chapter");
  return n;
}

function sourceTitle(value: unknown): SourceTitle {
  const o = value as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw new Error("Invalid title");
  return { sourceId: text(o.sourceId, "source", 32), id: text(o.id, "title id", o.sourceId === "toonkotsu" ? 190 : 64), title: optionalText(o.title, 300) ?? "" };
}

/** The manga fields a download keeps (enough to read it offline). */
function downloadManga(value: unknown): DownloadManga {
  const o = value as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw new Error("Invalid manga");
  return { id: id(o.id, "manga id"), title: optionalText(o.title, 300) ?? "Unknown", cover: optionalText(o.cover, 2048), country: optionalText(o.country, 8) };
}

/** A chapter to download; its id must have [sourceId]'s shape (it names a folder on disk). */
function chapterArg(value: unknown, sourceId: string): MangaChapter {
  const o = value as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw new Error("Invalid chapter");
  const chapterId = text(o.id, "chapter id", 64);
  if (!isSourceChapterId(sourceId, chapterId)) throw new Error("Invalid chapter id");
  const pageCount = Number(o.pageCount);
  const uploadedAt = Number(o.uploadedAt);
  return {
    id: chapterId,
    number: chapterNumber(o.number),
    title: optionalText(o.title, 200),
    group: optionalText(o.group, 80),
    pageCount: Number.isInteger(pageCount) && pageCount > 0 && pageCount <= MAX_PAGES ? pageCount : null,
    uploadedAt: Number.isFinite(uploadedAt) && uploadedAt > 0 ? uploadedAt : null,
  };
}

/** A download request's title on a known source. */
function downloadTitle(value: unknown): SourceTitle {
  const t = sourceTitle(value);
  return { ...t, sourceId: sourceById(t.sourceId).info.id };
}

function filters(value: unknown): MangaSearchFilters {
  const o = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.length <= 120 ? v : undefined);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    query: str(o.query), genre: str(o.genre), year: num(o.year), format: str(o.format),
    country: str(o.country), status: str(o.status), sort: str(o.sort), page: num(o.page),
  };
}

function readingRow(value: unknown): ReadingRow {
  const o = value as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw new Error("Invalid progress");
  const page = Number(o.page);
  const pageCount = Number(o.pageCount);
  if (!Number.isInteger(page) || !Number.isInteger(pageCount) || page < 0 || pageCount < 1 || pageCount > 2000 || page >= pageCount) {
    throw new Error("Invalid progress");
  }
  return {
    mangaId: id(o.mangaId, "manga id"),
    chapter: chapterNumber(o.chapter),
    chapterId: text(o.chapterId, "chapter id", 64),
    page,
    pageCount,
    title: optionalText(o.title, 300) ?? "Unknown",
    cover: optionalText(o.cover, 2048),
    sourceId: sourceById(o.sourceId).info.id,
    updatedAt: Date.now(),
  };
}

/** A row synced from another device: validated like [readingRow], keeping its own timestamp. */
function syncedReadingRow(value: unknown): ReadingRow {
  const row = readingRow(value);
  const updatedAt = Number((value as Record<string, unknown>).updatedAt);
  // A far-future timestamp would win every later merge, so it is refused.
  if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0 || updatedAt > Date.now() + 24 * 3600 * 1000) {
    throw new Error("Invalid progress time");
  }
  return { ...row, updatedAt };
}

/** Source calls answer with a result instead of throwing, so the page can offer Connect or Retry. */
async function guarded<T>(work: () => Promise<T>): Promise<SourceResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof MangaSourceError) return { ok: false, error: error.message, verify: error.verify };
    return { ok: false, error: "Something went wrong reaching the source. Try again." };
  }
}

export function registerMangaIpc(getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle(MANGA_IPC.FEED, () => mangaFeed());
  ipcMain.handle(MANGA_IPC.SEARCH, (_e, value: unknown) => searchManga(filters(value)));
  ipcMain.handle(MANGA_IPC.GET, (_e, mangaId: unknown) => mangaById(id(mangaId, "manga id")));
  ipcMain.handle(MANGA_IPC.ADAPTATIONS, (_e, mangaId: unknown) => animeAdaptations(id(mangaId, "manga id")));
  ipcMain.handle(MANGA_IPC.SOURCES, () => sourceInfos());

  ipcMain.handle(MANGA_IPC.FIND, (_e, sourceId: unknown, mangaId: unknown) => guarded(async () => {
    const source = sourceById(sourceId);
    const manga = await mangaById(id(mangaId, "manga id"));
    if (!manga) throw new MangaSourceError("AniList didn't answer. Check your connection and retry.");
    return source.find(manga);
  }));
  ipcMain.handle(MANGA_IPC.CHAPTERS, (_e, title: unknown) => guarded(async () => {
    const t = sourceTitle(title);
    return sourceById(t.sourceId).chapters(t);
  }));
  ipcMain.handle(MANGA_IPC.CHAPTERS_SAVED, (_e, title: unknown) => savedChapters(sourceTitle(title)));
  ipcMain.handle(MANGA_IPC.PAGES, (_e, title: unknown, chapterId: unknown, mangaId: unknown) => guarded(async () => {
    const t = sourceTitle(title);
    const chapter = text(chapterId, "chapter id", 64);
    // A downloaded chapter opens from disk first, so it reads without a connection.
    const local = mangaId == null ? null : await downloads.localPages(id(mangaId, "manga id"), chapter);
    return local ?? sourceById(t.sourceId).pages(t, chapter);
  }));
  // Opens the source's site for the user to pass its check themselves.
  ipcMain.handle(MANGA_IPC.CONNECT, (_e, sourceId: unknown) => connectMangaSource(sourceId, getMainWindow()));

  ipcMain.handle(MANGA_IPC.READING_GET, (_e, mangaId: unknown) => store.readingFor(id(mangaId, "manga id")));
  ipcMain.handle(MANGA_IPC.READING_SAVE, (_e, row: unknown) => {
    store.saveReading(readingRow(row));
    return { ok: true };
  });
  ipcMain.handle(MANGA_IPC.READING_MARK, (_e, mangaId: unknown, chapters: unknown, read: unknown, title: unknown, cover: unknown, sourceId: unknown) => {
    if (!Array.isArray(chapters) || chapters.length > 5000) throw new Error("Invalid chapters");
    const list = chapters.map((c: Record<string, unknown>) => ({
      number: chapterNumber(c?.number),
      id: text(c?.id, "chapter id", 64),
      pageCount: Math.min(2000, Math.max(1, Number(c?.pageCount) || 1)),
    }));
    store.markChapters(id(mangaId, "manga id"), list, read === true, optionalText(title, 300) ?? "Unknown", optionalText(cover, 2048), sourceById(sourceId).info.id);
    return { ok: true };
  });
  ipcMain.handle(MANGA_IPC.CONTINUE, () => store.continueReading(30));
  ipcMain.handle(MANGA_IPC.READING_FORGET, (_e, mangaId: unknown) => {
    store.forgetReading(id(mangaId, "manga id"));
    return { ok: true };
  });
  ipcMain.handle(MANGA_IPC.READING_ALL, () => store.allReading());
  ipcMain.handle(MANGA_IPC.READING_APPLY, (_e, upserts: unknown, removes: unknown) => {
    if (!Array.isArray(upserts) || !Array.isArray(removes) || upserts.length > 20_000 || removes.length > 20_000) {
      throw new Error("Invalid reading sync");
    }
    // Rows come from another device's copy: skip any this version can't accept
    // (say, a source it doesn't know) instead of failing the whole reconcile.
    const rows = upserts.flatMap((value) => { try { return [syncedReadingRow(value)]; } catch { return []; } });
    const gone = removes.flatMap((value: Record<string, unknown> | null) => {
      try { return [{ mangaId: id(value?.mangaId, "manga id"), chapter: chapterNumber(value?.chapter) }]; } catch { return []; }
    });
    store.applySyncedReading(rows, gone);
    return { ok: true, applied: rows.length, removed: gone.length };
  });

  ipcMain.handle(MANGA_IPC.LIST_GET, (_e, mangaId: unknown) => store.mangaStatus(id(mangaId, "manga id")));
  ipcMain.handle(MANGA_IPC.LIST_SET, (_e, mangaId: unknown, status: unknown, title: unknown, cover: unknown) => {
    const value = status == null ? null : (MANGA_STATUSES as readonly string[]).includes(String(status)) ? status as MangaStatus : undefined;
    if (value === undefined) throw new Error("Invalid status");
    store.setMangaStatus(id(mangaId, "manga id"), value, optionalText(title, 300) ?? "Unknown", optionalText(cover, 2048));
    return { ok: true };
  });
  ipcMain.handle(MANGA_IPC.LIST_ALL, () => store.mangaList());

  // Offline chapters: progress reaches the renderer as DOWNLOAD_EVENT messages.
  downloads.setMangaDownloadEmitter((event) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(MANGA_IPC.DOWNLOAD_EVENT, event);
  });
  ipcMain.handle(MANGA_IPC.DOWNLOADS, () => downloads.listMangaDownloads());
  ipcMain.handle(MANGA_IPC.DOWNLOAD, (_e, manga: unknown, title: unknown, chapter: unknown) => {
    const t = downloadTitle(title);
    return downloads.downloadChapter(downloadManga(manga), t, chapterArg(chapter, t.sourceId));
  });
  ipcMain.handle(MANGA_IPC.DOWNLOAD_RANGE, (_e, manga: unknown, title: unknown, chapters: unknown) => {
    if (!Array.isArray(chapters) || chapters.length > 5000) throw new Error("Invalid chapters");
    const t = downloadTitle(title);
    return downloads.downloadChapters(downloadManga(manga), t, chapters.map((c) => chapterArg(c, t.sourceId)));
  });
  ipcMain.handle(MANGA_IPC.DOWNLOAD_REMOVE, (_e, key: unknown) => downloads.removeMangaDownload(text(key, "download", 128)));
  ipcMain.handle(MANGA_IPC.DOWNLOAD_CANCEL, (_e, mangaId: unknown) => downloads.cancelMangaDownloads(id(mangaId, "manga id")));

  // Updates: what to check, then one title at a time (the page runs a few at once).
  ipcMain.handle(MANGA_IPC.TRACKED, () => trackedTitles(store.continueReading(UPDATES_MAX), store.mangaList(), store.lastReadChapters()));
  ipcMain.handle(MANGA_IPC.LATEST, (_e, mangaId: unknown, preferred: unknown, skip: unknown) => {
    const skipped = Array.isArray(skip) ? skip.filter((s): s is string => typeof s === "string" && s.length <= 32).slice(0, 10) : [];
    return latestFor(id(mangaId, "manga id"), optionalText(preferred, 32), new Set(skipped));
  });
}

/**
 * Page images reach the renderer as anitrack-manga://img/?s=<source>&u=<url>, and
 * downloaded pages as anitrack-manga://local/<anilistId>/<chapter>/<file>.
 */
export function registerMangaProtocol() {
  protocol.handle("anitrack-manga", (request) =>
    request.url.startsWith("anitrack-manga://local/") ? downloads.serveLocalPage(request.url) : servePageImage(request.url));
}
