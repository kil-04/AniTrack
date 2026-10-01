import type {
  AnimeInfo,
  EpisodeInfo,
  ExternalIds,
  ProviderEpisodePage,
  StreamData,
  StreamLink,
  StreamProvider,
} from "./types";
import {
  MkissaClient,
  type MkissaAudio,
  type MkissaClientApi,
  type MkissaSeries,
  type MkissaShow,
  type MkissaSource,
} from "./mkissa-client";
import { MkissaProviderError, safeText } from "./mkissa-utils";

const EPISODE_PAGE_SIZE = 100;
const SERIES_CACHE_TTL_MS = 15 * 60 * 1000;
const LINK_TOKEN_PREFIX = "mk1.";

interface LinkToken {
  v: 1;
  showId: string;
  episode: string;
  audio: MkissaAudio;
  server: string;
  occurrence: number;
  index: number;
}

interface CachedSeries {
  value: MkissaSeries;
  expiresAt: number;
}

export interface MkissaProviderOptions {
  client?: MkissaClientApi;
  now?: () => number;
}

/**
 * Provider-neutral MKissa connector.
 *
 * Link ids contain only validated catalogue coordinates. Actual server URLs
 * remain inside the main process and are resolved lazily after the user picks
 * a server. This also lets the client refresh expired source URLs safely.
 */
export class MkissaProvider implements StreamProvider {
  readonly id = "mkissa";
  readonly name = "MKissa";
  readonly capabilities = {
    externalIds: true,
    downloads: false,
    streamVariants: "server" as const,
    episodePageSize: EPISODE_PAGE_SIZE,
  };

  private readonly client: MkissaClientApi;
  private readonly now: () => number;
  private readonly seriesCache = new Map<string, CachedSeries>();
  private readonly seriesPending = new Map<string, Promise<MkissaSeries>>();
  private readonly anilistIds = new Map<string, number>();

  constructor(options: MkissaProviderOptions = {}) {
    this.client = options.client ?? new MkissaClient();
    this.now = options.now ?? Date.now;
  }

  async search(query: string): Promise<AnimeInfo[]> {
    const shows = await this.client.search(query);
    return shows.map((show) => {
      this.rememberShow(show);
      return {
        id: show.id,
        providerId: this.id,
        title: show.name,
        poster: this.client.normalizePoster(show.thumbnail),
        episodes: show.totalEpisodes,
        subCount: show.subEpisodes.length || undefined,
        dubCount: show.dubEpisodes.length || undefined,
        externalLookupId: show.anilistId,
      };
    });
  }

  async getEpisodes(animeId: string, page = 1): Promise<ProviderEpisodePage> {
    const safePage = positiveInteger(page, 1);
    const series = await this.getSeries(animeId);
    const episodeStrings = orderedEpisodes(series);
    const total = episodeStrings.length;
    const lastPage = Math.max(1, Math.ceil(total / EPISODE_PAGE_SIZE));
    const offset = (Math.min(safePage, lastPage) - 1) * EPISODE_PAGE_SIZE;
    const data: EpisodeInfo[] = episodeStrings
      .slice(offset, offset + EPISODE_PAGE_SIZE)
      .map((episode, localIndex) => ({
        id: encodeEpisodeId(episode),
        episodeNumber: episodeNumber(episode, offset + localIndex),
        title: `Episode ${episode}`,
      }));
    return { data, total, lastPage };
  }

  async getStreamLinks(episodeId: string, animeId: string): Promise<StreamLink[]> {
    const episode = decodeEpisodeId(episodeId);
    const series = await this.getSeries(animeId);
    const modes: MkissaAudio[] = [];
    if (series.subEpisodes.includes(episode)) modes.push("sub");
    if (series.dubEpisodes.includes(episode)) modes.push("dub");
    if (modes.length === 0) {
      throw new MkissaProviderError("MKissa episode is no longer available", "INVALID_RESPONSE");
    }

    const links: StreamLink[] = [];
    let lastError: unknown = null;
    for (const audio of modes) {
      try {
        const sources = await this.client.getEpisodeSources(series.id, episode, audio);
        sources.forEach((source, index) => {
          const server = serverKey(source);
          const occurrence = sources.slice(0, index).filter((candidate) => serverKey(candidate) === server).length;
          const audioLabel = modes.length > 1 && audio === "dub" ? " · Dub" : "";
          links.push({
            id: encodeLinkToken({
              v: 1,
              showId: series.id,
              episode,
              audio,
              server,
              occurrence,
              index,
            }),
            quality: `${safeText(source.sourceName, 60) || "Server"}${audioLabel}`,
            audio: audio === "dub" ? "eng" : "jpn",
            variant: variantKey(source.sourceName),
          });
        });
      } catch (error) {
        if (error instanceof MkissaProviderError
          && (error.code === "CAPTCHA_REQUIRED" || error.code === "RATE_LIMITED")) throw error;
        lastError = error;
      }
    }
    if (links.length > 0) return deduplicateLinks(links);
    if (lastError instanceof Error) throw lastError;
    throw new MkissaProviderError("MKissa returned no stream servers", "INVALID_RESPONSE");
  }

  async resolveStream(linkId: string): Promise<StreamData> {
    const token = decodeLinkToken(linkId);
    const sources = await this.client.getEpisodeSources(token.showId, token.episode, token.audio);
    const matchingIndex = sources
      .map((source, index) => ({ source, index }))
      .filter(({ source }) => serverKey(source) === token.server)[token.occurrence]?.index ?? -1;
    const selectedIndex = matchingIndex >= 0 ? matchingIndex : Math.min(token.index, sources.length - 1);
    if (selectedIndex < 0) {
      throw new MkissaProviderError("MKissa server is no longer available", "INVALID_RESPONSE");
    }
    return this.client.resolveSource(sources[selectedIndex]);
  }

  async getExternalIds(animeId: string, lookupId?: string | number): Promise<ExternalIds> {
    const direct = Number(lookupId);
    if (Number.isSafeInteger(direct) && direct > 0) return { anilistId: direct };
    const cached = this.anilistIds.get(animeId);
    return cached ? { anilistId: cached } : {};
  }

  onConfigChanged(): void {
    this.seriesCache.clear();
    this.seriesPending.clear();
    this.anilistIds.clear();
    this.client.reset?.();
  }

  private rememberShow(show: MkissaShow): void {
    boundedMapSet(this.seriesCache, show.id, {
      value: { id: show.id, subEpisodes: show.subEpisodes, dubEpisodes: show.dubEpisodes },
      expiresAt: this.now() + SERIES_CACHE_TTL_MS,
    }, 200);
    if (show.anilistId) boundedMapSet(this.anilistIds, show.id, show.anilistId, 1_000);
  }

  private async getSeries(animeId: string): Promise<MkissaSeries> {
    validateOpaqueId(animeId, "show");
    const cached = this.seriesCache.get(animeId);
    if (cached && this.now() < cached.expiresAt) return cached.value;
    const existing = this.seriesPending.get(animeId);
    if (existing) return existing;
    const pending = this.client.getSeries(animeId).then((series) => {
      boundedMapSet(this.seriesCache, animeId, {
        value: series,
        expiresAt: this.now() + SERIES_CACHE_TTL_MS,
      }, 200);
      return series;
    });
    this.seriesPending.set(animeId, pending);
    pending.finally(() => this.seriesPending.delete(animeId)).catch(() => {});
    return pending;
  }
}

function orderedEpisodes(series: MkissaSeries): string[] {
  return [...new Set([...series.subEpisodes, ...series.dubEpisodes])].sort((left, right) => {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
    if (Number.isFinite(leftNumber) !== Number.isFinite(rightNumber)) return Number.isFinite(leftNumber) ? -1 : 1;
    return left.localeCompare(right, undefined, { numeric: true });
  });
}

function episodeNumber(value: string, index: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : index + 1;
}

function encodeEpisodeId(episode: string): string {
  validateEpisode(episode);
  return `mke1.${Buffer.from(episode, "utf8").toString("base64url")}`;
}

function decodeEpisodeId(value: string): string {
  if (typeof value !== "string" || !value.startsWith("mke1.") || value.length > 100) {
    throw new MkissaProviderError("Invalid MKissa episode link", "INVALID_RESPONSE");
  }
  const encoded = value.slice(5);
  let decoded: string;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) throw new Error("non-canonical token");
    decoded = bytes.toString("utf8");
  } catch { decoded = ""; }
  validateEpisode(decoded);
  return decoded;
}

function encodeLinkToken(token: LinkToken): string {
  return LINK_TOKEN_PREFIX + Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
}

function decodeLinkToken(value: string): LinkToken {
  if (typeof value !== "string" || !value.startsWith(LINK_TOKEN_PREFIX) || value.length > 1_024) {
    throw new MkissaProviderError("Invalid MKissa server link", "INVALID_RESPONSE");
  }
  const encoded = value.slice(LINK_TOKEN_PREFIX.length);
  let parsed: unknown = null;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) throw new Error("non-canonical token");
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {}
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MkissaProviderError("Invalid MKissa server link", "INVALID_RESPONSE");
  }
  const token = parsed as Partial<LinkToken>;
  validateOpaqueId(token.showId, "show");
  validateEpisode(token.episode);
  if (token.v !== 1 || (token.audio !== "sub" && token.audio !== "dub")
    || typeof token.server !== "string" || !/^[a-z0-9-]{1,100}$/.test(token.server)
    || !Number.isSafeInteger(token.occurrence) || token.occurrence! < 0 || token.occurrence! > 29
    || !Number.isSafeInteger(token.index) || token.index! < 0 || token.index! > 29) {
    throw new MkissaProviderError("Invalid MKissa server link", "INVALID_RESPONSE");
  }
  return token as LinkToken;
}

function serverKey(source: MkissaSource): string {
  return `${variantKey(source.sourceName)}-${variantKey(source.type)}`.slice(0, 100);
}

function variantKey(value: string): string {
  return safeText(value, 60).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "server";
}

function deduplicateLinks(links: StreamLink[]): StreamLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.id)) return false;
    seen.add(link.id);
    return true;
  });
}

function validateOpaqueId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
    throw new MkissaProviderError(`Invalid MKissa ${label} identifier`, "INVALID_RESPONSE");
  }
}

function validateEpisode(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,32}$/.test(value)) {
    throw new MkissaProviderError("Invalid MKissa episode identifier", "INVALID_RESPONSE");
  }
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function boundedMapSet<K, V>(map: Map<K, V>, key: K, value: V, maximum: number): void {
  if (!map.has(key) && map.size >= maximum) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}
