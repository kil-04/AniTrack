import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  isNovelChapterId,
  isNovelSource,
  isNovelTitleId,
  novelTitleKey,
  type NovelChapter,
  type NovelChapterText,
  type NovelDetail,
  type NovelDownloadTitle,
  type NovelSourceId,
} from "../../../../../packages/shared/novel";
import { NovelSourceError, novelChapter } from "./sources";

/*
 * Offline novel chapters: userData/novel_downloads/<source>-<hex title id>/ holds
 * meta.json (the title's details and full chapter list when it was queued) and one
 * c-<hex chapter id>.json per saved chapter. Ids are hex-encoded because NovelBuddy
 * ids are case-sensitive and Windows file names aren't. One worker fetches one
 * chapter at a time on the sources' slower background lane.
 */

interface Title {
  detail: NovelDetail;
  chapters: NovelChapter[];
  saved: Set<string>;
  queue: NovelChapter[];
  failed: Map<string, string>;
  current: NovelChapter | null;
  sizeBytes: number;
  error: string | null;
  updatedAt: number;
  /** Failures in a row; three stop the title's queue. */
  failStreak: number;
}

type Listener = (event: NovelDownloadTitle | { removed: string }) => void;

const titles = new Map<string, Title>();
let listener: Listener = () => {};
let loading: Promise<void> | null = null;
let running = false;

const root = () => path.join(app.getPath("userData"), "novel_downloads");
const hex = (value: string) => Buffer.from(value, "utf-8").toString("hex");
const unhex = (value: string) => Buffer.from(value, "hex").toString("utf-8");
const folder = (sourceId: string, titleId: string) => path.join(root(), `${sourceId}-${hex(titleId)}`);
const chapterFile = (sourceId: string, titleId: string, chapterId: string) => path.join(folder(sourceId, titleId), `c-${hex(chapterId)}.json`);

export function onNovelDownload(fn: Listener) {
  listener = fn;
}

function view(t: Title): NovelDownloadTitle {
  return {
    sourceId: t.detail.sourceId,
    titleId: t.detail.id,
    title: t.detail.title,
    cover: t.detail.cover,
    saved: t.saved.size,
    queued: t.queue.length + (t.current ? 1 : 0),
    failed: t.failed.size,
    current: t.current?.label ?? null,
    currentId: t.current?.id ?? null,
    queuedIds: t.queue.map((c) => c.id),
    failedIds: [...t.failed.keys()],
    sizeBytes: t.sizeBytes,
    error: t.error,
    updatedAt: t.updatedAt,
  };
}

const emit = (t: Title) => { t.updatedAt = Date.now(); listener(view(t)); };

async function writeAtomic(file: string, text: string) {
  const temp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(temp, text);
  await fs.promises.rename(temp, file);
}

/** Reads what's on disk once (titles and their saved chapters). */
function load(): Promise<void> {
  loading ??= (async () => {
    const dirs = await fs.promises.readdir(root(), { withFileTypes: true }).catch(() => []);
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const base = path.join(root(), dir.name);
      try {
        const meta = JSON.parse(await fs.promises.readFile(path.join(base, "meta.json"), "utf-8")) as { detail: NovelDetail; chapters: NovelChapter[] };
        if (!isNovelSource(meta.detail?.sourceId) || !isNovelTitleId(meta.detail.sourceId, meta.detail.id)) continue;
        if (base !== folder(meta.detail.sourceId, meta.detail.id)) continue;
        const files = await fs.promises.readdir(base);
        const saved = new Set<string>();
        let size = 0;
        for (const name of files) {
          const match = name.match(/^c-([0-9a-f]+)\.json$/);
          if (!match) continue;
          saved.add(unhex(match[1]));
          size += (await fs.promises.stat(path.join(base, name)).catch(() => null))?.size ?? 0;
        }
        titles.set(novelTitleKey(meta.detail.sourceId, meta.detail.id), {
          detail: meta.detail, chapters: Array.isArray(meta.chapters) ? meta.chapters : [], saved, queue: [], failed: new Map(),
          current: null, sizeBytes: size, error: null, updatedAt: Date.now(), failStreak: 0,
        });
      } catch {
        /* a folder without readable metadata is skipped */
      }
    }
  })();
  return loading;
}

export async function listNovelDownloads(): Promise<NovelDownloadTitle[]> {
  await load();
  return [...titles.values()].map(view).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A title's chapter ids saved on disk. */
export async function savedChapterIds(sourceId: NovelSourceId, titleId: string): Promise<string[]> {
  await load();
  return [...(titles.get(novelTitleKey(sourceId, titleId))?.saved ?? [])];
}

/** A downloaded chapter, or null to fetch it. */
export async function localChapter(sourceId: NovelSourceId, titleId: string, chapterId: string): Promise<NovelChapterText | null> {
  await load();
  if (!titles.get(novelTitleKey(sourceId, titleId))?.saved.has(chapterId)) return null;
  try {
    const text = JSON.parse(await fs.promises.readFile(chapterFile(sourceId, titleId, chapterId), "utf-8")) as NovelChapterText;
    return Array.isArray(text.paragraphs) && typeof text.label === "string" ? { id: chapterId, label: text.label, paragraphs: text.paragraphs } : null;
  } catch {
    return null;
  }
}

/** The details and chapter list saved with a title's downloads (for offline title pages). */
export async function downloadedTitle(sourceId: NovelSourceId, titleId: string): Promise<{ detail: NovelDetail; chapters: NovelChapter[] } | null> {
  await load();
  const t = titles.get(novelTitleKey(sourceId, titleId));
  return t ? { detail: t.detail, chapters: t.chapters } : null;
}

/**
 * Queues [chapters] (reading order) of a title; chapters saved or already on the
 * way are skipped, failed ones are tried again. Returns how many were added.
 */
export async function enqueueNovelChapters(detail: NovelDetail, chapters: NovelChapter[], fullList: NovelChapter[]): Promise<number> {
  await load();
  const key = novelTitleKey(detail.sourceId, detail.id);
  let t = titles.get(key);
  if (!t) {
    t = { detail, chapters: fullList, saved: new Set(), queue: [], failed: new Map(), current: null, sizeBytes: 0, error: null, updatedAt: Date.now(), failStreak: 0 };
    titles.set(key, t);
  }
  t.detail = detail;
  if (fullList.length) t.chapters = fullList;
  await fs.promises.mkdir(folder(detail.sourceId, detail.id), { recursive: true });
  await writeAtomic(path.join(folder(detail.sourceId, detail.id), "meta.json"), JSON.stringify({ detail: t.detail, chapters: t.chapters }));
  const waiting = new Set([...t.queue.map((c) => c.id), t.current?.id]);
  let added = 0;
  for (const chapter of [...chapters].sort((a, b) => a.order - b.order)) {
    if (!isNovelChapterId(detail.sourceId, chapter.id) || t.saved.has(chapter.id) || waiting.has(chapter.id)) continue;
    t.failed.delete(chapter.id);
    t.queue.push(chapter);
    waiting.add(chapter.id);
    added++;
  }
  t.error = null;
  t.failStreak = 0;
  emit(t);
  void pump();
  return added;
}

/** Stops a title's waiting chapters (the one in progress finishes); saved ones stay. */
export async function cancelNovelDownloads(sourceId: NovelSourceId, titleId: string): Promise<void> {
  await load();
  const t = titles.get(novelTitleKey(sourceId, titleId));
  if (!t) return;
  t.queue = [];
  emit(t);
}

/** Deletes some (or, without [chapterIds], all) of a title's saved chapters. */
export async function removeNovelDownloads(sourceId: NovelSourceId, titleId: string, chapterIds?: string[]): Promise<void> {
  await load();
  const key = novelTitleKey(sourceId, titleId);
  const t = titles.get(key);
  if (!t) return;
  if (!chapterIds) {
    titles.delete(key);
    t.queue = [];
    await fs.promises.rm(folder(sourceId, titleId), { recursive: true, force: true }).catch(() => {});
    listener({ removed: key });
    return;
  }
  for (const id of chapterIds) {
    if (!t.saved.delete(id)) continue;
    const file = chapterFile(sourceId, titleId, id);
    t.sizeBytes -= (await fs.promises.stat(file).catch(() => null))?.size ?? 0;
    await fs.promises.rm(file, { force: true }).catch(() => {});
  }
  t.sizeBytes = Math.max(0, t.sizeBytes);
  emit(t);
}

/** The single worker: oldest title with waiting chapters first, one chapter at a time. */
async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const t = [...titles.values()].filter((x) => x.queue.length).sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!t) break;
      const chapter = t.queue.shift()!;
      t.current = chapter;
      emit(t);
      const { sourceId, id } = t.detail;
      try {
        const text = await novelChapter(sourceId, id, chapter.id, "back");
        const body = JSON.stringify({ id: chapter.id, label: chapter.label, paragraphs: text.paragraphs });
        // The title may have been removed while this chapter was on its way.
        if (titles.get(novelTitleKey(sourceId, id)) === t) {
          await writeAtomic(chapterFile(sourceId, id, chapter.id), body);
          t.saved.add(chapter.id);
          t.sizeBytes += Buffer.byteLength(body);
          t.failStreak = 0;
        }
      } catch (error) {
        const message = error instanceof NovelSourceError ? error.message : "Couldn't save this chapter.";
        t.failed.set(chapter.id, message);
        t.error = message;
        t.failStreak++;
        // A source that keeps refusing (or limiting) gets left alone instead of hammered.
        if (t.failStreak >= 3 || (error instanceof NovelSourceError && error.status === 429)) {
          for (const rest of t.queue) t.failed.set(rest.id, message);
          t.queue = [];
          t.error = `${message} Downloading stopped; try again later.`;
        }
      } finally {
        t.current = null;
        if (titles.get(novelTitleKey(sourceId, id)) === t) emit(t);
      }
    }
  } finally {
    running = false;
  }
}
