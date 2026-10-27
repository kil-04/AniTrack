import { app } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  ArchiveUnavailableError, archiveSearchUrl, archiveFileUrl, parseArchiveSearch, parseArchiveTracks, validArchiveId,
  type ArchiveTrack, type ArchiveSearchResult, type CityPopDownload, type ArchiveMediaFilter,
} from "../../../../packages/shared/city-pop-archive";

const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 ** 3;
/** Archive gets this long to answer a download request, and then this long between two chunks. */
const RESPONSE_TIMEOUT_MS = 30_000;
const STALL_TIMEOUT_MS = 60_000;
const cache = new Map<string, { at: number; tracks: ArchiveTrack[] }>();
const jobs = new Map<string, CityPopDownload>();
const controllers = new Map<string, AbortController>();
let loaded = false;
let working = false;
const directory = () => path.join(app.getPath("userData"), "city-pop-downloads");
const indexFile = () => path.join(directory(), "index.json");
const keyFor = (id: string, file: string) => createHash("sha256").update(`${id}\0${file}`).digest("hex");
const fileFor = (row: CityPopDownload) => path.join(directory(), `${row.key}${path.extname(row.fileName).toLowerCase()}`);
/** A message written for the user; anything else is shown as a plain connection or disk problem. */
class CityPopError extends Error {}
class ArchiveHttpError extends CityPopError {
  constructor(readonly status: number) { super(`Archive.org answered ${status}. Try again later.`); }
}

/** Node and network internals ("fetch failed", "terminated", ENOSPC with a local path) never reach the page. */
function userMessage(error: unknown): string {
  if (error instanceof CityPopError || error instanceof ArchiveUnavailableError) return error.message;
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === "ENOSPC") return "Not enough free disk space for this download.";
  if (code === "EACCES" || code === "EPERM" || code === "EBUSY" || code === "EROFS") return "AniTrack couldn't use its download folder. Check the disk and try again.";
  return "Couldn't reach Archive.org. Check your connection and try again.";
}

/** Calls the page makes reject with user-facing text only. */
async function userFacing<T>(task: () => Promise<T>): Promise<T> {
  try { return await task(); } catch (error) { throw new CityPopError(userMessage(error)); }
}

export function archiveUrlAllowed(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") &&
      (u.hostname === "archive.org" || u.hostname.endsWith(".archive.org"));
  } catch { return false; }
}

/** Follow only Internet Archive's own storage redirects; never carry account headers. */
async function request(url: string, signal: AbortSignal): Promise<Response> {
  for (let hop = 0; hop < 6; hop++) {
    if (!archiveUrlAllowed(url)) throw new CityPopError("Archive.org returned an unsupported address.");
    const response = await fetch(url, {
      redirect: "manual", credentials: "omit", signal,
      headers: { "User-Agent": `AniTrack/${app.getVersion()} (City Pop)`, Accept: "*/*" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new CityPopError("Archive.org returned an incomplete redirect.");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ArchiveHttpError(response.status);
    }
    return response;
  }
  throw new CityPopError("Archive.org redirected too many times.");
}

async function json(url: string): Promise<unknown> {
  const response = await request(url, AbortSignal.timeout(30_000));
  const reader = response.body?.getReader();
  if (!reader) throw new CityPopError("Archive.org returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_JSON_BYTES) throw new CityPopError("Archive.org sent too much metadata.");
      chunks.push(value);
    }
    // A maintenance or error page instead of JSON is Archive failing, not a network problem.
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ArchiveUnavailableError("Internet Archive sent an unreadable answer. Try again later."); }
  } finally { await reader.cancel().catch(() => {}); }
}

export function searchCityPopArchive(query: string, page: number, media: ArchiveMediaFilter = "all"): Promise<ArchiveSearchResult> {
  return userFacing(async () => parseArchiveSearch(await json(archiveSearchUrl(query, page, media)), page, media));
}

async function archiveItem(id: string): Promise<ArchiveTrack[]> {
  if (!validArchiveId(id)) throw new CityPopError("Choose an Archive.org item.");
  const held = cache.get(id);
  if (held && Date.now() - held.at < 15 * 60_000) return held.tracks;
  const tracks = parseArchiveTracks(id, await json(`https://archive.org/metadata/${encodeURIComponent(id)}`));
  // Only real track lists are kept, so "Try again" on an empty item asks Archive again.
  if (tracks.length) {
    if (cache.size >= 40) cache.delete(cache.keys().next().value!);
    cache.set(id, { at: Date.now(), tracks });
  }
  return tracks;
}

export function cityPopArchiveItem(id: string): Promise<ArchiveTrack[]> {
  return userFacing(() => archiveItem(id));
}

async function archiveTrack(id: string, fileName: string): Promise<ArchiveTrack> {
  if (typeof fileName !== "string" || fileName.length > 1024) throw new CityPopError("Choose a track.");
  const track = (await archiveItem(id)).find((row) => row.fileName === fileName);
  if (!track) throw new CityPopError("That public media file is no longer available.");
  return track;
}

/** An album's files in the order asked for; each plays from its saved copy once that download is complete. */
export function resolveCityPopArchiveQueue(id: string, fileNames: readonly string[]): Promise<{ track: ArchiveTrack; url: string }[]> {
  return userFacing(async () => {
    const tracks = await archiveItem(id);
    init();
    return fileNames.map((fileName) => {
      const track = tracks.find((row) => row.fileName === fileName);
      if (!track) throw new CityPopError("That public media file is no longer available.");
      const saved = jobs.get(keyFor(id, fileName));
      const offline = saved?.status === "completed" && fs.existsSync(fileFor(saved));
      return { track, url: offline ? `anitrack-city-pop://download/${saved.key}` : track.url };
    });
  });
}

function persist(): void {
  fs.mkdirSync(directory(), { recursive: true });
  const temp = `${indexFile()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify([...jobs.values()]));
  fs.renameSync(temp, indexFile());
}

/** The index only matters after a restart: a failed write (a file briefly locked on Windows) must not stop the queue. */
function save(): void {
  try { persist(); } catch { /* The next change rewrites it. */ }
}

function init(): void {
  if (loaded) return;
  loaded = true;
  // A quit or crash mid-download leaves its partial file behind; no download has started yet.
  try {
    for (const name of fs.readdirSync(directory())) if (name.endsWith(".part")) fs.rmSync(path.join(directory(), name), { force: true });
  } catch { /* No downloads folder yet. */ }
  try {
    const stat = fs.statSync(indexFile());
    if (stat.size > 2 * 1024 * 1024) return;
    const rows: unknown = JSON.parse(fs.readFileSync(indexFile(), "utf8"));
    if (!Array.isArray(rows)) return;
    for (const row of rows.slice(0, 300)) {
      if (!row || typeof row !== "object" || !validArchiveId(row.itemId) || typeof row.fileName !== "string") continue;
      try { archiveFileUrl(row.itemId, row.fileName); } catch { continue; }
      if (row.key !== keyFor(row.itemId, row.fileName) || !/\.(mp3|m4a|ogg|oga|opus|flac|wav|mp4|m4v|webm)$/i.test(row.fileName)) continue;
      if (typeof row.title !== "string" || row.title.length > 500 || typeof row.artist !== "string" || row.artist.length > 500 || !["audio", "video"].includes(row.mediaType)) continue;
      const size = fs.statSync(fileFor(row), { throwIfNoEntry: false })?.size;
      const complete = row.status === "completed" && typeof size === "number" && size > 0 && size <= MAX_FILE_BYTES;
      jobs.set(row.key, {
        key: row.key, itemId: row.itemId, fileName: row.fileName, title: row.title, artist: row.artist, mediaType: row.mediaType,
        status: complete ? "completed" : "error", bytes: complete ? size : 0,
        totalBytes: complete ? size : null, error: complete ? null : "Download interrupted. Retry when online.",
      });
    }
  } catch { /* A missing/corrupt queue must not prevent browsing. */ }
}

export function cityPopDownloads(): CityPopDownload[] {
  init();
  return [...jobs.values()].map((row) => ({ ...row }));
}

export function downloadCityPopArchive(id: string, fileName: string): Promise<{ key: string }> {
  return userFacing(async () => {
    init();
    const track = await archiveTrack(id, fileName);
    if (track.size !== null && track.size > MAX_FILE_BYTES) throw new CityPopError("This file is larger than the 2 GB download limit.");
    const key = keyFor(id, fileName);
    const held = jobs.get(key);
    if (held && held.status !== "error") return { key };
    if (jobs.size >= 300 && !held) throw new CityPopError("Remove some City Pop downloads before adding more.");
    jobs.set(key, {
      key, itemId: id, fileName, title: track.title, artist: track.artist, mediaType: track.mediaType,
      status: "queued", bytes: 0, totalBytes: track.size, error: null,
    });
    save();
    void work().catch(() => { /* Rows record their own failures; the next download restarts the worker. */ });
    return { key };
  });
}

async function work(): Promise<void> {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const row = [...jobs.values()].find((entry) => entry.status === "queued");
      if (!row) break;
      const controller = new AbortController();
      controllers.set(row.key, controller);
      const part = `${fileFor(row)}.part`;
      row.status = "downloading";
      let handle: fs.promises.FileHandle | null = null;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const expectedBytes = row.totalBytes;
      // A slow download that keeps moving finishes however long it takes; one that stops
      // sending times out with its own message (never shown as a cancel).
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const allow = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms); };
      allow(RESPONSE_TIMEOUT_MS);
      try {
        const response = await request(archiveFileUrl(row.itemId, row.fileName), controller.signal);
        allow(STALL_TIMEOUT_MS);
        reader = response.body?.getReader();
        if (!reader) throw new CityPopError("Archive.org returned an empty file.");
        if (response.status === 206 || response.headers.has("content-range")) throw new CityPopError("Archive.org sent a partial file. Try downloading again.");
        const type = response.headers.get("content-type") ?? "";
        if (/text\/html|application\/json/i.test(type)) throw new CityPopError("Archive.org returned a page instead of media.");
        const declared = Number(response.headers.get("content-length"));
        if (declared > MAX_FILE_BYTES) throw new CityPopError("This file is larger than the 2 GB download limit.");
        if (declared > 0 && expectedBytes !== null && declared !== expectedBytes) throw new CityPopError("Archive.org's file size changed. Try again later.");
        row.totalBytes = declared > 0 ? declared : row.totalBytes;
        handle = await fs.promises.open(part, "w");
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          allow(STALL_TIMEOUT_MS);
          if (controller.signal.aborted || jobs.get(row.key) !== row) throw new CityPopError("Cancelled.");
          row.bytes += value.length;
          if (row.bytes > MAX_FILE_BYTES) throw new CityPopError("This file is larger than the 2 GB download limit.");
          await handle.writeFile(value);
        }
        clearTimeout(timer);
        if (!row.bytes || (declared > 0 && row.bytes !== declared) || (expectedBytes !== null && row.bytes !== expectedBytes)) throw new CityPopError("Archive.org sent an incomplete file.");
        await handle.close(); handle = null;
        if (controller.signal.aborted || jobs.get(row.key) !== row) throw new CityPopError("Cancelled.");
        await fs.promises.rename(part, fileFor(row));
        if (controller.signal.aborted || jobs.get(row.key) !== row) {
          // The serial worker has not started any replacement job yet.
          await fs.promises.unlink(fileFor(row)).catch(() => {});
          throw new CityPopError("Cancelled.");
        }
        row.status = "completed"; row.totalBytes = row.bytes; row.error = null;
      } catch (error) {
        if (error instanceof ArchiveHttpError && (error.status === 403 || error.status === 429)) {
          for (const queued of jobs.values()) {
            if (queued.status === "queued") {
              queued.status = "error";
              queued.error = "Archive.org paused these downloads. Try again later.";
            }
          }
        }
        if (jobs.get(row.key) === row) {
          row.status = "error";
          row.error = timedOut ? "Archive.org stopped sending this file. Retry when your connection is steady."
            : controller.signal.aborted ? "Download cancelled. Retry when ready." : userMessage(error);
        }
      } finally {
        clearTimeout(timer);
        await reader?.cancel().catch(() => {});
        await handle?.close().catch(() => {});
        await fs.promises.unlink(part).catch(() => {});
        controllers.delete(row.key);
        save();
      }
    }
  } finally { working = false; }
}

export function cancelCityPopDownload(key: string): void {
  init();
  const row = jobs.get(key);
  if (!row || row.status === "completed") return;
  controllers.get(key)?.abort();
  row.status = "error"; row.error = "Download cancelled. Retry when ready.";
  save();
}

export function removeCityPopDownload(key: string): void {
  init();
  const row = jobs.get(key);
  if (!row) return;
  const controller = controllers.get(key);
  controller?.abort();
  try {
    fs.rmSync(fileFor(row), { force: true });
    // An active download's worker deletes its own partial file; an interrupted one left it behind.
    if (!controller) fs.rmSync(`${fileFor(row)}.part`, { force: true });
  } catch (error) { throw new CityPopError(userMessage(error)); }
  jobs.delete(key);
  save();
}

export function localCityPopTrack(key: string): { track: ArchiveTrack; url: string } {
  init();
  const row = jobs.get(key);
  if (!row || row.status !== "completed" || !fs.existsSync(fileFor(row))) throw new CityPopError("This download is not available offline.");
  return { track: { ...row, size: row.bytes, url: archiveFileUrl(row.itemId, row.fileName) }, url: `anitrack-city-pop://download/${key}` };
}

const CONTENT_TYPES: Record<string, string> = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac", ".wav": "audio/wav", ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm" };

/** Local downloads are addressed by receipts, not renderer-supplied file paths. */
export async function serveCityPopDownload(request: Request): Promise<Response> {
  try {
    init();
    const url = new URL(request.url);
    if (url.protocol !== "anitrack-city-pop:" || url.hostname !== "download" || url.username || url.password || url.port || url.search || url.hash || !/^\/[a-f0-9]{64}$/.test(url.pathname) || !["GET", "HEAD"].includes(request.method)) return new Response("", { status: 404 });
    const row = jobs.get(url.pathname.slice(1));
    if (!row || row.status !== "completed") return new Response("", { status: 404 });
    const file = fileFor(row);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat?.isFile()) return new Response("", { status: 404 });
    const headers: Record<string, string> = { "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream", "Accept-Ranges": "bytes" };
    const rangeHeader = request.headers.get("range");
    const range = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? "");
    if (rangeHeader !== null && (!range || (!range[1] && !range[2]))) return new Response("", { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    let start = 0, end = stat.size - 1;
    if (range && (range[1] || range[2])) {
      start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) return new Response("", { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
      headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers["Content-Length"] = String(end - start + 1);
    const body = request.method === "HEAD" ? null : Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch { return new Response("", { status: 404 }); }
}
