import { app, net } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { DownloadItem } from "../../shared/types";
import { getRuntimeConfig } from "./remote-config";

/**
 * Desktop (Electron) offline downloader — mirrors the Android AniTrackDownloader
 * plugin. Saves a resolved HLS stream (playlist + segments + AES keys + soft subs)
 * to userData/anitrack_downloads/<folder>/, rewrites the playlist to local relative
 * paths, and serves it back via the `anitrack-dl://` protocol (registered in main.ts)
 * so the in-app hls.js player can play it offline. Progress is pushed to the
 * renderer via an injected `emit` callback.
 */

type Emit = (item: DownloadItem) => void;
let emitProgress: Emit = () => {};
export function setDownloadEmitter(fn: Emit) { emitProgress = fn; }

export function downloadsDir(): string {
  return path.join(app.getPath("userData"), "anitrack_downloads");
}
function folderName(id: string): string { return id.replace(/:/g, "_"); }
function itemDir(id: string): string { return path.join(downloadsDir(), folderName(id)); }

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const cancelled = new Set<string>();
const running = new Set<string>();

export interface StartOpts {
  id: string; animeId: number; episode: number; title: string; coverUrl?: string | null;
  providerId: string; hlsUrl: string; referer?: string | null;
  animeSession?: string; episodeSession?: string; subtitleUrl?: string | null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startDownload(opts: StartOpts): void {
  if (!getRuntimeConfig().features.downloads) {
    emit(opts, "failed", 0, 0, 0, 0, "Downloads are temporarily disabled by signed automation rules.");
    return;
  }
  if (running.has(opts.id)) return;
  cancelled.delete(opts.id);
  void runDownload(opts);
}

export function listDownloads(): { items: DownloadItem[] } {
  const items: DownloadItem[] = [];
  try {
    for (const d of fs.readdirSync(downloadsDir(), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const meta = path.join(downloadsDir(), d.name, "meta.json");
      if (fs.existsSync(meta)) {
        try {
          let item = JSON.parse(fs.readFileSync(meta, "utf-8")) as DownloadItem;
          // Downloads are process-bound. A persisted in-progress state with no
          // matching worker means Electron exited before the job settled.
          if ((item.status === "downloading" || item.status === "queued") && !running.has(item.id)) {
            item = {
              ...item,
              status: "failed",
              error: "Download was interrupted. Retry to continue.",
              updatedAt: Date.now(),
            };
            fs.writeFileSync(meta, JSON.stringify(item));
          }
          items.push(item);
        } catch { /* skip */ }
      }
    }
  } catch { /* dir may not exist yet */ }
  return { items };
}

export function removeDownload(id: string): void {
  cancelled.add(id);
  try { fs.rmSync(itemDir(id), { recursive: true, force: true }); } catch { /* ignore */ }
}

export function getDownloadPlayUrl(id: string): { url: string } {
  return { url: `anitrack-dl://d/${folderName(id)}/index.m3u8` };
}

// ── Worker ──────────────────────────────────────────────────────────────────

function emit(o: StartOpts, status: DownloadItem["status"], progress: number, done: number, total: number, sizeBytes: number, error?: string) {
  const item: DownloadItem = {
    id: o.id, animeId: o.animeId, episode: o.episode, title: o.title, coverUrl: o.coverUrl ?? null,
    providerId: o.providerId, status, progress, doneSegments: done, totalSegments: total, sizeBytes,
    updatedAt: Date.now(), animeSession: o.animeSession, episodeSession: o.episodeSession,
    ...(error ? { error } : {}),
  };
  try {
    const dir = itemDir(o.id);
    if (fs.existsSync(dir) || status !== "failed") {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(item));
    }
  } catch { /* ignore */ }
  emitProgress(item);
}

async function runDownload(o: StartOpts): Promise<void> {
  const dir = itemDir(o.id);
  running.add(o.id);
  try {
    fs.mkdirSync(dir, { recursive: true });
    emit(o, "downloading", 0, 0, 0, 0);
    const ref = o.referer && o.referer.length
      ? o.referer.replace(/\/$/, "")
      : o.hlsUrl.includes("animepahe") ? "https://animepahe.pw" : "";

    let playlistUrl = o.hlsUrl;
    let playlist = await httpGetText(playlistUrl, ref);
    if (playlist.includes("#EXT-X-STREAM-INF")) {
      const variant = pickVariant(playlist, playlistUrl);
      if (variant) { playlistUrl = variant; playlist = await httpGetText(playlistUrl, ref); }
    }

    const base = playlistUrl.slice(0, playlistUrl.lastIndexOf("/") + 1);
    const out: string[] = [];
    const toDownload: { url: string; file: string }[] = [];
    const localByUrl = new Map<string, string>();
    let seg = 0, key = 0, init = 0;
    const queueAsset = (url: string, prefix: "seg" | "key" | "init", fallbackExt: string): string => {
      const absolute = absolutize(url, base);
      const existing = localByUrl.get(absolute);
      if (existing) return existing;
      const sequence = prefix === "seg" ? seg++ : prefix === "key" ? key++ : init++;
      const width = prefix === "seg" ? 5 : 2;
      const ext = safeMediaExtension(absolute, fallbackExt);
      const name = `${prefix}${String(sequence).padStart(width, "0")}${ext}`;
      localByUrl.set(absolute, name);
      toDownload.push({ url: absolute, file: path.join(dir, name) });
      return name;
    };
    for (const raw of playlist.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (line.startsWith("#EXT-X-KEY") || line.startsWith("#EXT-X-SESSION-KEY")) {
        const m = line.match(/URI="([^"]+)"/);
        if (m) {
          const name = queueAsset(m[1], "key", ".key");
          out.push(line.replace(m[0], `URI="${name}"`));
        } else out.push(line);
      } else if (line.startsWith("#EXT-X-MAP")) {
        const m = line.match(/URI="([^"]+)"/);
        if (m) {
          const name = queueAsset(m[1], "init", ".mp4");
          out.push(line.replace(m[0], `URI="${name}"`));
        } else out.push(line);
      } else if (line.length && !line.startsWith("#")) {
        const name = queueAsset(line, "seg", ".ts");
        out.push(name);
      } else out.push(line);
    }
    if (!toDownload.length) throw new Error("Playlist had no segments");
    fs.writeFileSync(path.join(dir, "index.m3u8"), out.join("\n"));

    const total = toDownload.length;
    let done = 0;
    // 6-way concurrency with 429 backoff (mirrors the Android downloader).
    let idx = 0;
    async function worker() {
      while (idx < toDownload.length) {
        if (cancelled.has(o.id)) throw new Error("cancelled");
        const d = toDownload[idx++];
        await httpDownloadToFile(d.url, d.file, ref);
        done++;
        if (done % 4 === 0 || done === total) emit(o, "downloading", Math.floor((done * 100) / total), done, total, 0);
      }
    }
    await Promise.all(Array.from({ length: 6 }, () => worker()));

    if (o.subtitleUrl) {
      try { await httpDownloadToFile(o.subtitleUrl, path.join(dir, "subs.vtt"), ref); } catch { /* best-effort */ }
    }

    let sizeBytes = 0;
    try { for (const f of fs.readdirSync(dir)) sizeBytes += fs.statSync(path.join(dir, f)).size; } catch { /* ignore */ }
    emit(o, "done", 100, total, total, sizeBytes);
  } catch (e: any) {
    if (cancelled.has(o.id)) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
    else emit(o, "failed", 0, 0, 0, 0, e?.message ?? "download failed");
  } finally {
    running.delete(o.id);
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function reqHeaders(ref: string): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": UA };
  if (ref) { h["Referer"] = ref + "/"; h["Origin"] = ref; }
  return h;
}

async function execWithRetry(url: string, ref: string, maxRetries = 6): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const resp = await net.fetch(url, { headers: reqHeaders(ref) });
    if (resp.ok) return resp;
    const retryable = resp.status === 429 || resp.status === 408 || resp.status >= 500;
    if (!retryable || attempt >= maxRetries) throw new Error(`HTTP ${resp.status} for ${url}`);
    const ra = Number(resp.headers.get("retry-after"));
    const backoff = isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(5000, 400 * 2 ** attempt);
    await new Promise((r) => setTimeout(r, backoff + Math.floor(Math.random() * 300)));
    attempt++;
  }
}

async function httpGetText(url: string, ref: string): Promise<string> {
  const resp = await execWithRetry(url, ref);
  return resp.text();
}

async function httpDownloadToFile(url: string, file: string, ref: string): Promise<void> {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return; // resume: skip complete segments
  const resp = await execWithRetry(url, ref);
  const buf = Buffer.from(await resp.arrayBuffer());
  const tmp = file + ".part";
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

function absolutize(uri: string, base: string): string {
  if (uri.startsWith("http://") || uri.startsWith("https://")) return uri;
  if (uri.startsWith("//")) return "https:" + uri;
  if (uri.startsWith("/")) {
    const root = base.match(/^(https?:\/\/[^/]+)/)?.[1] ?? base;
    return root + uri;
  }
  return base + uri;
}

function safeMediaExtension(url: string, fallback: string): string {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if ([".ts", ".m4s", ".mp4", ".aac", ".mp3", ".key"].includes(ext)) return ext;
  } catch { /* use the known-safe fallback */ }
  return fallback;
}

function pickVariant(playlist: string, base: string): string | null {
  const lines = playlist.split("\n").map((l) => l.replace(/\r$/, ""));
  const baseDir = base.slice(0, base.lastIndexOf("/") + 1);
  let bestUrl: string | null = null, bestBw = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
      const bw = Number(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] ?? 0);
      const uri = lines[i + 1]?.trim();
      if (uri && !uri.startsWith("#") && bw > bestBw) { bestBw = bw; bestUrl = absolutize(uri, baseDir); }
    }
  }
  return bestUrl;
}
