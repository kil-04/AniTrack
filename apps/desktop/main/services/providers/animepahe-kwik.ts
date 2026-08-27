import { BrowserWindow, net } from "electron";
import { getRuntimeConfig } from "../remote-config";
import {
  animePaheEnabled,
  assertAnimePaheEnabled,
  paheBaseUrl,
  paheRoute,
} from "./animepahe-config";

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
// Build the interception filter from the signed runtime configuration. AnimePahe
// rotates CDN families; keeping a second hard-coded allow-list here meant a new
// (already trusted) family could resolve in the fast path but never be captured
// by the browser path.
function cdnRequestPatterns(): string[] {
  const hosts = getRuntimeConfig().providers.animepahe.streamHostFragments
    .filter((host) => !host.startsWith("kwik."));
  return hosts.flatMap((host) => [`*://${host}/*`, `*://*.${host}/*`]);
}
const CDN_RE = /https?:\/\/[^"'\s<>]*(?:owocdn\.(?:top|com)|uwucdn\.top|llnwi\.net)[^"'\s<>]*/;
const VIDEO_RE = /https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/;

// ─── Kwik cookie cache ────────────────────────────────────────────────────────

// Last-captured kwik session cookies, injected into CDN requests at the
// Electron network layer (main.ts onBeforeSendHeaders).
let _lastKwikCookies = "";
let _lastKwikCookiesAt = 0;
const COOKIE_TTL_MS = 30 * 60_000; // refresh cookies after 30 min
export interface AuthorizedPaheRequestHeaders {
  host: string;
  referer: string;
  cookie: string;
}

const _authorizedStreamHosts = new Map<string, { authorizedAt: number; referer: string }>();

export function getKwikCookies(): string { return animePaheEnabled() ? _lastKwikCookies : ""; }

function kwikCookiesFresh(): boolean {
  return Boolean(_lastKwikCookies) && Date.now() - _lastKwikCookiesAt < COOKIE_TTL_MS;
}

function authorizeStreamUrl(raw: string, kwikUrl: string) {
  assertAnimePaheEnabled();
  const url = new URL(raw);
  const kwik = new URL(kwikUrl);
  const rules = getRuntimeConfig().providers.animepahe.streamHostFragments;
  const host = url.hostname.toLowerCase();
  const trustedHost = rules.some((rule) => host === rule || host.endsWith(`.${rule}`));
  const path = url.pathname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || !trustedHost ||
      !(path.endsWith(".m3u8") || path.endsWith(".mp4"))) {
    throw new Error("Kwik returned an untrusted stream URL");
  }
  _authorizedStreamHosts.set(host, { authorizedAt: Date.now(), referer: kwik.origin });
}

function assertTrustedKwikUrl(raw: string) {
  assertAnimePaheEnabled();
  const url = new URL(raw);
  const rules = getRuntimeConfig().providers.animepahe.streamHostFragments
    .filter((rule) => rule.startsWith("kwik."));
  const host = url.hostname.toLowerCase();
  const trustedHost = rules.some((rule) => host === rule || host.endsWith(`.${rule}`));
  if (url.protocol !== "https:" || url.username || url.password || !trustedHost) {
    throw new Error("Untrusted Kwik embed URL");
  }
}

export function isAuthorizedPaheStreamUrl(raw: string): boolean {
  try {
    if (!animePaheEnabled()) return false;
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    const authorization = _authorizedStreamHosts.get(host);
    if (!authorization || Date.now() - authorization.authorizedAt > URL_TTL_MS) {
      if (authorization) _authorizedStreamHosts.delete(host);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function getAuthorizedPaheRequestHeaders(raw: string): AuthorizedPaheRequestHeaders | null {
  if (!isAuthorizedPaheStreamUrl(raw)) return null;
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const authorization = _authorizedStreamHosts.get(host);
  if (!authorization) return null;
  return {
    host,
    referer: authorization.referer,
    cookie: getKwikCookies(),
  };
}

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

export function resetKwikForBaseChange(): void {
  _kwikUrlCache.clear();
  _authorizedStreamHosts.clear();
  _lastKwikCookies = "";
  _lastKwikCookiesAt = 0;
}

// ─── Persistent kwik BrowserWindow ───────────────────────────────────────────
//
// We keep ONE hidden window alive (using the persist:kwik session) instead of
// creating a new one per episode. On the first call it loads kwik.cx, runs the
// CF challenge, and captures cookies. Subsequent navigations reuse the same
// window+session so CF is already cleared — page loads in ~1 s instead of 5-10 s.

let _kwikWin: BrowserWindow | null = null;
let _kwikRequestConfigKey = "";
// Callback installed by the currently-running _resolveKwikBrowser call.
let _kwikInterceptCb: ((url: string) => void) | null = null;
// A single BrowserWindow cannot navigate to two Kwik embeds at once. Playback
// prefetch and the download queue can otherwise replace each other's callback,
// leaving one resolve hung until its 20-second timeout.
let _kwikBrowserQueue: Promise<unknown> = Promise.resolve();

function kwikRequestConfigKey(): string {
  const runtime = getRuntimeConfig();
  return JSON.stringify({
    enabled: runtime.providers.animepahe.enabled && runtime.features.animepaheStreaming,
    patterns: cdnRequestPatterns(),
  });
}

/** Apply signed host-rule changes without requiring an app restart. */
export function syncPaheRuntimeConfig(): void {
  const nextKey = kwikRequestConfigKey();
  if (nextKey === _kwikRequestConfigKey) return;
  _kwikRequestConfigKey = nextKey;
  _kwikInterceptCb = null;
  _kwikUrlCache.clear();
  _authorizedStreamHosts.clear();
  if (_kwikWin && !_kwikWin.isDestroyed()) _kwikWin.destroy();
  _kwikWin = null;
}

function getKwikWindow(): BrowserWindow {
  assertAnimePaheEnabled();
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
  _kwikRequestConfigKey = kwikRequestConfigKey();

  // Set up session-level CDN interceptor ONCE — it stays alive for the whole
  // session and routes every intercepted URL to whatever callback is current.
  const sess = _kwikWin.webContents.session;
  sess.webRequest.onBeforeRequest({ urls: cdnRequestPatterns() }, async (details, callback) => {
    if (!animePaheEnabled()) {
      _kwikInterceptCb = null;
      callback({ cancel: true });
      return;
    }
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
  assertTrustedKwikUrl(kwikUrl);
  // 1. URL cache hit
  const cached = _kwikUrlCache.get(kwikUrl);
  // A cached URL is useful only while its matching hotlink cookies are fresh.
  // Previously a two-hour URL could be paired with 30-minute cookies, causing
  // playback/download failures after the app had been open for a while.
  if (cached && Date.now() - cached.at < URL_TTL_MS && kwikCookiesFresh()) {
    authorizeStreamUrl(cached.url, kwikUrl);
    return { url: cached.url, cookies: _lastKwikCookies };
  }

  // 2. In-flight deduplication
  if (_kwikPending.has(kwikUrl)) {
    return _kwikPending.get(kwikUrl)!;
  }

  // 3. Choose fast or slow path
  const cookiesFresh = kwikCookiesFresh();
  const promise = (cookiesFresh
    ? resolveKwikFast(kwikUrl)
        .then((url) => {
          authorizeStreamUrl(url, kwikUrl);
          _kwikUrlCacheSet(kwikUrl, { url, at: Date.now() });
          return { url, cookies: _lastKwikCookies };
        })
        .catch(() => _resolveKwikBrowser(kwikUrl))
    : _resolveKwikBrowser(kwikUrl)).then((result) => {
      authorizeStreamUrl(result.url, kwikUrl);
      return result;
    });

  _kwikPending.set(kwikUrl, promise);
  // .catch on the derived chain so a rejected resolve doesn't surface as an
  // unhandled rejection — the caller still receives the original rejection.
  promise.finally(() => _kwikPending.delete(kwikUrl)).catch(() => {});
  return promise;
}

/** Pre-resolve a kwik URL silently in the background (call while current ep plays). */
export function prefetchKwik(kwikUrl: string): void {
  if (!animePaheEnabled()) return;
  if (_kwikPending.has(kwikUrl)) return;
  const cached = _kwikUrlCache.get(kwikUrl);
  if (cached && Date.now() - cached.at < URL_TTL_MS && kwikCookiesFresh()) return;
  resolveKwik(kwikUrl).catch(() => {});
}

async function _resolveKwikBrowser(
  kwikUrl: string,
): Promise<{ url: string; cookies: string }> {
  const run = () => _resolveKwikBrowserOnce(kwikUrl);
  const pending = _kwikBrowserQueue.then(run, run);
  _kwikBrowserQueue = pending.catch(() => {});
  return pending;
}

function _resolveKwikBrowserOnce(
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

    win.loadURL(kwikUrl, { httpReferrer: paheBaseUrl() + paheRoute("home") }).catch((e) => {
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
  assertAnimePaheEnabled();
  const KWIK_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  const resp = await net.fetch(kwikUrl, {
    headers: { Referer: paheBaseUrl() + paheRoute("home"), Accept: "text/html,*/*", "User-Agent": KWIK_UA },
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
