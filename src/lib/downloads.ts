/**
 * Offline downloads (Android only).
 *
 * The native `AniTrackDownloader` plugin downloads a resolved HLS stream (playlist
 * + segments + keys) to disk and serves it back for in-app playback via an
 * `anitrack-dl://` URL. The JS side here owns the *queue*: it resolves each
 * episode's HLS URL just-in-time (kwik URLs expire fast) and feeds one download
 * at a time to native, so a 50-episode batch stays fresh and doesn't hammer the
 * CDN. State is mirrored to subscribers for the UI.
 */
import { registerPlugin } from "@capacitor/core";
import { isCapacitor } from "./platform";
import type { DownloadItem } from "../../shared/types";

interface StartOpts {
  id: string;
  animeId: number;
  episode: number;
  title: string;
  coverUrl?: string | null;
  providerId: string;
  hlsUrl: string;
  referer?: string | null;
  animeSession?: string;
  episodeSession?: string;
  subtitleUrl?: string | null;
}

interface DownloaderPlugin {
  start(opts: StartOpts): Promise<void>;
  list(): Promise<{ items: DownloadItem[] }>;
  remove(opts: { id: string }): Promise<void>;
  getPlayUrl(opts: { id: string }): Promise<{ url: string }>;
  readFile(opts: { url: string; binary: boolean }): Promise<{ data: string; status: number; binary: boolean }>;
  addListener(
    event: "progress",
    cb: (e: DownloadItem) => void,
  ): Promise<{ remove: () => void }>;
}

// Unified backend: the Android native plugin OR the Electron IPC downloader.
interface Backend {
  start(opts: StartOpts): Promise<unknown>;
  list(): Promise<{ items: DownloadItem[] }>;
  remove(id: string): Promise<unknown>;
  getPlayUrl(id: string): Promise<{ url: string }>;
  readFile(opts: { url: string; binary: boolean }): Promise<{ data: string; status: number; binary: boolean }>;
  onProgress(cb: (e: DownloadItem) => void): void;
}

function makeBackend(): Backend | null {
  if (isCapacitor) {
    const plugin = registerPlugin<DownloaderPlugin>("AniTrackDownloader");
    return {
      start: (o) => plugin.start(o),
      list: () => plugin.list(),
      remove: (id) => plugin.remove({ id }),
      getPlayUrl: (id) => plugin.getPlayUrl({ id }),
      readFile: (o) => plugin.readFile(o),
      onProgress: (cb) => { void plugin.addListener("progress", cb); },
    };
  }
  const dl = (typeof window !== "undefined" ? (window as any).api?.downloads : null);
  if (dl) {
    return {
      start: (o) => dl.start(o),
      list: () => dl.list(),
      remove: (id: string) => dl.remove(id),
      getPlayUrl: (id: string) => dl.getPlayUrl(id),
      // Desktop serves files via the anitrack-dl:// protocol, so the hls.js
      // default loader fetches them directly — no readFile needed.
      readFile: async ({ binary }) => ({ data: "", status: 404, binary }),
      onProgress: (cb) => { (window as any).api?.on?.("download:progress", cb); },
    };
  }
  return null;
}

const backend = makeBackend();

export function downloadsSupported(): boolean {
  return backend != null;
}

export function downloadId(animeId: number, episode: number): string {
  return `${animeId}:${episode}`;
}

// ── State + subscriptions ────────────────────────────────────────────────────

const state = new Map<string, DownloadItem>();
const subscribers = new Set<() => void>();
let initialized = false;

function emit() {
  for (const cb of subscribers) cb();
}

export function subscribeDownloads(cb: () => void): () => void {
  subscribers.add(cb);
  void ensureInit();
  return () => subscribers.delete(cb);
}

/** Snapshot of all downloads, keyed by id. */
export function getDownloads(): Map<string, DownloadItem> {
  return state;
}

export function getDownload(id: string): DownloadItem | undefined {
  return state.get(id);
}

async function ensureInit() {
  if (initialized || !backend) return;
  initialized = true;
  try {
    const { items } = await backend.list();
    for (const it of items) state.set(it.id, it);
    emit();
  } catch {
    /* ignore */
  }
  try {
    backend.onProgress((e) => {
      state.set(e.id, e);
      emit();
      // Wake the queue worker when an active download settles.
      if (e.status === "done" || e.status === "failed") tickQueue();
    });
  } catch {
    /* ignore */
  }
}

// ── Queue ────────────────────────────────────────────────────────────────────

interface QueueEntry {
  id: string;
  animeId: number;
  episode: number;
  title: string;
  coverUrl?: string | null;
  providerId: string;
  animeSession: string; // provider anime session
  episodeSession: string; // provider episode session/id
}

const queue: QueueEntry[] = [];
let activeId: string | null = null;

function pickBest(links: any[], providerId: string): any | null {
  if (!links?.length) return null;
  if (providerId === "anikoto") {
    const soft = links.find((l) => {
      try { return JSON.parse(l.id).subType === "soft"; } catch { return false; }
    });
    return soft ?? links[0];
  }
  // AnimePahe: highest resolution, preferring the non-dub (jpn) track.
  const qOf = (l: any) => parseInt(String(l.quality ?? "").replace(/[^0-9]/g, ""), 10) || 0;
  const isJpn = (l: any) => !String(l.audio ?? "").toLowerCase().includes("eng");
  let best = links[0];
  let bestScore = -1;
  for (const l of links) {
    const s = qOf(l) * 10 + (isJpn(l) ? 1 : 0);
    if (s > bestScore) { bestScore = s; best = l; }
  }
  return best;
}

function setLocal(item: Partial<DownloadItem> & { id: string }) {
  const prev = state.get(item.id);
  state.set(item.id, {
    status: "queued",
    progress: 0,
    animeId: 0,
    episode: 0,
    title: "",
    providerId: "animepahe",
    updatedAt: Date.now(),
    ...prev,
    ...item,
  } as DownloadItem);
  emit();
}

async function tickQueue() {
  if (!backend || activeId) return;
  const next = queue.shift();
  if (!next) return;
  activeId = next.id;
  setLocal({ ...next, status: "queued", progress: 0 });

  try {
    // Resolve the HLS URL just before downloading so the kwik token is fresh.
    const links = await window.api.pahe.links(next.providerId, next.episodeSession, next.animeSession);
    const best = pickBest(links, next.providerId);
    if (!best) throw new Error("No stream link found");
    const resolved = await window.api.pahe.resolve(next.providerId, best.id ?? best.kwik);
    if (!resolved?.url) throw new Error("Could not resolve stream URL");

    // Anikoto uses soft (separate) subtitles — save the English .vtt so downloads
    // are subtitled offline. AnimePahe is hard-subbed, so it has none.
    let subtitleUrl: string | null = null;
    const subs: any[] = (resolved as any).subtitles ?? [];
    if (subs.length) {
      const eng = subs.find((s) => /eng/i.test(s?.label ?? "")) ?? subs[0];
      subtitleUrl = eng?.file ?? null;
    }

    await backend.start({
      id: next.id,
      animeId: next.animeId,
      episode: next.episode,
      title: next.title,
      coverUrl: next.coverUrl,
      providerId: next.providerId,
      hlsUrl: resolved.url,
      referer: resolved.referer ?? null,
      animeSession: next.animeSession,
      episodeSession: next.episodeSession,
      subtitleUrl,
    });
    // The native `progress` listener drives status to done/failed, which calls
    // tickQueue() again. Clear the active marker once it settles.
    const settle = () => {
      const cur = state.get(next.id);
      if (cur && (cur.status === "done" || cur.status === "failed")) {
        if (activeId === next.id) { activeId = null; tickQueue(); }
        return;
      }
      setTimeout(settle, 1000);
    };
    settle();
  } catch (e: any) {
    setLocal({ id: next.id, status: "failed", error: e?.message ?? String(e) });
    activeId = null;
    tickQueue();
  }
}

/** Queue a single episode for download. Returns false if not supported/duplicate. */
export function enqueueDownload(entry: QueueEntry): boolean {
  if (!backend) return false;
  void ensureInit();
  const existing = state.get(entry.id);
  if (existing && (existing.status === "done" || existing.status === "downloading" || existing.status === "queued")) {
    return false;
  }
  if (queue.some((q) => q.id === entry.id)) return false;
  queue.push(entry);
  setLocal({ ...entry, status: "queued", progress: 0 });
  tickQueue();
  return true;
}

/** Queue up to `max` episodes at once (batch). Returns how many were queued. */
export function enqueueBatch(entries: QueueEntry[], max = 50): number {
  let n = 0;
  for (const e of entries) {
    if (n >= max) break;
    if (enqueueDownload(e)) n++;
  }
  return n;
}

export async function removeDownload(id: string): Promise<void> {
  if (!backend) return;
  // Drop from queue if still pending.
  const qi = queue.findIndex((q) => q.id === id);
  if (qi >= 0) queue.splice(qi, 1);
  try { await backend.remove(id); } catch { /* ignore */ }
  state.delete(id);
  if (activeId === id) { activeId = null; tickQueue(); }
  emit();
}

export async function getPlayUrl(id: string): Promise<string | null> {
  if (!backend) return null;
  try {
    const { url } = await backend.getPlayUrl(id);
    return url;
  } catch {
    return null;
  }
}

/** Read a local download file (used by the player's hls.js loader for anitrack-dl:// URLs). */
export async function readLocalFile(
  url: string,
  binary: boolean,
): Promise<{ data: string; status: number; binary: boolean }> {
  if (!backend) return { data: "", status: 404, binary };
  return backend.readFile({ url, binary });
}

export function isLocalDownloadUrl(url: string): boolean {
  return url.startsWith("anitrack-dl://");
}
