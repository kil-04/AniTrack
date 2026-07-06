/**
 * Cross-device playback sync via a private GitHub Gist.
 *
 * Solo-user friendly: paste a GitHub personal-access-token (scope: `gist`) on each
 * device — the gist is auto-discovered (or created) per account, so there's no
 * project to maintain and nothing expires. Stores all continue-watching rows as a
 * single JSON file and merges last-write-wins by `updatedAt`.
 *
 * (File name kept as supabase-sync.ts so existing imports don't change; the export
 *  names are backend-neutral.)
 */

const TOKEN_KEY = "gist_token";
const GISTID_KEY = "gist_id";
const GIST_FILE = "anitrack-sync.json";
const GIST_DESC = "AniTrack cross-device sync";

export interface SyncConfig {
  token: string;
  gistId: string;
}

export function getSyncConfig(): SyncConfig | null {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  return { token, gistId: localStorage.getItem(GISTID_KEY) ?? "" };
}

export function setSyncConfig(cfg: Partial<SyncConfig>) {
  if (cfg.token !== undefined) localStorage.setItem(TOKEN_KEY, cfg.token);
  if (cfg.gistId !== undefined) localStorage.setItem(GISTID_KEY, cfg.gistId);

  if ((window as any).Capacitor?.isNativePlatform?.()) {
    const Settings = (window as any).Capacitor.Plugins.AniTrackSettings;
    if (Settings) {
      if (cfg.token !== undefined) Settings.set({ key: TOKEN_KEY, value: cfg.token });
      if (cfg.gistId !== undefined) Settings.set({ key: GISTID_KEY, value: cfg.gistId });
    }
  }
}

export function clearSyncConfig() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(GISTID_KEY);
  cache = {};
  cacheLoaded = false;
  cacheAt = 0;
  dirty.clear();
  if ((window as any).Capacitor?.isNativePlatform?.()) {
    const Settings = (window as any).Capacitor.Plugins.AniTrackSettings;
    if (Settings) { Settings.del({ key: TOKEN_KEY }); Settings.del({ key: GISTID_KEY }); }
  }
}

export interface PlaybackRow {
  animeId: number;
  episode: number;
  positionSec: number;
  durationSec: number;
  animeTitle?: string;
  animeCoverUrl?: string;
  animePaheSession?: string;
  updatedAt: number;
}

function ghHeaders(token: string) {
  return {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
}

const GH = "https://api.github.com";

// ── Gist storage ──────────────────────────────────────────────────────────────

let cache: Record<string, PlaybackRow> = {};
let cacheLoaded = false;
let cacheAt = 0; // when the cache last saw the remote gist
const CACHE_STALE_MS = 60_000;
const dirty = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function rowKey(animeId: number, episode: number) {
  return `${animeId}:${episode}`;
}

/** Fold remote rows into the cache, keeping whichever side is newer per key.
 *  Never blindly replaces the cache — un-flushed local rows must survive. */
function mergeRemoteIntoCache(remote: Record<string, PlaybackRow>) {
  for (const [k, v] of Object.entries(remote)) {
    if (!cache[k] || (v.updatedAt ?? 0) > (cache[k].updatedAt ?? 0)) cache[k] = v;
  }
  cacheLoaded = true;
  cacheAt = Date.now();
}

/** Resolve (or auto-discover / create) the gist id for this token. */
async function ensureGistId(cfg: SyncConfig): Promise<string | null> {
  if (cfg.gistId) return cfg.gistId;
  try {
    // Reuse an existing AniTrack gist on this account if there is one.
    const list = await fetch(`${GH}/gists?per_page=100`, { headers: ghHeaders(cfg.token) });
    if (list.ok) {
      const gists = (await list.json()) as any[];
      const found = gists.find((g) => g?.files && g.files[GIST_FILE]);
      if (found?.id) { setSyncConfig({ gistId: found.id }); return found.id; }
    }
    // Otherwise create a fresh private gist.
    const created = await fetch(`${GH}/gists`, {
      method: "POST",
      headers: ghHeaders(cfg.token),
      body: JSON.stringify({
        description: GIST_DESC,
        public: false,
        files: { [GIST_FILE]: { content: JSON.stringify({ playback: {} }) } },
      }),
    });
    if (!created.ok) return null;
    const j = (await created.json()) as any;
    if (j?.id) { setSyncConfig({ gistId: j.id }); return j.id; }
  } catch {
    /* network error */
  }
  return null;
}

async function loadRemote(cfg: SyncConfig, gistId: string): Promise<Record<string, PlaybackRow>> {
  try {
    const res = await fetch(`${GH}/gists/${gistId}`, { headers: ghHeaders(cfg.token) });
    if (!res.ok) return {};
    const j = (await res.json()) as any;
    const file = j?.files?.[GIST_FILE];
    if (!file) return {};
    let content: string = file.content ?? "";
    if (file.truncated && file.raw_url) {
      content = await fetch(file.raw_url, { headers: ghHeaders(cfg.token) }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    }
    if (!content) return {};
    const parsed = JSON.parse(content);
    return (parsed?.playback ?? {}) as Record<string, PlaybackRow>;
  } catch {
    return {};
  }
}

async function writeGist(
  cfg: SyncConfig,
  gistId: string,
  data: Record<string, PlaybackRow>,
  keepalive = false,
): Promise<boolean> {
  const res = await fetch(`${GH}/gists/${gistId}`, {
    method: "PATCH",
    headers: ghHeaders(cfg.token),
    body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify({ playback: data }) } } }),
    keepalive,
  });
  return res.ok;
}

async function ensureCacheLoaded(cfg: SyncConfig, gistId: string) {
  if (cacheLoaded) return;
  mergeRemoteIntoCache(await loadRemote(cfg, gistId));
}

// Merge the cache up to the gist, folding in anything the other device wrote since.
async function flush() {
  flushTimer = null;
  if (!dirty.size) return;
  const cfg = getSyncConfig();
  if (!cfg) return;
  const gistId = await ensureGistId(cfg);
  if (!gistId) return;
  const flushed = Array.from(dirty);
  dirty.clear();
  try {
    mergeRemoteIntoCache(await loadRemote(cfg, gistId));
    await writeGist(cfg, gistId, cache);
  } catch {
    // Restore the un-flushed keys so the next push retries them — clearing
    // them on failure silently dropped progress until the next reconcile.
    for (const k of flushed) dirty.add(k);
  }
}

function scheduleFlush() {
  if (flushTimer) return; // batch rapid 10s saves into one write
  flushTimer = setTimeout(flush, 7000);
}

// Last-chance flush when the app/window is closing: the debounce above would
// otherwise drop the final position (e.g. quit right after pausing). keepalive
// lets the PATCH outlive the page. No GET-merge here — there's no time; the
// regular flush path re-merges on next launch anyway.
// Exported so the player can invoke it AFTER its own final save — module-level
// listeners registered here fire BEFORE the player's, which would otherwise
// flush just before the last position lands in the cache.
export function flushOnQuit() {
  if (!dirty.size) return;
  const cfg = getSyncConfig();
  if (!cfg?.gistId) return;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  dirty.clear();
  void writeGist(cfg, cfg.gistId, cache, true).catch(() => {});
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushOnQuit);
  window.addEventListener("beforeunload", flushOnQuit);
}

// ── Public API (backend-neutral names) ────────────────────────────────────────

export async function pushProgress(p: PlaybackRow): Promise<void> {
  if (!getSyncConfig()) return;
  const key = rowKey(p.animeId, p.episode);
  const prev = cache[key];
  if (!prev || (p.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) cache[key] = p;
  dirty.add(key);
  scheduleFlush();
}

/** One-shot seed: push every local continue-watching row to the gist. */
export async function pushAllProgress(): Promise<number> {
  const cfg = getSyncConfig();
  if (!cfg) return 0;
  const gistId = await ensureGistId(cfg);
  if (!gistId) throw new Error("Could not create or find the sync gist (check the token's 'gist' scope).");
  await ensureCacheLoaded(cfg, gistId);

  const paged = await window.api.list.continueWatchingPaged(1, 10000).catch(() => ({ items: [] }));
  const items: any[] = (paged as any).items ?? paged;
  let n = 0;
  for (const item of items) {
    const row = localItemToRow(item);
    if (!row) continue;
    cache[rowKey(row.animeId, row.episode)] = row;
    n++;
  }
  cacheLoaded = true;
  const ok = await writeGist(cfg, gistId, cache);
  if (!ok) throw new Error("Failed to write to the gist.");
  cacheAt = Date.now();
  return n;
}

export async function deleteAnimeProgress(animeId: number): Promise<void> {
  const cfg = getSyncConfig();
  if (!cfg) return;
  const gistId = await ensureGistId(cfg);
  if (!gistId) return;
  await ensureCacheLoaded(cfg, gistId);
  let changed = false;
  for (const k of Object.keys(cache)) {
    if (k.startsWith(`${animeId}:`)) { delete cache[k]; dirty.delete(k); changed = true; }
  }
  if (changed) { try { await writeGist(cfg, gistId, cache); } catch { /* ignore */ } }
}

/** Freshest cloud position for one episode (used for pull-before-resume).
 *  Refetches the gist when the cache is older than a minute, so a long-open
 *  app still resumes from where the *other* device just left off. */
export async function pullRemoteProgress(animeId: number, episode: number): Promise<PlaybackRow | null> {
  const cfg = getSyncConfig();
  if (!cfg) return null;
  const gistId = await ensureGistId(cfg);
  if (!gistId) return null;
  if (!cacheLoaded || Date.now() - cacheAt > CACHE_STALE_MS) {
    mergeRemoteIntoCache(await loadRemote(cfg, gistId));
  }
  return cache[rowKey(animeId, episode)] ?? null;
}

function localItemToRow(item: any): PlaybackRow | null {
  const animeId = item?.anime?.id;
  if (animeId == null) return null;
  // NEVER fabricate a timestamp. Defaulting to Date.now() here once re-stamped
  // every gist row on each sync, flattening the continue-watching order across
  // devices. A row without a real watch time simply doesn't get pushed.
  if (item.updatedAt == null) return null;
  return {
    animeId,
    episode: item.episode,
    positionSec: item.positionSec,
    durationSec: item.durationSec,
    animeTitle: item.anime?.title ?? undefined,
    animeCoverUrl: item.anime?.coverImage ?? undefined,
    animePaheSession: item.animePaheSession ?? undefined,
    updatedAt: item.updatedAt,
  };
}

let syncInFlight: Promise<number> | null = null;

/**
 * Two-way reconcile with the gist (auto-sync entry point — runs on app start,
 * window focus, and every Continue-Watching refresh):
 *  - remote rows newer than local → written into the local DB
 *  - local rows newer than (or missing from) remote → PATCHed up to the gist
 * Auto-discovers/creates the gist, so a fresh device only needs the token.
 * Returns how many rows were pulled into the local DB.
 */
export async function pullAndMerge(): Promise<number> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const cfg = getSyncConfig();
    if (!cfg) return 0;
    const gistId = await ensureGistId(cfg);
    if (!gistId) return 0;
    const remote = await loadRemote(cfg, gistId);
    mergeRemoteIntoCache(remote);

    // Pull: remote rows that are newer than the local DB.
    const results = await Promise.allSettled(
      Object.values(remote).map(async (r) => {
        const local = await window.api.progress.get(r.animeId, r.episode).catch(() => null);
        if (local && local.updatedAt >= r.updatedAt) return false;
        await window.api.progress.set({
          animeId: r.animeId,
          episode: r.episode,
          positionSec: r.positionSec,
          durationSec: r.durationSec,
          animeTitle: r.animeTitle ?? undefined,
          animeCoverUrl: r.animeCoverUrl ?? undefined,
          animePaheSession: r.animePaheSession ?? undefined,
          updatedAt: r.updatedAt,
        });
        return true;
      }),
    );

    // Push back: local rows the gist is missing or has stale (covers progress
    // made while offline, or an app killed before the debounced flush ran).
    try {
      const paged = await window.api.list.continueWatchingPaged(1, 10000).catch(() => ({ items: [] }));
      const items: any[] = (paged as any).items ?? paged;
      let needWrite = false;
      for (const item of items) {
        const row = localItemToRow(item);
        if (!row) continue;
        const key = rowKey(row.animeId, row.episode);
        if (!cache[key] || (row.updatedAt ?? 0) > (cache[key].updatedAt ?? 0)) {
          cache[key] = row;
          needWrite = true;
        }
      }
      if (needWrite) await writeGist(cfg, gistId, cache);
    } catch {
      /* push-back is best-effort; the debounced flush will catch up */
    }

    return results.filter((r) => r.status === "fulfilled" && r.value).length;
  })().finally(() => { syncInFlight = null; });
  return syncInFlight;
}
