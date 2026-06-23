// MyAnimeList OAuth + list sync.
// MAL uses OAuth 2.0 with PKCE (plain code_challenge_method).
// Docs: https://myanimelist.net/apiconfig/references/api/v2
//
// Uses a shared public client ID (no secret required) with an in-app
// BrowserWindow to intercept the OAuth redirect.

import { BrowserWindow } from "electron";
import crypto from "node:crypto";
import { SimpleStore } from "./store";
import {
  clearDirty,
  getAnime,
  getAnimeByMalId,
  getDirtyEntries,
  getListEntry,
  setListEntry,
  upsertAnime,
} from "./db";
import { getByMalId } from "./anilist";
import type { MalAuthState, WatchStatus } from "../../shared/types";

// Default public MAL client (no secret needed — registered as "other" app type).
// Users can override with their own via Settings if this one is rate-limited or revoked.
const DEFAULT_MAL_CLIENT_ID = process.env.MAL_CLIENT_ID ?? "10093a3f9f0174b6b5577c40e9accdae";
const REDIRECT_URI = "https://malsync.moe/mal/oauth";
const AUTH_BASE = "https://myanimelist.net/v1/oauth2";
const API_BASE = "https://api.myanimelist.net/v2";

interface MalTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix ms
  username?: string;
}

interface StoreShape {
  malTokens?: MalTokens;
  pkceVerifier?: string;
  clientId?: string;
}

const store = new SimpleStore<StoreShape>("anitrack-auth");

function getClientId(): string {
  const custom = store.get("clientId");
  return custom && custom.trim() ? custom.trim() : DEFAULT_MAL_CLIENT_ID;
}

export function setMalClientId(id: string): { ok: boolean; usingCustom: boolean } {
  const trimmed = id.trim();
  if (trimmed) store.set("clientId", trimmed);
  else store.delete("clientId");
  return { ok: true, usingCustom: !!trimmed };
}

export function getMalClientInfo(): { usingCustom: boolean; clientId?: string } {
  const custom = store.get("clientId");
  return { usingCustom: !!custom, clientId: custom };
}

// MAL requires `plain` code_challenge_method. The verifier must be
// 43-128 chars of URL-safe characters — use the same set MALSync uses.
function makeVerifier(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let v = "";
  const bytes = crypto.randomBytes(50);
  for (const b of bytes) v += chars[b % chars.length];
  return v;
}

export function beginAuth(mainWindow: BrowserWindow): { ok: boolean; reason?: string } {
  const verifier = makeVerifier();
  store.set("pkceVerifier", verifier);

  const url =
    `${AUTH_BASE}/authorize?response_type=code` +
    `&client_id=${getClientId()}` +
    `&code_challenge=${verifier}` +
    `&code_challenge_method=plain` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  // Open an in-app BrowserWindow so we can intercept the redirect to
  // malsync.moe/mal/oauth without needing a localhost server or custom protocol.
  const authWin = new BrowserWindow({
    width: 500,
    height: 700,
    title: "Connect to MyAnimeList",
    autoHideMenuBar: true,
    parent: mainWindow,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  authWin.loadURL(url);

  // Intercept the redirect before the page even loads — MAL will redirect to
  // REDIRECT_URI?code=... and we grab the code right here.
  // Both events can fire for the same navigation; the `handled` latch keeps the
  // second firing from re-entering after the PKCE verifier is consumed (which
  // would surface a spurious "Missing PKCE verifier" error to the renderer).
  let handled = false;
  const onNav = (_e: unknown, navUrl: string) => {
    if (handled) return;
    if (navUrl.startsWith(REDIRECT_URI) && new URL(navUrl).searchParams.get("code")) {
      handled = true;
    }
    handleRedirect(navUrl, authWin, mainWindow);
  };
  authWin.webContents.on("will-navigate", onNav);
  // Also catch did-navigate in case will-navigate fires after load starts.
  authWin.webContents.on("did-navigate", onNav);

  // Auto-close after 10 minutes if the user abandons the flow.
  const timeout = setTimeout(() => authWin.destroy(), 10 * 60 * 1000);
  authWin.on("closed", () => clearTimeout(timeout));

  return { ok: true };
}

function handleRedirect(
  navUrl: string,
  authWin: BrowserWindow,
  mainWindow: BrowserWindow,
) {
  if (!navUrl.startsWith(REDIRECT_URI)) return;
  const code = new URL(navUrl).searchParams.get("code");
  if (!code) return;

  // We have the code — close the auth window immediately, then exchange.
  if (!authWin.isDestroyed()) authWin.destroy();

  const verifier = store.get("pkceVerifier");
  if (!verifier) {
    mainWindow.webContents.send("mal:auth-error", "Missing PKCE verifier — try again.");
    return;
  }
  store.delete("pkceVerifier");

  (async () => {
    try {
      const body = new URLSearchParams({
        client_id: getClientId(),
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      });
      const res = await fetch(`${AUTH_BASE}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok)
        throw new Error(`MAL token exchange failed: ${res.status} ${await res.text()}`);

      const j = await res.json() as any;
      const tokens: MalTokens = {
        access_token: j.access_token,
        refresh_token: j.refresh_token,
        expires_at: Date.now() + j.expires_in * 1000,
      };

      // Fetch username
      try {
        const me = await fetch(`${API_BASE}/users/@me`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (me.ok) {
          const meJ = await me.json() as any;
          tokens.username = meJ.name;
        }
      } catch { /* swallow */ }

      store.set("malTokens", tokens);
      mainWindow.webContents.send("mal:auth-complete", getState());
    } catch (e) {
      console.error("MAL token exchange error", e);
      mainWindow.webContents.send("mal:auth-error", (e as Error).message);
    }
  })();
}

// Kept for backward compat — no longer used by beginAuth but still exported.
export async function handleCallback(_url: string): Promise<void> {
  // No-op: auth is now handled inline in handleRedirect.
}

export function disconnect() {
  store.delete("malTokens");
}

export function getState(): MalAuthState {
  const t = store.get("malTokens");
  return {
    connected: !!t,
    username: t?.username ?? null,
    expiresAt: t?.expires_at ?? null,
  };
}

// Single-flight guard: the 30s flush timer and user-initiated calls can both
// trigger a refresh at the same moment. MAL rotates refresh tokens, so two
// concurrent refreshes race — the loser stores a revoked token and the user
// gets logged out. Share one in-flight refresh instead.
let _refreshing: Promise<string | null> | null = null;

async function refreshIfNeeded(): Promise<string | null> {
  const t = store.get("malTokens");
  if (!t) return null;
  if (Date.now() < t.expires_at - 60_000) return t.access_token;
  if (_refreshing) return _refreshing;
  _refreshing = doRefresh(t);
  try {
    return await _refreshing;
  } finally {
    _refreshing = null;
  }
}

async function doRefresh(t: MalTokens): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: getClientId(),
    grant_type: "refresh_token",
    refresh_token: t.refresh_token,
  });
  let res: Response;
  try {
    res = await fetch(`${AUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (e) {
    // Network error during refresh — don't invalidate tokens, just fail this call.
    console.warn("MAL refresh network error", e);
    return null;
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("MAL refresh failed", res.status, errBody);
    // 400/401 = refresh token invalid — clear so the user re-auths instead of
    // looping forever on a broken token.
    if (res.status === 400 || res.status === 401) {
      store.delete("malTokens");
    }
    return null;
  }
  const j = await res.json() as any;
  const tokens: MalTokens = {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + j.expires_in * 1000,
    username: t.username,
  };
  store.set("malTokens", tokens);
  return tokens.access_token;
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const token = await refreshIfNeeded();
  if (!token) throw new Error("Not authenticated with MAL");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

const MAL_STATUS_MAP: Record<string, WatchStatus> = {
  watching: "watching",
  completed: "completed",
  on_hold: "on_hold",
  dropped: "dropped",
  plan_to_watch: "plan_to_watch",
};

const TO_MAL_STATUS: Record<WatchStatus, string> = {
  watching: "watching",
  completed: "completed",
  on_hold: "on_hold",
  dropped: "dropped",
  plan_to_watch: "plan_to_watch",
};

// Pulls the user's full list from MAL and writes entries + anime metadata to local DB.
export async function pullList(
  onProgress?: (n: number) => void,
): Promise<{ imported: number }> {
  let url: string | null =
    "/users/@me/animelist?fields=list_status,num_episodes,my_list_status,main_picture,start_season,mean,status&limit=100&nsfw=true";
  let count = 0;
  while (url) {
    const res = await apiFetch(url);
    if (!res.ok)
      throw new Error(`MAL pull failed: ${res.status} ${await res.text()}`);
    const j = await res.json() as any;
    for (const item of j.data as any[]) {
      const node = item.node;
      const ls = item.list_status;
      // Resolve to AniList ID via MAL ID so we have rich metadata.
      let anime = getAnimeByMalId(node.id);
      if (!anime) {
        try {
          const remote = await getByMalId(node.id);
          if (remote) {
            upsertAnime(remote);
            anime = remote;
          }
        } catch (e) {
          console.warn("AniList lookup by MAL id failed", node.id, e);
        }
      }
      if (!anime) {
        // Fall back to MAL-only stub so list still imports.
        anime = {
          id: 1_000_000_000 + node.id, // pseudo-id outside AniList range
          malId: node.id,
          title: node.title,
          coverImage: node.main_picture?.large || node.main_picture?.medium || null,
          episodes: node.num_episodes ?? null,
          genres: [],
          studios: [],
        };
        upsertAnime(anime);
      }
      const status = MAL_STATUS_MAP[ls.status] ?? "plan_to_watch";
      setListEntry({
        animeId: anime.id,
        status,
        episodesWatched: ls.num_episodes_watched ?? 0,
        score: ls.score || null,
        updatedAt: Date.parse(ls.updated_at) || Date.now(),
      });
      count++;
      onProgress?.(count);
    }
    url = j.paging?.next
      ? j.paging.next.replace("https://api.myanimelist.net/v2", "")
      : null;
  }
  return { imported: count };
}

// Push one entry to MAL.
// startDate / finishDate are ISO date strings ("YYYY-MM-DD"). MAL only stores
// the date (not time) and accepts them as optional fields — sending them on
// the "first watched" and "completed" transitions keeps the timeline accurate.
async function pushOne(
  malId: number,
  status: WatchStatus,
  episodes: number,
  score?: number | null,
  startDate?: string,
  finishDate?: string,
) {
  const body = new URLSearchParams({
    status: TO_MAL_STATUS[status],
    num_watched_episodes: String(episodes),
  });
  if (score != null) body.set("score", String(Math.round(score)));
  if (startDate)  body.set("start_date",  startDate);
  if (finishDate) body.set("finish_date", finishDate);
  const res = await apiFetch(`/anime/${malId}/my_list_status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok)
    throw new Error(`MAL push failed: ${res.status} ${await res.text()}`);
}

// Drain all dirty entries to MAL. Called debounced from main process.
export async function flushDirty(): Promise<{ pushed: number; errors: number }> {
  const t = await refreshIfNeeded();
  if (!t) return { pushed: 0, errors: 0 };
  const dirty = getDirtyEntries();
  let pushed = 0,
    errors = 0;
  for (const e of dirty) {
    const row = getAnime(e.animeId);
    if (!row?.malId) {
      // No MAL ID yet — could still be resolving via fire-and-forget AniList lookup.
      // Skip (don't clear) so we retry on the next flush cycle.
      // Entries under stub/negative IDs that never resolve are harmless — they just
      // stay dirty until overwritten by a migrated real-ID entry.
      continue;
    }
    try {
      await pushOne(row.malId, e.status, e.episodesWatched, e.score);
      clearDirty(e.animeId);
      pushed++;
    } catch (err) {
      console.warn("MAL push error", err);
      errors++;
    }
  }
  return { pushed, errors };
}

// Convenience: called by player after a watch threshold is crossed.
export async function markEpisodeWatched(animeId: number, episode: number) {
  const anime = getAnime(animeId);
  if (!anime) return;
  const existing = getListEntry(animeId);
  const totalEps = anime.episodes ?? Infinity;
  const newEps = Math.max(episode, existing?.episodesWatched ?? 0);
  // Compute new status, but respect explicit user choices:
  // - "dropped" stays dropped (user explicitly stopped — don't reactivate)
  // - completed series stays completed
  const computed: WatchStatus = newEps >= totalEps ? "completed" : "watching";
  const status: WatchStatus =
    existing?.status === "dropped" ? "dropped" : computed;

  // Detect start / finish transitions so we can send dates to MAL.
  const wasUnstarted = !existing || existing.status === "plan_to_watch";
  const isFirstEpisode = episode === 1 && (existing?.episodesWatched ?? 0) === 0;
  const isStarting = wasUnstarted && isFirstEpisode;
  const isCompleting = status === "completed" && existing?.status !== "completed";

  setListEntry(
    {
      animeId,
      status,
      episodesWatched: newEps,
      score: existing?.score ?? null,
      updatedAt: Date.now(),
    },
    { markDirty: true },
  );

  // If a date-carrying transition happened, fire an immediate push so MAL
  // records the correct start/finish date. The regular dirty flush 30s later
  // will send the same entry without dates — MAL PATCH ignores omitted fields,
  // so the dates we just sent are preserved.
  if ((isStarting || isCompleting) && anime.malId) {
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    pushOne(
      anime.malId,
      status,
      newEps,
      existing?.score ?? null,
      isStarting   ? today : undefined,
      isCompleting ? today : undefined,
    ).catch((e) => console.warn("MAL date push failed", e));
  }
}
