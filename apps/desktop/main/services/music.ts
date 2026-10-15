import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { extractZipEntry, readZipEntries } from "./zip-entries";
import {
  BG_MUSIC_MAX_BYTES,
  isMusicFile,
  safeTrackName,
  sortTracks,
  trackFromFile,
  type BgTrack,
} from "../../../../packages/shared/bg-music";

/**
 * Background music: the tracks the user imported (copies in userData/music) plus
 * the ones that ship with the app (resources/music, shared with the Android
 * assets). The renderer plays them through anitrack-music://t/<file name>.
 */
export function musicDir(): string {
  const dir = path.join(app.getPath("userData"), "music");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Built-in tracks: in the installed app's resources, or the Android assets in a checkout. */
function bundledDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "music")
    : path.join(app.getAppPath(), "apps", "android", "app", "src", "main", "assets", "music");
}

/** Built-in tracks the user removed (they stay in the app, just out of the list). */
const HIDDEN_FILE = ".hidden-bundled.json";

function hiddenBundled(): Set<string> {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(musicDir(), HIDDEN_FILE), "utf8"));
    return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function fileNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function listTracks(): BgTrack[] {
  const own = fileNames(musicDir())
    .map((name) => trackFromFile(name))
    .filter((track): track is BgTrack => track != null);
  const ownIds = new Set(own.map((track) => track.id));
  const hidden = hiddenBundled();
  // An imported file with the same name stands in for the built-in one.
  const bundled = fileNames(bundledDir())
    .filter((name) => !ownIds.has(name) && !hidden.has(name))
    .map((name) => trackFromFile(name))
    .filter((track): track is BgTrack => track != null)
    .map((track) => ({ ...track, bundled: true }));
  return sortTracks([...own, ...bundled]);
}

/** Where an imported track lives: only plain names directly inside the music folder. */
function trackFile(id: unknown): string | null {
  if (typeof id !== "string" || !isMusicFile(id) || id !== safeTrackName(id)) return null;
  const dir = musicDir();
  const file = path.join(dir, id);
  return path.dirname(file) === dir ? file : null;
}

/** The file to play for [id]: the user's copy, else the built-in one. */
function playableFile(id: unknown): string | null {
  const own = trackFile(id);
  if (!own) return null;
  if (fs.existsSync(own)) return own;
  const name = path.basename(own);
  const bundled = path.join(bundledDir(), name);
  return fs.existsSync(bundled) && !hiddenBundled().has(name) ? bundled : null;
}

/** Copies audio files (or the audio inside .zip files) in; a name already there is left as it is. */
export function importTracks(paths: string[]): Promise<{ added: number; skipped: number }> {
  // One import at a time, so leftover partial files can be cleared safely.
  const run = importQueue.then(() => importNow(paths));
  importQueue = run.catch(() => undefined);
  return run;
}

let importQueue: Promise<unknown> = Promise.resolve();
const PART_PREFIX = ".import-";

async function importNow(paths: string[]): Promise<{ added: number; skipped: number }> {
  const dir = musicDir();
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(PART_PREFIX)) fs.rmSync(path.join(dir, name), { force: true });
  }
  let added = 0;
  let skipped = 0;
  for (const source of paths) {
    if (source.toLowerCase().endsWith(".zip")) {
      const result = await importZip(source);
      added += result.added;
      skipped += result.skipped;
      continue;
    }
    const name = safeTrackName(path.basename(source));
    const stat = await fs.promises.stat(source).catch(() => null);
    const target = trackFile(name);
    if (!stat?.isFile() || stat.size > BG_MUSIC_MAX_BYTES || !target || fs.existsSync(target)) {
      skipped++;
      continue;
    }
    try {
      await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      added++;
    } catch {
      skipped++;
    }
  }
  return { added, skipped };
}

/** The audio files inside a zip, by their own names (folders inside it are ignored). */
async function importZip(zip: string): Promise<{ added: number; skipped: number }> {
  const entries = await readZipEntries(zip).catch(() => null);
  if (!entries) return { added: 0, skipped: 1 };
  let added = 0;
  let skipped = 0;
  for (const entry of entries) {
    const base = entry.name.split("/").pop() ?? "";
    if (entry.name.startsWith("__MACOSX/") || base.startsWith("._")) continue;
    const name = safeTrackName(base);
    if (!isMusicFile(name)) continue;
    const target = trackFile(name);
    if (!target || entry.size > BG_MUSIC_MAX_BYTES || fs.existsSync(target)) {
      skipped++;
      continue;
    }
    const part = path.join(musicDir(), `${PART_PREFIX}${added + skipped}.part`);
    try {
      await extractZipEntry(zip, entry, part);
      if (fs.existsSync(target)) {
        skipped++;
      } else {
        await fs.promises.rename(part, target);
        added++;
      }
    } catch {
      skipped++;
    } finally {
      await fs.promises.rm(part, { force: true }).catch(() => undefined);
    }
  }
  return { added, skipped };
}

export function removeTrack(id: unknown): void {
  const file = trackFile(id);
  if (!file) return;
  if (fs.existsSync(file)) {
    fs.rmSync(file, { force: true });
    return;
  }
  // A built-in track: hide it.
  const name = path.basename(file);
  if (fs.existsSync(path.join(bundledDir(), name))) {
    const hidden = hiddenBundled();
    hidden.add(name);
    fs.writeFileSync(path.join(musicDir(), HIDDEN_FILE), JSON.stringify([...hidden]));
  }
}

const TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".oga": "audio/ogg",
  ".opus": "audio/ogg", ".wav": "audio/wav", ".flac": "audio/flac",
};

/** anitrack-music://t/<file name>, with byte ranges so the audio element can stream and seek. */
export async function serveTrack(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const file = playableFile(decodeURIComponent(url.pathname.replace(/^\/+/, "")));
    const stat = file ? await fs.promises.stat(file).catch(() => null) : null;
    if (!file || !stat?.isFile()) return new Response("", { status: 404 });
    const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
      let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
      end = Math.min(end, stat.size - 1);
      if (start > end || start >= stat.size) {
        return new Response("", { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
      }
      start = Math.max(0, start);
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": type,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
        },
      });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
      headers: { "Content-Type": type, "Content-Length": String(stat.size), "Accept-Ranges": "bytes" },
    });
  } catch {
    return new Response("", { status: 500 });
  }
}
