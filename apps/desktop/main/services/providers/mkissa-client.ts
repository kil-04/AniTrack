import { createDecipheriv } from "node:crypto";
import type { StreamData } from "./types";
import {
  buildAaRequest,
  decodeMkissaSourceUrl,
  decryptProtectedPayload,
  sha256Hex,
} from "./mkissa-crypto";
import { MkissaKeyManager, type MkissaKeyManagerOptions } from "./mkissa-key-manager";
import {
  classifyMkissaFailure,
  errorMessages,
  MkissaProviderError,
  normalizeHeaders,
  positiveNumber,
  publicHttpsUrl,
  responseText,
  safeRedirectFetch,
  safeText,
  type MkissaFetch,
} from "./mkissa-utils";

export const MKISSA_SITE_ORIGIN = "https://mkissa.to";
export const MKISSA_API_ORIGIN = "https://api.mkissa.net";
export const MKISSA_PLAYER_ORIGIN = "https://allanime.day";

const CONTENT_LANE = "k7";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
  + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const SEARCH_QUERY = `query(
  $search: SearchInput
  $limit: Int
  $page: Int
  $translationType: VaildTranslationTypeEnumType
  $countryOrigin: VaildCountryOriginEnumType
) {
  shows(
    search: $search
    limit: $limit
    page: $page
    translationType: $translationType
    countryOrigin: $countryOrigin
  ) {
    pageInfo { total }
    edges {
      _id
      name
      thumbnail
      englishName
      nativeName
      slugTime
      availableEpisodes
      availableEpisodesDetail
      aniListId
    }
  }
}`;

const EPISODES_QUERY = `query ($_id: String!) {
  show(_id: $_id) {
    _id
    availableEpisodesDetail
  }
}`;

export const MKISSA_STREAM_QUERY = `query(
  $showId: String!
  $translationType: VaildTranslationTypeEnumType!
  $episodeString: String!
) {
  episode(
    showId: $showId
    translationType: $translationType
    episodeString: $episodeString
  ) {
    sourceUrls
    show { _id }
  }
}`;

const STREAM_HASH = sha256Hex(MKISSA_STREAM_QUERY);

export type MkissaAudio = "sub" | "dub";

export interface MkissaShow {
  id: string;
  name: string;
  englishName?: string;
  nativeName?: string;
  thumbnail?: string;
  slugTime?: string;
  anilistId?: number;
  subEpisodes: string[];
  dubEpisodes: string[];
  totalEpisodes?: number;
}

export interface MkissaSeries {
  id: string;
  subEpisodes: string[];
  dubEpisodes: string[];
}

export interface MkissaSource {
  sourceUrl: string;
  sourceName: string;
  type: string;
  priority: number;
}

export interface MkissaClientApi {
  search(query: string): Promise<MkissaShow[]>;
  getSeries(showId: string): Promise<MkissaSeries>;
  getEpisodeSources(showId: string, episode: string, audio: MkissaAudio): Promise<MkissaSource[]>;
  resolveSource(source: MkissaSource): Promise<StreamData>;
  resolveSourceChoices(sources: MkissaSource[], selectedIndex: number): Promise<StreamData>;
  normalizePoster(value: string | undefined): string;
  reset?(): void;
}

export interface MkissaClientOptions extends MkissaKeyManagerOptions {
  keyManager?: MkissaKeyManager;
  challengeCooldownMs?: number;
  sourceCacheTtlMs?: number;
}

interface CachedSources {
  sources: MkissaSource[];
  expiresAt: number;
}

export class MkissaClient implements MkissaClientApi {
  private readonly fetcher: MkissaFetch;
  private readonly siteOrigin: string;
  private readonly apiOrigin: string;
  private readonly playerOrigin: string;
  private readonly userAgent: string;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly challengeCooldownMs: number;
  private readonly sourceCacheTtlMs: number;
  private readonly keyManager: MkissaKeyManager;
  private readonly sourceCache = new Map<string, CachedSources>();
  private readonly sourcePending = new Map<string, Promise<MkissaSource[]>>();
  private blockedUntil = 0;
  private blockedCode: "CAPTCHA_REQUIRED" | "RATE_LIMITED" = "RATE_LIMITED";

  constructor(options: MkissaClientOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.siteOrigin = originOnly(options.siteOrigin ?? MKISSA_SITE_ORIGIN);
    this.apiOrigin = originOnly(options.apiOrigin ?? MKISSA_API_ORIGIN);
    this.playerOrigin = MKISSA_PLAYER_ORIGIN;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.now = options.now ?? Date.now;
    this.timeoutMs = boundedPositive(options.requestTimeoutMs, 10_000, 1_000, 60_000);
    this.challengeCooldownMs = boundedPositive(options.challengeCooldownMs, 10 * 60 * 1000, 60_000, 60 * 60 * 1000);
    this.sourceCacheTtlMs = boundedPositive(options.sourceCacheTtlMs, 10 * 60 * 1000, 30_000, 60 * 60 * 1000);
    this.keyManager = options.keyManager ?? new MkissaKeyManager({
      ...options,
      fetch: this.fetcher,
      siteOrigin: this.siteOrigin,
      apiOrigin: this.apiOrigin,
      userAgent: this.userAgent,
      now: this.now,
    });
  }

  async search(query: string): Promise<MkissaShow[]> {
    const normalized = safeText(query, 200);
    if (!normalized) return [];
    const data = await this.graphql(SEARCH_QUERY, {
      search: { allowAdult: false, allowUnknown: false, query: normalized },
      limit: 40,
      page: 1,
      translationType: "sub",
      countryOrigin: "ALL",
    });
    const edges = objectAt(data, "shows")?.edges;
    if (!Array.isArray(edges)) return [];
    const results: MkissaShow[] = [];
    const seen = new Set<string>();
    for (const value of edges.slice(0, 100)) {
      const show = parseShow(value);
      if (!show || seen.has(show.id)) continue;
      seen.add(show.id);
      results.push(show);
    }
    return results;
  }

  async getSeries(showId: string): Promise<MkissaSeries> {
    const id = validateOpaqueId(showId, "show");
    const data = await this.graphql(EPISODES_QUERY, { _id: id });
    const show = objectAt(data, "show");
    if (!show) throw new MkissaProviderError("MKissa series was not found", "INVALID_RESPONSE");
    const returnedId = validateOpaqueId(typeof show._id === "string" ? show._id : id, "show");
    const detail = episodeDetail(show.availableEpisodesDetail);
    return { id: returnedId, ...detail };
  }

  async getEpisodeSources(showId: string, episode: string, audio: MkissaAudio): Promise<MkissaSource[]> {
    const id = validateOpaqueId(showId, "show");
    const episodeString = validateEpisodeString(episode);
    if (audio !== "sub" && audio !== "dub") {
      throw new MkissaProviderError("Invalid MKissa audio mode", "INVALID_RESPONSE");
    }
    const cacheKey = `${id}:${audio}:${episodeString}`;
    const cached = this.sourceCache.get(cacheKey);
    if (cached && this.now() < cached.expiresAt) return cached.sources;
    if (this.sourcePending.has(cacheKey)) return this.sourcePending.get(cacheKey)!;
    if (this.now() < this.blockedUntil) {
      throw new MkissaProviderError(
        "MKissa streaming is cooling down after a security or rate-limit response.",
        this.blockedCode,
      );
    }

    const pending = this.fetchProtectedSources(id, episodeString, audio)
      .then((sources) => {
        boundedMapSet(this.sourceCache, cacheKey, { sources, expiresAt: this.now() + this.sourceCacheTtlMs }, 200);
        return sources;
      })
      .catch((error: unknown) => {
        if (error instanceof MkissaProviderError
          && (error.code === "CAPTCHA_REQUIRED" || error.code === "RATE_LIMITED")) {
          this.blockedCode = error.code;
          this.blockedUntil = this.now() + this.challengeCooldownMs;
        }
        throw error;
      });
    this.sourcePending.set(cacheKey, pending);
    pending.finally(() => this.sourcePending.delete(cacheKey)).catch(() => {});
    return pending;
  }

  async resolveSourceChoices(sources: MkissaSource[], selectedIndex: number): Promise<StreamData> {
    if (!Array.isArray(sources) || sources.length === 0 || sources.length > 30
      || !Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= sources.length) {
      throw new MkissaProviderError("Invalid MKissa server selection", "INVALID_RESPONSE");
    }
    const order = [
      ...sources.slice(selectedIndex),
      ...sources.slice(0, selectedIndex),
    ];
    let lastError: unknown = null;
    for (const source of order) {
      try {
        return await this.resolveOneSource(validateSource(source));
      } catch (error) {
        if (error instanceof MkissaProviderError
          && (error.code === "CAPTCHA_REQUIRED" || error.code === "RATE_LIMITED")) throw error;
        lastError = error;
      }
    }
    if (lastError instanceof MkissaProviderError) throw lastError;
    throw new MkissaProviderError("No MKissa server could be resolved", "UNSUPPORTED_SOURCE");
  }

  async resolveSource(source: MkissaSource): Promise<StreamData> {
    return this.resolveOneSource(validateSource(source));
  }

  normalizePoster(value: string | undefined): string {
    if (!value) return "";
    try {
      if (value.startsWith("/")) return publicHttpsUrl(value, `${this.siteOrigin}/`).toString();
      return publicHttpsUrl(value).toString();
    } catch {
      return "";
    }
  }

  reset(): void {
    this.sourceCache.clear();
    this.sourcePending.clear();
    this.blockedUntil = 0;
    this.keyManager.invalidateBuild();
  }

  private async graphql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.request(new URL("/api", this.apiOrigin), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: this.siteOrigin,
        Referer: `${this.siteOrigin}/`,
      },
      body: JSON.stringify({ query, variables }),
    }, true);
    const body = await responseText(response, 5 * 1024 * 1024, "MKissa catalogue");
    const payload = parseObject(body, "MKissa catalogue");
    const messages = errorMessages(payload);
    const classified = classifyMkissaFailure(messages, response.status);
    if (classified) throw classified;
    if (!response.ok || messages.length > 0) {
      throw new MkissaProviderError(
        messages[0] || `MKissa catalogue failed (${response.status})`,
        "INVALID_RESPONSE",
        response.status,
      );
    }
    return objectAt(payload, "data") ?? {};
  }

  private async fetchProtectedSources(
    showId: string,
    episodeString: string,
    audio: MkissaAudio,
  ): Promise<MkissaSource[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const material = await this.keyManager.material(attempt > 0);
      const extensions = {
        persistedQuery: { version: 1, sha256Hash: STREAM_HASH },
        k: CONTENT_LANE,
        aaReq: buildAaRequest(
          material.key,
          material.epoch,
          material.buildId,
          STREAM_HASH,
          CONTENT_LANE,
          this.now(),
        ),
      };
      const endpoint = new URL("/api", this.apiOrigin);
      endpoint.searchParams.set("query", MKISSA_STREAM_QUERY);
      endpoint.searchParams.set("variables", JSON.stringify({
        showId,
        translationType: audio,
        episodeString,
      }));
      endpoint.searchParams.set("extensions", JSON.stringify(extensions));

      const response = await this.request(endpoint, {
        headers: {
          Accept: "application/json",
          Origin: this.siteOrigin,
          Referer: `${this.siteOrigin}/`,
          "x-build-id": material.buildId,
        },
      }, true);
      const body = await responseText(response, 5 * 1024 * 1024, "MKissa stream source");
      const payload = parseObject(body, "MKissa stream source");
      const messages = errorMessages(payload);
      const classified = classifyMkissaFailure(messages, response.status)
        ?? (response.status === 403
          ? new MkissaProviderError("MKissa client keys are stale", "CRYPTO_STALE", 403)
          : null);
      if (classified?.code === "CAPTCHA_REQUIRED" || classified?.code === "RATE_LIMITED") {
        this.blockedCode = classified.code;
        this.blockedUntil = this.now() + this.challengeCooldownMs;
        throw classified;
      }
      if (classified?.code === "CRYPTO_STALE") {
        this.keyManager.invalidateBuild();
        if (attempt === 0) continue;
        throw classified;
      }
      if (classified || !response.ok || messages.length > 0) {
        throw classified ?? new MkissaProviderError(
          messages[0] || `MKissa stream source failed (${response.status})`,
          "INVALID_RESPONSE",
          response.status,
        );
      }

      try {
        const data = objectAt(payload, "data") ?? {};
        const encrypted = typeof data.tobeparsed === "string" ? data.tobeparsed : null;
        const decoded = encrypted
          ? parseObject(decryptProtectedPayload(encrypted, material.key), "MKissa protected stream source")
          : data;
        const episode = objectAt(decoded, "episode") ?? objectAt(objectAt(decoded, "data") ?? {}, "episode");
        const sourceUrls = episode?.sourceUrls;
        if (!Array.isArray(sourceUrls)) {
          throw new MkissaProviderError("MKissa returned no stream servers", "INVALID_RESPONSE");
        }
        const sources = sourceUrls.slice(0, 30)
          .map(parseSource)
          .filter((source): source is MkissaSource => source !== null)
          .sort((left, right) => right.priority - left.priority);
        if (sources.length === 0) {
          throw new MkissaProviderError("MKissa returned no usable stream servers", "INVALID_RESPONSE");
        }
        return sources;
      } catch (error) {
        if (attempt === 0 && !(error instanceof MkissaProviderError && error.code === "UNSAFE_URL")) {
          this.keyManager.invalidateBuild();
          continue;
        }
        throw error;
      }
    }
    throw new MkissaProviderError("MKissa stream encryption changed", "CRYPTO_STALE");
  }

  private async resolveOneSource(source: MkissaSource): Promise<StreamData> {
    const decoded = decodeMkissaSourceUrl(source.sourceUrl);
    if (decoded.startsWith("/apivtwo/")) return this.resolveClock(decoded);
    const normalized = decoded.startsWith("//") ? `https:${decoded}` : decoded;
    const url = publicHttpsUrl(normalized);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.toLowerCase();

    if (source.type.toLowerCase() === "player") {
      return streamData(url, `${this.playerOrigin}/`, this.userAgent, path.endsWith(".m3u8"));
    }
    if (/\.(?:m3u8|mp4|webm|mkv)$/.test(path)) {
      return streamData(url, `${this.siteOrigin}/`, this.userAgent, path.endsWith(".m3u8"));
    }
    if (host === "allanime.day" && /\/apivtwo\/clock(?:\.json)?$/.test(path)) {
      return this.resolveClock(url.toString());
    }
    if (host === "mp4upload.com") return this.resolveMp4Upload(url);
    if (host === "ok.ru") return this.resolveOkRu(url);
    if (host === "uns.bio" || host.endsWith(".uns.bio")) return this.resolveUns(url);
    if (host === "bysekoze.com" || host.endsWith(".bysekoze.com")
      || host === "streamsb.net" || host.endsWith(".streamsb.net")) {
      return this.resolvePackedEmbed(url);
    }
    throw new MkissaProviderError(
      `MKissa server “${safeText(source.sourceName, 60) || "unknown"}” is not supported yet`,
      "UNSUPPORTED_SOURCE",
    );
  }

  private async resolveClock(value: string): Promise<StreamData> {
    const url = value.startsWith("/")
      ? publicHttpsUrl(value, `${this.playerOrigin}/`)
      : publicHttpsUrl(value);
    if (url.hostname !== new URL(this.playerOrigin).hostname) {
      throw new MkissaProviderError("MKissa internal server changed host", "UNSAFE_URL");
    }
    if (url.pathname.endsWith("/clock")) url.pathname += ".json";
    const referer = `${this.playerOrigin}/player.html`;
    const response = await this.request(url, {
      headers: { Accept: "application/json", Referer: referer, Origin: this.playerOrigin },
    });
    if (!response.ok) {
      throw new MkissaProviderError(`MKissa internal server failed (${response.status})`, "UNSUPPORTED_SOURCE");
    }
    const payload = parseObject(
      await responseText(response, 2 * 1024 * 1024, "MKissa internal server"),
      "MKissa internal server",
    );
    const links = Array.isArray(payload.links) ? payload.links : [];
    const candidates = links.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      if (typeof item.link !== "string") return [];
      try {
        return [{
          url: publicHttpsUrl(item.link),
          hls: item.hls === true || item.link.includes(".m3u8"),
          quality: positiveNumber(item.resolution ?? item.quality) ?? 0,
        }];
      } catch {
        return [];
      }
    }).sort((left, right) => Number(right.hls) - Number(left.hls) || right.quality - left.quality);
    if (!candidates[0]) throw new MkissaProviderError("MKissa internal server returned no media", "UNSUPPORTED_SOURCE");
    return streamData(candidates[0].url, referer, this.userAgent, candidates[0].hls, this.playerOrigin);
  }

  private async resolveMp4Upload(embedUrl: URL): Promise<StreamData> {
    const referer = "https://www.mp4upload.com/";
    const response = await this.request(embedUrl, { headers: { Accept: "text/html", Referer: referer } });
    if (!response.ok) throw new MkissaProviderError("MP4Upload did not respond", "UNSUPPORTED_SOURCE");
    const html = await responseText(response, 3 * 1024 * 1024, "MP4Upload");
    const encoded = /player\.src\s*\(\s*\{[^}]*\bsrc\s*:\s*["']([^"']+)/i.exec(html)?.[1]
      ?? /["']file["']\s*:\s*["'](https?:\\?\/\\?\/[^"']+)/i.exec(html)?.[1]
      ?? /\bsrc\s*:\s*["'](https?:\\?\/\\?\/[^"']+\.mp4[^"']*)/i.exec(html)?.[1];
    if (!encoded) throw new MkissaProviderError("MP4Upload media was not found", "UNSUPPORTED_SOURCE");
    const media = publicHttpsUrl(encoded.replace(/\\\//g, "/"));
    return streamData(media, referer, this.userAgent, false);
  }

  private async resolveOkRu(embedUrl: URL): Promise<StreamData> {
    const referer = "https://ok.ru/";
    const response = await this.request(embedUrl, { headers: { Accept: "text/html", Referer: referer } });
    if (!response.ok) throw new MkissaProviderError("OK video did not respond", "UNSUPPORTED_SOURCE");
    const html = await responseText(response, 5 * 1024 * 1024, "OK video");
    const encoded = /ondemandHls(?:\\&quot;|&quot;|")\s*:\s*(?:\\&quot;|&quot;|")([^"<]+?)(?:\\&quot;|&quot;|")/i.exec(html)?.[1];
    if (!encoded) throw new MkissaProviderError("OK video media was not found", "UNSUPPORTED_SOURCE");
    const media = publicHttpsUrl(encoded
      .replace(/\\u0026/gi, "&")
      .replace(/&amp;/gi, "&")
      .replace(/\\\//g, "/"));
    return streamData(media, referer, this.userAgent, true);
  }

  private async resolveUns(embedUrl: URL): Promise<StreamData> {
    const identifier = embedUrl.hash.slice(1).split("&", 1)[0];
    if (!identifier || !/^[A-Za-z0-9_-]{1,200}$/.test(identifier)) {
      throw new MkissaProviderError("MKissa MP4 server identifier was invalid", "UNSUPPORTED_SOURCE");
    }
    const endpoint = new URL("/api/v1/video", embedUrl.origin);
    endpoint.searchParams.set("id", identifier);
    endpoint.searchParams.set("w", "1280");
    endpoint.searchParams.set("h", "720");
    endpoint.searchParams.set("r", "");
    const response = await this.request(endpoint, {
      headers: { Accept: "text/plain", Origin: embedUrl.origin, Referer: embedUrl.toString() },
    });
    if (!response.ok) throw new MkissaProviderError("MKissa MP4 server did not respond", "UNSUPPORTED_SOURCE");
    const encrypted = (await responseText(response, 2 * 1024 * 1024, "MKissa MP4 server")).trim();
    if (!encrypted || encrypted.length % 32 !== 0 || !/^[a-f0-9]+$/i.test(encrypted)) {
      throw new MkissaProviderError("MKissa MP4 server response was invalid", "UNSUPPORTED_SOURCE");
    }
    let decoded: string;
    try {
      const decipher = createDecipheriv(
        "aes-128-cbc",
        Buffer.from("kiemtienmua911ca", "utf8"),
        Buffer.from("1234567890oiuytr", "utf8"),
      );
      decoded = Buffer.concat([decipher.update(Buffer.from(encrypted, "hex")), decipher.final()]).toString("utf8");
    } catch {
      throw new MkissaProviderError("MKissa MP4 server decryption failed", "UNSUPPORTED_SOURCE");
    }
    const payload = parseObject(decoded, "MKissa MP4 server");
    const candidate = typeof payload.source === "string" ? payload.source
      : typeof payload.cf === "string" ? payload.cf : null;
    if (!candidate) throw new MkissaProviderError("MKissa MP4 server returned no media", "UNSUPPORTED_SOURCE");
    return streamData(publicHttpsUrl(candidate), embedUrl.toString(), this.userAgent, candidate.includes(".m3u8"));
  }

  private async resolvePackedEmbed(embedUrl: URL): Promise<StreamData> {
    const response = await this.request(embedUrl, {
      headers: { Accept: "text/html,*/*", Referer: `${embedUrl.origin}/` },
    });
    if (!response.ok) {
      throw new MkissaProviderError("MKissa HLS server did not respond", "UNSUPPORTED_SOURCE");
    }
    const html = await responseText(response, 3 * 1024 * 1024, "MKissa HLS server");
    const media = extractEmbedMediaUrl(html)
      ?? packedBodies(html).map(extractEmbedMediaUrl).find((value): value is URL => value !== null)
      ?? null;
    if (!media) {
      throw new MkissaProviderError("MKissa HLS server media was not found", "UNSUPPORTED_SOURCE");
    }
    return streamData(
      media,
      embedUrl.toString(),
      this.userAgent,
      media.pathname.toLowerCase().includes(".m3u8"),
      embedUrl.origin,
    );
  }

  private async request(url: URL, init: RequestInit, apiOnly = false): Promise<Response> {
    const parsed = publicHttpsUrl(url.toString());
    if (apiOnly && parsed.origin !== this.apiOrigin) {
      throw new MkissaProviderError("MKissa API request changed host", "UNSAFE_URL");
    }
    const headers = normalizeHeaders(init.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", this.userAgent);
    if (!headers.has("Accept-Language")) headers.set("Accept-Language", "en-US,en;q=0.9");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await safeRedirectFetch(
        this.fetcher,
        parsed,
        { ...init, headers, signal: controller.signal },
        (candidate) => {
          if (apiOnly && candidate.origin !== this.apiOrigin) {
            throw new MkissaProviderError("MKissa API redirected to another host", "UNSAFE_URL");
          }
        },
      );
      if (response.url) {
        const finalUrl = publicHttpsUrl(response.url);
        if (apiOnly && finalUrl.origin !== this.apiOrigin) {
          throw new MkissaProviderError("MKissa API redirected to another host", "UNSAFE_URL");
        }
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function streamData(
  mediaUrl: URL,
  referer: string,
  userAgent: string,
  hls: boolean,
  origin?: string,
): StreamData {
  const requestHeaders: Record<string, string> = { Referer: referer, "User-Agent": userAgent };
  if (origin) requestHeaders.Origin = origin;
  return {
    url: mediaUrl.toString(),
    referer,
    requestHeaders,
    authorizationScope: hls ? "directory" : "exact",
    cors: true,
  };
}

function extractEmbedMediaUrl(text: string): URL | null {
  const candidates = [
    ...text.matchAll(/https?:\\?\/\\?\/[^\s"'<>]+?\.(?:m3u8|mp4)[^\s"'<>]*/gi),
    ...text.matchAll(/(?:source|file|src)["']?\s*[=:]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)/gi),
  ];
  for (const match of candidates) {
    const value = match[1] ?? match[0];
    try {
      return publicHttpsUrl(value
        .replace(/\\u0026/gi, "&")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, "\"")
        .replace(/\\\//g, "/"));
    } catch { /* try the next bounded candidate */ }
  }
  return null;
}

function packedBodies(html: string): string[] {
  const matches = [
    ...html.matchAll(/\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/gs),
    ...html.matchAll(/\}\s*\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"((?:[^"\\]|\\.)*)"\.split\("\|"\)/gs),
  ].slice(0, 20);
  return matches.flatMap((match) => {
    const radix = Number(match[2]);
    const count = Number(match[3]);
    if (!Number.isInteger(radix) || radix < 2 || radix > 62
      || !Number.isInteger(count) || count < 1 || count > 10_000) return [];
    const keys = match[4].split("|", count);
    const lookup = new Map<string, string>();
    keys.forEach((word, index) => {
      if (word) lookup.set(baseN(index, radix), word);
    });
    return [match[1].replace(/\b\w+\b/g, (token) => lookup.get(token) ?? token)];
  });
}

function baseN(value: number, radix: number): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (value === 0) return "0";
  let number = value;
  let result = "";
  while (number > 0) {
    result = alphabet[number % radix] + result;
    number = Math.floor(number / radix);
  }
  return result;
}

function parseShow(value: unknown): MkissaShow | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  if (typeof object._id !== "string") return null;
  let id: string;
  try { id = validateOpaqueId(object._id, "show"); } catch { return null; }
  const name = safeText(object.name, 300)
    || safeText(object.englishName, 300)
    || safeText(object.nativeName, 300);
  if (!name) return null;
  const detail = episodeDetail(object.availableEpisodesDetail);
  const available = positiveNumber(object.availableEpisodes);
  const anilistId = positiveNumber(object.aniListId);
  return {
    id,
    name,
    englishName: safeText(object.englishName, 300) || undefined,
    nativeName: safeText(object.nativeName, 300) || undefined,
    thumbnail: typeof object.thumbnail === "string" ? object.thumbnail.slice(0, 2_048) : undefined,
    slugTime: safeText(object.slugTime, 300) || undefined,
    anilistId: anilistId && Number.isInteger(anilistId) ? anilistId : undefined,
    ...detail,
    totalEpisodes: available ?? Math.max(detail.subEpisodes.length, detail.dubEpisodes.length),
  };
}

function episodeDetail(value: unknown): { subEpisodes: string[]; dubEpisodes: string[] } {
  const detail = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    subEpisodes: episodeStrings(detail.sub),
    dubEpisodes: episodeStrings(detail.dub),
  };
}

function episodeStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 20_000).flatMap((entry) => {
    const candidate = typeof entry === "number" || typeof entry === "string" ? String(entry).trim() : "";
    try { return [validateEpisodeString(candidate)]; } catch { return []; }
  }))];
}

function parseSource(value: unknown): MkissaSource | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  if (typeof object.sourceUrl !== "string" || object.sourceUrl.length > 32_768) return null;
  const sourceName = safeText(object.sourceName, 80) || "Server";
  const priority = positiveNumber(object.priority) ?? 0;
  return {
    sourceUrl: object.sourceUrl,
    sourceName,
    type: safeText(object.type, 40) || "embed",
    priority: Math.min(priority, 1_000_000),
  };
}

function validateSource(source: MkissaSource): MkissaSource {
  const parsed = parseSource(source);
  if (!parsed) throw new MkissaProviderError("Invalid MKissa server data", "INVALID_RESPONSE");
  return parsed;
}

function validateOpaqueId(value: string, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
    throw new MkissaProviderError(`Invalid MKissa ${label} identifier`, "INVALID_RESPONSE");
  }
  return value;
}

function validateEpisodeString(value: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 32 || !/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new MkissaProviderError("Invalid MKissa episode identifier", "INVALID_RESPONSE");
  }
  return normalized;
}

function parseObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* handled below */ }
  throw new MkissaProviderError(`${label} returned invalid JSON`, "INVALID_RESPONSE");
}

function objectAt(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const child = value[key];
  return child && typeof child === "object" && !Array.isArray(child)
    ? child as Record<string, unknown>
    : null;
}

function originOnly(value: string): string {
  const parsed = publicHttpsUrl(value);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new MkissaProviderError("MKissa origin must not contain a path", "UNSAFE_URL");
  }
  return parsed.origin;
}

function boundedPositive(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.floor(value!))) : fallback;
}

function boundedMapSet<K, V>(map: Map<K, V>, key: K, value: V, maximum: number): void {
  if (!map.has(key) && map.size >= maximum) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}
