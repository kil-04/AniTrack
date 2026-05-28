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
  episodes(opts: { providerId: string; session: string; page: number }): Promise<{ value: string }>;
  links(opts: { providerId: string; epSession: string; animeSession: string }): Promise<{ value: string }>;
  resolve(opts: { providerId: string; kwikUrl: string }): Promise<{ url: string; cookies: string }>;
  prefetch(opts: { kwikUrl: string }): Promise<{ ok: boolean }>;
  getIds(opts: { paheId: number; session: string }): Promise<{ value: string }>;
  findById(opts: { anilistId?: number; malId?: number }): Promise<{ value: string | null }>;
  getUrl(): Promise<{ url: string }>;
  setUrl(opts: { url: string }): Promise<{ ok: boolean; url: string; reason?: string }>;
  fetchUrl(opts: { url: string; binary?: boolean; headers?: Record<string, string> }): Promise<{ data: string; status: number; binary: boolean }>;
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

let _alState: import("../../shared/types").AniListAuthState = {
  connected: false,
  username: null,
  userId: null,
  expiresAt: null,
  hasClientId: false
};

// ── Anikoto Provider (Browserless HTTP Scraper) ────────────────────────────────

const ANIKOTO_BASE_URL = "https://anikoto.cz";

async function anikotoFetch(url: string, options: RequestInit = {}): Promise<any> {
  const fullUrl = url.startsWith("http") ? url : `${ANIKOTO_BASE_URL}${url}`;
  
  let reqHeaders: Record<string, string> = {};
  if (options.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((val, key) => {
        reqHeaders[key] = val;
      });
    } else if (Array.isArray(options.headers)) {
      for (const [key, val] of options.headers) {
        reqHeaders[key] = val;
      }
    } else {
      reqHeaders = options.headers as Record<string, string>;
    }
  }

  // Route requests via native OkHttp client on Android to bypass WebView CORS restrictions
  const res = await AniTrackPahe.fetchUrl({
    url: fullUrl,
    binary: false,
    headers: reqHeaders
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Anikoto fetch failed: ${res.status}`);
  }

  return {
    ok: true,
    status: res.status,
    text: async () => res.data,
    json: async () => JSON.parse(res.data)
  };
}

const anikotoProvider = {
  id: "anikoto",
  name: "Anikoto",

  async search(query: string) {
    try {
      const resp = await anikotoFetch(`/filter?keyword=${encodeURIComponent(query)}`);
      const html = await resp.text();
      
      const results = [];
      const itemRe = /<div class="item[^>]*>[\s\S]*?href="[^"]*\/watch\/([^/"]+)[^"]*"[\s\S]*?<img src="([^"]+)" alt="([^"]+)"/g;
      let match;
      while ((match = itemRe.exec(html)) !== null) {
        results.push({
          id: match[1],
          providerId: this.id,
          poster: match[2],
          title: match[3],
        });
      }
      return results;
    } catch (err) {
      console.error("[Anikoto Capacitor] Search failed:", err);
      return [];
    }
  },

  async getEpisodes(animeId: string, page = 1) {
    console.log(`[Anikoto Capacitor] Fetching watch page HTML for showId: ${animeId}`);
    const resp = await anikotoFetch(`/watch/${animeId}`);
    const html = await resp.text();

    const idMatch = html.match(/id="watch-main"[^>]*data-id="([^"]+)"/) || html.match(/data-id="([^"]+)"/);
    if (!idMatch) throw new Error("Failed to extract anime show ID from watch page HTML");
    const showId = idMatch[1];
    console.log(`[Anikoto Capacitor] Extracted showId: ${showId} for ${animeId}`);

    const listResp = await anikotoFetch(`/ajax/episode/list/${showId}`, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    const listJson = await listResp.json() as any;
    const listHtml = listJson.result || "";

    const episodes = [];
    const regex = /<a[^>]+data-id="([^"]+)"[^>]+data-slug="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = regex.exec(listHtml)) !== null) {
      const dataId = match[1];
      const dataSlug = match[2];
      const text = match[3].trim();
      
      const tag = match[0];
      const numM = /data-num="([^"]*)"/.exec(tag);
      const titleM = /title="([^"]*)"/.exec(tag);
      
      const num = numM ? numM[1] : text;
      const title = titleM ? titleM[1] : `Episode ${num}`;
      
      const idsM = /data-ids="([^"]*)"/.exec(tag);
      const serversParam = idsM ? idsM[1] : "";
      
      const slugStr = `ep-${dataSlug}`;
      const id = `${slugStr}:${dataId}:${serversParam}`;
      
      episodes.push({
        id,
        episodeNumber: parseFloat(num) || 0,
        title
      });
    }

    console.log(`[Anikoto Capacitor] Parsed ${episodes.length} episodes browserlessly for ${animeId}`);
    return {
      data: episodes,
      total: episodes.length,
      lastPage: 1
    };
  },

  async getStreamLinks(episodeId: string, animeId: string) {
    return [
      {
        id: JSON.stringify({ episodeId, animeId, subType: "soft" }),
        quality: "Auto (Soft Sub)",
        audio: "jpn"
      }
    ];
  },

  async resolveStream(linkId: string) {
    const { episodeId, animeId, subType = "soft" } = JSON.parse(linkId);

    const parts = episodeId.split(':');
    const slug = parts[0];
    const dataId = parts[1];
    let serversParam = parts[2] || "";

    if (!serversParam) {
      console.log(`[Anikoto Capacitor] Fallback: serversParam missing from episodeId. Fetching list...`);
      const resp = await anikotoFetch(`/watch/${animeId}`);
      const html = await resp.text();
      const idMatch = html.match(/id="watch-main"[^>]*data-id="([^"]+)"/) || html.match(/data-id="([^"]+)"/);
      if (idMatch) {
        const showId = idMatch[1];
        const listResp = await anikotoFetch(`/ajax/episode/list/${showId}`, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const listJson = await listResp.json() as any;
        const listHtml = listJson.result || "";
        const targetRe = new RegExp(`<a[^>]+data-id="${dataId}"[^>]*>`);
        const tagMatch = targetRe.exec(listHtml);
        if (targetRe.test(listHtml)) {
          const tagMatchExec = targetRe.exec(listHtml);
          if (tagMatchExec) {
            const idsM = /data-ids="([^"]*)"/.exec(tagMatchExec[0]);
            if (idsM) {
              serversParam = idsM[1];
            }
          }
        }
      }
    }

    if (!serversParam) {
      throw new Error(`Failed to obtain servers token (data-ids) for episode: ${dataId}`);
    }

    // Ensure we load watch page first to set cookies natively
    await anikotoFetch(`/watch/${animeId}`);

    console.log(`[Anikoto Capacitor] Fetching servers list for episode: ${dataId}`);
    const serversResp = await anikotoFetch(`/ajax/server/list?servers=${encodeURIComponent(serversParam)}`, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    const serversJson = await serversResp.json() as any;
    const serversHtml = serversJson.result || "";

    const types = [];
    const typeRe = /<div class="type"[^>]*>([\s\S]*?)<\/ul>\s*<\/div>/g;
    let typeMatch;
    while ((typeMatch = typeRe.exec(serversHtml)) !== null) {
      const typeHtml = typeMatch[1];
      const labelM = /<label[^>]*>([\s\S]*?)<\/label>/.exec(typeHtml);
      const label = labelM ? labelM[1].replace(/<[^>]+>/g, '').trim() : '';
      
      const liRe = /<li[^>]+data-link-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g;
      let liMatch;
      const items = [];
      while ((liMatch = liRe.exec(typeHtml)) !== null) {
        items.push({
          linkId: liMatch[1],
          name: liMatch[2].replace(/<[^>]+>/g, '').trim()
        });
      }
      types.push({ label, items });
    }

    const isHardLabel = (labelStr: string) => {
      const l = labelStr.toUpperCase();
      return l.includes("H-SUB") || l.includes("H SUB") || l.includes("HARDSUB") || l.includes("HARD SUB") || l.includes("HSUB");
    };

    const isSoftLabel = (labelStr: string) => {
      const l = labelStr.toUpperCase();
      return l.includes("SUB") && !isHardLabel(labelStr);
    };

    const targetType = types.find(t => {
      return subType === "hard" ? isHardLabel(t.label) : isSoftLabel(t.label);
    });
    
    let isActualHardSub = false;
    let ajaxLinkId = "";
    
    if (targetType && targetType.items.length > 0) {
      ajaxLinkId = targetType.items[0].linkId;
      isActualHardSub = isHardLabel(targetType.label);
    }
    
    if (!ajaxLinkId) {
      if (types.length > 0 && types[0].items.length > 0) {
        ajaxLinkId = types[0].items[0].linkId;
        isActualHardSub = isHardLabel(types[0].label);
      }
    }

    if (!ajaxLinkId) {
      throw new Error(`Failed to find server matching subtitle subtype: ${subType}`);
    }

    console.log(`[Anikoto Capacitor] Resolving player server url browserlessly for linkId: ${ajaxLinkId.substring(0, 20)}...`);
    const serverGetResp = await anikotoFetch(`/ajax/server?get=${encodeURIComponent(ajaxLinkId)}`, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    const serverGetJson = await serverGetResp.json() as any;
    let iframeUrl = serverGetJson.result?.url || "";
    if (!iframeUrl) throw new Error("Server iframe URL not found in AJAX response");
    console.log(`[Anikoto Capacitor] Found player iframe URL: ${iframeUrl}`);

    // Decode base64 hash if plyr.php or mewcdn
    if (iframeUrl.includes('plyr.php') || iframeUrl.includes('mewcdn.online/player/')) {
      const hashParts = iframeUrl.split('#');
      if (hashParts.length >= 2) {
        try {
          const decodedUrl = atob(hashParts[1]);
          console.log(`[Anikoto Capacitor] Decoded H-SUB stream URL from hash: ${decodedUrl}`);
          return {
            url: decodedUrl,
            subtitles: [],
            intro: serverGetJson?.result?.skip_data?.intro?.end > 0 ? serverGetJson.result.skip_data.intro : undefined,
            outro: serverGetJson?.result?.skip_data?.outro?.end > 0 ? serverGetJson.result.skip_data.outro : undefined
          };
        } catch (err) {
          console.error('[Anikoto Capacitor] Failed to decode base64 hash:', err);
        }
      }
    }

    const megaplayResp = await anikotoFetch(iframeUrl, {
      headers: {
        'Referer': `${ANIKOTO_BASE_URL}/`
      }
    });
    const megaplayHtml = await megaplayResp.text();
    const match = megaplayHtml.match(/id="megaplay-player"[^>]*data-id="([^"]+)"/) || megaplayHtml.match(/data-id="([^"]+)"/);
    if (!match) {
      throw new Error("Failed to extract data-id from Megaplay iframe HTML");
    }
    
    const megaplayId = match[1];
    console.log(`[Anikoto Capacitor] Extracted Megaplay player source ID: ${megaplayId}`);

    const resp = await anikotoFetch(`https://megaplay.buzz/stream/getSources?id=${megaplayId}`, {
      headers: {
        'Referer': iframeUrl,
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    const json = await resp.json() as any;
    
    const streamUrl = json.sources?.file || "";
    const subs = isActualHardSub ? [] : (json.tracks || []).filter((t: any) => t.kind === "captions").map((t: any) => ({
      ...t,
      url: t.file,
      label: t.label || t.name || "English"
    }));
    
    const intro = json.intro?.end > 0 ? json.intro : (serverGetJson?.result?.skip_data?.intro?.end > 0 ? serverGetJson.result.skip_data.intro : undefined);
    const outro = json.outro?.end > 0 ? json.outro : (serverGetJson?.result?.skip_data?.outro?.end > 0 ? serverGetJson.result.skip_data.outro : undefined);

    return {
      url: streamUrl,
      subtitles: subs,
      intro,
      outro
    };
  }
};

// ── Shim installation ──────────────────────────────────────────────────────────

export async function installCapacitorApiBridge() {
  // --- SUPABASE NATIVE RECOVERY ---
  // If the WebView's localStorage gets wiped during an app update, this recovers
  // the user's Supabase sync details from Android SharedPreferences BEFORE React boots.
  const supaUrl = await AniTrackSettings.get({ key: "supabase_url" }).catch(() => ({ value: null }));
  const supaKey = await AniTrackSettings.get({ key: "supabase_key" }).catch(() => ({ value: null }));
  const supaUid = await AniTrackSettings.get({ key: "supabase_user_id" }).catch(() => ({ value: null }));
  
  if (supaUrl.value) localStorage.setItem("supabase_url", supaUrl.value);
  if (supaKey.value) localStorage.setItem("supabase_key", supaKey.value);
  if (supaUid.value) localStorage.setItem("supabase_user_id", supaUid.value);

  // Bridge Capacitor plugin events → JS event bus so Settings.tsx listeners work unchanged.
  AniTrackMal.addListener("mal:auth-complete", async (data: any) => {
    // Auto-pull the user's MAL list right after connecting so Library populates immediately.
    try { await AniTrackMal.pull(); } catch { /* ignore pull errors */ }
    emit("mal:auth-complete", data);
  });
  AniTrackMal.addListener("mal:auth-error", (data: any) => {
    emit("mal:auth-error", (data as any).error ?? "Auth failed");
  });

  // Listen for deep links (e.g. AniList OAuth redirects)
  const AppPlugin = (window as any).Capacitor?.Plugins?.App;
  if (AppPlugin) {
    const handleOpenUrl = async (url: string) => {
      console.log("[Capacitor] App opened via URL:", url);
      if (url.startsWith("anitrack://anilist-callback")) {
        try {
          const fragPart = url.split("#")[1];
          if (!fragPart) return;
          const frag = new URLSearchParams(fragPart);
          const token = frag.get("access_token");
          const expiresIn = Number(frag.get("expires_in") ?? 31536000);
          if (!token) return;

          // Fetch user info from AniList GQL API
          const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          };
          const gqlQuery = JSON.stringify({ query: "{ Viewer { id name } }" });
          const res = await fetch(ANILIST_GQL, {
            method: "POST",
            headers,
            body: gqlQuery
          });
          if (!res.ok) throw new Error(`AniList Viewer query failed: ${res.status}`);
          const json = await res.json();
          if (json.errors?.length) throw new Error(json.errors[0].message);
          
          const viewer = json.data?.Viewer;
          if (viewer) {
            _alState = {
              connected: true,
              username: viewer.name,
              userId: viewer.id,
              expiresAt: Date.now() + expiresIn * 1000,
              hasClientId: true
            };
            await AniTrackSettings.set({ key: "al_state", value: JSON.stringify(_alState) });
            await AniTrackSettings.set({ key: "al_token", value: token });
            console.log("[Capacitor] AniList authentication complete. Viewer:", viewer.name);
            emit("al:auth-complete", _alState);
          }
        } catch (err) {
          console.error("[Capacitor] AniList callback handling error:", err);
          emit("al:auth-error", String(err));
        }
      }
    };

    AppPlugin.addListener("appUrlOpen", (data: { url: string }) => {
      handleOpenUrl(data.url);
    });

    // Check for cold-start deep link launch URLs
    AppPlugin.getLaunchUrl()
      .then((launchData: any) => {
        if (launchData?.url) {
          console.log("[Capacitor] App launched with URL:", launchData.url);
          handleOpenUrl(launchData.url);
        }
      })
      .catch((err: any) => {
        console.error("[Capacitor] Failed to get launch URL:", err);
      });
  }

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
      async advancedSearch(filters: any) {
        throw new Error("advancedSearch not implemented in capacitor yet");
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
        const pahePromise = AniTrackPahe.search({ query: q })
          .then(r => {
            const list = JSON.parse(r.value) as any[];
            return list.map(item => ({
              id: item.session ?? item.id,
              paheId: item.id,
              session: item.session ?? item.id,
              providerId: "animepahe",
              title: item.title,
              poster: item.poster,
              episodes: item.episodes,
              type: item.type,
              status: item.status,
              season: item.season,
              year: item.year,
              score: item.score
            }));
          })
          .catch(() => []);
        
        const anikotoPromise = anikotoProvider.search(q).catch(() => []);
        const [paheRes, anikotoRes] = await Promise.all([pahePromise, anikotoPromise]);
        
        const flat = [...paheRes, ...anikotoRes];
        return flat.sort((a, b) => {
          const aId = a.providerId ?? "animepahe";
          const bId = b.providerId ?? "animepahe";
          if (aId === "animepahe" && bId !== "animepahe") return -1;
          if (aId !== "animepahe" && bId === "animepahe") return 1;
          return 0;
        });
      },
      async episodes(providerId: string, animeId: string, page: number) {
        if (providerId === "anikoto") {
          return anikotoProvider.getEpisodes(String(animeId), page);
        }
        // Correct native parameter mismatch: Map animeId -> session (stringified to prevent type-coercion bypass)
        const raw = await AniTrackPahe.episodes({ providerId, session: String(animeId), page });
        return JSON.parse(raw.value);
      },
      async links(providerId: string, episodeId: string, animeId: string) {
        if (providerId === "anikoto") {
          return anikotoProvider.getStreamLinks(String(episodeId), String(animeId));
        }
        // Correct native parameter mismatch: Map episodeId -> epSession and animeId -> animeSession
        const raw = await AniTrackPahe.links({ providerId, epSession: String(episodeId), animeSession: String(animeId) });
        return JSON.parse(raw.value);
      },
      async resolve(providerId: string, linkId: string) {
        if (providerId === "anikoto") {
          return anikotoProvider.resolveStream(String(linkId));
        }
        // Correct native parameter mismatch: Map linkId -> kwikUrl
        return AniTrackPahe.resolve({ providerId, kwikUrl: String(linkId) });
      },
      async prefetch(kwikUrl: string) {
        return AniTrackPahe.prefetch({ kwikUrl: String(kwikUrl) });
      },
      async getIds(paheId: number, session: string) {
        const raw = await AniTrackPahe.getIds({ paheId, session: String(session) });
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

    // ── updater (checks GitHub for APK updates) ───────────────────────────────
    updater: {
      async check() {
        try {
          const res = await fetch("https://api.github.com/repos/kil-04/AniTrack/releases/latest");
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const latestVersion = data.tag_name.replace(/^v/, '');
          
          // @ts-ignore
          if (latestVersion.localeCompare(__APP_VERSION__, undefined, { numeric: true, sensitivity: 'base' }) === 1) {
             emit("update:available", { version: latestVersion });
             emit("update:downloaded", { version: latestVersion });
          } else {
             emit("update:not-available");
          }
          return { ok: true, version: latestVersion };
        } catch (e) {
          emit("update:error", String(e));
          return { ok: false, version: null, reason: String(e) };
        }
      },
      async install() {
        await Browser.open({ url: "https://github.com/kil-04/AniTrack/releases/latest" });
      },
    },

    // ── on (event listener) ───────────────────────────────────────────────────
    on: onEvent,
  } satisfies Window["api"];
}

// Export ScreenOrientation for use in StreamPlayer
export { ScreenOrientation };
