/**
 * Capacitor shim for window.api — mirrors the Electron preload bridge exactly.
 *
 * On Android, Capacitor plugins (Kotlin) handle all native operations.
 * AniList queries go directly via fetch (public GraphQL API, no auth needed for search).
 * MAL OAuth uses @capacitor/browser for the in-app browser flow.
 * AnimePahe scraping + CF bypass is handled by AniTrackPahePlugin (hidden WebView).
 * SQLite is handled by AniTrackDbPlugin (native SQLite3).
 */

import { Browser } from "@capacitor/browser";
import { ScreenOrientation } from "@capacitor/screen-orientation";

import {
  AniTrackDb,
  AniTrackMal,
  AniTrackPahe,
  AniTrackSettings,
} from "./capacitor-plugins";
import {
  alGql,
  ANILIST_GQL,
  mapMedia,
  MEDIA_FIELDS,
  rankByRelevance,
} from "./capacitor-anilist";
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

let _alState: import("../../../../packages/shared/types").AniListAuthState = {
  connected: false,
  username: null,
  userId: null,
  expiresAt: null,
  hasClientId: false
};

import { anikotoMalIds, anikotoProvider } from "./capacitor-anikoto";
// ── Shim installation ──────────────────────────────────────────────────────────

export async function installCapacitorApiBridge() {
  // --- SYNC NATIVE RECOVERY ---
  // If the WebView's localStorage gets wiped during an app update, recover the
  // GitHub-Gist sync details from Android SharedPreferences BEFORE React boots.
  const gistTok = await AniTrackSettings.get({ key: "gist_token" }).catch(() => ({ value: null }));
  const gistId  = await AniTrackSettings.get({ key: "gist_id" }).catch(() => ({ value: null }));

  if (gistTok.value) localStorage.setItem("gist_token", gistTok.value);
  if (gistId.value)  localStorage.setItem("gist_id", gistId.value);

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
            Page(perPage: 25) {
              media(search: $q, type: ANIME, sort: SEARCH_MATCH, isAdult: false) { ${MEDIA_FIELDS} }
            }
          }`, { q });
        return rankByRelevance(q, data.Page?.media ?? []).map((m: any) => mapMedia(m));
      },
      async advancedSearch(filters: any) {
        const page = filters.page || 1;
        const queryArgs = [];
        const mediaArgs = [];
        const variables: Record<string, any> = {};

        if (filters.query?.trim()) {
          queryArgs.push("$q: String");
          mediaArgs.push("search: $q");
          variables.q = filters.query.trim();
        }
        if (filters.genre && filters.genre.length > 0) {
          queryArgs.push("$genre: [String]");
          mediaArgs.push("genre_in: $genre");
          variables.genre = filters.genre;
        }
        if (filters.tag && filters.tag.length > 0) {
          queryArgs.push("$tag: [String]");
          mediaArgs.push("tag_in: $tag");
          mediaArgs.push("minimumTagRank: 50");
          variables.tag = filters.tag;
        }
        if (filters.season) {
          queryArgs.push("$season: MediaSeason");
          mediaArgs.push("season: $season");
          variables.season = filters.season;
        }
        if (filters.year) {
          queryArgs.push("$year: Int");
          mediaArgs.push("seasonYear: $year");
          variables.year = filters.year;
        }
        if (filters.format) {
          queryArgs.push("$format: MediaFormat");
          mediaArgs.push("format: $format");
          variables.format = filters.format;
        }
        if (filters.status) {
          queryArgs.push("$status: MediaStatus");
          mediaArgs.push("status: $status");
          variables.status = filters.status;
        }
        if (filters.source) {
          queryArgs.push("$source: MediaSource");
          mediaArgs.push("source: $source");
          variables.source = filters.source;
        }
        if (filters.episodesGreater != null) {
          queryArgs.push("$epGt: Int");
          mediaArgs.push("episodes_greater: $epGt");
          variables.epGt = Math.max(0, filters.episodesGreater - 1);
        }
        if (filters.episodesLesser != null) {
          queryArgs.push("$epLt: Int");
          mediaArgs.push("episodes_lesser: $epLt");
          variables.epLt = filters.episodesLesser + 1;
        }

        const isRelevanceSearch = !!filters.query?.trim() && !filters.sort;
        queryArgs.push("$sort: [MediaSort]");
        mediaArgs.push("sort: $sort");
        variables.sort = filters.sort ? [filters.sort] : (filters.query?.trim() ? ["SEARCH_MATCH"] : ["TRENDING_DESC", "POPULARITY_DESC"]);

        queryArgs.push("$page: Int");
        const qArgsStr = queryArgs.length > 0 ? `(${queryArgs.join(", ")})` : "";
        const mArgsStr = mediaArgs.length > 0 ? `(${mediaArgs.join(", ")}, type: ANIME)` : "(type: ANIME)";

        const data = await alGql<any>(
          `query${qArgsStr} {
            Page(page: $page, perPage: 36) {
              pageInfo { hasNextPage lastPage total }
              media${mArgsStr} { ${MEDIA_FIELDS} }
            }
          }`,
          { ...variables, page }
        );

        const rawMedia = data.Page?.media ?? [];
        const media = isRelevanceSearch ? rankByRelevance(filters.query.trim(), rawMedia) : rawMedia;
        return {
          results: media.map((m: any) => mapMedia(m)),
          hasNextPage: data.Page?.pageInfo?.hasNextPage ?? false,
          lastPage: data.Page?.pageInfo?.lastPage ?? (data.Page?.pageInfo?.total ? Math.ceil(data.Page.pageInfo.total / 36) : undefined),
        };
      },
      async trending() {
        const data = await alGql<any>(`
          query {
            Page(perPage: 20) {
              media(type: ANIME, sort: TRENDING_DESC, status_in: [RELEASING, NOT_YET_RELEASED]) { ${MEDIA_FIELDS} }
            }
          }`, {}, "low");
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
      async airing(ids: number[]) {
        const unique = Array.from(new Set((ids ?? []).filter((n) => Number.isInteger(n) && n > 0)));
        if (unique.length === 0) return [];
        const out: any[] = [];
        for (let i = 0; i < unique.length; i += 50) {
          const chunk = unique.slice(i, i + 50);
          try {
            const data = await alGql<any>(`
              query($ids: [Int]) {
                Page(perPage: 50) {
                  media(id_in: $ids, type: ANIME) {
                    id title { romaji english } coverImage { large }
                    nextAiringEpisode { airingAt episode }
                  }
                }
              }`, { ids: chunk }, "low");
            for (const m of (data.Page?.media ?? [])) {
              if (!m.nextAiringEpisode) continue;
              out.push({
                animeId: m.id,
                title: m.title?.english || m.title?.romaji || "Untitled",
                coverImage: m.coverImage?.large ?? null,
                episode: m.nextAiringEpisode.episode,
                airingAt: m.nextAiringEpisode.airingAt,
              });
            }
          } catch { /* skip chunk on error */ }
        }
        return out;
      },
      async recent(page = 1) {
        const safePage = Number.isInteger(page) && page > 0 ? page : 1;
        const data = await alGql<any>(`
          query($to: Int, $page: Int) {
            Page(page: $page, perPage: 30) {
              pageInfo { hasNextPage }
              airingSchedules(airingAt_lesser: $to, sort: TIME_DESC) {
                airingAt episode
                media { ${MEDIA_FIELDS} isAdult }
              }
            }
          }`, { to: Math.floor(Date.now() / 1000), page: safePage }, "low");
        const seen = new Set<number>();
        return {
          data: (data.Page?.airingSchedules ?? []).flatMap((schedule: any) => {
            const media = schedule.media;
            if (!media || media.isAdult || seen.has(media.id)) return [];
            seen.add(media.id);
            return [{
              anime: mapMedia(media),
              episode: schedule.episode,
              airingAt: schedule.airingAt,
            }];
          }),
          page: safePage,
          hasNextPage: data.Page?.pageInfo?.hasNextPage ?? false,
        };
      },
      async relations(id: number) {
        if (id <= 0) return [];
        try {
          const data = await alGql<any>(`
            query($id: Int) {
              Media(id: $id) {
                relations { edges { relationType(version: 2) node { ${MEDIA_FIELDS} } } }
              }
            }`, { id }, "low");
          return (data.Media?.relations?.edges ?? []).map((edge: any) => ({
            relationType: edge.relationType,
            anime: mapMedia(edge.node),
          }));
        } catch { return []; }
      },
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
      async getIds(paheId: number | string, session: string) {
        // Anikoto candidates pass their slug (non-numeric string). Their MAL id
        // lives in the episode list — fetch it so title-mislabeled entries
        // (e.g. anikoto's "City Hunter" actually being City Hunter '91) can be
        // caught by id verification, same as on desktop.
        if (typeof paheId === "string" && !/^\d+$/.test(paheId)) {
          if (!anikotoMalIds.has(paheId)) {
            try { await anikotoProvider.getEpisodes(paheId, 1); } catch { /* unreachable */ }
          }
          const mal = anikotoMalIds.get(paheId);
          return mal != null ? { malId: mal } : {};
        }
        const raw = await AniTrackPahe.getIds({ paheId: Number(paheId), session: String(session) });
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
      async fetchUrl(url: string, binary = false, headers?: Record<string, string>) {
        return AniTrackPahe.fetchUrl({ url, binary, headers });
      },
      async anikotoTop() {
        return anikotoProvider.getTop();
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
