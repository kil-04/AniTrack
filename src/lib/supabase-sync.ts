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
  tombstones = {};
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
// Deletion tombstones: animeId -> when it was dismissed. Without these, the
// OTHER device's push-back re-uploads its local rows for a dismissed show and
// resurrects it in Continue Watching everywhere. A tombstone beats any row
// older than it; watching the show again (newer row) clears the tombstone.
let tombstones: Record<string, number> = {};
const TOMBSTONE_TTL = 90 * 24 * 3600 * 1000;
let cacheLoaded = false;
let cacheAt = 0; // when the cache last saw the remote gist
const CACHE_STALE_MS = 60_000;
const dirty = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_DEBOUNCE_MS = 7_000;
const FLUSH_RETRY_MAX_MS = 5 * 60_000;
let flushRetryMs = FLUSH_DEBOUNCE_MS;
let gistNetworkEnabled = true;

function applyAutomationStatus(value: unknown) {
  const next = (value as any)?.config?.features?.gistSync;
  if (typeof next !== "boolean") return;
  const wasEnabled = gistNetworkEnabled;
  gistNetworkEnabled = next;
  if (!wasEnabled && next && dirty.size) scheduleFlushRetry();
}

if (typeof window !== "undefined") {
  const api = window.api;
  void api?.automation?.status().then(applyAutomationStatus).catch(() => {});
  api?.on?.("automation:status", applyAutomationStatus);
}

function rowKey(animeId: number, episode: number) {
  return `${animeId}:${episode}`;
}

function tombstoneCovers(animeId: number | string, updatedAt: number | undefined): boolean {
  const ts = tombstones[String(animeId)];
  return ts != null && (updatedAt ?? 0) <= ts;
}

interface RemoteDoc {
  rows: Record<string, PlaybackRow>;
  deleted: Record<string, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRemoteDoc(document: unknown): RemoteDoc {
  if (!isRecord(document) || !isRecord(document.playback)) {
    throw new Error("The sync gist has an invalid playback document.");
  }

  const rows: Record<string, PlaybackRow> = {};
  for (const [key, value] of Object.entries(document.playback)) {
    if (
      !isRecord(value) ||
      typeof value.animeId !== "number" || !Number.isFinite(value.animeId) ||
      typeof value.episode !== "number" || !Number.isFinite(value.episode) ||
      typeof value.positionSec !== "number" || !Number.isFinite(value.positionSec) ||
      typeof value.durationSec !== "number" || !Number.isFinite(value.durationSec) ||
      typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) ||
      (value.animeTitle != null && typeof value.animeTitle !== "string") ||
      (value.animeCoverUrl != null && typeof value.animeCoverUrl !== "string") ||
      (value.animePaheSession != null && typeof value.animePaheSession !== "string")
    ) {
      throw new Error(`The sync gist contains an invalid playback row (${key}).`);
    }
    rows[key] = {
      animeId: value.animeId,
      episode: value.episode,
      positionSec: value.positionSec,
      durationSec: value.durationSec,
      updatedAt: value.updatedAt,
      animeTitle: typeof value.animeTitle === "string" ? value.animeTitle : undefined,
      animeCoverUrl: typeof value.animeCoverUrl === "string" ? value.animeCoverUrl : undefined,
      animePaheSession: typeof value.animePaheSession === "string" ? value.animePaheSession : undefined,
    };
  }

  const deletedValue = document.deleted;
  if (deletedValue != null && !isRecord(deletedValue)) {
    throw new Error("The sync gist has an invalid deletion map.");
  }
  const deleted: Record<string, number> = {};
  for (const [animeId, timestamp] of Object.entries(deletedValue ?? {})) {
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
      throw new Error(`The sync gist contains an invalid deletion (${animeId}).`);
    }
    deleted[animeId] = timestamp;
  }

  return { rows, deleted };
}

/** Fold remote rows + tombstones into the cache, keeping whichever side is
 *  newer per key. Never blindly replaces the cache — un-flushed local rows
 *  must survive. */
function mergeRemoteIntoCache(remote: RemoteDoc) {
  for (const [id, ts] of Object.entries(remote.deleted)) {
    if (!(id in tombstones) || ts > tombstones[id]) tombstones[id] = ts;
  }
  for (const [k, v] of Object.entries(remote.rows)) {
    if (tombstoneCovers(k.split(":")[0], v.updatedAt)) continue;
    if (!cache[k] || (v.updatedAt ?? 0) > (cache[k].updatedAt ?? 0)) cache[k] = v;
  }
  // Drop cached rows a (possibly newer) tombstone now covers.
  for (const k of Object.keys(cache)) {
    if (tombstoneCovers(k.split(":")[0], cache[k].updatedAt)) { delete cache[k]; dirty.delete(k); }
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

async function loadRemote(cfg: SyncConfig, gistId: string): Promise<RemoteDoc> {
  const res = await fetch(`${GH}/gists/${gistId}`, { headers: ghHeaders(cfg.token) });
  if (!res.ok) {
    throw new Error(`Could not read the sync gist (GitHub returned ${res.status}).`);
  }

  const payload: unknown = await res.json();
  if (!isRecord(payload) || !isRecord(payload.files)) {
    throw new Error("GitHub returned an invalid sync gist response.");
  }
  const file = payload.files[GIST_FILE];
  if (!isRecord(file)) {
    throw new Error(`The sync gist is missing ${GIST_FILE}.`);
  }

  let content = typeof file.content === "string" ? file.content : "";
  if (file.truncated === true) {
    if (typeof file.raw_url !== "string" || !file.raw_url) {
      throw new Error("The truncated sync gist has no raw download URL.");
    }
    const raw = await fetch(file.raw_url, { headers: ghHeaders(cfg.token) });
    if (!raw.ok) {
      throw new Error(`Could not read the full sync gist (GitHub returned ${raw.status}).`);
    }
    content = await raw.text();
  }
  if (!content.trim()) {
    throw new Error("The sync gist is empty.");
  }

  return parseRemoteDoc(JSON.parse(content));
}

async function writeGist(
  cfg: SyncConfig,
  gistId: string,
  data: Record<string, PlaybackRow>,
  keepalive = false,
): Promise<boolean> {
  // Prune ancient tombstones so the deleted map can't grow forever.
  const cutoff = Date.now() - TOMBSTONE_TTL;
  for (const [id, ts] of Object.entries(tombstones)) {
    if (ts < cutoff) delete tombstones[id];
  }
  const res = await fetch(`${GH}/gists/${gistId}`, {
    method: "PATCH",
    headers: ghHeaders(cfg.token),
    body: JSON.stringify({
      files: { [GIST_FILE]: { content: JSON.stringify({ playback: data, deleted: tombstones }) } },
    }),
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
  if (!gistNetworkEnabled) return;
  const cfg = getSyncConfig();
  if (!cfg) return;
  const gistId = await ensureGistId(cfg);
  if (!gistId) {
    scheduleFlushRetry();
    return;
  }
  const flushed = Array.from(dirty);
  dirty.clear();
  try {
    mergeRemoteIntoCache(await loadRemote(cfg, gistId));
    const ok = await writeGist(cfg, gistId, cache);
    if (!ok) throw new Error("GitHub rejected the sync gist update.");
    flushRetryMs = FLUSH_DEBOUNCE_MS;
  } catch {
    // Restore the un-flushed keys so the next push retries them — clearing
    // them on failure silently dropped progress until the next reconcile.
    for (const k of flushed) dirty.add(k);
    scheduleFlushRetry();
  }
}

function scheduleFlush(delay = FLUSH_DEBOUNCE_MS) {
  if (flushTimer) return; // batch rapid 10s saves into one write
  flushTimer = setTimeout(flush, delay);
}

function scheduleFlushRetry() {
  const delay = flushRetryMs;
  flushRetryMs = Math.min(flushRetryMs * 2, FLUSH_RETRY_MAX_MS);
  scheduleFlush(delay);
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
  if (!gistNetworkEnabled) return;
  const cfg = getSyncConfig();
  if (!cfg?.gistId) return;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const flushed = Array.from(dirty);
  dirty.clear();
  void writeGist(cfg, cfg.gistId, cache, true)
    .then((ok) => {
      if (!ok) throw new Error("GitHub rejected the sync gist update.");
      flushRetryMs = FLUSH_DEBOUNCE_MS;
    })
    .catch(() => {
      for (const k of flushed) dirty.add(k);
      scheduleFlushRetry();
    });
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushOnQuit);
  window.addEventListener("beforeunload", flushOnQuit);
}

// ── Public API (backend-neutral names) ────────────────────────────────────────

export async function pushProgress(p: PlaybackRow): Promise<void> {
  if (!getSyncConfig()) return;
  // Watching a previously-dismissed show again legitimately resurrects it.
  const t = tombstones[String(p.animeId)];
  if (t != null && (p.updatedAt ?? 0) > t) delete tombstones[String(p.animeId)];
  const key = rowKey(p.animeId, p.episode);
  const prev = cache[key];
  if (!prev || (p.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) cache[key] = p;
  dirty.add(key);
  scheduleFlush();
}

/** One-shot seed: push every local continue-watching row to the gist. */
export async function pushAllProgress(): Promise<number> {
  if (!gistNetworkEnabled) throw new Error("Gist sync is temporarily disabled by signed automation rules.");
  const cfg = getSyncConfig();
  if (!cfg) return 0;
  const gistId = await ensureGistId(cfg);
  if (!gistId) throw new Error("Could not create or find the sync gist (check the token's 'gist' scope).");
  await ensureCacheLoaded(cfg, gistId);

  const paged = await window.api.list.continueWatchingPaged(1, 10000).catch(() => ({ items: [] }));
  const items: any[] = (paged as any).items ?? paged;
  let n = 0;
  const pushedKeys: string[] = [];
  for (const item of items) {
    const row = localItemToRow(item);
    if (!row) continue;
    if (tombstoneCovers(row.animeId, row.updatedAt)) continue;
    const key = rowKey(row.animeId, row.episode);
    cache[key] = row;
    pushedKeys.push(key);
    n++;
  }
  cacheLoaded = true;
  try {
    const ok = await writeGist(cfg, gistId, cache);
    if (!ok) throw new Error("Failed to write to the gist.");
  } catch (error) {
    for (const key of pushedKeys) dirty.add(key);
    if (pushedKeys.length) scheduleFlushRetry();
    throw error;
  }
  flushRetryMs = FLUSH_DEBOUNCE_MS;
  cacheAt = Date.now();
  return n;
}

export async function deleteAnimeProgress(animeId: number): Promise<void> {
  const cfg = getSyncConfig();
  if (!cfg) return;
  // Tombstone FIRST — deleting the rows alone isn't durable: the other
  // device's push-back would re-upload its local copies and resurrect the
  // show. The tombstone tells every device "dismissed at T; ignore and drop
  // anything older".
  tombstones[String(animeId)] = Date.now();
  for (const k of Object.keys(cache)) {
    if (k.startsWith(`${animeId}:`)) { delete cache[k]; dirty.delete(k); }
  }
  const deleteKey = `deleted:${animeId}`;
  dirty.add(deleteKey);
  if (!gistNetworkEnabled) return;
  await flush();
}

/** Freshest cloud position for one episode (used for pull-before-resume).
 *  Refetches the gist when the cache is older than a minute, so a long-open
 *  app still resumes from where the *other* device just left off. */
export async function pullRemoteProgress(animeId: number, episode: number): Promise<PlaybackRow | null> {
  if (!gistNetworkEnabled) return null;
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
  if (!gistNetworkEnabled) return 0;
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const cfg = getSyncConfig();
    if (!cfg) return 0;
    const gistId = await ensureGistId(cfg);
    if (!gistId) return 0;
    const remote = await loadRemote(cfg, gistId);
    mergeRemoteIntoCache(remote);
    let changedLocal = 0;

    // Pull: remote rows that are newer than the local DB (tombstoned shows
    // are skipped — they were dismissed on some device).
    const results = await Promise.allSettled(
      Object.values(remote.rows)
        .filter((r) => !tombstoneCovers(r.animeId, r.updatedAt))
        .map(async (r) => {
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
    changedLocal += results.filter((r) => r.status === "fulfilled" && r.value).length;

    // Apply tombstones locally: a show dismissed on the other device gets
    // dismissed here too — unless it was watched here AFTER the dismissal.
    for (const [idStr, ts] of Object.entries(tombstones)) {
      const animeId = Number(idStr);
      if (!Number.isFinite(animeId)) continue;
      try {
        const rows = await window.api.progress.getForAnime(animeId);
        if (!rows.length) continue;
        const newest = Math.max(...rows.map((r: any) => r.updatedAt ?? 0));
        if (newest <= ts) {
          await window.api.list.dismissContinueWatching(animeId);
          changedLocal++;
        }
      } catch { /* best-effort */ }
    }

    // Push back: local rows the gist is missing or has stale (covers progress
    // made while offline, or an app killed before the debounced flush ran).
    // Tombstoned rows stay out — that's exactly how dismissed shows used to
    // resurrect themselves.
    const pushBackKeys: string[] = [];
    try {
      const paged = await window.api.list.continueWatchingPaged(1, 10000).catch(() => ({ items: [] }));
      const items: any[] = (paged as any).items ?? paged;
      let needWrite = false;
      for (const item of items) {
        const row = localItemToRow(item);
        if (!row) continue;
        if (tombstoneCovers(row.animeId, row.updatedAt)) continue;
        const key = rowKey(row.animeId, row.episode);
        if (!cache[key] || (row.updatedAt ?? 0) > (cache[key].updatedAt ?? 0)) {
          cache[key] = row;
          pushBackKeys.push(key);
          needWrite = true;
        }
      }
      if (needWrite) {
        const ok = await writeGist(cfg, gistId, cache);
        if (!ok) throw new Error("GitHub rejected the sync gist update.");
        flushRetryMs = FLUSH_DEBOUNCE_MS;
      }
    } catch {
      // The cache now contains these local rows, so mark them dirty explicitly;
      // otherwise the next reconcile would see its own cache and never retry.
      for (const key of pushBackKeys) dirty.add(key);
      if (pushBackKeys.length) scheduleFlushRetry();
    }

    return changedLocal;
  })().finally(() => { syncInFlight = null; });
  return syncInFlight;
}
