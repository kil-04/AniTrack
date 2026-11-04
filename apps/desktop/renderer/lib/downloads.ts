/**
 * Offline downloads (Android only).
 *
 * The native `AniTrackDownloader` plugin downloads a resolved HLS stream (playlist
 * + segments + keys) to disk and serves it back for in-app playback via an
 * `anitrack-dl://` URL. The JS side here owns the *queue*: it resolves each
 * episode's HLS URL just-in-time (kwik URLs expire fast) and feeds one download
 * at a time to native, so a 50-episode batch stays fresh and doesn't hammer the
 * CDN. State is mirrored to subscribers for the UI.
 *
 * Resuming: a download that stops with its files kept carries a `resume` hint.
 * The queue starts it again, with a freshly resolved stream: at once when the
 * stream expired or the app restarted, when the network is back, or once a
 * rate limit's wait is over. The downloader then keeps the pieces it already has.
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
  resolvedAt?: number;
  reResolves?: number;
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
    // Unfinished downloads from before the app was closed carry on now.
    // (In reverse, as each one goes to the front of the queue: they keep their order.)
    for (const it of [...items].reverse()) if (it.resume) scheduleResume(it, true);
  } catch {
    /* ignore */
  }
  try {
    backend.onProgress((e) => {
      state.set(e.id, e);
      emit();
      if (e.resume) scheduleResume(e, false);
      // Wake the queue worker when an active download settles.
      if (e.status === "done" || e.status === "failed" || e.resume) tickQueue();
    });
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", resumeNetworkWaiters);
    // `online` isn't fired for every kind of reconnect (Wi-Fi to Wi-Fi, a VPN, waking up).
    setInterval(() => { if (navigator.onLine !== false) resumeNetworkWaiters(); }, NETWORK_RECHECK_MS);
  }
}

// ── Resuming ─────────────────────────────────────────────────────────────────

const NETWORK_RECHECK_MS = 60_000;
const resumeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const waitingForNetwork = new Set<string>();
/** Rate-limited: no episode starts before this (the CDN is shared by the batch). */
let holdUntil = 0;

/** What a paused download is waiting for, for the Downloads page. */
export function resumeLabel(item: DownloadItem): string | null {
  const reason = item.resume?.reason;
  if (!reason || item.status !== "queued") return null;
  const pct = item.progress > 0 ? ` · ${item.progress}% saved` : "";
  if (reason === "network") return `Waiting for the network${pct}`;
  if (reason === "rate-limit" || reason === "server") {
    const minutes = item.resume?.at ? Math.max(1, Math.ceil((item.resume.at - Date.now()) / 60_000)) : null;
    const wait = minutes ? ` (about ${minutes} min)` : "";
    return `${reason === "rate-limit" ? "The server asked to wait" : "The server is busy"}${wait}${pct}`;
  }
  return `Continuing${pct}`;
}

function scheduleResume(item: DownloadItem, afterRestart: boolean) {
  const hint = item.resume;
  if (!hint) return;
  clearTimeout(resumeTimers.get(item.id));
  resumeTimers.delete(item.id);
  waitingForNetwork.delete(item.id);
  const at = hint.at ?? 0;
  if ((hint.reason === "rate-limit" || hint.reason === "server") && at > Date.now()) {
    holdUntil = Math.max(holdUntil, at);
    resumeTimers.set(item.id, setTimeout(() => { resumeTimers.delete(item.id); resumeEntry(item.id); }, at - Date.now()));
  } else if (hint.reason === "network" && !afterRestart) {
    waitingForNetwork.add(item.id);
    if (navigator.onLine !== false) {
      resumeTimers.set(item.id, setTimeout(() => { resumeTimers.delete(item.id); resumeNetworkWaiters(); }, NETWORK_RECHECK_MS));
    }
  } else {
    resumeEntry(item.id);
  }
}

function resumeNetworkWaiters() {
  for (const id of [...waitingForNetwork]) {
    waitingForNetwork.delete(id);
    clearTimeout(resumeTimers.get(id));
    resumeTimers.delete(id);
    resumeEntry(id);
  }
}

/** Puts a paused download back at the front of the queue. */
function resumeEntry(id: string) {
  const item = state.get(id);
  if (!item?.resume || item.status !== "queued" || activeId === id || queue.some((q) => q.id === id)) return;
  if (!item.animeSession || !item.episodeSession) {
    setLocal({ id, status: "failed", resume: undefined, error: "Download was interrupted. Retry to continue." });
    return;
  }
  queue.unshift({
    id, animeId: item.animeId, episode: item.episode, title: item.title, coverUrl: item.coverUrl ?? null,
    providerId: item.providerId, animeSession: item.animeSession, episodeSession: item.episodeSession,
    reResolves: item.resume.reResolves ?? 0,
  });
  tickQueue();
}

function clearResume(id: string) {
  clearTimeout(resumeTimers.get(id));
  resumeTimers.delete(id);
  waitingForNetwork.delete(id);
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
  /** Fresh streams already fetched for a resumed download without progress. */
  reResolves?: number;
}

const queue: QueueEntry[] = [];
let activeId: string | null = null;

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

let holdTimer: ReturnType<typeof setTimeout> | null = null;

async function tickQueue() {
  if (!backend || activeId) return;
  if (Date.now() < holdUntil) {
    if (!holdTimer) holdTimer = setTimeout(() => { holdTimer = null; tickQueue(); }, holdUntil - Date.now());
    return;
  }
  const next = queue.shift();
  if (!next) return;
  activeId = next.id;
  clearResume(next.id);
  const { reResolves, ...entry } = next;
  const kept = state.get(next.id)?.progress ?? 0;
  setLocal({ ...entry, status: "queued", progress: kept, resume: undefined, error: undefined });

  try {
    // Resolve the HLS URL just before downloading so the kwik token is fresh.
    const [links, descriptors] = await Promise.all([
      providerClient.links(next.providerId, next.episodeSession, next.animeSession),
      providerClient.list(),
    ]);
    const descriptor = descriptors.find((item) => item.id === next.providerId);
    const bestIndex = preferredStreamLinkIndex(
      links as StreamLink[],
      descriptor,
      providerVariantPreference(next.providerId),
    );
    const best = bestIndex >= 0 ? links[bestIndex] : null;
    if (!best) throw new Error("No stream link found");
    const resolved = await providerClient.resolve(next.providerId, best.id);
    const resolvedAt = Date.now();
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
      resolvedAt,
      reResolves: reResolves ?? 0,
    });
    // The native `progress` listener drives status to done/failed (or a paused
    // state with a `resume` hint), which calls tickQueue() again. Clear the
    // active marker once it settles. Capped: a download stuck for 2h without
    // settling releases the queue instead of polling forever.
    let settleTries = 0;
    const settle = () => {
      const cur = state.get(next.id);
      if (!cur) { if (activeId === next.id) { activeId = null; tickQueue(); } return; }
      if (cur.status === "done" || cur.status === "failed" || cur.resume) {
        if (activeId === next.id) { activeId = null; tickQueue(); }
        return;
      }
      if (++settleTries > 7200) {
        setLocal({ id: next.id, status: "failed", error: "Download stalled" });
        if (activeId === next.id) { activeId = null; tickQueue(); }
        return;
      }
      setTimeout(settle, 1000);
    };
    settle();
  } catch (e: any) {
    if (typeof navigator !== "undefined" && navigator.onLine === false && state.get(next.id)?.progress) {
      // Offline while resolving a resumed download: wait for the network again.
      setLocal({ id: next.id, status: "queued", resume: { reason: "network", reResolves: reResolves ?? 0 } });
      scheduleResume(state.get(next.id)!, false);
    } else {
      setLocal({ id: next.id, status: "failed", error: e?.message ?? String(e) });
    }
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
    // Asking again for a paused download starts it now instead of waiting.
    if (existing.status === "queued" && existing.resume) { clearResume(entry.id); resumeEntry(entry.id); }
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
  clearResume(id);
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
