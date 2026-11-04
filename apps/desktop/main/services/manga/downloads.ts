import { app, net } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  chapterFolder,
  downloadKey,
  downloadMeta,
  downloadMetaJson,
  imageSize,
  PAGE_FILE,
  pageContentType,
  pageExtension,
  planRange,
  publicHttps,
  type DownloadManga,
  type DownloadMeta,
  type MangaChapter,
  type MangaDownload,
  type MangaDownloadEvent,
  type MangaPageImage,
  type SavedPage,
  type SourceTitle,
} from "../../../../../packages/shared/manga";
import { fetchPageImage, MangaSourceError, sourceById } from "./sources";
import {
  HEAD_BYTES,
  LEDGER_FILE,
  ledgerHeader,
  ledgerLine,
  nextStep,
  parseLedger,
  pieceTag,
  renditionId,
  resumePlan,
  type Failure,
  type Ledger,
  type PlanPiece,
  type Step,
} from "../../../../../packages/shared/download-resume";

/**
 * Offline manga chapters, like the Android app's MangaDownloads: each chapter's
 * page images are saved to userData/manga_downloads/<anilistId>/<chapter>/ with a
 * meta.json, one chapter at a time in the order they were asked for. The reader
 * opens a finished chapter from disk (anitrack-manga://local/…), so downloaded
 * chapters read without a connection.
 *
 * Interrupted chapters resume (packages/shared/download-resume.ts): each saved
 * page is appended to download.ledger, and a later run keeps the pages that
 * still verify (same size and image format) for the same page list, fetching
 * only the rest in their places. A chapter waits out rate limits and network
 * drops, fetches its page list again when page addresses expire, and carries
 * on after the app is restarted.
 */

const MAX_PAGE_BYTES = 40 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 60_000;
// A chapter's pages come three at a time, about what the reader itself asks for:
// MangaBall's CDN served one page at 15 KB/s on 11 Oct 2026 while three in
// parallel finished in 6 s, so one at a time took minutes per chapter.
const PAGE_WORKERS = 3;
const RM = { recursive: true, force: true, maxRetries: 3, retryDelay: 150 } as const;
const VERIFY_MESSAGE = "MangaDot needs a quick check. Use Connect MangaDot on the title's page, complete it, then retry.";

export const mangaDownloadsDir = () => path.join(app.getPath("userData"), "manga_downloads");

let emit: (event: MangaDownloadEvent) => void = () => {};
export function setMangaDownloadEmitter(fn: (event: MangaDownloadEvent) => void) { emit = fn; }

class DownloadError extends Error {}
class Stopped extends Error {}
/** The chapter has to stop: wait ([step] pause) or fetch its page list again (re-resolve). */
class Interrupt extends Error {
  readonly step: Step;
  constructor(step: Step) { super("Download paused."); this.step = step; }
}

const NETWORK_POLL_MS = 15_000;
let retryScale = 1;
/** Tests shrink backoff and Retry-After waits; the app never calls this. */
export function setMangaRetryScale(scale: number): void { retryScale = scale; }

interface Pending { key: string; generation: number; title: SourceTitle }

const items = new Map<string, MangaDownload>();
// The live request per chapter: a queued or running download whose generation no
// longer matches was removed or cancelled, and stops without touching the list.
const generations = new Map<string, number>();
const controllers = new Map<string, AbortController>();
const queue: Pending[] = [];
let nextGeneration = 0;
let working = false;
let restoring: Promise<void> | null = null;
const ready = () => (restoring ??= restore());

// Folder work (clearing, creating, deleting) runs one step at a time, so a deletion
// still in flight never removes files of a chapter queued again right after.
let lane: Promise<unknown> = Promise.resolve();
function onLane<T>(work: () => Promise<T>): Promise<T> {
  const run = lane.then(work, work);
  lane = run.catch(() => {});
  return run;
}

/** [relative] under the downloads folder, refusing anything that would leave it. */
function inside(relative: string): string {
  const root = path.resolve(mangaDownloadsDir());
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new DownloadError("Refused a download path.");
  return target;
}

function folderOf(mangaId: number, chapterId: string): string {
  const name = chapterFolder(chapterId);
  if (!name || !Number.isInteger(mangaId) || mangaId <= 0) throw new DownloadError("Unrecognised chapter.");
  return inside(path.join(String(mangaId), name));
}

const itemOf = (manga: DownloadManga, title: SourceTitle, chapter: MangaChapter): MangaDownload => ({
  key: downloadKey(manga.id, chapter.id),
  mangaId: manga.id,
  mangaTitle: manga.title,
  cover: manga.cover,
  country: manga.country,
  sourceId: title.sourceId,
  sourceTitleId: title.id,
  sourceTitle: title.title,
  chapter,
  status: "queued",
  done: 0,
  total: chapter.pageCount ?? 0,
  error: null,
  sizeBytes: 0,
});

async function readMeta(dir: string): Promise<DownloadMeta | null> {
  try {
    return downloadMeta(JSON.parse(await fs.promises.readFile(path.join(dir, "meta.json"), "utf-8")));
  } catch {
    return null;
  }
}

async function writeMeta(dir: string, meta: DownloadMeta): Promise<void> {
  const text = downloadMetaJson(meta);
  const temp = path.join(dir, "meta.json.tmp");
  await fs.promises.writeFile(temp, text);
  try {
    await fs.promises.rename(temp, path.join(dir, "meta.json"));
  } catch {
    await fs.promises.writeFile(path.join(dir, "meta.json"), text);
    await fs.promises.rm(temp, { force: true }).catch(() => {});
  }
}

async function folderSize(dir: string): Promise<number> {
  let total = 0;
  for (const name of await fs.promises.readdir(dir).catch(() => [] as string[])) {
    total += (await fs.promises.stat(path.join(dir, name)).catch(() => null))?.size ?? 0;
  }
  return total;
}

/** Downloads from earlier runs; an unfinished one is queued again and resumes. */
async function restore(): Promise<void> {
  const root = mangaDownloadsDir();
  const resume: { manga: DownloadManga; title: SourceTitle; chapter: MangaChapter }[] = [];
  for (const series of await fs.promises.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!series.isDirectory() || !/^\d{1,10}$/.test(series.name)) continue;
    for (const folder of await fs.promises.readdir(path.join(root, series.name), { withFileTypes: true }).catch(() => [])) {
      if (!folder.isDirectory() || !/^[A-Za-z0-9_-]{1,64}$/.test(folder.name)) continue;
      const dir = path.join(root, series.name, folder.name);
      const meta = await readMeta(dir);
      if (!meta || String(meta.manga.id) !== series.name || chapterFolder(meta.chapter.id) !== folder.name) {
        // Metadata from an interrupted first write can't be resumed; free the space.
        await fs.promises.rm(dir, RM).catch(() => {});
        continue;
      }
      const item = itemOf(meta.manga, meta.title, meta.chapter);
      if (!meta.complete) {
        // Unfinished: it carries on where it stopped (keeping the pages its ledger lists).
        resume.push({ manga: meta.manga, title: meta.title, chapter: meta.chapter });
        continue;
      }
      items.set(item.key, {
        ...item,
        status: meta.complete ? "done" : "failed",
        done: meta.complete ? meta.pages.length : 0,
        error: meta.complete ? null : "Download was interrupted. Download it again.",
        sizeBytes: meta.complete ? meta.sizeBytes || await folderSize(dir) : 0,
      });
    }
  }
  for (const r of resume) enqueue(r.manga, r.title, r.chapter);
}

export async function listMangaDownloads(): Promise<MangaDownload[]> {
  await ready();
  return [...items.values()];
}

function enqueue(manga: DownloadManga, title: SourceTitle, chapter: MangaChapter): void {
  const item = itemOf(manga, title, chapter);
  items.set(item.key, item);
  const generation = ++nextGeneration;
  generations.set(item.key, generation);
  queue.push({ key: item.key, generation, title });
  emit({ item });
  void work();
}

/** Queues one chapter unless it's downloaded or on its way already (a failed try is retried). */
export async function downloadChapter(manga: DownloadManga, title: SourceTitle, chapter: MangaChapter): Promise<boolean> {
  await ready();
  const existing = items.get(downloadKey(manga.id, chapter.id));
  if (existing && existing.status !== "failed") return false;
  enqueue(manga, title, chapter);
  return true;
}

/**
 * Queues [chapters] in reading order, one per chapter number: numbers downloaded or
 * on the way from any group are skipped, failed tries replaced. Returns how many
 * were added.
 */
export async function downloadChapters(manga: DownloadManga, title: SourceTitle, chapters: MangaChapter[]): Promise<number> {
  await ready();
  const plan = planRange(chapters, [...items.values()], manga.id);
  for (const key of plan.drop) await removeMangaDownload(key);
  for (const chapter of plan.add) enqueue(manga, title, chapter);
  return plan.add.length;
}

/** Deletes a download, stopping it first when it's queued or running. */
export async function removeMangaDownload(key: string): Promise<void> {
  await ready();
  const item = items.get(key);
  if (!item) return;
  generations.delete(key);
  items.delete(key);
  controllers.get(key)?.abort();
  emit({ removed: [key] });
  await onLane(async () => {
    const dir = folderOf(item.mangaId, item.chapter.id);
    await fs.promises.rm(dir, RM);
    // The title's folder goes with its last chapter.
    await fs.promises.rmdir(path.dirname(dir)).catch(() => {});
  }).catch(() => {});
}

/** Stops a series' queued and in-progress chapters; finished ones stay. */
export async function cancelMangaDownloads(mangaId: number): Promise<number> {
  await ready();
  const keys = [...items.values()]
    .filter((item) => item.mangaId === mangaId && (item.status === "queued" || item.status === "downloading"))
    .map((item) => item.key);
  for (const key of keys) await removeMangaDownload(key);
  return keys.length;
}

/** A finished chapter's pages on disk, for the reader; null to read it online. */
export async function localPages(mangaId: number, chapterId: string): Promise<MangaPageImage[] | null> {
  let dir: string;
  try { dir = folderOf(mangaId, chapterId); } catch { return null; }
  const meta = await readMeta(dir);
  if (!meta?.complete || meta.manga.id !== mangaId || meta.chapter.id !== chapterId) return null;
  for (const page of meta.pages) {
    if (!(await fs.promises.stat(path.join(dir, page.file)).catch(() => null))?.isFile()) return null;
  }
  const folder = path.basename(dir);
  return meta.pages.map((page) => ({ url: `anitrack-manga://local/${mangaId}/${folder}/${page.file}`, width: page.w, height: page.h }));
}

/** Serves a saved page: anitrack-manga://local/<anilistId>/<chapter folder>/<file>. */
export async function serveLocalPage(requestUrl: string): Promise<Response> {
  let target: string;
  let file: string;
  try {
    const parts = new URL(requestUrl).pathname.split("/").filter(Boolean).map(decodeURIComponent);
    file = parts[2] ?? "";
    if (parts.length !== 3 || !/^\d{1,10}$/.test(parts[0]) || !/^[A-Za-z0-9_-]{1,64}$/.test(parts[1]) || !PAGE_FILE.test(file)) {
      return new Response("", { status: 404 });
    }
    target = inside(path.join(parts[0], parts[1], file));
  } catch {
    return new Response("", { status: 400 });
  }
  // Read whole (pages are small) so no file stays open while a deletion runs.
  const bytes = await fs.promises.readFile(target).catch(() => null);
  if (!bytes) return new Response("", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": pageContentType(file), "Content-Length": String(bytes.length), "Cache-Control": "max-age=3600" },
  });
}

// ── Worker ────────────────────────────────────────────────────────────────────

async function work(): Promise<void> {
  if (working) return;
  working = true;
  try {
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (generations.get(next.key) === next.generation) await run(next);
    }
  } finally {
    working = false;
  }
}

/** Saves a still-live download's new state (a removed row is never re-added). */
function update(pending: Pending, item: MangaDownload): MangaDownload {
  if (generations.get(pending.key) !== pending.generation) return item;
  items.set(item.key, item);
  emit({ item });
  return item;
}

async function run(pending: Pending): Promise<void> {
  const live = () => generations.get(pending.key) === pending.generation;
  const queued = items.get(pending.key);
  if (!queued || !live()) return;
  let item = queued;
  const manga: DownloadManga = { id: item.mangaId, title: item.mangaTitle, cover: item.cover, country: item.country };
  const controller = new AbortController();
  controllers.set(pending.key, controller);
  let dir = "";
  try {
    dir = folderOf(item.mangaId, item.chapter.id);
    const chapter = item.chapter;
    // The folder is kept: pages an earlier run saved are reused below.
    await onLane(async () => {
      await fs.promises.mkdir(dir, { recursive: true });
      await writeMeta(dir, { manga, title: pending.title, chapter, pages: [], complete: false, sizeBytes: 0 });
    });
    let reResolves = 0;
    for (;;) {
      try {
        item = await saveChapter(pending, item, dir, controller.signal, reResolves, live);
        break;
      } catch (error) {
        if (!(error instanceof Interrupt) || !live()) throw error;
        if (error.step.action === "re-resolve") { reResolves++; continue; }
        if (error.step.action !== "pause") throw error;
        const latest = items.get(pending.key) ?? item;
        item = update(pending, { ...latest, status: "queued", error: waitingLabel(error.step, latest) });
        await waitOut(error.step, controller.signal);
        if (!live()) throw new Stopped();
      }
    }
    const finished = { ...item.chapter, pageCount: item.total };
    update(pending, { ...item, chapter: finished, status: "done", error: null });
  } catch (error) {
    if (live() && !(error instanceof Stopped)) update(pending, { ...item, status: "failed", error: failureMessage(error) });
  } finally {
    if (controllers.get(pending.key) === controller) controllers.delete(pending.key);
    if (!live() && dir) await onLane(() => fs.promises.rm(dir, RM)).catch(() => {});
  }
}

function waitingLabel(step: Extract<Step, { action: "pause" }>, item: MangaDownload): string {
  const saved = item.done > 0 ? ` (${item.done} of ${item.total} pages saved)` : "";
  if (step.reason === "network") return `Waiting for the network${saved}.`;
  return `${step.reason === "rate-limit" ? "The source asked to wait" : "The source is busy"}; continuing automatically${saved}.`;
}

/** Sleeps until a paused chapter may continue: the wait is over and the network is up. */
async function waitOut(step: Extract<Step, { action: "pause" }>, signal: AbortSignal): Promise<void> {
  if (step.resumeAt) await sleep(Math.max(0, step.resumeAt - Date.now()) * retryScale, signal);
  while (!net.isOnline()) await sleep(NETWORK_POLL_MS * retryScale, signal);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Stopped()); return; }
    const onAbort = () => { clearTimeout(timer); reject(new Stopped()); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function failureOf(error: unknown): Failure | null {
  if (error instanceof MangaSourceError) {
    if (error.verify || error.status == null) return null;
    return error.status === 0 ? { network: true, online: net.isOnline() } : { status: error.status, retryAfter: error.retryAfter };
  }
  const e = error as { name?: unknown } | null;
  if (e?.name === "TimeoutError" || e?.name === "TypeError") return { network: true, online: net.isOnline() };
  return null;
}

/** [work] with the shared retry rules; throws [Interrupt] when the chapter has to stop. */
async function withRetry<T>(work: () => Promise<T>, reResolves: number, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (signal.aborted) throw new Stopped();
      const failure = failureOf(error);
      if (!failure) throw error;
      const step = nextStep(failure, attempt, reResolves, Date.now());
      if (step.action === "retry") { await sleep(step.delayMs * retryScale, signal); continue; }
      if (step.action === "fail") throw error;
      throw new Interrupt(step);
    }
  }
}

/** One pass at a chapter: keeps what's saved for the same page list, fetches the rest. */
async function saveChapter(
  pending: Pending, start: MangaDownload, dir: string, stop: AbortSignal, reResolves: number, live: () => boolean,
): Promise<MangaDownload> {
  let item = start;
  const chapter = item.chapter;
  const manga: DownloadManga = { id: item.mangaId, title: item.mangaTitle, cover: item.cover, country: item.country };
  const pages = await withRetry(() => sourceById(item.sourceId).pageImages(pending.title, chapter.id), reResolves, stop);
  if (!live()) throw new Stopped();
  const pieces: PlanPiece[] = pages.map((page) => ({ kind: "page", url: page.url }));
  const rendition = renditionId(`chapter ${chapter.id}`, pieces);
  const ledgerFile = path.join(dir, LEDGER_FILE);
  const previous = parseLedger(await fs.promises.readFile(ledgerFile, "utf8").catch(() => ""));
  const heads = new Map<string, { size: number; head: Uint8Array }>();
  for (const entry of previous?.pieces.values() ?? []) {
    const bytes = await fs.promises.readFile(path.join(dir, entry.file)).catch(() => null);
    if (bytes) heads.set(entry.file, { size: bytes.length, head: bytes.subarray(0, HEAD_BYTES) });
  }
  const plan = resumePlan(pieces, rendition, previous, (file) => heads.get(file) ?? null);
  const ledger: Ledger | null = plan.restart ? null : previous;
  if (plan.restart) {
    // Another page list (or none recorded): start the chapter clean.
    for (const name of await fs.promises.readdir(dir)) {
      if (PAGE_FILE.test(name) || name.endsWith(".part")) await fs.promises.rm(path.join(dir, name), { force: true });
    }
    await fs.promises.writeFile(ledgerFile, ledgerHeader(rendition, pages.length));
  }
  const saved: SavedPage[] = new Array(pages.length);
  let size = 0;
  for (const index of plan.keep) {
    const entry = ledger!.pieces.get(index)!;
    const bytes = await fs.promises.readFile(path.join(dir, entry.file));
    const page = pages[index];
    const dims = page.width && page.height ? { width: page.width, height: page.height } : imageSize(bytes);
    saved[index] = { file: entry.file, w: dims?.width ?? null, h: dims?.height ?? null };
    size += bytes.length;
  }
  item = update(pending, { ...item, status: "downloading", done: plan.keep.length, total: pages.length, error: null });
  let next = 0;
  // One failed page stops the others before the chapter is marked failed.
  const failed = new AbortController();
  const signal = AbortSignal.any([stop, failed.signal]);
  const worker = async () => {
    while (next < plan.fetch.length) {
      if (!live()) throw new Stopped();
      const index = plan.fetch[next++];
      const result = await withRetry(() => savePage(item.sourceId, pages[index], dir, index, signal), reResolves, signal);
      if (!live()) throw new Stopped();
      await fs.promises.appendFile(ledgerFile, ledgerLine(index, result.page.file, result.bytes, result.tag));
      saved[index] = result.page;
      size += result.bytes;
      item = update(pending, { ...item, done: item.done + 1 });
    }
  };
  const workers = Array.from({ length: Math.min(PAGE_WORKERS, plan.fetch.length) }, worker);
  try {
    await Promise.all(workers);
  } catch (error) {
    failed.abort();
    await Promise.allSettled(workers);
    throw error;
  }
  if (!live()) throw new Stopped();
  const finished = { ...chapter, pageCount: pages.length };
  await writeMeta(dir, { manga, title: pending.title, chapter: finished, pages: saved, complete: true, sizeBytes: size });
  return { ...item, chapter: finished, done: pages.length, total: pages.length, sizeBytes: size };
}

async function savePage(
  sourceId: string,
  page: MangaPageImage,
  dir: string,
  index: number,
  stop: AbortSignal,
): Promise<{ page: SavedPage; bytes: number; tag: string }> {
  const target = publicHttps(page.url);
  if (!target) throw new DownloadError("Refused an unsafe page address.");
  const pending = fetchPageImage(sourceId, target, AbortSignal.any([stop, AbortSignal.timeout(PAGE_TIMEOUT_MS)]));
  if (!pending) throw new DownloadError("Refused an unexpected page address.");
  let response: Response;
  try {
    response = await pending;
  } catch (error) {
    if (stop.aborted) throw new Stopped();
    // No answer at all (offline, reset, timeout): the network, not the page.
    throw new MangaSourceError("The download was interrupted. Check your connection and try again.", 0);
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.toLowerCase().startsWith("image/")) {
    void response.body?.cancel().catch(() => {});
    if (sourceId === "mangadot" && (response.status === 403 || response.status === 503 || (response.ok && type.includes("html")))) {
      throw new DownloadError(VERIFY_MESSAGE);
    }
    if (response.status === 429) throw new MangaSourceError("The source is limiting requests. Wait a minute, then retry.", 429, false, response.headers.get("retry-after"));
    if (response.status === 404) throw new MangaSourceError(`Page ${index + 1} is missing at the source.`, 404);
    if (!response.ok) throw new MangaSourceError(`Page ${index + 1} didn't download (HTTP ${response.status}).`, response.status, false, response.headers.get("retry-after"));
    throw new DownloadError(`Page ${index + 1} didn't come back as an image.`);
  }
  let bytes: Buffer;
  try {
    bytes = await readBytes(response);
  } catch (error) {
    if (error instanceof DownloadError || stop.aborted) throw error;
    throw new MangaSourceError("The download was interrupted. Check your connection and try again.", 0);
  }
  const file = `${String(index + 1).padStart(3, "0")}.${pageExtension(type, target.pathname)}`;
  const partial = path.join(dir, `${file}.part`);
  await fs.promises.writeFile(partial, bytes);
  await fs.promises.rename(partial, path.join(dir, file));
  const size = page.width && page.height ? { width: page.width, height: page.height } : imageSize(bytes);
  return { page: { file, w: size?.width ?? null, h: size?.height ?? null }, bytes: bytes.length, tag: pieceTag({ kind: "page", url: page.url }, bytes) };
}

async function readBytes(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_PAGE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new DownloadError("A page is too large to save.");
  }
  if (!response.body) throw new DownloadError("A page came back empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PAGE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new DownloadError("A page is too large to save.");
    }
    chunks.push(value);
  }
  if (!size) throw new DownloadError("A page came back empty.");
  return Buffer.concat(chunks, size);
}

function failureMessage(error: unknown): string {
  if (error instanceof DownloadError || error instanceof MangaSourceError) return error.message;
  const e = error as { name?: unknown; code?: unknown } | null;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "A page took too long to download. Try again.";
  if (e?.code === "ENOSPC") return "There isn't enough free disk space for this chapter.";
  if (e?.code === "EACCES" || e?.code === "EPERM" || e?.code === "EBUSY") return "AniTrack couldn't save this chapter's pages.";
  return "The download was interrupted. Check your connection and try again.";
}
