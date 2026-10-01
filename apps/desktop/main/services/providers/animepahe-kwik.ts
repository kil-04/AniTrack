import { session as electronSession } from "electron";
import { getRuntimeConfig } from "../remote-config";
import {
  animePaheEnabled,
  assertAnimePaheEnabled,
  paheBaseUrl,
  paheRoute,
} from "./animepahe-config";
import { StreamAuthorizationRegistry } from "./stream-authorization";
import { PaheAccessError, PaheResolvedStreamCache, paheResponseError } from "./animepahe-session";
import { awaitKwikStage, extractKwikStreamUrls, readKwikHtml } from "./animepahe-kwik-parser";

// Kwik HTML is treated strictly as bounded data. No embed window is loaded and
// no downloaded script executes to discover a source or establish cookies.
const COOKIE_TTL_MS = 30 * 60_000;
const URL_TTL_MS = 2 * 60 * 60_000;
const authorizedStreams = new StreamAuthorizationRegistry(URL_TTL_MS);
const streamCache = new PaheResolvedStreamCache(URL_TTL_MS, COOKIE_TTL_MS);
const pending = new Map<string, Promise<{ url: string; cookies: string }>>();
let lastCookies = "";
let lastCookiesAt = 0;
let configKey = "";
let generation = 0;

export interface AuthorizedPaheRequestHeaders {
  host: string;
  referer: string;
  cookie: string;
}

export function getKwikCookies(): string {
  return animePaheEnabled() && Date.now() - lastCookiesAt < COOKIE_TTL_MS ? lastCookies : "";
}

function trustedHost(host: string): boolean {
  return getRuntimeConfig().providers.animepahe.streamHostFragments
    .some((rule) => host === rule || host.endsWith("." + rule));
}

function trustedKwikUrl(raw: string): URL {
  assertAnimePaheEnabled();
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Untrusted Kwik stream link."); }
  const host = url.hostname.toLowerCase();
  const trusted = getRuntimeConfig().providers.animepahe.streamHostFragments
    .filter((rule) => rule.startsWith("kwik."))
    .some((rule) => host === rule || host.endsWith("." + rule));
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
      || !trusted || !/^\/e\/[A-Za-z0-9_-]{1,200}\/?$/.test(url.pathname)) {
    throw new Error("Untrusted Kwik stream link.");
  }
  url.hash = "";
  return url;
}

function trustedMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password
      && (!url.port || url.port === "443") && trustedHost(url.hostname.toLowerCase())
      && /\.(?:m3u8|mp4)$/i.test(url.pathname);
  } catch { return false; }
}

function authorizeStream(url: string, kwikUrl: string, cookies: string): void {
  assertAnimePaheEnabled();
  if (!trustedMediaUrl(url)) throw new Error("Kwik returned an untrusted stream URL.");
  if (!cookies) throw new Error("Kwik did not supply the stream cookies. This source needs a connector update; try another provider.");
  authorizedStreams.remember(url, new URL(kwikUrl).origin, cookies);
}

export function isAuthorizedPaheStreamUrl(raw: string): boolean {
  return Boolean(getAuthorizedPaheRequestHeaders(raw));
}

export function getAuthorizedPaheRequestHeaders(raw: string): AuthorizedPaheRequestHeaders | null {
  if (!animePaheEnabled()) return null;
  // Child HLS segments need not end in .m3u8/.mp4; the registry's exact origin
  // and directory scope, established from a trusted manifest, authorize them.
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password
      || (url.port && url.port !== "443") || !trustedHost(url.hostname.toLowerCase())) return null;
    return authorizedStreams.get(raw);
  } catch { return null; }
}

export function resetKwikForBaseChange(): void {
  generation++;
  streamCache.clear();
  authorizedStreams.clear();
  lastCookies = "";
  lastCookiesAt = 0;
}

export function syncPaheRuntimeConfig(): void {
  const runtime = getRuntimeConfig();
  const nextKey = JSON.stringify({
    enabled: runtime.providers.animepahe.enabled && runtime.features.animepaheStreaming,
    hosts: runtime.providers.animepahe.streamHostFragments,
    base: paheBaseUrl(),
  });
  if (nextKey === configKey) return;
  configKey = nextKey;
  resetKwikForBaseChange();
}

export async function resolveKwik(raw: string): Promise<{ url: string; cookies: string }> {
  const kwikUrl = trustedKwikUrl(raw).toString();
  syncPaheRuntimeConfig();
  const cached = streamCache.get(kwikUrl);
  if (cached) {
    authorizeStream(cached.url, kwikUrl, cached.cookies);
    return { url: cached.url, cookies: cached.cookies };
  }
  const inFlight = pending.get(kwikUrl);
  if (inFlight) return inFlight;
  const startedGeneration = generation;
  const resolve = (async () => {
    const session = electronSession.fromPartition("persist:kwik");
    const deadline = AbortSignal.timeout(20_000);
    const response = await awaitKwikStage(session.fetch(kwikUrl, {
      signal: deadline,
      credentials: "include",
      redirect: "manual",
      headers: { Referer: paheBaseUrl() + paheRoute("home"), Accept: "text/html,*/*" },
    }), deadline);
    const html = await readKwikHtml(response, deadline);
    const accessError = paheResponseError(response.status, html);
    if (accessError) {
      throw new PaheAccessError(accessError.code, "Kwik rejected this request. Complete any required website check yourself or choose another provider; AniTrack stopped the attempt.");
    }
    if (!response.ok) throw new Error("Kwik HTTP " + response.status + ". Try another provider.");
    const url = extractKwikStreamUrls(html).find(trustedMediaUrl);
    if (!url) throw new Error("Kwik did not supply a supported direct stream. Its connector needs an update; try another provider.");
    const cookieList = await awaitKwikStage(session.cookies.get({ url: kwikUrl }), deadline);
    const cookies = cookieList.map((cookie) => cookie.name + "=" + cookie.value).join("; ");
    const capturedAt = Date.now();
    if (generation !== startedGeneration) throw new Error("AnimePahe configuration changed during resolution. Retry to obtain a fresh source.");
    authorizeStream(url, kwikUrl, cookies);
    lastCookies = cookies;
    lastCookiesAt = capturedAt;
    streamCache.set(kwikUrl, { url, cookies, cookiesAt: capturedAt, resolvedAt: capturedAt });
    return { url, cookies };
  })();
  pending.set(kwikUrl, resolve);
  void resolve.finally(() => { if (pending.get(kwikUrl) === resolve) pending.delete(kwikUrl); }).catch(() => {});
  return resolve;
}

export function prefetchKwik(raw: string): void {
  if (!animePaheEnabled()) return;
  void resolveKwik(raw).catch(() => {});
}
