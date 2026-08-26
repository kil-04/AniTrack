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

// Two-lane serial scheduler + TTL cache + 429 retry — mirrors apps/desktop/main/services/anilist.ts.
// All requests stay serialized (AniList 429s otherwise), but interactive calls
// (search / filter / detail get) go through the HIGH lane and always run before
// queued background work (watch-order relations crawl, trending, airing). Without
// the lanes, a Search or Filter request can sit behind dozens of queued background
// calls at 350ms spacing and appear to load forever.
const _alHigh: Array<() => Promise<void>> = [];
const _alLow: Array<() => Promise<void>> = [];
let _alPumping = false;
let _alStartup = true;
setTimeout(() => { _alStartup = false; }, 6000);
const _alCache = new Map<string, { value: unknown; expires: number }>();
const AL_CACHE_TTL = 5 * 60 * 1000;

async function _alPump() {
  if (_alPumping) return;
  _alPumping = true;
  try {
    while (_alHigh.length || _alLow.length) {
      const job = (_alHigh.shift() ?? _alLow.shift())!;
      await job();
      // Space requests so we stay under AniList's ~90/min limit.
      await new Promise((r) => setTimeout(r, _alStartup ? 700 : 350));
    }
  } finally {
    _alPumping = false;
  }
}

async function alGql<T>(
  query: string,
  variables: Record<string, unknown>,
  priority: "high" | "low" = "high",
): Promise<T> {
  const key = JSON.stringify({ query, variables });
  const hit = _alCache.get(key);
  if (hit && Date.now() < hit.expires) return hit.value as T;

  return new Promise<T>((resolve, reject) => {
    const job = async () => {
      try {
        const result = await _alDoGql<T>(query, variables);
        _alCache.set(key, { value: result, expires: Date.now() + AL_CACHE_TTL });
        if (_alCache.size > 300) {
          const oldest = _alCache.keys().next().value;
          if (oldest !== undefined) _alCache.delete(oldest);
        }
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };
    (priority === "high" ? _alHigh : _alLow).push(job);
    void _alPump();
  });
}

async function _alDoGql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    // Time-box the request — the scheduler is a single serial pump, so one
    // hung fetch would otherwise stall EVERY AniList call in the app.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(ANILIST_GQL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: ac.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (attempt < 3) continue;
      throw err;
    }
    clearTimeout(timer);
    if (res.status === 429) {
      if (attempt < 3) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = Math.min(5000, isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * attempt);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new Error("AniList 429");
    }
    if (!res.ok) throw new Error(`AniList ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);
    return json.data as T;
  }
  throw new Error("AniList: exhausted retries");
}

const MEDIA_FIELDS = `
  id idMal title { romaji english native } synonyms coverImage { large } bannerImage
  episodes status format popularity season seasonYear averageScore genres description(asHtml: false)
  startDate { year month day } nextAiringEpisode { airingAt episode }
  studios(isMain: true) { nodes { name } }
`;

function mapMedia(m: any) {
  return {
    id: m.id,
    malId: m.idMal ?? null,
    title: m.title?.english || m.title?.romaji || "Unknown",
    titleEnglish: m.title?.english ?? null,
    titleRomaji: m.title?.romaji ?? null,
    coverImage: m.coverImage?.large ?? null,
    bannerImage: m.bannerImage ?? null,
    episodes: m.episodes ?? null,
    status: m.status ?? null,
    format: m.format ?? null,
    popularity: m.popularity ?? null,
    // Strip HTML tags — the synopsis is rendered via dangerouslySetInnerHTML, and
    // AniList descriptions can contain markup. (Desktop strips this in anilist.ts.)
    synopsis: (m.description ?? "").replace(/<[^>]+>/g, "") || null,
    genres: m.genres ?? [],
    averageScore: m.averageScore ?? null,
    year: m.seasonYear ?? null,
    studios: m.studios?.nodes?.map((n: any) => n.name) ?? [],
  };
}

// Mirrors apps/desktop/main/services/anilist.ts: AniList's SEARCH_MATCH ranks obscure
// synonym-matches above the obvious popular series, so re-rank each result page
// by relevance tier (exact/prefix > substring > word overlap) then popularity.
const _normTitle = (s: string | undefined | null) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function _relevanceTier(query: string, m: any): number {
  const nq = _normTitle(query);
  if (!nq) return 0;
  const cands = [m.title?.english, m.title?.romaji, m.title?.native, ...(m.synonyms ?? [])]
    .map(_normTitle)
    .filter(Boolean);
  let tier = 0;
  for (const c of cands) {
    if (c === nq || c.startsWith(nq)) tier = Math.max(tier, 3);
    else if (c.includes(nq)) tier = Math.max(tier, 2);
    else {
      const qw = nq.split(" ");
      const cw = new Set(c.split(" "));
      if (qw.filter((w) => cw.has(w)).length / qw.length >= 0.5) tier = Math.max(tier, 1);
    }
  }
  return tier;
}

function rankByRelevance(query: string, media: any[]): any[] {
  return media
    .map((m, i) => ({ m, score: _relevanceTier(query, m) * 1000 + Math.log10((m.popularity ?? 0) + 1) * 10 - i * 0.001 }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m);
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

let _alState: import("../../../../packages/shared/types").AniListAuthState = {
  connected: false,
  username: null,
  userId: null,
  expiresAt: null,
  hasClientId: false
};

// ── Anikoto Provider (Browserless HTTP Scraper) ────────────────────────────────

const ANIKOTO_BASE_URL = "https://anikoto.cz";

// MAL id per anikoto slug, harvested from the episode list (see getEpisodes).
const _anikotoMalIds = new Map<string, number | null>();
// Episode-list cache + in-flight dedup for the Android anikoto provider.
const _anikotoEpsCache = new Map<string, { value: any; expires: number }>();
const _anikotoEpsPending = new Map<string, Promise<any>>();

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

  async getTop(): Promise<{ day: any[]; week: any[]; month: any[] }> {
    const out: { day: any[]; week: any[]; month: any[] } = { day: [], week: [], month: [] };
    try {
      const resp = await anikotoFetch(`/home`);
      const html = await resp.text();
      const secStart = html.indexOf('id="top-anime"');
      if (secStart < 0) return out;
      const sec = html.slice(secStart, secStart + 80000);
      const markers = [...sec.matchAll(/<div class="tab-content" data-name="(day|week|month)"/g)];
      for (let i = 0; i < markers.length; i++) {
        const name = markers[i][1] as "day" | "week" | "month";
        const start = markers[i].index!;
        const end = i + 1 < markers.length ? markers[i + 1].index! : sec.length;
        const block = sec.slice(start, end);
        const items: any[] = [];
        for (const p of block.split(/<a class="item/).slice(1, 11)) {
          const href = (p.match(/href="([^"]+)"/) || [])[1] || "";
          const slug = (href.match(/\/watch\/([^"?/]+)/) || [])[1] || "";
          const poster = (p.match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
          const alt = (p.match(/alt="([^"]*)"/) || [])[1] || "";
          const nameM = p.match(/class="name[^"]*"[^>]*>\s*([^<]+?)\s*</);
          const title = ((nameM && nameM[1]) || alt).trim();
          const titleJp = (p.match(/data-jp="([^"]*)"/) || [])[1] || "";
          const showId = (p.match(/data-tip="([^"]*)"/) || [])[1] || "";
          const sub = (p.match(/ep-status sub[\s\S]*?<span>\s*(\d+)/) || [])[1];
          const dub = (p.match(/ep-status dub[\s\S]*?<span>\s*(\d+)/) || [])[1];
          if (title) items.push({ slug, showId, title, titleJp, poster, sub: sub ? +sub : null, dub: dub ? +dub : null });
        }
        out[name] = items;
      }
    } catch (e) {
      console.warn("[Anikoto Capacitor] getTop failed", e);
    }
    return out;
  },

  async search(query: string) {
    try {
      const results: any[] = [];

      const fetchPage = async (pageNo: number) => {
        try {
          const resp = await anikotoFetch(`/filter?keyword=${encodeURIComponent(query)}&page=${pageNo}`);
          const html = await resp.text();
          
          const blocks = html.split(/<div class="item\s*/);
          for (let i = 1; i < blocks.length; i++) {
            const block = blocks[i];
            
            const hrefM = /href="[^"]*\/watch\/([^/"]+)/.exec(block);
            const href = hrefM ? hrefM[1] : null;
            if (!href) continue;
            
            const imgM = /<img src="([^"]+)" alt="([^"]+)"/.exec(block);
            const imgSrc = imgM ? imgM[1] : null;
            const imgAlt = imgM ? imgM[2] : null;
            
            const jpM = /data-jp="([^"]+)"/.exec(block);
            const dataJp = jpM ? jpM[1].replace(/&#039;/g, "'") : null;
            
            const totalM = /class="ep-status total"[^>]*>\s*<span>\s*(\d+)\s*<\/span>/.exec(block);
            const totalEps = totalM ? parseInt(totalM[1], 10) : undefined;
            const subM = /class="ep-status sub"[^>]*>\s*<span>\s*(\d+)\s*<\/span>/.exec(block);
            const dubM = /class="ep-status dub"[^>]*>\s*<span>\s*(\d+)\s*<\/span>/.exec(block);
            const subCount = subM ? parseInt(subM[1], 10) : undefined;
            const dubCount = dubM ? parseInt(dubM[1], 10) : undefined;

            const title = dataJp || imgAlt || "Untitled";
            
            // Extract year from title if possible
            let parsedYear: number | undefined;
            const clean = title.trim();
            const y4Match = clean.match(/\b(19\d\d|20[0-2]\d)\b/);
            if (y4Match) {
              parsedYear = parseInt(y4Match[1], 10);
            } else {
              const y2Match = clean.match(/'(\d{2})\b/);
              if (y2Match) {
                const yy = parseInt(y2Match[1], 10);
                parsedYear = yy >= 50 ? 1900 + yy : 2000 + yy;
              } else {
                const end2Match = clean.match(/\b([5-9]\d|0\d|1\d|2[0-5])\b\s*$/);
                if (end2Match) {
                  const yy = parseInt(end2Match[1], 10);
                  parsedYear = yy >= 50 ? 1900 + yy : 2000 + yy;
                }
              }
            }
            
            results.push({
              id: href,
              providerId: this.id,
              poster: imgSrc || "",
              title: title,
              episodes: totalEps,
              subCount,
              dubCount,
              year: parsedYear,
            });
          }
        } catch (err) {
          console.error(`[Anikoto Capacitor] Page ${pageNo} search failed:`, err);
        }
      };

      await Promise.all([fetchPage(1), fetchPage(2)]);
      return results;
    } catch (err) {
      console.error("[Anikoto Capacitor] Search failed:", err);
      return [];
    }
  },

  async getEpisodes(animeId: string, page = 1) {
    // Cache + in-flight dedup (mirrors the desktop provider): id verification
    // and playback both need this list — they must share ONE fetch, or bursts
    // trip the site's anti-bot limit and everything starts timing out.
    const cached = _anikotoEpsCache.get(animeId);
    if (cached && Date.now() < cached.expires) return cached.value;
    const pending = _anikotoEpsPending.get(animeId);
    if (pending) return pending;
    const promise = this._getEpisodesUncached(animeId, page)
      .then((value: any) => {
        _anikotoEpsCache.set(animeId, { value, expires: Date.now() + 15 * 60 * 1000 });
        if (_anikotoEpsCache.size > 100) {
          const oldest = _anikotoEpsCache.keys().next().value;
          if (oldest !== undefined) _anikotoEpsCache.delete(oldest);
        }
        return value;
      })
      .finally(() => _anikotoEpsPending.delete(animeId));
    _anikotoEpsPending.set(animeId, promise);
    promise.catch(() => {});
    return promise;
  },

  async _getEpisodesUncached(animeId: string, _page = 1) {
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

    // Harvest the MAL id from the episode anchors (data-mal) — anikoto entries
    // can be mislabeled, and this id is the only reliable identity check.
    const malM = /data-mal="(\d+)"/.exec(listHtml);
    _anikotoMalIds.set(animeId, malM ? parseInt(malM[1], 10) : null);

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

    // getSources lives on the SAME origin as the player iframe; the host rotates
    // (megaplay.buzz → vidtube.site → …) so derive it instead of hardcoding a
    // dead domain (a stale host 302s to an ad and the fetch fails).
    let playerOrigin = "https://megaplay.buzz";
    try { playerOrigin = new URL(iframeUrl).origin; } catch { /* keep default */ }
    const resp = await anikotoFetch(`${playerOrigin}/stream/getSources?id=${megaplayId}`, {
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
      outro,
      // Player origin (e.g. https://vidtube.site) — the segment CDN (nekostream)
      // hotlink-checks Referer against this. On Android there's no webRequest
      // header injection, so the HLS loader must send it explicitly.
      referer: playerOrigin,
    };
  }
};

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
          if (!_anikotoMalIds.has(paheId)) {
            try { await anikotoProvider.getEpisodes(paheId, 1); } catch { /* unreachable */ }
          }
          const mal = _anikotoMalIds.get(paheId);
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
