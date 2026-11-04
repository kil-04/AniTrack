import { app, net } from "electron";
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
import { nextStep, type Failure } from "../../../../../packages/shared/download-resume";

/*
 * Offline novel chapters: userData/novel_downloads/<source>-<hex title id>/ holds
 * meta.json (the title's details and full chapter list when it was queued) and one
 * c-<hex chapter id>.json per saved chapter. Ids are hex-encoded because NovelBuddy
 * ids are case-sensitive and Windows file names aren't. One worker fetches one
 * chapter at a time on the sources' slower background lane.
 *
 * pending.json lists the chapters still to fetch, so downloads carry on after
 * the app is restarted. A chapter that hits a rate limit or a network drop waits
 * (Retry-After, backoff, the network coming back) and continues, using the
 * rules shared with the other downloads (packages/shared/download-resume.ts).
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
const pendingFile = (sourceId: string, titleId: string) => path.join(folder(sourceId, titleId), "pending.json");
const NETWORK_POLL_MS = 15_000;
let retryScale = 1;
/** Tests shrink backoff and Retry-After waits; the app never calls this. */
export function setNovelRetryScale(scale: number): void { retryScale = scale; }

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

/** Records the chapters still to fetch (waiting and in progress, but not [finished]), so a restart resumes them. */
async function savePending(t: Title, finished?: NovelChapter): Promise<void> {
  const ids = [...(t.current && t.current !== finished ? [t.current.id] : []), ...t.queue.map((c) => c.id)];
  const file = pendingFile(t.detail.sourceId, t.detail.id);
  try {
    if (ids.length) await writeAtomic(file, JSON.stringify(ids));
    else await fs.promises.rm(file, { force: true });
  } catch { /* best-effort: the folder may have been removed */ }
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
        const chapters: NovelChapter[] = Array.isArray(meta.chapters) ? meta.chapters : [];
        // Chapters that were still on their way when the app closed carry on, in order.
        const pending = await fs.promises.readFile(path.join(base, "pending.json"), "utf-8").then((text) => JSON.parse(text) as unknown).catch(() => []);
        const byId = new Map(chapters.map((c) => [c.id, c]));
        const queue = (Array.isArray(pending) ? pending : [])
          .filter((id): id is string => typeof id === "string" && !saved.has(id) && byId.has(id) && isNovelChapterId(meta.detail.sourceId, id))
          .map((id) => byId.get(id)!);
        titles.set(novelTitleKey(meta.detail.sourceId, meta.detail.id), {
          detail: meta.detail, chapters, saved, queue: [...new Map(queue.map((c) => [c.id, c])).values()], failed: new Map(),
          current: null, sizeBytes: size, error: null, updatedAt: Date.now(), failStreak: 0,
        });
      } catch {
        /* a folder without readable metadata is skipped */
      }
    }
    if ([...titles.values()].some((t) => t.queue.length)) void pump();
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
  await savePending(t);
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
  await savePending(t);
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
      const live = () => titles.get(novelTitleKey(sourceId, id)) === t;
      try {
        const text = await fetchChapter(t, chapter, live);
        const body = JSON.stringify({ id: chapter.id, label: chapter.label, paragraphs: text.paragraphs });
        // The title may have been removed while this chapter was on its way.
        if (live()) {
          await writeAtomic(chapterFile(sourceId, id, chapter.id), body);
          t.saved.add(chapter.id);
          t.sizeBytes += Buffer.byteLength(body);
          t.failStreak = 0;
          t.error = null;
        }
      } catch (error) {
        if (error instanceof Removed) continue;
        const message = error instanceof NovelSourceError ? error.message : "Couldn't save this chapter.";
        t.failed.set(chapter.id, message);
        t.error = message;
        t.failStreak++;
        // A source that keeps refusing gets left alone instead of hammered. (Rate
        // limits and network drops are waited out in fetchChapter instead.)
        if (t.failStreak >= 3) {
          for (const rest of t.queue) t.failed.set(rest.id, message);
          t.queue = [];
          t.error = `${message} Downloading stopped; try again later.`;
        }
      } finally {
        // What's left goes to disk before the chapter shows as settled, so a
        // quit (or anyone reading the list) never sees a stale pending.json.
        if (live()) await savePending(t, chapter);
        t.current = null;
        if (live()) emit(t);
      }
    }
  } finally {
    running = false;
  }
}

class Removed extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches one chapter, waiting out rate limits (Retry-After) and network drops
 * with the shared rules; other failures are thrown for the chapter to fail.
 */
async function fetchChapter(t: Title, chapter: NovelChapter, live: () => boolean): Promise<NovelChapterText> {
  for (let attempt = 0; ; attempt++) {
    if (!live()) throw new Removed();
    try {
      return await novelChapter(t.detail.sourceId, t.detail.id, chapter.id, "back");
    } catch (error) {
      if (!(error instanceof NovelSourceError) || error.verify || error.status == null) throw error;
      const status = error.status;
      if (status !== 0 && status !== 429 && status !== 503 && status !== 408 && !(status >= 500 && status <= 599)) throw error;
      const failure: Failure = status === 0 ? { network: true, online: net.isOnline() } : { status, retryAfter: error.retryAfter };
      const step = nextStep(failure, attempt, 0, Date.now());
      if (step.action === "retry") { await sleep(step.delayMs * retryScale); continue; }
      if (step.action !== "pause") throw error;
      t.error = step.reason === "network"
        ? "Waiting for the network; downloading continues when it's back."
        : `${error.message.replace(/ Wait a minute, then retry\.$/, "")} Continuing automatically.`;
      emit(t);
      if (step.resumeAt) await sleep(Math.max(0, step.resumeAt - Date.now()) * retryScale);
      while (!net.isOnline()) await sleep(NETWORK_POLL_MS * retryScale);
      if (!live()) throw new Removed();
      t.error = null;
      emit(t);
      attempt = -1;
    }
  }
}
