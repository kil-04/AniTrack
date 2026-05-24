/**
 * Capacitor shim for window.api — mirrors the Electron preload bridge exactly.
 *
 * On Android, Capacitor plugins (Kotlin) handle all native operations.
 * AniList queries go directly via fetch (public GraphQL API, no auth needed for search).
 * MAL OAuth uses @capacitor/browser for the in-app browser flow.
 * AnimePahe scraping + CF bypass is handled by AniTrackPahePlugin (hidden WebView).
 * SQLite is handled by AniTrackDbPlugin (native SQLite3).
 */

import { registerPlugin } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { ScreenOrientation } from "@capacitor/screen-orientation";

// ── Plugin interfaces ──────────────────────────────────────────────────────────

interface DbPlugin {
  getAll(): Promise<{ value: string }>;
  listSet(opts: { entry: string }): Promise<{ value: string }>;
  continueWatching(): Promise<{ value: string }>;
  continueWatchingPaged(opts: { page: number; pageSize: number }): Promise<{ value: string }>;
  dismissContinueWatching(opts: { animeId: number }): Promise<{ ok: boolean }>;
  progressGet(opts: { animeId: number; episode: number }): Promise<{ value: string | null }>;
  progressSet(opts: { progress: string }): Promise<{ ok: boolean }>;
  progressGetForAnime(opts: { animeId: number }): Promise<{ value: string }>;
}

interface PahePlugin {
  ensureSession(): Promise<{ ok: boolean }>;
  latest(opts: { page: number }): Promise<{ value: string }>;
  search(opts: { query: string }): Promise<{ value: string }>;
  episodes(opts: { session: string; page: number }): Promise<{ value: string }>;
  links(opts: { epSession: string; animeSession: string }): Promise<{ value: string }>;
  resolve(opts: { kwikUrl: string }): Promise<{ url: string; cookies: string }>;
  prefetch(opts: { kwikUrl: string }): Promise<{ ok: boolean }>;
  getIds(opts: { paheId: number; session: string }): Promise<{ value: string }>;
  findById(opts: { anilistId?: number; malId?: number }): Promise<{ value: string | null }>;
  getUrl(): Promise<{ url: string }>;
  setUrl(opts: { url: string }): Promise<{ ok: boolean; url: string; reason?: string }>;
  fetchUrl(opts: { url: string; binary?: boolean }): Promise<{ data: string; status: number; binary: boolean }>;
}

interface MalPlugin {
  beginAuth(opts: { clientId: string }): Promise<{ ok: boolean; reason?: string }>;
  getState(): Promise<{ value: string }>;
  disconnect(): Promise<{ value: string }>;
  pull(): Promise<{ imported: number }>;
  push(): Promise<{ pushed: number; errors: number }>;
  setClientId(opts: { clientId: string }): Promise<{ ok: boolean; usingCustom: boolean }>;
  clientInfo(): Promise<{ usingCustom: boolean; clientId?: string }>;
  addListener(event: string, handler: (data: unknown) => void): Promise<any>;
}

interface SettingsPlugin {
  get(opts: { key: string }): Promise<{ value: string | null }>;
  set(opts: { key: string; value: string }): Promise<{ ok: boolean }>;
  del(opts: { key: string }): Promise<{ ok: boolean }>;
}

const AniTrackDb = registerPlugin<DbPlugin>("AniTrackDb");
const AniTrackPahe = registerPlugin<PahePlugin>("AniTrackPahe");
const AniTrackMal = registerPlugin<MalPlugin>("AniTrackMal");
const AniTrackSettings = registerPlugin<SettingsPlugin>("AniTrackSettings");

// ── AniList GraphQL (direct fetch — public API) ────────────────────────────────

const ANILIST_GQL = "https://graphql.anilist.co";

async function alGql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ANILIST_GQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data as T;
}

const MEDIA_FIELDS = `
  id title { romaji english } coverImage { large } bannerImage
  episodes status season seasonYear averageScore genres description(asHtml: false)
  startDate { year month day } nextAiringEpisode { airingAt episode }
  studios(isMain: true) { nodes { name } }
`;

function mapMedia(m: any) {
  return {
    id: m.id,
    title: m.title?.english || m.title?.romaji || "Unknown",
    titleEnglish: m.title?.english ?? null,
    titleRomaji: m.title?.romaji ?? null,
    coverImage: m.coverImage?.large ?? null,
    bannerImage: m.bannerImage ?? null,
    episodes: m.episodes ?? null,
    status: m.status ?? null,
    synopsis: m.description ?? null,
    genres: m.genres ?? [],
    averageScore: m.averageScore ?? null,
    year: m.seasonYear ?? null,
    studios: m.studios?.nodes?.map((n: any) => n.name) ?? [],
  };
}

// ── Event bus (lightweight replacement for ipcRenderer.on) ────────────────────

type Listener = (...args: unknown[]) => void;
const _listeners = new Map<string, Set<Listener>>();

function emit(channel: string, ...args: unknown[]) {
  _listeners.get(channel)?.forEach((fn) => fn(...args));
}

function onEvent(channel: string, fn: Listener): () => void {
  if (!_listeners.has(channel)) _listeners.set(channel, new Set());
  _listeners.get(channel)!.add(fn);
  return () => _listeners.get(channel)?.delete(fn);
}

// ── MAL OAuth flow via Browser plugin ─────────────────────────────────────────

const DEFAULT_MAL_CLIENT_ID = "10093a3f9f0174b6b5577c40e9accdae"; // MALSync public client

async function getMalClientId(): Promise<string> {
  const stored = await AniTrackSettings.get({ key: "mal_client_id" }).catch(() => ({ value: null }));
  return stored.value ?? DEFAULT_MAL_CLIENT_ID;
}

// ── AniList auth (stub — AniList search/trending don't require auth on Android) ─

let _alState = { connected: false, username: null as string | null };

// ── Shim installation ──────────────────────────────────────────────────────────

export function installCapacitorApiBridge() {
  // Bridge Capacitor plugin events → JS event bus so Settings.tsx listeners work unchanged.
  AniTrackMal.addListener("mal:auth-complete", async (data: any) => {
    // Auto-pull the user's MAL list right after connecting so Library populates immediately.
    try { await AniTrackMal.pull(); } catch { /* ignore pull errors */ }
    emit("mal:auth-complete", data);
  });
  AniTrackMal.addListener("mal:auth-error", (data: any) => {
    emit("mal:auth-error", (data as any).error ?? "Auth failed");
  });

  (window as any).api = {

    // ── al (AniList) ──────────────────────────────────────────────────────────
    al: {
      async beginAuth() {
        // AniList OAuth implicit flow — open in-app browser
        const clientId = await AniTrackSettings.get({ key: "al_client_id" }).then(r => r.value).catch(() => null) ?? "21986";
        const redirectUri = "anitrack://anilist-callback";
        const url = `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token`;
        await Browser.open({ url });
        return { ok: true };
      },
      async state() {
        const raw = await AniTrackSettings.get({ key: "al_state" }).catch(() => ({ value: null }));
        if (raw.value) {
          try { _alState = JSON.parse(raw.value); } catch { /* ignore */ }
        }
        return _alState;
      },
      async disconnect() {
        _alState = { connected: false, username: null };
        await AniTrackSettings.set({ key: "al_state", value: JSON.stringify(_alState) }).catch(() => {});
        return _alState;
      },
      async pull() {
        // AniList list pull — import user list entries into local DB
        const token = await AniTrackSettings.get({ key: "al_token" }).then(r => r.value).catch(() => null);
        if (!token || !_alState.connected) return { imported: 0 };
        // Simplified: just return 0 imported (full implementation would query AniList user list)
        return { imported: 0 };
      },
      async setClientId(id: string) {
        await AniTrackSettings.set({ key: "al_client_id", value: id }).catch(() => {});
        return _alState;
      },
    },

    // ── mal (MyAnimeList) ─────────────────────────────────────────────────────
    mal: {
      async beginAuth() {
        try {
          const clientId = await getMalClientId();
          return AniTrackMal.beginAuth({ clientId }).catch(e => ({ ok: false, reason: String(e) }));
        } catch (e) {
          return { ok: false, reason: String(e) };
        }
      },
      async state() {
        const raw = await AniTrackMal.getState();
        return JSON.parse(raw.value);
      },
      async disconnect() {
        const raw = await AniTrackMal.disconnect();
        return JSON.parse(raw.value);
      },
      async pull() { return AniTrackMal.pull(); },
      async push() { return AniTrackMal.push(); },
      async setClientId(id: string) { return AniTrackMal.setClientId({ clientId: id }); },
      async clientInfo() { return AniTrackMal.clientInfo(); },
    },

    // ── anilist ───────────────────────────────────────────────────────────────
    anilist: {
      async search(q: string) {
        const data = await alGql<any>(`
          query($q: String) {
            Page(perPage: 20) {
              media(search: $q, type: ANIME, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} }
            }
          }`, { q });
        return (data.Page?.media ?? []).map((m: any) => mapMedia(m));
      },
      async trending() {
        const data = await alGql<any>(`
          query {
            Page(perPage: 20) {
              media(type: ANIME, sort: TRENDING_DESC, status_in: [RELEASING, NOT_YET_RELEASED]) { ${MEDIA_FIELDS} }
            }
          }`, {});
        return (data.Page?.media ?? []).map((m: any) => mapMedia(m));
      },
      async get(id: number) {
        if (id <= 0 || id > 1_000_000_000) return null;
        try {
          const data = await alGql<any>(`
            query($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`, { id });
          return data.Media ? mapMedia(data.Media) : null;
        } catch { return null; }
      },
      async relations(id: number) {
        if (id <= 0) return [];
        try {
          const data = await alGql<any>(`
            query($id: Int) {
              Media(id: $id) {
                relations { edges { relationType(version: 2) node { ${MEDIA_FIELDS} } } }
              }
            }`, { id });
          return (data.Media?.relations?.edges ?? []).map((edge: any) => ({
            relationType: edge.relationType,
            anime: mapMedia(edge.node),
          }));
        } catch { return []; }
      },
    },

    // ── library (no-op on Android — no local file library) ───────────────────
    library: {
      async addFolder() { return []; },
      async removeFolder() { return []; },
      async listFolders() { return []; },
      async scan() { return { shows: 0, episodes: 0 }; },
      async episodesFor() { return []; },
    },

    // ── list ──────────────────────────────────────────────────────────────────
    list: {
      async getAll() {
        const raw = await AniTrackDb.getAll();
        return JSON.parse(raw.value);
      },
      async set(entry: any) {
        const raw = await AniTrackDb.listSet({ entry: JSON.stringify(entry) });
        return JSON.parse(raw.value);
      },
      async continueWatching() {
        const raw = await AniTrackDb.continueWatching();
        return JSON.parse(raw.value);
      },
      async continueWatchingPaged(page: number, pageSize: number) {
        const raw = await AniTrackDb.continueWatchingPaged({ page, pageSize });
        return JSON.parse(raw.value);
      },
      async dismissContinueWatching(animeId: number) {
        return AniTrackDb.dismissContinueWatching({ animeId });
      },
    },

    // ── progress ──────────────────────────────────────────────────────────────
    progress: {
      async get(id: number, ep: number) {
        const raw = await AniTrackDb.progressGet({ animeId: id, episode: ep });
        return raw.value ? JSON.parse(raw.value) : null;
      },
      async set(p: any) {
        return AniTrackDb.progressSet({ progress: JSON.stringify(p) });
      },
      async getForAnime(id: number) {
        const raw = await AniTrackDb.progressGetForAnime({ animeId: id });
        return JSON.parse(raw.value);
      },
    },

    // ── player (no-op on Android) ─────────────────────────────────────────────
    player: {
      async resolveFile() { return ""; },
    },

    // ── legal ─────────────────────────────────────────────────────────────────
    legal: {
      async links(_id: number) {
        return [] as import("../../shared/types").StreamingServiceLink[];
      },
      async open(url: string) {
        await Browser.open({ url });
        return { ok: true };
      },
    },

    // ── pahe ──────────────────────────────────────────────────────────────────
    pahe: {
      async latest(page = 1) {
        const raw = await AniTrackPahe.latest({ page });
        return JSON.parse(raw.value);
      },
      async search(q: string) {
        const raw = await AniTrackPahe.search({ query: q });
        return JSON.parse(raw.value);
      },
      async episodes(session: string, page: number) {
        const raw = await AniTrackPahe.episodes({ session, page });
        return JSON.parse(raw.value);
      },
      async links(epSession: string, animeSession: string) {
        const raw = await AniTrackPahe.links({ epSession, animeSession });
        return JSON.parse(raw.value);
      },
      async resolve(kwikUrl: string) {
        return AniTrackPahe.resolve({ kwikUrl });
      },
      async prefetch(kwikUrl: string) {
        return AniTrackPahe.prefetch({ kwikUrl });
      },
      async getIds(paheId: number, session: string) {
        const raw = await AniTrackPahe.getIds({ paheId, session });
        return JSON.parse(raw.value);
      },
      async findById(anilistId?: number, malId?: number) {
        const raw = await AniTrackPahe.findById({ anilistId, malId });
        return raw.value ? JSON.parse(raw.value) : null;
      },
      async getUrl() {
        const raw = await AniTrackPahe.getUrl();
        return raw.url;
      },
      async setUrl(url: string) {
        return AniTrackPahe.setUrl({ url });
      },
      async fetchUrl(url: string, binary = false) {
        return AniTrackPahe.fetchUrl({ url, binary });
      },
    },

    // ── updater (no-op on Android — APK updates are manual for now) ───────────
    updater: {
      async check() { return { ok: false, version: null, reason: "Not supported on Android" }; },
      async install() {},
    },

    // ── on (event listener) ───────────────────────────────────────────────────
    on: onEvent,
  } satisfies Window["api"];
}

// Export ScreenOrientation for use in StreamPlayer
export { ScreenOrientation };
