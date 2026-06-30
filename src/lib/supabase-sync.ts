/**
 * Cross-device playback sync via Supabase REST API.
 * Config is stored in localStorage so it works identically on desktop and Android.
 * No SDK required — plain fetch against the Supabase REST endpoint.
 */

const URL_KEY    = "supabase_url";
const KEY_KEY    = "supabase_key";
const USERID_KEY = "supabase_user_id";

export interface SyncConfig {
  url: string;
  key: string;
  userId: string;
}

export function getSyncConfig(): SyncConfig | null {
  const url    = localStorage.getItem(URL_KEY);
  const key    = localStorage.getItem(KEY_KEY);
  const userId = localStorage.getItem(USERID_KEY);
  if (!url || !key || !userId) return null;
  return { url: url.replace(/\/$/, ""), key, userId };
}

export function setSyncConfig(cfg: Partial<SyncConfig>) {
  if (cfg.url !== undefined) localStorage.setItem(URL_KEY, cfg.url);
  if (cfg.key !== undefined) localStorage.setItem(KEY_KEY, cfg.key);
  if (cfg.userId !== undefined) localStorage.setItem(USERID_KEY, cfg.userId);

  if ((window as any).Capacitor?.isNativePlatform()) {
    const Settings = (window as any).Capacitor.Plugins.AniTrackSettings;
    if (Settings) {
      if (cfg.url !== undefined) Settings.set({ key: URL_KEY, value: cfg.url });
      if (cfg.key !== undefined) Settings.set({ key: KEY_KEY, value: cfg.key });
      if (cfg.userId !== undefined) Settings.set({ key: USERID_KEY, value: cfg.userId });
    }
  }
}

export function clearSyncConfig() {
  localStorage.removeItem(URL_KEY);
  localStorage.removeItem(KEY_KEY);
  localStorage.removeItem(USERID_KEY);

  if ((window as any).Capacitor?.isNativePlatform()) {
    const Settings = (window as any).Capacitor.Plugins.AniTrackSettings;
    if (Settings) {
      Settings.del({ key: URL_KEY });
      Settings.del({ key: KEY_KEY });
      Settings.del({ key: USERID_KEY });
    }
  }
}

function restHeaders(key: string) {
  return {
    apikey:         key,
    Authorization:  `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

// ── Push ─────────────────────────────────────────────────────────────────────

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

export async function pushProgress(p: PlaybackRow): Promise<void> {
  const cfg = getSyncConfig();
  if (!cfg) return;
  const row = {
    user_id:           cfg.userId,
    anime_id:          p.animeId,
    episode:           p.episode,
    position_sec:      p.positionSec,
    duration_sec:      p.durationSec,
    anime_title:       p.animeTitle ?? null,
    anime_cover_url:   p.animeCoverUrl ?? null,
    animepahe_session: p.animePaheSession ?? null,
    updated_at:        p.updatedAt,
  };
  await fetch(`${cfg.url}/rest/v1/sync_playback`, {
    method:  "POST",
    headers: { ...restHeaders(cfg.key), Prefer: "resolution=merge-duplicates" },
    body:    JSON.stringify(row),
  }).catch(() => {});
}

// ── Push all local continue-watching records (one-time seed) ─────────────────

export async function pushAllProgress(): Promise<number> {
  const cfg = getSyncConfig();
  if (!cfg) return 0;

  // Grab every continue-watching entry from the local DB (large page = all).
  const paged = await window.api.list.continueWatchingPaged(1, 10000).catch(() => ({ items: [] }));
  const items: any[] = (paged as any).items ?? paged;
  if (!items.length) return 0;

  const rows = items.map((item: any) => ({
    user_id:           cfg.userId,
    anime_id:          item.anime?.id,
    episode:           item.episode,
    position_sec:      item.positionSec,
    duration_sec:      item.durationSec,
    anime_title:       item.anime?.title  ?? null,
    anime_cover_url:   item.anime?.coverImage ?? null,
    animepahe_session: item.animePaheSession ?? null,
    updated_at:        item.updatedAt ?? Date.now(),
  })).filter((r: any) => r.anime_id != null);

  const res = await fetch(`${cfg.url}/rest/v1/sync_playback`, {
    method:  "POST",
    headers: { ...restHeaders(cfg.key), Prefer: "resolution=merge-duplicates" },
    body:    JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase ${res.status}: ${body}`);
  }
  return rows.length;
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteAnimeProgress(animeId: number): Promise<void> {
  const cfg = getSyncConfig();
  if (!cfg) return;
  await fetch(
    `${cfg.url}/rest/v1/sync_playback?user_id=eq.${encodeURIComponent(cfg.userId)}&anime_id=eq.${animeId}`,
    { method: "DELETE", headers: restHeaders(cfg.key) },
  ).catch(() => {});
}

// ── Targeted pull (freshest position for one episode) ────────────────────────

/**
 * Fetch the cloud playback row for a single anime+episode, if any. Used right
 * before resuming so the position always reflects the other device — even if it
 * was watched after this device launched (the app-start pullAndMerge missed it).
 */
export async function pullRemoteProgress(
  animeId: number,
  episode: number,
): Promise<PlaybackRow | null> {
  const cfg = getSyncConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/sync_playback?user_id=eq.${encodeURIComponent(cfg.userId)}` +
        `&anime_id=eq.${animeId}&episode=eq.${episode}&select=*&limit=1`,
      { headers: restHeaders(cfg.key) },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows?.length) return null;
    const r = rows[0];
    return {
      animeId:          r.anime_id,
      episode:          r.episode,
      positionSec:      r.position_sec,
      durationSec:      r.duration_sec,
      animeTitle:       r.anime_title ?? undefined,
      animeCoverUrl:    r.anime_cover_url ?? undefined,
      animePaheSession: r.animepahe_session ?? undefined,
      updatedAt:        r.updated_at,
    };
  } catch {
    return null;
  }
}

// ── Pull & merge ──────────────────────────────────────────────────────────────

export async function pullAndMerge(): Promise<number> {
  const cfg = getSyncConfig();
  if (!cfg) return 0;

  let rows: any[];
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/sync_playback?user_id=eq.${encodeURIComponent(cfg.userId)}&select=*`,
      { headers: restHeaders(cfg.key) },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Supabase ${res.status}: ${body}`);
    }
    rows = await res.json();
  } catch (e) {
    throw e;
  }

  // Run all merges in parallel — each calls into IPC/native which serializes safely,
  // but pipelining the I/O cuts wall time roughly in half for large lists.
  const results = await Promise.allSettled(rows.map(async (r) => {
    const local = await window.api.progress
      .get(r.anime_id, r.episode)
      .catch(() => null);
    if (local && local.updatedAt >= r.updated_at) return false;
    await window.api.progress.set({
      animeId:          r.anime_id,
      episode:          r.episode,
      positionSec:      r.position_sec,
      durationSec:      r.duration_sec,
      animeTitle:       r.anime_title  ?? undefined,
      animeCoverUrl:    r.anime_cover_url ?? undefined,
      animePaheSession: r.animepahe_session ?? undefined,
      updatedAt:        r.updated_at,
    });
    return true;
  }));
  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}
