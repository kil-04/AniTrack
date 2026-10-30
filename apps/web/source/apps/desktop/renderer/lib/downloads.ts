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
import type { DownloadItem } from "../../../../packages/shared/types";
import {
  preferredStreamLinkIndex,
  providerClient,
  providerVariantPreference,
} from "./provider-api";
import type { StreamLink } from "../../../../packages/shared/provider-types";

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
  conservativeNetwork?: boolean;
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
  onRemoved?(cb: (id: string) => void): void;
  prepare?(): Promise<boolean>;
  /** Browser-only durable queue/lease. Native backends keep their existing API. */
  queue?(item: DownloadItem): Promise<{ ok: boolean }>;
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
      onRemoved: typeof dl.queue === "function" ? (cb) => { (window as any).api?.on?.("download:removed", cb); } : undefined,
      queue: typeof dl.queue === "function" ? (item) => dl.queue(item) : undefined,
      prepare: typeof dl.prepareSave === "function" ? () => dl.prepareSave() : undefined,
    };
  }
  return null;
}

const backend = makeBackend();

export function downloadsSupported(): boolean {
  return backend != null;
}

/** Older website tabs have no lease; their pending work must remain visible. */
export function hasLegacyPendingDownloads(items: readonly unknown[]): boolean {
  if (!backend?.queue) return false;
  return items.some((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as {webOwner?: string; status?: string; queued?: number; current?: string | null; currentId?: string | null; queuedIds?: unknown[]};
    return !row.webOwner && (row.status === "queued" || row.status === "downloading" ||
      (row.queued ?? 0) > 0 || !!row.current || !!row.currentId || !!row.queuedIds?.length);
  });
}

export function downloadId(animeId: number, episode: number): string {
  return `${animeId}:${episode}`;
}

// ── State + subscriptions ────────────────────────────────────────────────────

const state = new Map<string, DownloadItem>();
const subscribers = new Set<() => void>();
let initialization: Promise<void> | null = null;

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
  if (!backend) return;
  if (initialization) return initialization;
  initialization = (async () => {
    const observed = new Set<string>();
    try {
      backend.onProgress((e) => {
        observed.add(e.id);
        state.set(e.id, e);
        emit();
        if (e.status === "done" || e.status === "failed") void tickQueue();
      });
      backend.onRemoved?.((id) => {
        observed.add(id);
        generations.delete(id);
        jobs.delete(id);
        const pending = queue.findIndex(job => job.entry.id === id);
        if (pending >= 0) queue.splice(pending, 1);
        state.delete(id);
        if (activeId === id) activeId = null;
        emit();
        void tickQueue();
      });
    } catch { /* a list snapshot remains usable without events */ }
    try {
      const { items } = await backend.list();
      for (const item of items) if (!observed.has(item.id)) state.set(item.id, item);
      emit();
      // Only the browser backend persists unresolved work. Native queues keep
      // their existing lifecycle, while web jobs obtain fresh media on restart.
      if (backend.queue) for (const item of state.values()) {
        if (item.status !== "queued" || removing.has(item.id) || queue.some((job) => job.entry.id === item.id)) continue;
        const owned = item as DownloadItem & {webOwner?: string; webGeneration?: string};
        // A pre-lease tab may still own this work. Only modern durable queues
        // can be safely reclaimed after their tab's Web Lock has disappeared.
        if (!owned.webOwner || !owned.webGeneration) continue;
        const entry = retryEntry(item);
        if (entry) schedule(entry);
      }
    } catch { /* a new local queue can still be used when listing fails */ }
  })();
  return initialization;
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

interface QueueJob { entry: QueueEntry; token: symbol; ready: Promise<boolean> }
const queue: QueueJob[] = [];
const generations = new Map<string, symbol>();
const jobs = new Map<string, QueueJob>();
const removing = new Set<string>();
let activeId: string | null = null;
let starting = false;

function setLocal(item: Partial<DownloadItem> & { id: string }) {
  const prev = state.get(item.id);
  const next = {
    status: "queued",
    progress: 0,
    animeId: 0,
    episode: 0,
    title: "",
    providerId: "animepahe",
    updatedAt: Date.now(),
    ...prev,
    ...item,
  } as DownloadItem;
  state.set(item.id, next);
  emit();
  return next;
}

function retryEntry(item: DownloadItem): QueueEntry | null {
  if (!item.providerId || !item.animeSession || !item.episodeSession) return null;
  return { id: item.id, animeId: item.animeId, episode: item.episode, title: item.title,
    coverUrl: item.coverUrl, providerId: item.providerId, animeSession: item.animeSession,
    episodeSession: item.episodeSession };
}

function schedule(entry: QueueEntry) {
  // Invoke the folder picker in the user's click, before any asynchronous read.
  let preparation:Promise<{ok:boolean;error?:unknown}>;
  try {preparation=(backend?.prepare?.()??Promise.resolve(true)).then(ok=>({ok}),error=>({ok:false,error}));}
  catch(error){preparation=Promise.resolve({ok:false,error});}
  const token = Symbol(entry.id);
  const job: QueueJob = { entry, token, ready: Promise.resolve(false) };
  generations.set(entry.id, token);
  jobs.set(entry.id, job);
  queue.push(job);
  setLocal({ ...entry, status: "queued", progress: 0, error: undefined });
  job.ready = ensureInit().then(async () => {
    const destination=await preparation;
    if(destination.error)throw destination.error;
    if(!destination.ok){jobs.delete(entry.id);state.delete(entry.id);emit();return false;}
    if (generations.get(entry.id) !== token) return false;
    const existing = state.get(entry.id);
    if (existing?.status === "done" || existing?.status === "downloading") return false;
    const row = setLocal({ ...entry, status: "queued", progress: 0, error: undefined, updatedAt: Date.now() });
    if (!backend?.queue) return true;
    const claimed = await backend.queue(row);
    if (!claimed.ok) {
      // Show the authoritative state when another tab already owns the job.
      const saved = (await backend.list()).items.find((item) => item.id === entry.id);
      if (saved) { state.set(saved.id, saved); emit(); }
      return false;
    }
    return generations.get(entry.id) === token;
  }).catch(async (error) => {
    if (generations.get(entry.id) === token) {
      const failed = setLocal({ id: entry.id, status: "failed", error: error instanceof Error ? error.message : "Couldn't save the download queue." });
      try { await backend?.queue?.(failed); } catch { /* the visible error remains */ }
    }
    return false;
  });
  void job.ready.then(() => tickQueue());
}

async function tickQueue() {
  if (!backend || activeId || starting) return;
  starting = true;
  await ensureInit();
  const job = queue.shift();
  starting = false;
  if (!job) return;
  const next = job.entry;
  activeId = next.id;
  const current = () => activeId === next.id && generations.get(next.id) === job.token;
  const release = () => {
    if (!current()) return;
    generations.delete(next.id);
    if (jobs.get(next.id) === job) jobs.delete(next.id);
    activeId = null;
    void tickQueue();
  };

  try {
    if (!await job.ready || !current()) { release(); return; }
    // Resolve the HLS URL just before downloading so the kwik token is fresh.
    const [links, descriptors] = await Promise.all([
      providerClient.links(next.providerId, next.episodeSession, next.animeSession),
      providerClient.list(),
    ]);
    if (!current()) return;
    const descriptor = descriptors.find((item) => item.id === next.providerId);
    const bestIndex = preferredStreamLinkIndex(
      links as StreamLink[],
      descriptor,
      providerVariantPreference(next.providerId),
    );
    const best = bestIndex >= 0 ? links[bestIndex] : null;
    if (!best) throw new Error("No stream link found");
    const resolved = await providerClient.resolve(next.providerId, best.id);
    if (!current()) return;
    if (!resolved?.url) throw new Error("Could not resolve stream URL");
    if (resolved.hls === false) throw new Error("Choose an HLS server before downloading this episode.");

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
      conservativeNetwork: resolved.conservativeNetwork,
    });
    // The native `progress` listener drives status to done/failed, which calls
    // tickQueue() again. Clear the active marker once it settles. Capped: a
    // download stuck for 2h without settling releases the queue instead of
    // polling forever.
    let settleTries = 0;
    const settle = () => {
      if (!current()) return;
      const cur = state.get(next.id);
      if (cur && (cur.status === "done" || cur.status === "failed")) {
        release();
        return;
      }
      if (++settleTries > 7200) {
        const failed = setLocal({ id: next.id, status: "failed", error: "Download stalled" });
        void backend.queue?.(failed).catch(() => {});
        release();
        return;
      }
      setTimeout(settle, 1000);
    };
    settle();
  } catch (e: any) {
    if (!current()) return;
    const failed = setLocal({ id: next.id, status: "failed", error: e?.message ?? String(e), updatedAt: Date.now() });
    try { await backend.queue?.(failed); } catch { /* retain the failure in this tab */ }
    release();
  }
}

/** Queue a single episode for download. Returns false if not supported/duplicate. */
export function enqueueDownload(entry: QueueEntry): boolean {
  if (!backend || removing.has(entry.id)) return false;
  void ensureInit();
  const existing = state.get(entry.id);
  if (existing && (existing.status === "done" || existing.status === "downloading" || existing.status === "queued")) {
    return false;
  }
  if (queue.some((job) => job.entry.id === entry.id)) return false;
  schedule(entry);
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
  removing.add(id);
  const job = jobs.get(id);
  // Drop from queue if still pending.
  generations.delete(id);
  const qi = queue.findIndex((job) => job.entry.id === id);
  if (qi >= 0) queue.splice(qi, 1);
  try {
    // A slow durable claim must settle before removal, otherwise it could
    // recreate a queued row after the deletion already returned.
    await job?.ready;
    try { await backend.remove(id); } catch { /* ignore */ }
    state.delete(id);
    if (jobs.get(id) === job) jobs.delete(id);
    if (activeId === id) { activeId = null; void tickQueue(); }
    emit();
  } finally { removing.delete(id); }
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
