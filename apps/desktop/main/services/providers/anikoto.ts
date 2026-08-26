import { BrowserWindow, net, session } from "electron";
import {
  StreamProvider,
  AnimeInfo,
  EpisodeInfo,
  StreamLink,
  StreamData,
  ProviderFeed,
  ProviderFeedResult,
} from "./types";
import { getRuntimeConfig } from "../remote-config";

let _activeAnikotoBase = "";

function anikotoBases(): string[] {
  return getRuntimeConfig().providers.anikoto.baseUrls.map((base) => base.replace(/\/+$/, ""));
}

function anikotoBaseUrl(): string {
  const config = getRuntimeConfig();
  if (!config.providers.anikoto.enabled || !config.features.anikotoStreaming) {
    throw new Error("Anikoto is temporarily disabled by the automation configuration.");
  }
  const bases = anikotoBases();
  if (!bases.includes(_activeAnikotoBase)) _activeAnikotoBase = bases[0];
  return _activeAnikotoBase;
}

function anikotoRoute(name: string, values: Record<string, string | number> = {}): string {
  const template = getRuntimeConfig().providers.anikoto.routes[name];
  if (!template) throw new Error(`Missing signed Anikoto route: ${name}`);
  const route = template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, key: string) => {
    if (!(key in values)) throw new Error(`Missing Anikoto route value: ${key}`);
    return encodeURIComponent(String(values[key]));
  });
  if (route.includes("{")) throw new Error(`Unresolved Anikoto route: ${name}`);
  return route;
}

function anikotoUrl(name: string, values: Record<string, string | number> = {}): string {
  return `${anikotoBaseUrl()}${anikotoRoute(name, values)}`;
}

function anikotoSelector(name: string): string {
  const value = getRuntimeConfig().providers.anikoto.selectors[name];
  if (!value) throw new Error(`Missing signed Anikoto selector: ${name}`);
  return value;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function htmlAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${escapeRegex(name)}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag);
  return match?.[2] ?? null;
}

function elementAttributeById(html: string, id: string, attribute: string): string | null {
  const tag = new RegExp(`<[^>]+\\sid\\s*=\\s*(["'])${escapeRegex(id)}\\1[^>]*>`, "i").exec(html)?.[0];
  return tag ? htmlAttribute(tag, attribute) : null;
}

function extractRouteValue(value: string, routeName: string, key: string): string | null {
  const template = getRuntimeConfig().providers.anikoto.routes[routeName];
  const marker = `{${key}}`;
  const at = template?.indexOf(marker) ?? -1;
  if (!template || at < 0) return null;
  const pattern = new RegExp(`${escapeRegex(template.slice(0, at))}([^/?&#]+)${escapeRegex(template.slice(at + marker.length))}`);
  const match = pattern.exec(value);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

// Origin of the player iframe that served the most-recently-resolved stream
// (e.g. https://vidtube.site). The segment CDNs (mewstream.buzz, nekostream.site)
// hotlink-check Referer against this embedding player, and it rotates — so we
// capture it at resolve time and main.ts reads it via getAnikotoPlayerOrigin()
// to spoof the correct Referer/Origin on CDN requests.
let _lastPlayerOrigin = "";
export function getAnikotoPlayerOrigin(): string { return _lastPlayerOrigin; }
const streamOrigins = new Map<string, { origin: string; expiresAt: number }>();

function rememberAnikotoStreamOrigin(data: StreamData, playerOrigin: string) {
  const expiresAt = Date.now() + 45 * 60 * 1000;
  for (const candidate of [data.url, ...(data.subtitles ?? []).map((track: any) => track.file ?? track.src ?? "")]) {
    try { streamOrigins.set(new URL(candidate).hostname.toLowerCase(), { origin: playerOrigin, expiresAt }); } catch {}
  }
}

export function getAnikotoPlayerOriginForUrl(url: string): string {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return ""; }
  const mapped = streamOrigins.get(host);
  if (!mapped) return "";
  if (mapped.expiresAt <= Date.now()) {
    streamOrigins.delete(host);
    return "";
  }
  return mapped.origin;
}

let _anikotoWin: BrowserWindow | null = null;
let _anikotoReady = false;
let _anikotoReadyPromise: Promise<void> | null = null;
let _anikotoTimeout: NodeJS.Timeout | null = null;

function resetAnikotoWindow() {
  if (_anikotoWin && !_anikotoWin.isDestroyed()) _anikotoWin.destroy();
  _anikotoWin = null;
  _anikotoReady = false;
  _anikotoReadyPromise = null;
}

function selectAnikotoBase(base: string) {
  const clean = base.replace(/\/+$/, "");
  if (_activeAnikotoBase && _activeAnikotoBase !== clean) resetAnikotoWindow();
  _activeAnikotoBase = clean;
}

function resetAnikotoTimeout() {
  if (_anikotoTimeout) {
    clearTimeout(_anikotoTimeout);
  }
  _anikotoTimeout = setTimeout(() => {
    if (_anikotoWin && !_anikotoWin.isDestroyed()) {
      console.log("[Anikoto] Destroying idle prewarmed window to save memory");
      _anikotoWin.destroy();
    }
    _anikotoWin = null;
    _anikotoReady = false;
    _anikotoReadyPromise = null;
    _anikotoTimeout = null;
  }, 120_000); // 2 minutes
}

export function getAnikotoWindow(): Promise<BrowserWindow> {
  const baseUrl = anikotoBaseUrl();
  resetAnikotoTimeout();
  if (_anikotoWin && !_anikotoWin.isDestroyed() && _anikotoReady) {
    return Promise.resolve(_anikotoWin);
  }
  if (_anikotoReadyPromise && _anikotoWin && !_anikotoWin.isDestroyed()) {
    return _anikotoReadyPromise.then(() => {
      if (!_anikotoWin || _anikotoWin.isDestroyed()) throw new Error("Anikoto window closed during init");
      return _anikotoWin;
    });
  }

  _anikotoReady = false;
  _anikotoWin = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: "persist:anikoto",
    },
  });

  _anikotoReadyPromise = new Promise<void>((resolve) => {
    let resolved = false;
    function done() {
      if (resolved) return;
      resolved = true;
      _anikotoReady = true;
      resolve();
    }
    _anikotoWin!.webContents.on("did-finish-load", done);
    setTimeout(done, 15_000);
    _anikotoWin!.loadURL(baseUrl + "/");
    _anikotoWin!.on("closed", () => {
      _anikotoWin = null;
      _anikotoReady = false;
      _anikotoReadyPromise = null;
    });
  });

  return _anikotoReadyPromise.then(() => {
    if (!_anikotoWin || _anikotoWin.isDestroyed()) throw new Error("Anikoto window closed during init");
    return _anikotoWin;
  });
}

export function prewarmAnikoto(): void {
  getAnikotoWindow().catch(() => {
    /* ignore */
  });
}

async function anikotoFetch(url: string, options: any = {}): Promise<any> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...(options.headers || {})
  };

  const bases = anikotoBases();
  let parsed: URL | null = null;
  try { parsed = new URL(url); } catch {}
  const providerRequest = parsed ? bases.includes(parsed.origin) : false;
  const orderedBases = providerRequest
    ? [anikotoBaseUrl(), ...bases.filter((base) => base !== anikotoBaseUrl())]
    : [""];
  let lastResponse: any = null;
  let lastError: unknown = null;
  for (const candidateBase of orderedBases) {
    const candidateUrl = providerRequest && parsed
      ? `${candidateBase}${parsed.pathname}${parsed.search}${parsed.hash}`
      : url;
    if (providerRequest) selectAnikotoBase(candidateBase);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await getAnikotoWindow();
        const candidateHeaders = { ...headers } as Record<string, string>;
        for (const [name, value] of Object.entries(candidateHeaders)) {
          if (name.toLowerCase() !== "referer") continue;
          try {
            const referer = new URL(value);
            if (bases.includes(referer.origin) && providerRequest) {
              candidateHeaders[name] = `${candidateBase}${referer.pathname}${referer.search}${referer.hash}`;
            }
          } catch {}
        }
        const resp = await (net.fetch as any)(candidateUrl, {
          ...options,
          session: session.fromPartition("persist:anikoto"),
          headers: candidateHeaders,
        });
        lastResponse = resp;
        if (resp.ok) return resp;
        const retryable = resp.status === 403 || resp.status === 429 || resp.status === 503;
        if (attempt === 0 && retryable) {
          console.log(`[Anikoto] ${candidateBase || "stream host"} returned ${resp.status}; refreshing session.`);
          resetAnikotoWindow();
          continue;
        }
        if (!providerRequest || (resp.status < 500 && !retryable && resp.status !== 404)) return resp;
        break;
      } catch (error) {
        lastError = error;
        resetAnikotoWindow();
        if (attempt === 0) continue;
        break;
      }
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error("Every signed Anikoto origin failed");
}

export interface AnikotoTopItem {
  slug: string;
  showId: string;
  title: string;
  titleJp: string;
  poster: string;
  sub: number | null;
  dub: number | null;
}

export interface AnikotoTopResult {
  day: AnikotoTopItem[];
  week: AnikotoTopItem[];
  month: AnikotoTopItem[];
}

// Parse Anikoto's home-page "Top anime" sidebar into day/week/month lists.
export function parseAnikotoTop(html: string): AnikotoTopResult {
  const out: AnikotoTopResult = { day: [], week: [], month: [] };
  const secStart = html.indexOf('id="top-anime"');
  if (secStart < 0) return out;
  const sec = html.slice(secStart, secStart + 80000);
  const markers = [...sec.matchAll(/<div class="tab-content" data-name="(day|week|month)"/g)];
  for (let i = 0; i < markers.length; i++) {
    const name = markers[i][1] as "day" | "week" | "month";
    const start = markers[i].index!;
    const end = i + 1 < markers.length ? markers[i + 1].index! : sec.length;
    const block = sec.slice(start, end);
    const items: AnikotoTopItem[] = [];
    const itemClass = escapeRegex(anikotoSelector("searchItemClass"));
    const itemStart = new RegExp(`<a\\s+class=["'][^"']*\\b${itemClass}\\b[^"']*["']`, "i");
    for (const p of block.split(itemStart).slice(1, 11)) {
      const href = (p.match(/href="([^"]+)"/) || [])[1] || "";
      const slug = extractRouteValue(href, "watch", "animeId") || "";
      const poster = (p.match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
      const alt = (p.match(/alt="([^"]*)"/) || [])[1] || "";
      const nameM = p.match(/class="name[^"]*"[^>]*>\s*([^<]+?)\s*</);
      const title = ((nameM && nameM[1]) || alt).trim();
      const titleJp = htmlAttribute(p, anikotoSelector("searchTitleAttribute")) || "";
      const showId = (p.match(/data-tip="([^"]*)"/) || [])[1] || "";
      const sub = (p.match(/ep-status sub[\s\S]*?<span>\s*(\d+)/) || [])[1];
      const dub = (p.match(/ep-status dub[\s\S]*?<span>\s*(\d+)/) || [])[1];
      if (title) items.push({ slug, showId, title, titleJp, poster, sub: sub ? +sub : null, dub: dub ? +dub : null });
    }
    out[name] = items;
  }
  return out;
}

export async function getAnikotoTop(): Promise<AnikotoTopResult> {
  try {
    const resp = await anikotoFetch(anikotoUrl("home"));
    const html = await resp.text();
    return parseAnikotoTop(html);
  } catch (e) {
    console.warn("[Anikoto] getAnikotoTop failed", e);
    return { day: [], week: [], month: [] };
  }
}

export class AnikotoProvider implements StreamProvider {
  readonly id = "anikoto";
  readonly name = "Anikoto";
  readonly capabilities = {
    top: true,
    externalIds: true,
    downloads: true,
    streamVariants: "subtitle-type" as const,
    episodePageSize: 10_000,
  };

  private episodesCache = new Map<string, { episodes: EpisodeInfo[]; total: number; timestamp: number }>();
  private readonly EPISODES_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  private episodesPending = new Map<string, Promise<{ data: EpisodeInfo[]; total: number; lastPage: number }>>();

  // MAL id per slug, harvested from the episode list's data-mal attribute.
  // Anikoto entries can be MISLABELED (their "City Hunter" is actually City
  // Hunter '91's episodes) — the embedded MAL id is the only reliable truth,
  // so match verification uses this instead of trusting titles.
  private malIdCache = new Map<string, number | null>();

  private resolveCache = new Map<string, { data: StreamData; timestamp: number }>();
  private readonly RESOLVE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
  private resolvePending = new Map<string, Promise<StreamData>>();

  private cacheResolve(linkId: string, data: StreamData) {
    if (this.resolveCache.size >= 200) {
      const firstKey = this.resolveCache.keys().next().value;
      if (firstKey !== undefined) this.resolveCache.delete(firstKey);
    }
    this.resolveCache.set(linkId, { data, timestamp: Date.now() });
    if (data.referer) rememberAnikotoStreamOrigin(data, data.referer);
  }

  async search(query: string): Promise<AnimeInfo[]> {
    const results: AnimeInfo[] = [];
    
    const fetchPage = async (pageNo: number) => {
      try {
        const resp = await anikotoFetch(anikotoUrl("search", { query, page: pageNo }));
        if (!resp.ok) return;
        const html = await resp.text();
        
        const itemClass = escapeRegex(anikotoSelector("searchItemClass"));
        const blocks = html.split(new RegExp(`<div\\s+class=["'][^"']*\\b${itemClass}\\b[^"']*["'][^>]*>`, "i"));
        for (let i = 1; i < blocks.length; i++) {
          const block = blocks[i];
          
          const hrefValue = htmlAttribute(block, "href") || /href="([^"]+)"/.exec(block)?.[1] || "";
          const href = extractRouteValue(hrefValue, "watch", "animeId");
          if (!href) continue;
          
          const imgM = /<img src="([^"]+)" alt="([^"]+)"/.exec(block);
          const imgSrc = imgM ? imgM[1] : null;
          const imgAlt = imgM ? imgM[2] : null;
          
          const dataJp = (htmlAttribute(block, anikotoSelector("searchTitleAttribute")) || "").replace(/&#039;/g, "'") || null;
          
          const countFor = (selector: string) => new RegExp(
            `class=["'][^"']*\\bep-status\\b[^"']*\\b${escapeRegex(selector)}\\b[^"']*["'][^>]*>\\s*<span>\\s*(\\d+)`,
            "i",
          ).exec(block);
          const totalM = countFor(anikotoSelector("totalClass"));
          const totalEps = totalM ? parseInt(totalM[1], 10) : undefined;
          // Anikoto cards also carry per-language availability badges.
          const subM = countFor(anikotoSelector("subClass"));
          const dubM = countFor(anikotoSelector("dubClass"));
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
        console.error(`[Anikoto] Fetching page ${pageNo} failed:`, err);
      }
    };

    await Promise.all([fetchPage(1), fetchPage(2)]);
    return results;
  }

  async getEpisodes(animeId: string, page = 1): Promise<{ data: EpisodeInfo[]; total: number; lastPage: number }> {
    // 1. Check episodes list cache
    const cached = this.episodesCache.get(animeId);
    if (cached && (Date.now() - cached.timestamp < this.EPISODES_CACHE_TTL)) {
      console.log(`[Anikoto] getEpisodes cache HIT for: ${animeId}`);
      return {
        data: cached.episodes,
        total: cached.total,
        lastPage: 1
      };
    }

    // 2. Check in-flight requests deduplication
    if (this.episodesPending.has(animeId)) {
      console.log(`[Anikoto] getEpisodes hit in-flight request deduplication for: ${animeId}`);
      return this.episodesPending.get(animeId)!;
    }

    const promise = (async () => {
      console.log(`[Anikoto] Fetching watch page HTML for showId: ${animeId}`);
      const resp = await anikotoFetch(anikotoUrl("watch", { animeId }));
      if (!resp.ok) throw new Error(`Failed to load watch page: status ${resp.status}`);
      const html = await resp.text();

      // Extract show/anime ID (data-id) from watch page HTML
      const showId = elementAttributeById(
        html,
        anikotoSelector("watchContainerId"),
        anikotoSelector("showIdAttribute"),
      );
      if (!showId) throw new Error("Failed to extract anime show ID from watch page HTML");
      console.log(`[Anikoto] Extracted showId: ${showId} for ${animeId}`);

      // Direct AJAX fetch to get episodes list
      const listResp = await anikotoFetch(anikotoUrl("episodeList", { showId }), {
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      if (!listResp.ok) throw new Error(`Failed to fetch episodes list AJAX: status ${listResp.status}`);
      const listJson = (await listResp.json()) as any;
      const listHtml = listJson.result || "";

      // Harvest the MAL id the episode anchors carry (data-mal) — used to
      // verify search matches against AniList/MAL ids.
      const malM = new RegExp(`${escapeRegex(anikotoSelector("malIdAttribute"))}=["'](\\d+)["']`, "i").exec(listHtml);
      this.malIdCache.set(animeId, malM ? parseInt(malM[1], 10) : null);

      // Parse episodes from returned HTML using fast regex
      const episodes: EpisodeInfo[] = [];
      const regex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = regex.exec(listHtml)) !== null) {
        const tag = match[0];
        const dataId = htmlAttribute(tag, anikotoSelector("episodeIdAttribute"));
        const dataSlug = htmlAttribute(tag, anikotoSelector("episodeSlugAttribute"));
        if (!dataId || !dataSlug) continue;
        const text = match[1].replace(/<[^>]+>/g, "").trim();
        const numValue = htmlAttribute(tag, anikotoSelector("episodeNumberAttribute"));
        const titleM = /title="([^"]*)"/.exec(tag);
        
        const num = numValue || text;
        const title = titleM ? titleM[1] : `Episode ${num}`;
        
        // Extract the server list parameter 'data-ids'
        const serversParam = htmlAttribute(tag, anikotoSelector("episodeServersAttribute")) || "";
        
        const slugStr = `ep-${dataSlug}`;
        // Encode: slug:dataId:serversParam
        const id = `${slugStr}:${dataId}:${serversParam}`;
        
        episodes.push({
          id,
          episodeNumber: parseFloat(num) || 0,
          title
        });
      }

      console.log(`[Anikoto] Parsed ${episodes.length} episodes browserlessly for ${animeId}`);

      // Cache episodes (bounded — evict the oldest entry once full)
      if (this.episodesCache.size >= 200) {
        const firstKey = this.episodesCache.keys().next().value;
        if (firstKey !== undefined) this.episodesCache.delete(firstKey);
      }
      this.episodesCache.set(animeId, {
        episodes,
        total: episodes.length,
        timestamp: Date.now()
      });

      return {
        data: episodes,
        total: episodes.length,
        lastPage: 1
      };
    })();

    this.episodesPending.set(animeId, promise);
    // .catch on the derived chain so a rejected fetch doesn't surface as an
    // unhandled rejection — the caller still receives the original rejection.
    promise.finally(() => this.episodesPending.delete(animeId)).catch(() => {});
    return promise;
  }

  /** External ids for a slug — the MAL id embedded in the episode list. Reuses
   *  the episode fetch (cache + in-flight dedup), so verifying a match costs at
   *  most one episodes load that the player would do anyway. */
  async getAnimeIds(animeId: string): Promise<{ malId?: number; anilistId?: number }> {
    if (!this.malIdCache.has(animeId)) {
      try { await this.getEpisodes(animeId, 1); } catch { /* unreachable page */ }
    }
    const mal = this.malIdCache.get(animeId);
    return mal != null ? { malId: mal } : {};
  }

  async getStreamLinks(episodeId: string, animeId: string): Promise<StreamLink[]> {
    const parts = episodeId.split(':');
    const serversParam = parts[2] || "";
    if (!serversParam) {
      return [
        {
          id: JSON.stringify({ episodeId, animeId, subType: "soft" }),
          quality: "Auto (Soft Sub)",
          audio: "jpn",
          variant: "soft",
        }
      ];
    }

    try {
      const serversResp = await anikotoFetch(anikotoUrl("serverList", { servers: serversParam }), {
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      if (!serversResp.ok) throw new Error(`Status ${serversResp.status}`);
      const serversJson = await serversResp.json() as any;
      const serversHtml = serversJson.result || "";

      const labels: string[] = [];
      const labelRe = /<label[^>]*>([\s\S]*?)<\/label>/g;
      let match;
      while ((match = labelRe.exec(serversHtml)) !== null) {
        labels.push(match[1].replace(/<[^>]+>/g, '').trim().toUpperCase());
      }

      const links: StreamLink[] = [];
      
      const hasSub = labels.some(l => l.includes("SUB") && !l.includes("H-SUB") && !l.includes("HSUB") && !l.includes("HARDSUB") && !l.includes("HARD SUB"));
      const hasHSub = labels.some(l => l.includes("H-SUB") || l.includes("HSUB") || l.includes("HARDSUB") || l.includes("HARD SUB"));

      // Dub is intentionally not offered — only soft/hard subs.
      if (hasSub || !hasHSub) {
        links.push({
          id: JSON.stringify({ episodeId, animeId, subType: "soft" }),
          quality: "Auto (Soft Sub)",
          audio: "jpn",
          variant: "soft",
        });
      }
      if (hasHSub) {
        links.push({
          id: JSON.stringify({ episodeId, animeId, subType: "hard" }),
          quality: "Auto (Hard Sub)",
          audio: "jpn",
          variant: "hard",
        });
      }

      return links;
    } catch (err) {
      console.error("[Anikoto] Failed to fetch server options in getStreamLinks:", err);
      return [
        {
          id: JSON.stringify({ episodeId, animeId, subType: "soft" }),
          quality: "Auto (Soft Sub)",
          audio: "jpn",
          variant: "soft",
        }
      ];
    }
  }

  async resolveStream(linkId: string): Promise<StreamData> {
    // 1. Check resolved stream cache
    const cached = this.resolveCache.get(linkId);
    if (cached && (Date.now() - cached.timestamp < this.RESOLVE_CACHE_TTL)) {
      console.log(`[Anikoto] resolveStream cache HIT for: ${linkId}`);
      if (cached.data.referer) rememberAnikotoStreamOrigin(cached.data, cached.data.referer);
      return cached.data;
    }

    // 2. Check in-flight resolves deduplication
    if (this.resolvePending.has(linkId)) {
      console.log(`[Anikoto] resolveStream hit in-flight request deduplication for: ${linkId}`);
      return this.resolvePending.get(linkId)!;
    }

    const promise = (async () => {
      const { episodeId, animeId, subType = "soft" } = JSON.parse(linkId);

      const parts = episodeId.split(':');
      const slug = parts[0];
      const dataId = parts[1];
      let serversParam = parts[2] || "";

      // Fallback: If serversParam is missing (should not happen in browserless flow), fetch watch page list
      if (!serversParam) {
        console.log(`[Anikoto] Fallback: serversParam missing from episodeId. Fetching list...`);
        const resp = await anikotoFetch(anikotoUrl("watch", { animeId }));
        if (resp.ok) {
          const html = await resp.text();
          const showId = elementAttributeById(
            html,
            anikotoSelector("watchContainerId"),
            anikotoSelector("showIdAttribute"),
          );
          if (showId) {
            const listResp = await anikotoFetch(anikotoUrl("episodeList", { showId }), {
              headers: {
                'X-Requested-With': 'XMLHttpRequest'
              }
            });
            if (listResp.ok) {
              const listJson = await listResp.json() as any;
              const listHtml = listJson.result || "";
              const tagMatch = [...listHtml.matchAll(/<a\b[^>]*>/gi)]
                .map((match) => match[0])
                .find((tag) => htmlAttribute(tag, anikotoSelector("episodeIdAttribute")) === dataId);
              if (tagMatch) {
                serversParam = htmlAttribute(tagMatch, anikotoSelector("episodeServersAttribute")) || "";
              }
            }
          }
        }
      }

      if (!serversParam) {
        throw new Error(`Failed to obtain servers token (data-ids) for episode: ${dataId}`);
      }

      // Fetch server list AJAX
      console.log(`[Anikoto] Fetching servers list for episode: ${dataId}`);
      const serversResp = await anikotoFetch(anikotoUrl("serverList", { servers: serversParam }), {
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      if (!serversResp.ok) throw new Error(`Failed to fetch servers list AJAX: status ${serversResp.status}`);
      const serversJson = (await serversResp.json()) as any;
      const serversHtml = serversJson.result || "";

      // Parse types and servers
      const types: { label: string; items: { linkId: string; name: string }[] }[] = [];
      const typeRe = /<div class="type"[^>]*>([\s\S]*?)<\/ul>\s*<\/div>/g;
      let typeMatch;
      while ((typeMatch = typeRe.exec(serversHtml)) !== null) {
        const typeHtml = typeMatch[1];
        const labelM = /<label[^>]*>([\s\S]*?)<\/label>/.exec(typeHtml);
        const label = labelM ? labelM[1].replace(/<[^>]+>/g, '').trim() : '';
        
        const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
        let liMatch;
        const items = [];
        while ((liMatch = liRe.exec(typeHtml)) !== null) {
          const linkId = htmlAttribute(liMatch[0], anikotoSelector("serverLinkAttribute"));
          if (!linkId) continue;
          items.push({
            linkId,
            name: liMatch[1].replace(/<[^>]+>/g, '').trim()
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

      const isDubLabel = (labelStr: string) => {
        const l = labelStr.toUpperCase();
        return l.includes("DUB");
      };

      // Find best server matching subtype selection
      const targetType = types.find(t => {
        if (subType === "hard") return isHardLabel(t.label);
        if (subType === "dub") return isDubLabel(t.label);
        return isSoftLabel(t.label);
      });
      
      // Build the ordered list of candidate servers to try. Each sub-type lists
      // several servers (VidPlay, HD, Vidstream, VidCloud, …); the first is often
      // down for a given episode, so we fall through to the next until one yields
      // a playable stream — that flakiness is why soft sub failed on some episodes.
      const chosenType = (targetType && targetType.items.length > 0)
        ? targetType
        : types.find(t => t.items.length > 0);
      if (!chosenType || chosenType.items.length === 0) {
        throw new Error(`Failed to find server matching subtitle subtype: ${subType}`);
      }
      let isActualHardSub = isHardLabel(chosenType.label);
      const candidateLinkIds = chosenType.items.map(it => it.linkId);

      let iframeUrl = "";
      let serverGetJson: any = null;

      if (subType === "hard" && !isActualHardSub) {
        console.log(`[Anikoto] H-SUB not found in AJAX response. Falling back to BrowserWindow resolving...`);
        const win = await getAnikotoWindow();
        
        // Load watch page if not already loaded
        const watchUrl = anikotoUrl("watch", { animeId });
        const currentUrl = win.webContents.getURL();
        if (!currentUrl.includes(anikotoRoute("watch", { animeId }))) {
          console.log(`[Anikoto] Browser loading watch page: ${watchUrl}`);
          await win.loadURL(watchUrl);
        }
        
        // Wait for page to be ready and execute interaction script
        console.log(`[Anikoto] Interacting with page to select episode ${dataId} and H-SUB server...`);
        const resolvedIframeUrl = await win.webContents.executeJavaScript(`
          new Promise((resolve, reject) => {
            // 1. Click the episode link
            const epBtn = document.querySelector('.episodes a[data-id="${dataId}"]');
            if (epBtn) {
              epBtn.click();
            } else {
              // Fallback: search by href or text if data-id mismatches
              const allLinks = Array.from(document.querySelectorAll('.episodes a'));
              const matchLink = allLinks.find(a => a.getAttribute('data-id') === "${dataId}" || a.href.includes("/${slug}"));
              if (matchLink) matchLink.click();
            }

            // 2. Wait for servers container
            let attempts = 0;
            const checkServers = () => {
              const servers = document.querySelector('.servers');
              if (servers) {
                const types = Array.from(document.querySelectorAll('.servers .type'));
                const targetType = types.find(t => {
                  const label = t.querySelector('label');
                  const text = label ? label.textContent.trim().toUpperCase() : '';
                  return text.includes("H-SUB") || text.includes("HARDSUB") || text.includes("HARD SUB");
                });

                if (targetType) {
                  const li = targetType.querySelector('ul li[data-link-id]');
                  if (li) {
                    const iframe = document.querySelector('#player iframe');
                    const oldSrc = iframe ? iframe.src : '';
                    
                    // Click H-SUB server!
                    li.click();
                    
                    // Wait for iframe src to change and not be blank
                    let srcAttempts = 0;
                    const waitIframe = () => {
                      const newIframe = document.querySelector('#player iframe');
                      const newSrc = newIframe ? newIframe.src : '';
                      if (newIframe && newSrc && newSrc !== oldSrc && (newSrc.includes('megaplay') || newSrc.includes('plyr.php') || newSrc.includes('mewcdn.online'))) {
                        resolve(newSrc);
                      } else if (srcAttempts < 30) {
                        srcAttempts++;
                        setTimeout(waitIframe, 200);
                      } else {
                        // Return whatever iframe src we have currently
                        resolve(newSrc || oldSrc);
                      }
                    };
                    setTimeout(waitIframe, 100);
                    return;
                  }
                }
                reject(new Error("H-SUB server element not found in DOM"));
              } else if (attempts < 40) {
                attempts++;
                setTimeout(checkServers, 250);
              } else {
                reject(new Error("Servers panel failed to load in DOM"));
              }
            };
            setTimeout(checkServers, 100);
          });
        `).catch(err => {
          console.error("[Anikoto] BrowserWindow resolving error:", err);
          return "";
        });

        if (resolvedIframeUrl) {
          console.log(`[Anikoto] BrowserWindow successfully resolved player URL: ${resolvedIframeUrl}`);
          iframeUrl = resolvedIframeUrl;
          isActualHardSub = true;
        }
      }

      // Resolve a single player iframe → { data, playerOrigin }: either the
      // base64-hash path (plyr.php/mewcdn) or fetch the Megaplay iframe + call
      // getSources. Throws on failure so the caller can try the next server.
      // Returns playerOrigin so the caller sets the global Referer hint to match
      // the CHOSEN stream rather than whichever attempt happened to run last.
      const attempt = async (attIframeUrl: string, attServerGetJson: any): Promise<{ data: StreamData; playerOrigin: string }> => {
        // getSources/segment CDN lives on the SAME origin as the iframe; the host
        // rotates (megaplay.buzz → vidtube.site → …) so derive it rather than
        // hardcode a dead domain (a stale host 302s to an ad → ERR_BLOCKED_BY_CLIENT).
        let playerOrigin = "https://megaplay.buzz";
        try { playerOrigin = new URL(attIframeUrl).origin; } catch { /* keep default */ }

        // H-SUB encoding from hash
        if (attIframeUrl.includes('plyr.php') || attIframeUrl.includes('mewcdn.online/player/')) {
          const parts = attIframeUrl.split('#');
          if (parts.length >= 2) {
            const decodedUrl = Buffer.from(parts[1], 'base64').toString('utf-8');
            console.log(`[Anikoto] Decoded H-SUB stream URL from hash: ${decodedUrl}`);
            return {
              data: {
                url: decodedUrl,
                subtitles: [],
                intro: attServerGetJson?.result?.skip_data?.intro?.end > 0 ? attServerGetJson.result.skip_data.intro : undefined,
                outro: attServerGetJson?.result?.skip_data?.outro?.end > 0 ? attServerGetJson.result.skip_data.outro : undefined,
                referer: playerOrigin,
              },
              playerOrigin,
            };
          }
        }

        // Extract Megaplay ID by fetching the player iframe page HTML.
        const megaplayResp = await anikotoFetch(attIframeUrl, { headers: { 'Referer': `${anikotoBaseUrl()}/` } });
        if (!megaplayResp.ok) throw new Error(`Failed to fetch Megaplay iframe: status ${megaplayResp.status}`);
        const megaplayHtml = await megaplayResp.text();
        const megaplayId = elementAttributeById(
          megaplayHtml,
          anikotoSelector("playerContainerId"),
          anikotoSelector("playerIdAttribute"),
        );
        if (!megaplayId) throw new Error("Failed to extract player id from iframe HTML");
        console.log(`[Anikoto] Extracted Megaplay player source ID: ${megaplayId}`);

        const sourcesResp = await anikotoFetch(`${playerOrigin}${anikotoRoute("sources", { playerId: megaplayId })}`, {
          headers: { 'Referer': attIframeUrl, 'X-Requested-With': 'XMLHttpRequest' },
        });
        if (!sourcesResp.ok) throw new Error(`getSources failed: status ${sourcesResp.status}`);
        const json = (await sourcesResp.json()) as any;
        const streamUrl = json.sources?.file || "";
        if (!streamUrl) throw new Error("Failed to extract Megaplay stream URL from sources JSON");
        console.log(`[Anikoto] Resolved stream URL: ${streamUrl}`);
        const subs = isActualHardSub ? [] : (json.tracks || []).filter((t: any) => t.kind === "captions");
        const intro = json.intro?.end > 0 ? json.intro : (attServerGetJson?.result?.skip_data?.intro?.end > 0 ? attServerGetJson.result.skip_data.intro : undefined);
        const outro = json.outro?.end > 0 ? json.outro : (attServerGetJson?.result?.skip_data?.outro?.end > 0 ? attServerGetJson.result.skip_data.outro : undefined);
        return { data: { url: streamUrl, subtitles: subs, intro, outro, referer: playerOrigin }, playerOrigin };
      };

      let result: StreamData | null = null;

      if (iframeUrl) {
        // The H-SUB BrowserWindow path already produced an iframe — use it directly.
        const a = await attempt(iframeUrl, serverGetJson);
        result = a.data;
        _lastPlayerOrigin = a.playerOrigin;
        rememberAnikotoStreamOrigin(a.data, a.playerOrigin);
      } else {
        // Try each server in the matched sub-type until one resolves. The first
        // server is frequently dead for a given episode — that's what made soft
        // sub fail intermittently; falling through to the next fixes it.
        //
        // For soft sub we also prefer a server that returns real caption tracks:
        // a SUB server with no tracks is serving a hard-subbed video, so we keep
        // looking before settling for it — that's why soft sub sometimes showed
        // burned-in (hard) subs.
        let lastErr: any = null;
        let firstResolved: { data: StreamData; playerOrigin: string } | null = null;
        for (const cand of candidateLinkIds) {
          try {
            const serverGetResp = await anikotoFetch(anikotoUrl("serverResolve", { linkId: cand }), {
              headers: { 'X-Requested-With': 'XMLHttpRequest' },
            });
            if (!serverGetResp.ok) throw new Error(`server iframe status ${serverGetResp.status}`);
            const sgJson = (await serverGetResp.json()) as any;
            const candIframe = sgJson.result?.url || "";
            if (!candIframe) throw new Error("Server iframe URL not found in AJAX response");
            console.log(`[Anikoto] Found player iframe URL: ${candIframe}`);
            const a = await attempt(candIframe, sgJson);
            if (!firstResolved) firstResolved = a;
            // Accept immediately unless we're on soft sub and this stream has no
            // caption tracks (= hard-subbed); in that case keep trying.
            if (subType !== "soft" || (a.data.subtitles && a.data.subtitles.length > 0)) {
              result = a.data;
              _lastPlayerOrigin = a.playerOrigin;
              rememberAnikotoStreamOrigin(a.data, a.playerOrigin);
              break;
            }
            console.log(`[Anikoto] Soft-sub server has no caption tracks (hard-subbed); trying next…`);
          } catch (e: any) {
            lastErr = e;
            console.warn(`[Anikoto] server attempt failed (${String(e?.message ?? e)}); trying next…`);
          }
        }
        if (!result && firstResolved) {
          // No soft-sub-with-tracks server found — fall back to the first that resolved.
          result = firstResolved.data;
          _lastPlayerOrigin = firstResolved.playerOrigin;
          rememberAnikotoStreamOrigin(firstResolved.data, firstResolved.playerOrigin);
        }
        if (!result) throw lastErr ?? new Error("All Anikoto servers failed to resolve");
      }

      this.cacheResolve(linkId, result);
      return result;
    })();

    this.resolvePending.set(linkId, promise);
    promise.finally(() => this.resolvePending.delete(linkId)).catch(() => {});
    return promise;
  }

  getExternalIds(animeId: string) {
    return this.getAnimeIds(animeId);
  }

  async getFeed(feed: ProviderFeed, page = 1, count = 30): Promise<ProviderFeedResult> {
    if (feed !== "top") throw new Error(`${this.name} does not support the ${feed} feed`);
    const result = await getAnikotoTop();
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeCount = Number.isFinite(count) && count > 0 ? Math.min(100, Math.floor(count)) : 30;
    const offset = (safePage - 1) * safeCount;
    const definitions: Array<{ id: keyof AnikotoTopResult; title: string }> = [
      { id: "day", title: "Today" },
      { id: "week", title: "This Week" },
      { id: "month", title: "This Month" },
    ];
    const lengths = definitions.map(({ id }) => result[id].length);
    return {
      providerId: this.id,
      feed,
      page: safePage,
      total: lengths.reduce((sum, length) => sum + length, 0),
      lastPage: Math.max(1, Math.ceil(Math.max(0, ...lengths) / safeCount)),
      groups: definitions.map(({ id, title }) => ({
        id,
        title,
        items: result[id].slice(offset, offset + safeCount).map((item) => ({
          id: item.showId || item.slug,
          providerId: this.id,
          animeId: item.slug,
          title: item.title,
          titleAlternatives: item.titleJp ? [item.titleJp] : undefined,
          poster: item.poster,
          subCount: item.sub ?? undefined,
          dubCount: item.dub ?? undefined,
        })),
      })),
    };
  }

  prewarm(): void { prewarmAnikoto(); }
}
