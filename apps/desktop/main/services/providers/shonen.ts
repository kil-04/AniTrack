import { app, net } from "electron";
import {
  isShonenAnimeId,
  parseShonenSearch,
  parseShonenSources,
  parseShonenTitlePage,
  SHONEN,
  ShonenError,
  shonenAnimeUrl,
  shonenSearchUrl,
  shonenSourcesUrl,
  type ShonenLanguage,
} from "../../../../../packages/shared/shonen";
import { MangaSourceError, SourceHttp } from "../manga/sources";
import { authorizeResolvedStream } from "./stream-authorization";
import type { AnimeInfo, EpisodeInfo, ExternalIds, ProviderEpisodePage, StreamData, StreamLink, StreamProvider } from "./types";

const EPISODE_PAGE_SIZE = 100;
const TITLE_TTL_MS = 30 * 60_000;
const PAGE_BYTES = 2 * 1024 * 1024;
const SOURCES_BYTES = 256 * 1024;

interface LinkToken { a: number; n: number; l: ShonenLanguage }

function animeIdOf(value: string): number {
  const id = /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : NaN;
  if (!isShonenAnimeId(id)) throw new ShonenError("Invalid shonen.to show. Reload the episode list.");
  return id;
}

function decodeLink(value: string): LinkToken {
  let token: Partial<LinkToken> | null = null;
  try { if (value.length <= 200) token = JSON.parse(value); } catch {}
  if (!token || !isShonenAnimeId(token.a) || !Number.isInteger(token.n) || token.n! < 1 || token.n! > 5_000
    || (token.l !== "sub" && token.l !== "dub")) {
    throw new ShonenError("Invalid shonen.to server link. Reload the episode list.");
  }
  return token as LinkToken;
}

/**
 * shonen.to (packages/shared/shonen.ts): AniList-keyed, plain HTTP, one paced request
 * at a time on its own host with AniTrack's honest user agent. Video comes from the
 * HLS proxy the API names; no Referer, cookies or human check.
 */
export class ShonenProvider implements StreamProvider {
  readonly id = "shonen";
  readonly name = "shonen.to";
  readonly capabilities = {
    externalIds: true, downloads: false, prefetch: false,
    streamVariants: "subtitle-type" as const, episodePageSize: EPISODE_PAGE_SIZE,
  };
  private readonly http = new SourceHttp("shonen.to", new Set(SHONEN.HOSTS), 500, () => net.fetch, `AniTrack/${app.getVersion()} (Desktop)`);
  private readonly titles = new Map<number, { at: number; title: string | null; episodes: number | null }>();

  private async get(url: string, maxBytes: number): Promise<string> {
    try {
      return await this.http.get(url, maxBytes);
    } catch (error) {
      if (error instanceof MangaSourceError && error.status === 404) throw new ShonenError("shonen.to has no stream for this episode in this language.", true);
      throw error;
    }
  }

  async search(query: string): Promise<AnimeInfo[]> {
    if (!query.trim()) return [];
    return parseShonenSearch(await this.get(shonenSearchUrl(query), PAGE_BYTES)).slice(0, 20).map((result) => ({
      id: String(result.anilistId),
      providerId: this.id,
      title: result.title,
      poster: result.poster ?? "",
      episodes: result.episodes ?? undefined,
      type: result.format ?? undefined,
      year: result.year ?? undefined,
      score: result.score ?? undefined,
      externalLookupId: result.anilistId,
    }));
  }

  async getExternalIds(animeId: string): Promise<ExternalIds> {
    return { anilistId: animeIdOf(animeId) };
  }

  async findByExternalId(anilistId?: number): Promise<AnimeInfo | null> {
    if (!isShonenAnimeId(anilistId)) return null;
    const page = await this.titlePage(anilistId).catch(() => null);
    if (!page?.title || !page.episodes) return null;
    return { id: String(anilistId), providerId: this.id, title: page.title, poster: "", episodes: page.episodes, externalLookupId: anilistId };
  }

  async getEpisodes(animeId: string, page = 1): Promise<ProviderEpisodePage> {
    const { episodes } = await this.titlePage(animeIdOf(animeId));
    if (!episodes) throw new ShonenError("shonen.to has no episodes for this show.");
    const lastPage = Math.max(1, Math.ceil(episodes / EPISODE_PAGE_SIZE));
    const safePage = Math.min(Math.max(1, Math.floor(Number(page) || 1)), lastPage);
    const data: EpisodeInfo[] = [];
    for (let n = (safePage - 1) * EPISODE_PAGE_SIZE + 1; n <= Math.min(episodes, safePage * EPISODE_PAGE_SIZE); n++) {
      data.push({ id: `ep:${n}`, episodeNumber: n, title: `Episode ${n}` });
    }
    return { data, total: episodes, lastPage };
  }

  async getStreamLinks(episodeId: string, animeId: string): Promise<StreamLink[]> {
    const a = animeIdOf(animeId);
    const match = /^ep:([1-9][0-9]{0,3})$/.exec(episodeId);
    if (!match) throw new ShonenError("Invalid shonen.to episode. Reload the episode list.");
    const n = Number(match[1]);
    // Both are offered without asking the API: a missing dub answers when it's picked.
    return (["sub", "dub"] as const).map((l) => ({
      id: JSON.stringify({ a, n, l } satisfies LinkToken),
      quality: l === "dub" ? "Auto · Dub" : "Auto · Sub",
      audio: l === "dub" ? "eng" : "jpn",
      variant: l === "dub" ? "dub" : "soft",
    }));
  }

  async resolveStream(linkId: string): Promise<StreamData> {
    const { a, n, l } = decodeLink(linkId);
    let json: unknown;
    try { json = JSON.parse(await this.get(shonenSourcesUrl(a, n, l), SOURCES_BYTES)); }
    catch (error) {
      if (error instanceof SyntaxError) throw new ShonenError("shonen.to sent a response AniTrack couldn't read.");
      throw error;
    }
    const stream = parseShonenSources(json);
    for (const subtitle of stream.subtitles) authorizeResolvedStream({ url: subtitle.file, authorizationScope: "exact", cors: true });
    return {
      url: stream.url,
      subtitles: stream.subtitles.map((s) => ({ file: s.file, label: s.label, kind: s.kind, default: s.default })),
      intro: stream.intro ?? undefined,
      outro: stream.outro ?? undefined,
      // Playlists, segments and captions all live under the proxy's /api/proxy/ path.
      authorizationScope: "directory",
      cors: true,
      // The proxy's playlist URL is /api/proxy/m3u8?t=…, without the .m3u8 the player looks for.
      hls: true,
    };
  }

  private async titlePage(anilistId: number) {
    const cached = this.titles.get(anilistId);
    if (cached && Date.now() - cached.at < TITLE_TTL_MS) return cached;
    const parsed = parseShonenTitlePage(await this.get(shonenAnimeUrl(anilistId), PAGE_BYTES));
    const entry = { at: Date.now(), ...parsed };
    if (this.titles.size >= 100) this.titles.delete(this.titles.keys().next().value!);
    this.titles.set(anilistId, entry);
    return entry;
  }

  onConfigChanged(): void {
    this.titles.clear();
  }
}
