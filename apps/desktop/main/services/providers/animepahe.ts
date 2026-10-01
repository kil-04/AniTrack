import type {
  StreamProvider,
  AnimeInfo,
  EpisodeInfo,
  StreamLink,
  StreamData,
  ProviderFeed,
  ProviderFeedResult,
} from "./types";
/**
 * AnimePahe integration with an app-owned homepage verification session.
 *
 * Flow:
 *  1. search(title)              → PaheAnime[]
 *  2. getEpisodes(session, page) → PaheEpisode[]
 *  3. getStreamLinks(epSession, animeSession) → PaheLink[]
 *  4. resolveKwik(kwikUrl)       → { url, cookies } (stream URL + kwik session cookies)
 *
 * Session handling:
 *  - The homepage window stays hidden for an ordinary load, and is shown for
 *    the user to complete any required verification themselves.
 *  - JSON and play-page requests are fixed same-origin GETs issued from an
 *    isolated world of that verified page (see paheSessionRequest).
 *  - Challenge/rate responses stop the attempt; the window is revalidated once
 *    to show the check, with no request retry, alternative transport, or
 *    origin rotation.
 *  - resolveKwik fetches the public link once, parses bounded static HTML data,
 *    and captures that link's ordinary session cookies for the resolved stream.
 *    No player/ad embed is executed to discover media or establish cookies.
 */

import { BrowserWindow } from "electron";
import { getRuntimeConfig } from "../remote-config";
import { PaheAccessError, PaheVerificationState, paheResponseError } from "./animepahe-session";
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
  // A user-selected origin requires a new homepage session next time it is used.
  if (_win && !_win.isDestroyed()) {
    _win.destroy();
    _win = null;
  }
  _verification.reset();
  _readyPromise = null;
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
const _verification = new PaheVerificationState();
let _readyPromise: Promise<BrowserWindow> | null = null;
let _windowBase = "";
/** A user request is waiting on the window; a startup prewarm alone never shows it. */
let _userWaiting = false;
let _idleTimer: NodeJS.Timeout | null = null;
// The hidden window runs the site's own scripts. Once AnimePahe is idle, free
// that renderer; the next request reopens it (playback/Kwik do not need it).
const IDLE_CLOSE_MS = 10 * 60_000;

function scheduleIdleClose(): void {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => {
    _idleTimer = null;
    // Never close a window that is loading or showing a check to the user.
    if (_win && !_win.isDestroyed() && !_win.isVisible() && _verification.ready && !_readyPromise) _win.destroy();
  }, IDLE_CLOSE_MS);
  _idleTimer.unref?.();
}

function selectConfiguredPaheBase(base: string) {
  if (selectRuntimePaheBase(base)) {
    if (_win && !_win.isDestroyed()) _win.destroy();
    _win = null;
    _verification.reset();
    _readyPromise = null;
  }
}

function getPaheWindow(interactive = true): Promise<BrowserWindow> {
  assertAnimePaheEnabled();
  if (interactive) _userWaiting = true;
  try { _verification.assertRequestAllowed(); } catch (error) {
    // A silent prewarm may have met the check; show it now that the user asked.
    if (interactive && error instanceof PaheAccessError && error.code === "PAHE_SECURITY_CHECK" && _win && !_win.isDestroyed()) {
      showPaheVerification(_win);
    }
    return Promise.reject(error);
  }
  const base = paheBaseUrl();
  if (_win && !_win.isDestroyed() && _windowBase !== base) {
    _win.destroy();
    _win = null;
    _readyPromise = null;
    _verification.reset();
  }
  if (_win && !_win.isDestroyed() && _verification.ready) {
    scheduleIdleClose();
    return Promise.resolve(_win);
  }
  if (_readyPromise && _win && !_win.isDestroyed()) {
    return _readyPromise;
  }

  const generation = _verification.reset();
  _windowBase = base;
  _win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: "persist:animepahe",
    },
  });
  const win = _win;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const providerSession = win.webContents.session;
  providerSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  providerSession.setPermissionCheckHandler(() => false);
  // Keep verification permissions separate from the desktop renderer.
  const denyDownload = (event: Electron.Event, _item: Electron.DownloadItem, contents?: Electron.WebContents) => {
    if (contents === win.webContents) event.preventDefault();
  };
  providerSession.on("will-download", denyDownload);
  win.webContents.on("will-navigate", (event, target) => {
    try { if (new URL(target).origin !== base) event.preventDefault(); } catch { event.preventDefault(); }
  });

  _readyPromise = new Promise<BrowserWindow>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      _readyPromise = null;
      if (error) {
        reject(error);
        if (!(error instanceof PaheAccessError) && !win.isDestroyed()) win.destroy();
      }
      else resolve(win);
    };
    const hardTimeout = setTimeout(() => {
      finish(new Error("AnimePahe homepage did not finish loading. Retry or choose another provider."));
    }, 30_000);
    const checkLoad = async () => {
      if (win.isDestroyed() || _win !== win) return;
      try {
        const title: string = await win.webContents.executeJavaScript("document.title", true);
        if (/just a moment|attention required|checking your browser|verify you are human/i.test(title)) {
          const error = paheResponseError(403, "")!;
          _verification.reject(error);
          if (_userWaiting) showPaheVerification(win);
          finish(error);
          return;
        }
        if (!title || new URL(win.webContents.getURL()).origin !== base) return;
        if (_verification.markReady(generation)) {
          _userWaiting = false;
          if (win.isVisible()) win.hide();
          finish();
          scheduleIdleClose();
        }
      } catch { /* page mid-navigation — wait for the next load */ }
    };
    win.webContents.on("did-finish-load", checkLoad);
    // A cached homepage can render while the network copy sits behind a
    // website check, which would falsely mark the session ready. Revalidate so
    // any check is what the window shows (and the user can complete).
    win.loadURL(base + paheRoute("home"), { extraHeaders: "Cache-Control: no-cache\n" }).catch(() => {
      finish(new Error("AnimePahe homepage could not be loaded. Retry or choose another provider."));
    });
    win.on("closed", () => {
      providerSession.removeListener("will-download", denyDownload);
      finish(new Error("AnimePahe verification window was closed. Retry to reconnect."));
      if (_win === win) {
        _win = null;
        _verification.reset();
        _readyPromise = null;
        _userWaiting = false;
      }
    });
  });

  return _readyPromise;
}

/**
 * Show the provider window for user-operated verification. `revalidate` is for
 * a request rejected while the window still shows a normal (possibly cached)
 * page: one cache-bypassing reload brings up the website's own check.
 */
function showPaheVerification(win: BrowserWindow, revalidate = false): void {
  if (win.isDestroyed()) return;
  try {
    win.setTitle("AnimePahe — complete the website check, then retry in AniTrack (Ctrl+R reloads this page)");
    win.show();
    win.focus();
    if (revalidate) win.webContents.reloadIgnoringCache();
  } catch { /* window closed while the request was completing */ }
}

// ─── Browser-session requests (one attempt per call) ─────────────────────────

const PAHE_REQUEST_WORLD = 1207;
const PAHE_REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAHE_BODY_BYTES = 2 * 1024 * 1024;

interface PaheSessionResponse { status: number; body: string | null }

/**
 * Cloudflare rejects browser-process Session.fetch requests even after the
 * user completes the website check, while the verified page's own same-origin
 * requests pass. Send one fixed, reviewed GET from an isolated world of that
 * page: page scripts cannot replace its fetch, nothing downloaded executes,
 * and only same-origin paths of the configured site are accepted.
 */
async function paheSessionRequest(win: BrowserWindow, url: string, accept: string, xhr: boolean): Promise<PaheSessionResponse> {
  const target = new URL(url);
  const origin = new URL(paheBaseUrl()).origin;
  if (target.protocol !== "https:" || target.origin !== origin || new URL(win.webContents.getURL()).origin !== origin) {
    throw new Error("AnimePahe request left the verified site. Retry or choose another provider.");
  }
  const request = { path: target.pathname + target.search, accept, xhr, limit: MAX_PAHE_BODY_BYTES, timeout: PAHE_REQUEST_TIMEOUT_MS };
  // `request` is data passed as an argument; the code around it is fixed. No
  // top-level declarations: the isolated world keeps its globals between calls.
  const code = `(async (request) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeout);
  try {
    const headers = { Accept: request.accept };
    if (request.xhr) headers["X-Requested-With"] = "XMLHttpRequest";
    const response = await fetch(request.path, { headers, credentials: "same-origin", cache: "no-store", signal: controller.signal });
    if (new URL(response.url).origin !== location.origin) return { status: 0, body: "" };
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > request.limit) { await reader.cancel(); return { status: response.status, body: null }; }
      chunks.push(value);
    }
    return { status: response.status, body: await new Blob(chunks).text() };
  } finally { clearTimeout(timer); }
})(
/* request */ ${JSON.stringify(request)}
)`;
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      win.webContents.executeJavaScriptInIsolatedWorld(PAHE_REQUEST_WORLD, [{ code }]),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), PAHE_REQUEST_TIMEOUT_MS + 5_000); }),
    ]);
    if (!result || typeof result.status !== "number" || (result.body !== null && typeof result.body !== "string")) {
      throw new Error("malformed");
    }
    return { status: result.status, body: result.body };
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
    console.warn("[AnimePahe] Session request failed:", reason.replace(/https?:\/\/\S+/g, "[url]").slice(0, 160));
    throw new Error("AnimePahe request did not complete. Retry or choose another provider.");
  } finally {
    clearTimeout(timer);
  }
}

function readPaheResponse(win: BrowserWindow, response: PaheSessionResponse, label: string): string {
  if (response.body === null) throw new Error(`${label} response was unexpectedly large.`);
  const accessError = paheResponseError(response.status, response.body);
  if (accessError) {
    _verification.reject(accessError);
    if (accessError.code === "PAHE_SECURITY_CHECK") showPaheVerification(win, true);
    throw accessError;
  }
  if (response.status < 200 || response.status >= 300) throw new Error(`${label} HTTP ${response.status}. Retry or choose another provider.`);
  return response.body;
}

async function paheWindowFetchOnce(url: string): Promise<any> {
  const win = await getPaheWindow();
  const response = await paheSessionRequest(win, url, "application/json, text/plain, */*", true);
  scheduleIdleClose();
  const body = readPaheResponse(win, response, "AnimePahe");
  try { return JSON.parse(body); } catch { throw new Error("AnimePahe returned an unexpected response. Retry or choose another provider."); }
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
      if (error instanceof PaheAccessError) throw error;
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
    const resp = await paheSessionRequest(win, `${paheBaseUrl()}${paheRoute("anime", { session })}`, "text/html,application/xhtml+xml,*/*", false);
    // readPaheResponse throws for every non-2xx answer.
    const html = readPaheResponse(win, resp, "AnimePahe show page");
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
  // Silent: a website check met here stays hidden until the user asks for AnimePahe.
  getPaheWindow(false).catch(() => {
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
    const cacheKey = `${paheBaseUrl()}:${animeId}:${episodeId}`;
    const cached = this.linksCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < this.LINKS_CACHE_TTL)) {
      console.log(`[AnimePahe] getStreamLinks cache HIT for: ${cacheKey}`);
      return cached.links;
    }

    const playUrl = paheBaseUrl() + paheRoute("play", { animeId, episodeId });

    async function fetchPlayPage(): Promise<string> {
      const win = await getPaheWindow();
      const response = await paheSessionRequest(win, playUrl, "text/html,application/xhtml+xml,*/*", false);
      scheduleIdleClose();
      return readPaheResponse(win, response, "AnimePahe play page");
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
    return { url, cookies, referer: new URL(linkId).origin,
      authorizationScope: new URL(url).pathname.endsWith(".m3u8") ? "directory" : "exact" };
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
