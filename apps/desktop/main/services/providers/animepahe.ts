import {
  StreamProvider,
  AnimeInfo,
  EpisodeInfo,
  StreamLink,
  StreamData,
  ProviderFeed,
  ProviderFeedResult,
} from "./types";
/**
 * AnimePahe integration — Cloudflare bypass via hidden BrowserWindow.
 *
 * Flow:
 *  1. search(title)              → PaheAnime[]
 *  2. getEpisodes(session, page) → PaheEpisode[]
 *  3. getStreamLinks(epSession, animeSession) → PaheLink[]
 *  4. resolveKwik(kwikUrl)       → { url, cookies } (stream URL + kwik session cookies)
 *
 * CF bypass:
 *  - A hidden BrowserWindow loads animepahe.pw once; CF challenge runs and
 *    sets cf_clearance in that session's cookie jar.
 *  - JSON API calls (search, episodes) use net.fetch with that session.
 *  - getStreamLinks fetches the HTML play page (same session) and regex-scrapes
 *    the resolution buttons — matching how the reference Python downloader works.
 *  - resolveKwik navigates the kwik embed page in a hidden BrowserWindow (like
 *    the Python Playwright approach), intercepts the m3u8 URL from the actual
 *    network request, and returns both the URL and the kwik session cookies.
 *    The CDN requires these cookies to serve segments.
 */

import { BrowserWindow, net, session as electronSession } from "electron";
import { getRuntimeConfig } from "../remote-config";
import {
  prefetchKwik,
  resetKwikForBaseChange,
  resolveKwik,
  syncPaheRuntimeConfig,
} from "./animepahe-kwik";

export {
  getAuthorizedPaheRequestHeaders,
  getKwikCookies,
  isAuthorizedPaheStreamUrl,
  syncPaheRuntimeConfig,
} from "./animepahe-kwik";
export type { AuthorizedPaheRequestHeaders } from "./animepahe-kwik";
import {
  animePaheEnabled,
  assertAnimePaheEnabled,
  getPaheBaseUrl,
  getManualPaheBaseUrl,
  paheBaseUrl,
  paheRoute,
  savePaheBaseUrl,
  selectConfiguredPaheBase as selectRuntimePaheBase,
} from "./animepahe-config";

export { getPaheBaseUrl } from "./animepahe-config";

export function setPaheBaseUrl(url: string): void {
  savePaheBaseUrl(url);
  // Force the CF window to reload against the new domain next time it's needed.
  if (_win && !_win.isDestroyed()) {
    _win.destroy();
    _win = null;
    _ready = false;
  }
  // Clear domain-derived caches — they were populated from the old host.
  _idsCache.clear();
  _reverseCache.clear();
  resetKwikForBaseChange();
}

function paheSelector(name: string): string {
  const value = getRuntimeConfig().providers.animepahe.selectors[name];
  if (!value) throw new Error(`Missing signed AnimePahe selector: ${name}`);
  return value;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagAttribute(tag: string, name: string): string | null {
  return new RegExp(`(?:^|\\s)${escapeRegex(name)}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag)?.[2] ?? null;
}

// ─── Persistent hidden window ─────────────────────────────────────────────────

let _win: BrowserWindow | null = null;
let _ready = false;
let _readyPromise: Promise<void> | null = null;

function selectConfiguredPaheBase(base: string) {
  if (selectRuntimePaheBase(base)) {
    if (_win && !_win.isDestroyed()) _win.destroy();
    _win = null;
    _ready = false;
    _readyPromise = null;
  }
}

function getPaheWindow(): Promise<BrowserWindow> {
  assertAnimePaheEnabled();
  if (_win && !_win.isDestroyed() && _ready) {
    return Promise.resolve(_win);
  }
  if (_readyPromise && _win && !_win.isDestroyed()) {
    return _readyPromise.then(() => {
      if (!_win || _win.isDestroyed()) throw new Error("AnimePahe window closed during init");
      return _win;
    });
  }

  _ready = false;
  _win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  _readyPromise = new Promise<void>((resolve) => {
    let resolved = false;
    let shown = false;
    function done() {
      if (resolved) return;
      resolved = true;
      _ready = true;
      // Hide the window again if we surfaced it for a manual CF solve.
      if (shown && _win && !_win.isDestroyed()) {
        try { _win.hide(); } catch { /* ignore */ }
      }
      resolve();
    }
    // Cloudflare serves an interstitial ("Just a moment...") that runs a JS
    // challenge and then reloads the page — did-finish-load fires for the
    // interstitial too. Only mark the session ready once the loaded page is
    // NOT a challenge page; otherwise API calls go out without cf_clearance
    // and 403.
    //
    // Modern CF often serves an INTERACTIVE challenge (Turnstile checkbox)
    // that a hidden window can never pass. If auto-clearance hasn't happened
    // after 10s, show the window so the user can click through it once —
    // cf_clearance persists in the session cookies afterwards. Hard cap at
    // 90s so a never-cleared page can't hang callers forever.
    const showTimer = setTimeout(() => {
      if (resolved || !_win || _win.isDestroyed()) return;
      shown = true;
      console.log("[pahe] CF challenge needs interaction — showing window for manual solve");
      try {
        _win.setTitle("AnimePahe — complete the verification check");
        _win.show();
        _win.focus();
      } catch { /* ignore */ }
    }, 10_000);
    const hardTimeout = setTimeout(() => {
      clearTimeout(showTimer);
      done();
    }, 90_000);
    const checkLoad = async () => {
      if (resolved || !_win || _win.isDestroyed()) return;
      try {
        const title: string = await _win.webContents.executeJavaScript("document.title", true);
        if (/just a moment|attention required|checking your browser|verify you are human/i.test(title)) {
          console.log("[pahe] CF challenge page detected, waiting for clearance…");
          return; // challenge reloads the page → did-finish-load fires again
        }
        console.log("[pahe] CF session ready:", title.slice(0, 60));
        clearTimeout(showTimer);
        clearTimeout(hardTimeout);
        done();
      } catch { /* page mid-navigation — wait for the next load */ }
    };
    _win!.webContents.on("did-finish-load", checkLoad);
    _win!.loadURL(paheBaseUrl() + paheRoute("home"));
    _win!.on("closed", () => {
      clearTimeout(showTimer);
      clearTimeout(hardTimeout);
      // Resolve so pending callers fail fast on the destroyed-window guard
      // instead of hanging until the hard timeout.
      done();
      _win = null;
      _ready = false;
      _readyPromise = null;
    });
  });

  return _readyPromise.then(() => {
    if (!_win || _win.isDestroyed()) throw new Error("AnimePahe window closed during init");
    return _win;
  });
}

// ─── Shared net.fetch helper (JSON API calls) ─────────────────────────────────
//
// Uses net.fetch with the hidden window's session so cf_clearance is included.
// More reliable than executeJavaScript for JSON endpoints in Electron 32.

/**
 * Run a fetch INSIDE the hidden window's page context. Unlike net.fetch, an
 * in-page request carries the full browser fingerprint (sec-fetch-* headers,
 * cookie ordering, etc.), so Cloudflare treats it like the site's own AJAX.
 * Returns { status, text } or null if the page context is unavailable.
 */
async function paheInPageFetch(
  win: BrowserWindow,
  url: string,
): Promise<{ status: number; text: string } | null> {
  try {
    const res = await win.webContents.executeJavaScript(
      `(async () => {
        try {
          const r = await fetch(${JSON.stringify(url)}, {
            headers: { "Accept": "application/json, text/html, text/plain, */*", "X-Requested-With": "XMLHttpRequest" },
            credentials: "include",
          });
          return { status: r.status, text: await r.text() };
        } catch (e) { return { status: 0, text: String(e) }; }
      })()`,
      true,
    );
    if (res && typeof res.status === "number") return res;
    return null;
  } catch {
    return null;
  }
}

// Serialize hidden-window navigations so concurrent calls don't race on the
// shared window.
let _paheNavQueue: Promise<unknown> = Promise.resolve();

/**
 * Fetch an HTML page (e.g. the /play/ page) by NAVIGATING the hidden window to
 * it and returning the rendered page's full HTML, or null. A top-level document
 * navigation carries the full browser fingerprint, which Cloudflare passes even
 * when an XHR / net.fetch is challenged. (This works only for real document
 * pages — AnimePahe's /api endpoint is XHR-only and 404s on document nav, so the
 * JSON API path relies on the in-page XHR fetch instead.) Navigations serialized.
 */
async function paheNavFetchHtml(url: string): Promise<string | null> {
  const run = async (): Promise<string | null> => {
    const win = await getPaheWindow().catch(() => null);
    if (!win || win.isDestroyed()) return null;
    try {
      await win.loadURL(url);
    } catch {
      // page may still have loaded despite a redirect/abort rejection
    }
    for (let i = 0; i < 12; i++) {
      if (win.isDestroyed()) return null;
      const title: string = await win.webContents
        .executeJavaScript("document.title", true)
        .catch(() => "");
      if (title && !/just a moment|verify you are human|attention required|checking your browser/i.test(title)) {
        const html: string = await win.webContents
          .executeJavaScript("document.documentElement.outerHTML", true)
          .catch(() => "");
        if (html) return html;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  };
  const p = _paheNavQueue.then(run, run);
  _paheNavQueue = p.catch(() => {});
  return p;
}

async function paheWindowFetchOnce(url: string, retried = false): Promise<any> {
  const win = await getPaheWindow();
  // `session` is valid at runtime in Electron 32 but absent from TS types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp = await (net.fetch as any)(url, {
    session: win.webContents.session,
    headers: {
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
      Referer: paheBaseUrl() + paheRoute("home"),
    },
  });
  if (!resp.ok) {
    if (resp.status === 403 || resp.status === 503 || resp.status === 429) {
      // 1. CF blocked the net.fetch fingerprint — retry from inside the page (XHR).
      //    The /api endpoint is XHR-only (document navigation 404s), so the
      //    in-page fetch is the only viable bypass here.
      const inPage = await paheInPageFetch(win, url);
      if (inPage && inPage.status >= 200 && inPage.status < 300) {
        try { return JSON.parse(inPage.text); } catch { /* fall through */ }
      }
      // 2. CF cookie may have expired. Destroy the hidden window once and retry
      //    — that re-runs the CF challenge and gets us a fresh cookie.
      if (!retried) {
        if (_win && !_win.isDestroyed()) { _win.destroy(); }
        _win = null;
        _ready = false;
        _readyPromise = null;
        return paheWindowFetchOnce(url, true);
      }
    }
    const body = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${body.slice(0, 120)}`);
  }
  return resp.json();
}

async function paheWindowFetch(url: string): Promise<any> {
  const manual = getManualPaheBaseUrl();
  const bases = manual
    ? [manual.replace(/\/+$/, "")]
    : getRuntimeConfig().providers.animepahe.baseUrls.map((base) => base.replace(/\/+$/, ""));
  let parsed: URL | null = null;
  try { parsed = new URL(url); } catch {}
  if (!parsed || !bases.includes(parsed.origin)) return paheWindowFetchOnce(url);
  const ordered = [getPaheBaseUrl(), ...bases.filter((base) => base !== getPaheBaseUrl())];
  let lastError: unknown = null;
  for (const base of ordered) {
    selectConfiguredPaheBase(base);
    try {
      return await paheWindowFetchOnce(`${base}${parsed.pathname}${parsed.search}${parsed.hash}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Every signed AnimePahe origin failed");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaheAnime {
  id: number;
  session: string;
  title: string;
  type: string;
  episodes: number;
  status: string;
  season: string;
  year: number;
  score: number;
  poster: string;
}

export interface PaheEpisode {
  id: number;
  anime_id: number;
  episode: number;
  episode2: number;
  edition: string;
  title: string;
  snapshot: string;
  disc: string;
  audio: string;
  duration: string;
  session: string;
  filler: number;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface PaheLatestEpisode {
  id: number;
  anime_id: number;
  anime_title: string;
  anime_session: string;
  episode: number;
  snapshot: string;  // episode screenshot URL
  filler: number;
  created_at: string;
}

export async function getLatestEpisodes(
  count = 30,
  page = 1,
): Promise<{ data: PaheLatestEpisode[]; total: number; lastPage: number }> {
  const data = await paheWindowFetch(
    `${paheBaseUrl()}${paheRoute("latest", { count, page })}`,
  );
  return {
    data: (data.data ?? []) as PaheLatestEpisode[],
    total: data.total ?? 0,
    lastPage: data.last_page ?? 1,
  };
}

/** In-process cache so repeated ShowDetail opens don't re-fetch. Bounded to avoid unbounded growth. */
const _idsCache = new Map<string, { malId?: number; anilistId?: number; kitsuId?: number }>();
const IDS_CACHE_MAX = 1000;
function _idsCacheSet(key: string, val: { malId?: number; anilistId?: number; kitsuId?: number }) {
  if (_idsCache.size >= IDS_CACHE_MAX) {
    const firstKey = _idsCache.keys().next().value;
    if (firstKey !== undefined) _idsCache.delete(firstKey);
  }
  _idsCache.set(key, val);
}

/** Resolve MAL / AniList IDs for an AnimePahe show.
 *
 * Priority (same strategy as MALSync):
 *  1. In-process memory cache (instant)
 *  2. api.malsync.moe community database (fast JSON, no CF needed)
 *  3. AnimePahe show-page meta tags (CF-cleared session, HTML parse)
 *
 * @param paheNumericId  The numeric `id` from AnimePahe search results
 * @param session        The UUID session string (used only for the HTML fallback)
 */
export async function getAnimeIds(
  paheNumericId: number,
  session: string,
): Promise<{ malId?: number; anilistId?: number; kitsuId?: number }> {
  assertAnimePaheEnabled();
  const cacheKey = String(paheNumericId);
  if (_idsCache.has(cacheKey)) return _idsCache.get(cacheKey)!;

  // ── 1. MALSync community API ────────────────────────────────────────────────
  try {
    const resp = await fetch(
      `https://api.malsync.moe/page/animepahe/${paheNumericId}`,
      { headers: { "User-Agent": "AniTrack/1.0" } },
    );
    if (resp.ok) {
      const json: any = await resp.json();
      // Response shape: { malUrl: "https://myanimelist.net/anime/123", aniUrl: "https://anilist.co/anime/456" }
      const malMatch = (json.malUrl ?? "").match(/\/anime\/(\d+)/);
      const alMatch  = (json.aniUrl  ?? "").match(/\/anime\/(\d+)/);
      if (malMatch || alMatch) {
        const result = {
          malId:     malMatch ? Number(malMatch[1]) : undefined,
          anilistId: alMatch  ? Number(alMatch[1])  : undefined,
        };
        _idsCacheSet(cacheKey, result);
        return result;
      }
    }
  } catch { /* fall through to HTML fallback */ }

  // ── 2. AnimePahe page meta tags (CF-cleared session) ───────────────────────
  try {
    const win = await getPaheWindow();
    const resp = await (net.fetch as any)(`${paheBaseUrl()}${paheRoute("anime", { session })}`, {
      session: win.webContents.session,
      headers: { Referer: paheBaseUrl() + paheRoute("home") },
    });
    if (resp.ok) {
      const html: string = await resp.text();
      // Tolerate any attribute order, single or double quotes, extra whitespace.
      const metaRe = (name: string) =>
        new RegExp(
          `<meta[^>]+(?:name=["']${name}["'][^>]+content=["'](\\d+)["']|content=["'](\\d+)["'][^>]+name=["']${name}["'])`,
          "i",
        );
      const grab = (name: string): number | undefined => {
        const m = html.match(metaRe(name));
        const v = m?.[1] ?? m?.[2];
        return v ? Number(v) : undefined;
      };
      const result = {
        malId:     grab("myanimelist"),
        anilistId: grab("anilist"),
        kitsuId:   grab("kitsu"),
      };
      _idsCacheSet(cacheKey, result);
      return result;
    }
  } catch { /* swallow */ }

  return {};
}

/** In-process cache for reverse ID lookups (AniList/MAL → AnimePahe session). */
const _reverseCache = new Map<string, PaheAnime | null>();
const REVERSE_CACHE_MAX = 500;
function _reverseCacheSet(key: string, val: PaheAnime | null) {
  if (_reverseCache.size >= REVERSE_CACHE_MAX) {
    const firstKey = _reverseCache.keys().next().value;
    if (firstKey !== undefined) _reverseCache.delete(firstKey);
  }
  _reverseCache.set(key, val);
}

/**
 * Reverse lookup: given an AniList or MAL ID, find the AnimePahe show directly.
 *
 * Uses the MALSync community API:
 *   https://api.malsync.moe/anilist/anime/{id}
 *   https://api.malsync.moe/mal/anime/{id}
 *
 * Returns a synthetic PaheAnime object (with session + id) or null if not found.
 */
export async function findByExternalId(
  anilistId?: number,
  malId?: number,
): Promise<PaheAnime | null> {
  assertAnimePaheEnabled();
  const cacheKey = `al:${anilistId ?? "?"}/mal:${malId ?? "?"}`;
  if (_reverseCache.has(cacheKey)) return _reverseCache.get(cacheKey)!;

  const tryUrl = async (url: string) => {
    const resp = await fetch(url, { headers: { "User-Agent": "AniTrack/1.0" } });
    if (!resp.ok) return null;
    const json: any = await resp.json();
    // Response: { Sites: { Animepahe: { "numericId": { identifier: "uuid-session", title, url } } } }
    const paheEntries: Record<string, any> = json?.Sites?.Animepahe ?? {};
    const keys = Object.keys(paheEntries);
    if (keys.length === 0) return null;
    const key = keys[0];
    const entry = paheEntries[key];
    // Extract session UUID from the AnimePahe URL or the `identifier` field.
    const urlMatch = (entry.url ?? "").match(/\/anime\/([a-f0-9-]{36})/i);
    const session = urlMatch?.[1] ?? entry.identifier ?? null;
    if (!session) return null;
    return {
      id: Number(key),
      session,
      title: entry.title ?? json.title ?? "",
      type: "",
      status: "",
      season: "",
      year: 0,
      episodes: 0,
      score: 0,
      poster: entry.image ?? "",
    } as PaheAnime;
  };

  try {
    let result: PaheAnime | null = null;
    if (anilistId) result = await tryUrl(`https://api.malsync.moe/anilist/anime/${anilistId}`);
    if (!result && malId) result = await tryUrl(`https://api.malsync.moe/mal/anime/${malId}`);
    _reverseCacheSet(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}


export function prewarm(): void {
  if (!animePaheEnabled()) return;
  getPaheWindow().catch(() => {
    /* ignore */
  });
}


export class AnimePaheProvider implements StreamProvider {
  readonly id = "animepahe";
  readonly name = "AnimePahe";
  readonly capabilities = {
    latest: true,
    externalIds: true,
    downloads: true,
    prefetch: true,
    configurableBaseUrl: true,
    streamVariants: "quality" as const,
    episodePageSize: 30,
  };

  private linksCache = new Map<string, { links: StreamLink[]; timestamp: number }>();
  private readonly LINKS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  async search(query: string): Promise<AnimeInfo[]> {
    assertAnimePaheEnabled();
    const data = await paheWindowFetch(
      paheBaseUrl() + paheRoute("search", { query }),
    );
    const results = (data.data ?? []) as PaheAnime[];
    return results.map(r => ({
      id: r.session,
      paheId: r.id,
      externalLookupId: r.id,
      session: r.session,
      providerId: this.id,
      title: r.title,
      poster: r.poster,
      episodes: r.episodes,
      type: r.type,
      status: r.status,
      season: r.season,
      year: r.year,
      score: r.score
    }));
  }

  async getEpisodes(animeId: string, page = 1): Promise<{ data: EpisodeInfo[]; total: number; lastPage: number }> {
    assertAnimePaheEnabled();
    const data = await paheWindowFetch(
      paheBaseUrl() + paheRoute("episodes", { animeId, page }),
    );
    const results = (data.data ?? []) as PaheEpisode[];
    return {
      data: results.map(r => ({
        id: r.session,
        episodeNumber: r.episode,
        title: r.title || `Episode ${r.episode}`,
        snapshot: r.snapshot,
        filler: r.filler === 1
      })),
      total: data.total ?? 0,
      lastPage: data.last_page ?? 1
    };
  }

  async getStreamLinks(episodeId: string, animeId: string): Promise<StreamLink[]> {
    assertAnimePaheEnabled();
    const cacheKey = `${animeId}:${episodeId}`;
    const cached = this.linksCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < this.LINKS_CACHE_TTL)) {
      console.log(`[AnimePahe] getStreamLinks cache HIT for: ${cacheKey}`);
      return cached.links;
    }

    const playUrl = paheBaseUrl() + paheRoute("play", { animeId, episodeId });

    async function fetchPlayPage(retried = false): Promise<string> {
      const win = await getPaheWindow();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = await (net.fetch as any)(playUrl, {
        session: win.webContents.session,
        headers: {
          Accept: "text/html,application/xhtml+xml,*/*",
          Referer: paheBaseUrl() + paheRoute("home"),
        },
      });
      if (!resp.ok) {
        if (resp.status === 403 || resp.status === 503 || resp.status === 429) {
          // 1. XHR from inside the page.
          const inPage = await paheInPageFetch(win, playUrl);
          if (inPage && inPage.status >= 200 && inPage.status < 300) return inPage.text;
          // 2. Top-level navigation (passes CF where XHR doesn't).
          const navHtml = await paheNavFetchHtml(playUrl);
          if (navHtml) return navHtml;
          // 3. Fresh CF challenge via window recreate.
          if (!retried) {
            if (_win && !_win.isDestroyed()) { _win.destroy(); }
            _win = null;
            _ready = false;
            _readyPromise = null;
            return fetchPlayPage(true);
          }
        }
        const body = await resp.text().catch(() => "");
        throw new Error(`Play page HTTP ${resp.status} ${resp.statusText}: ${body.slice(0, 120)}`);
      }
      return resp.text();
    }
    const html = await fetchPlayPage();
    const links = [];

    const tagRe = /<button[^>]*>/gi;
    let tagM;
    while ((tagM = tagRe.exec(html)) !== null) {
      const tag = tagM[0];
      const source = tagAttribute(tag, paheSelector("streamUrlAttribute"));
      if (!source || !source.includes("kwik")) continue;
      links.push({
        id: source,
        quality: tagAttribute(tag, paheSelector("resolutionAttribute")) ?? "?",
        audio: tagAttribute(tag, paheSelector("audioAttribute")) ?? "jpn",
      });
    }

    if (links.length === 0) {
      const kwikRe = /https?:\/\/kwik\.[^\s"'<>]+/g;
      let km;
      while ((km = kwikRe.exec(html)) !== null) {
        links.push({ id: km[0], quality: "?", audio: "jpn" });
      }
    }

    if (links.length === 0) {
      throw new Error("No stream links found on play page. Page may require a newer CF session.");
    }

    links.sort((a, b) => Number(b.quality) - Number(a.quality));

    // Store in cache (bounded — evict the oldest entry once full)
    if (this.linksCache.size >= 200) {
      const firstKey = this.linksCache.keys().next().value;
      if (firstKey !== undefined) this.linksCache.delete(firstKey);
    }
    this.linksCache.set(cacheKey, { links, timestamp: Date.now() });

    return links;
  }

  async resolveStream(linkId: string): Promise<StreamData> {
    assertAnimePaheEnabled();
    const { url, cookies } = await resolveKwik(linkId);
    return { url, cookies, referer: new URL(linkId).origin };
  }

  getExternalIds(animeId: string, lookupId?: string | number) {
    return getAnimeIds(Number(lookupId), animeId);
  }

  async findByExternalId(anilistId?: number, malId?: number): Promise<AnimeInfo | null> {
    const result = await findByExternalId(anilistId, malId);
    if (!result) return null;
    return {
      id: result.session,
      providerId: this.id,
      externalLookupId: result.id,
      title: result.title,
      poster: result.poster,
      episodes: result.episodes,
      type: result.type,
      status: result.status,
      season: result.season,
      year: result.year,
      score: result.score,
    };
  }

  async getFeed(feed: ProviderFeed, page = 1, count = 30): Promise<ProviderFeedResult> {
    if (feed !== "latest") throw new Error(`${this.name} does not support the ${feed} feed`);
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeCount = Number.isFinite(count) && count > 0 ? Math.min(100, Math.floor(count)) : 30;
    const result = await getLatestEpisodes(safeCount, safePage);
    return {
      providerId: this.id,
      feed,
      page: safePage,
      total: result.total,
      lastPage: result.lastPage,
      groups: [{
        id: "latest",
        title: "Latest",
        items: result.data.map((item) => ({
          id: String(item.id),
          providerId: this.id,
          animeId: item.anime_session,
          title: item.anime_title,
          snapshot: item.snapshot,
          episodeNumber: item.episode,
          publishedAt: item.created_at,
          externalLookupId: item.anime_id,
        })),
      }],
    };
  }

  prefetch(linkId: string): void { prefetchKwik(linkId); }
  prewarm(): void { prewarm(); }
  onConfigChanged(): void { syncPaheRuntimeConfig(); }
  getBaseUrl(): string { return getPaheBaseUrl(); }
  setBaseUrl(url: string): void { setPaheBaseUrl(url); }
}
