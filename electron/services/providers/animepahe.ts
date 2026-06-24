import { StreamProvider, AnimeInfo, EpisodeInfo, StreamLink, StreamData } from "./types";
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
import { SimpleStore } from "../store";

interface PaheSettings { baseUrl?: string }
const _paheStore = new SimpleStore<PaheSettings>("anitrack-pahe-settings");

export function getPaheBaseUrl(): string {
  return _paheStore.get("baseUrl") ?? "https://animepahe.pw";
}

export function setPaheBaseUrl(url: string): void {
  let clean = url.trim().replace(/\/$/, "");
  // Auto-prepend https:// if missing, validate it parses as a URL.
  if (!/^https?:\/\//i.test(clean)) clean = "https://" + clean;
  try { new URL(clean); } catch { throw new Error(`Invalid URL: ${url}`); }
  _paheStore.set("baseUrl", clean);
  // Force the CF window to reload against the new domain next time it's needed.
  if (_win && !_win.isDestroyed()) {
    _win.destroy();
    _win = null;
    _ready = false;
  }
  // Clear domain-derived caches — they were populated from the old host.
  _idsCache.clear();
  _reverseCache.clear();
  _kwikUrlCache.clear();
  _lastKwikCookies = "";
  _lastKwikCookiesAt = 0;
}

// Dynamic getter so every call picks up runtime changes.
function BASE() { return getPaheBaseUrl(); }

// ─── Persistent hidden window ─────────────────────────────────────────────────

let _win: BrowserWindow | null = null;
let _ready = false;
let _readyPromise: Promise<void> | null = null;

function getPaheWindow(): Promise<BrowserWindow> {
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
    _win!.loadURL(BASE() + "/");
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

async function paheWindowFetch(url: string, retried = false): Promise<any> {
  const win = await getPaheWindow();
  // `session` is valid at runtime in Electron 32 but absent from TS types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp = await (net.fetch as any)(url, {
    session: win.webContents.session,
    headers: {
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
      Referer: BASE() + "/",
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
        return paheWindowFetch(url, true);
      }
    }
    const body = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${body.slice(0, 120)}`);
  }
  return resp.json();
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
    `${BASE()}/api?m=airing&l=${count}&sort=session_id_desc&page=${page}`,
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
    const resp = await (net.fetch as any)(`${BASE()}/anime/${session}`, {
      session: win.webContents.session,
      headers: { Referer: BASE() + "/" },
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

// ─── Kwik resolver ───────────────────────────────────────────────────────────
//
// Strategy (mirrors the Python Playwright approach in animepahe.py):
//  1. Navigate the kwik embed URL in a hidden BrowserWindow so that:
//     - The kwik JS executes and sets session cookies (needed by the CDN)
//     - We can intercept the actual m3u8/video network request
//  2. Return { url, cookies } — the stream URL + kwik session cookies.
//     The cookies are required when the renderer fetches segments from the CDN.
//
// Fast-path JS-unpacking fallback is kept for reference but not used as primary
// because it doesn't set the CDN-authorising cookies.
// CDN URL patterns — covers all known AnimePahe video CDN backends.
const CDN_HOSTS = [
  "*://*.owocdn.top/*",
  "*://*.owocdn.com/*",
  "*://*.uwucdn.top/*",
  "*://*.llnwi.net/*",
];
const CDN_RE = /https?:\/\/[^"'\s<>]*(?:owocdn\.(?:top|com)|uwucdn\.top|llnwi\.net)[^"'\s<>]*/;
const VIDEO_RE = /https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/;

// ─── Kwik cookie cache ────────────────────────────────────────────────────────

// Last-captured kwik session cookies, injected into CDN requests at the
// Electron network layer (main.ts onBeforeSendHeaders).
let _lastKwikCookies = "";
let _lastKwikCookiesAt = 0;
const COOKIE_TTL_MS = 30 * 60_000; // refresh cookies after 30 min

export function getKwikCookies(): string { return _lastKwikCookies; }

// Resolved URL cache — avoids re-resolving the same kwik URL within a session.
const _kwikUrlCache = new Map<string, { url: string; at: number }>();
const URL_TTL_MS = 2 * 60 * 60_000; // HLS URLs are valid for ~2 h
const KWIK_CACHE_MAX = 500;
function _kwikUrlCacheSet(key: string, val: { url: string; at: number }) {
  if (_kwikUrlCache.size >= KWIK_CACHE_MAX) {
    const firstKey = _kwikUrlCache.keys().next().value;
    if (firstKey !== undefined) _kwikUrlCache.delete(firstKey);
  }
  _kwikUrlCache.set(key, val);
}

// In-flight deduplication map.
const _kwikPending = new Map<string, Promise<{ url: string; cookies: string }>>();

// ─── Persistent kwik BrowserWindow ───────────────────────────────────────────
//
// We keep ONE hidden window alive (using the persist:kwik session) instead of
// creating a new one per episode. On the first call it loads kwik.cx, runs the
// CF challenge, and captures cookies. Subsequent navigations reuse the same
// window+session so CF is already cleared — page loads in ~1 s instead of 5-10 s.

let _kwikWin: BrowserWindow | null = null;
// Callback installed by the currently-running _resolveKwikBrowser call.
let _kwikInterceptCb: ((url: string) => void) | null = null;

function getKwikWindow(): BrowserWindow {
  if (_kwikWin && !_kwikWin.isDestroyed()) return _kwikWin;

  _kwikWin = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: "persist:kwik",
    },
  });

  // Set up session-level CDN interceptor ONCE — it stays alive for the whole
  // session and routes every intercepted URL to whatever callback is current.
  const sess = _kwikWin.webContents.session;
  sess.webRequest.onBeforeRequest({ urls: CDN_HOSTS }, async (details, callback) => {
    const url = details.url;
    const isStream = url.includes(".m3u8") || url.includes(".mp4") || CDN_RE.test(url);
    if (!isStream || !_kwikInterceptCb) { callback({}); return; }

    const cb = _kwikInterceptCb;
    _kwikInterceptCb = null; // consume immediately so we don't double-fire
    callback({});

    const cookieList = await sess.cookies.get({}).catch(() => []);
    const cookies = cookieList.map((c) => `${c.name}=${c.value}`).join("; ");
    _lastKwikCookies = cookies;
    _lastKwikCookiesAt = Date.now();
    if (process.env.NODE_ENV === "development") {
      console.log("[kwik-browser] intercepted:", url.slice(0, 80), "cookies:", cookies.length);
    }
    cb(url);
  });

  _kwikWin.on("closed", () => { _kwikWin = null; _kwikInterceptCb = null; });
  return _kwikWin;
}

// ─── Public resolver ──────────────────────────────────────────────────────────

/**
 * Resolve a kwik embed URL → { url, cookies }.
 *
 * Fast path (subsequent episodes, ~200 ms):
 *   JS-unpack the kwik page to extract the URL + inject cached cookies.
 *
 * Slow path (first episode or cookie expiry, ~3-8 s):
 *   Navigate the persistent kwik BrowserWindow, intercept the CDN request,
 *   capture fresh cookies — then cache them for subsequent calls.
 */
export async function resolveKwik(
  kwikUrl: string,
): Promise<{ url: string; cookies: string }> {
  // 1. URL cache hit
  const cached = _kwikUrlCache.get(kwikUrl);
  if (cached && Date.now() - cached.at < URL_TTL_MS) {
    return { url: cached.url, cookies: _lastKwikCookies };
  }

  // 2. In-flight deduplication
  if (_kwikPending.has(kwikUrl)) {
    return _kwikPending.get(kwikUrl)!;
  }

  // 3. Choose fast or slow path
  const cookiesFresh = _lastKwikCookies && (Date.now() - _lastKwikCookiesAt < COOKIE_TTL_MS);
  const promise = cookiesFresh
    ? resolveKwikFast(kwikUrl)
        .then((url) => {
          _kwikUrlCacheSet(kwikUrl, { url, at: Date.now() });
          return { url, cookies: _lastKwikCookies };
        })
        .catch(() => _resolveKwikBrowser(kwikUrl))
    : _resolveKwikBrowser(kwikUrl);

  _kwikPending.set(kwikUrl, promise);
  // .catch on the derived chain so a rejected resolve doesn't surface as an
  // unhandled rejection — the caller still receives the original rejection.
  promise.finally(() => _kwikPending.delete(kwikUrl)).catch(() => {});
  return promise;
}

/** Pre-resolve a kwik URL silently in the background (call while current ep plays). */
export function prefetchKwik(kwikUrl: string): void {
  if (_kwikPending.has(kwikUrl)) return;
  const cached = _kwikUrlCache.get(kwikUrl);
  if (cached && Date.now() - cached.at < URL_TTL_MS) return;
  resolveKwik(kwikUrl).catch(() => {});
}

async function _resolveKwikBrowser(
  kwikUrl: string,
): Promise<{ url: string; cookies: string }> {
  return new Promise((resolve, reject) => {
    const win = getKwikWindow();
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      _kwikInterceptCb = null;
      resolveKwikFast(kwikUrl)
        .then((url) => resolve({ url, cookies: _lastKwikCookies }))
        .catch(reject);
    }, 20_000);

    _kwikInterceptCb = (url: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      _kwikUrlCacheSet(kwikUrl, { url, at: Date.now() });
      resolve({ url, cookies: _lastKwikCookies });
    };

    win.loadURL(kwikUrl, { httpReferrer: BASE() + "/" }).catch((e) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        _kwikInterceptCb = null;
        reject(e);
      }
    });
  });
}

// ─── Fast JS-unpack fallback (no cookies, used only when browser times out) ──

async function resolveKwikFast(kwikUrl: string): Promise<string> {
  const KWIK_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  const resp = await net.fetch(kwikUrl, {
    headers: { Referer: BASE() + "/", Accept: "text/html,*/*", "User-Agent": KWIK_UA },
  } as RequestInit);
  if (!resp.ok) throw new Error(`kwik HTTP ${resp.status}`);
  const html = await resp.text();

  // Direct URL in HTML
  const directM = html.match(/(?:source|file)['"]\s*[=:]\s*['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/);
  if (directM) return directM[1].replace(/\\/g, "");

  // Unpack JS blocks
  for (const block of extractAllPackedEvals(html)) {
    const unpacked = unpackJs(block);
    const m1 = unpacked.match(/(?:source|file|src)['"]\s*[=:]\s*['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/);
    if (m1) return m1[1].replace(/\\/g, "");
    const m2 = unpacked.match(VIDEO_RE) ?? unpacked.match(CDN_RE);
    if (m2) return m2[0];
  }

  // Raw scan
  const raw = html.match(VIDEO_RE) ?? html.match(CDN_RE);
  if (raw) return raw[0];

  throw new Error("Could not extract stream URL from kwik page");
}

function extractAllPackedEvals(html: string): string[] {
  const results: string[] = [];
  let searchFrom = 0;
  while (true) {
    const rel = html.slice(searchFrom).search(/eval\(function\(p,a,c,k,e[,{]/);
    if (rel === -1) break;
    const absStart = searchFrom + rel;
    let depth = 0, inStr: string | null = null, escape = false, found = false;
    for (let i = absStart + 4; i < html.length; i++) {
      const ch = html[i];
      if (escape) { escape = false; continue; }
      if (inStr) { if (ch === "\\") { escape = true; continue; } if (ch === inStr) inStr = null; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
      if (ch === "(") { depth++; continue; }
      if (ch === ")") { depth--; if (depth === 0) { results.push(html.slice(absStart, i + 1)); searchFrom = i + 1; found = true; break; } }
    }
    if (!found) break;
  }
  return results;
}

function unpackJs(packed: string): string {
  // SECURITY: never eval / vm.run this. It is attacker-controlled script from the
  // third-party kwik CDN page, and `vm` is NOT a sandbox — host objects passed into
  // the context leak the Function constructor, allowing a crafted page to run code
  // in the main process (RCE). Decode the dean-edwards packer purely as a string.
  try {
    const match = packed.match(/}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/);
    if (!match) return packed;
    const [, encoded, radixStr, , keysStr] = match;
    const radix = parseInt(radixStr, 10);
    const keys = keysStr.split("|");
    function baseN(n: number): string {
      const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      if (n === 0) return "0"; let r = "";
      while (n > 0) { r = chars[n % radix] + r; n = Math.floor(n / radix); } return r;
    }
    const lookup: Record<string, string> = {};
    keys.forEach((w, i) => { if (w) lookup[baseN(i)] = w; });
    return encoded.replace(/\b\w+\b/g, (w) => lookup[w] ?? w);
  } catch { return packed; }
}

export function prewarm(): void {
  getPaheWindow().catch(() => {
    /* ignore */
  });
}


export class AnimePaheProvider implements StreamProvider {
  id = "animepahe";
  name = "AnimePahe";

  private linksCache = new Map<string, { links: StreamLink[]; timestamp: number }>();
  private readonly LINKS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  async search(query: string): Promise<AnimeInfo[]> {
    const data = await paheWindowFetch(
      BASE() + "/api?m=search&q=" + encodeURIComponent(query),
    );
    const results = (data.data ?? []) as PaheAnime[];
    return results.map(r => ({
      id: r.session,
      paheId: r.id,
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
    const data = await paheWindowFetch(
      BASE() + "/api?m=release&id=" + animeId + "&sort=episode_asc&page=" + page,
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
    const cacheKey = `${animeId}:${episodeId}`;
    const cached = this.linksCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < this.LINKS_CACHE_TTL)) {
      console.log(`[AnimePahe] getStreamLinks cache HIT for: ${cacheKey}`);
      return cached.links;
    }

    const playUrl = BASE() + "/play/" + animeId + "/" + episodeId;

    async function fetchPlayPage(retried = false): Promise<string> {
      const win = await getPaheWindow();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = await (net.fetch as any)(playUrl, {
        session: win.webContents.session,
        headers: {
          Accept: "text/html,application/xhtml+xml,*/*",
          Referer: BASE() + "/",
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
      const srcM = /data-src="([^"]+)"/.exec(tag);
      if (!srcM || !srcM[1].includes("kwik")) continue;
      const resM = /data-resolution="([^"]*)"/.exec(tag);
      const audM = /data-audio="([^"]*)"/.exec(tag);
      links.push({
        id: srcM[1],
        quality: resM?.[1] ?? "?",
        audio: audM?.[1] ?? "jpn",
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
    const { url, cookies } = await resolveKwik(linkId);
    return { url, cookies };
  }
}
