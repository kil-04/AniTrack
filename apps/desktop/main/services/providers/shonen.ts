import { app, net } from "electron";
import {
  isShonenAnimeId,
  parseShonenSearch,
  parseShonenStreams,
  parseShonenTitlePage,
  SHONEN,
  ShonenError,
  shonenAnimeUrl,
  shonenSearchUrl,
  shonenSourcesUrl,
  type ShonenLanguage,
  type ShonenStream,
} from "../../../../../packages/shared/shonen";
import { MangaSourceError, SourceHttp } from "../manga/sources";
import { authorizeResolvedStream } from "./stream-authorization";
import type { AnimeInfo, EpisodeInfo, ExternalIds, ProviderEpisodePage, StreamData, StreamLink, StreamProvider } from "./types";

const EPISODE_PAGE_SIZE = 100;
const TITLE_TTL_MS = 30 * 60_000;
const PAGE_BYTES = 2 * 1024 * 1024;
const SOURCES_BYTES = 256 * 1024;
const NO_SUB = "shonen.to has no subtitled stream for this episode right now. It sometimes finds one later: retry in a few minutes or choose another source.";
/** A server list is reused this long, so listing servers and playing one is one API call. */
const STREAMS_TTL_MS = 60_000;
/** How long a stream's playlist gets to answer before it's listed after the ones that did. */
const PROBE_MS = 3_000;

/** `s`/`b`: the chosen stream's index and label (absent in links from before 9.1.5: the first stream). */
interface LinkToken { a: number; n: number; l: ShonenLanguage; s?: number; b?: string }

function animeIdOf(value: string): number {
  const id = /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : NaN;
  if (!isShonenAnimeId(id)) throw new ShonenError("Invalid shonen.to show. Reload the episode list.");
  return id;
}

function decodeLink(value: string): LinkToken {
  let token: Partial<LinkToken> | null = null;
  try { if (value.length <= 200) token = JSON.parse(value); } catch {}
  if (!token || !isShonenAnimeId(token.a) || !Number.isInteger(token.n) || token.n! < 1 || token.n! > 5_000
    || (token.l !== "sub" && token.l !== "dub")
    || (token.s !== undefined && (!Number.isInteger(token.s) || token.s < 0 || token.s > 7))
    || (token.b !== undefined && (typeof token.b !== "string" || token.b.length > 40))) {
    throw new ShonenError("Invalid shonen.to server link. Reload the episode list.");
  }
  return token as LinkToken;
}

/**
 * shonen.to (packages/shared/shonen.ts): AniList-keyed, plain HTTP, one paced request
 * at a time on its own host with AniTrack's honest user agent. Video comes from the
 * HLS proxies the API names, with shonen.to as Referer (anigato.lol's playlists refuse
 * requests without it); no cookies or human check.
 */
export class ShonenProvider implements StreamProvider {
  readonly id = "shonen";
  readonly name = "shonen.to";
  readonly capabilities = {
    externalIds: true, downloads: true, prefetch: false,
    // Each of an episode's streams is a server, so the player falls back to the next one.
    streamVariants: "server" as const, episodePageSize: EPISODE_PAGE_SIZE,
  };
  private readonly http = new SourceHttp("shonen.to", new Set(SHONEN.HOSTS), 500, () => net.fetch, `AniTrack/${app.getVersion()} (Desktop)`);
  private readonly titles = new Map<number, { at: number; title: string | null; episodes: number | null }>();
  private readonly streamLists = new Map<string, { at: number; streams: ShonenStream[] }>();

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
    const links: StreamLink[] = [];
    for (const l of ["sub", "dub"] as const) {
      let streams: ShonenStream[];
      // Always ask afresh: a stream shonen.to found since the last list (a backup) shows on Retry.
      try { streams = await this.streams(a, n, l, true); }
      catch (error) {
        // A missing dub is normal. Without Sub nothing is offered: AniTrack never
        // starts a dub the viewer didn't pick (Sub's own servers are tried in turn).
        if (l === "dub") continue;
        if (error instanceof ShonenError && error.notFound) throw new ShonenError(NO_SUB, true);
        throw error;
      }
      streams.forEach((stream, s) => links.push({
        id: JSON.stringify({ a, n, l, s, b: stream.label } satisfies LinkToken),
        quality: `${l === "dub" ? "Dub" : "Sub"} · ${stream.label}`,
        audio: l === "dub" ? "eng" : "jpn",
        variant: l,
      }));
    }
    return links;
  }

  async resolveStream(linkId: string): Promise<StreamData> {
    const { a, n, l, s = 0, b } = decodeLink(linkId);
    const streams = await this.streams(a, n, l);
    // The label survives a reordered list; the index covers a renamed stream.
    const stream = (b ? streams.find((item) => item.label === b) : undefined) ?? streams[s];
    if (!stream) throw new ShonenError("That shonen.to server is no longer listed. Reload the servers or choose another.");
    for (const subtitle of stream.subtitles) authorizeResolvedStream({ url: subtitle.file, authorizationScope: "exact", cors: true });
    return {
      url: stream.url,
      subtitles: stream.subtitles.map((item) => ({ file: item.file, label: item.label, kind: item.kind, default: item.default })),
      intro: stream.intro ?? undefined,
      outro: stream.outro ?? undefined,
      // anigato.lol answers its playlists only with shonen.to's Referer (22 Oct 2026).
      referer: SHONEN.ORIGIN,
      // Master and rendition playlists live under one proxy path (/api/stream/ on anigato.lol).
      authorizationScope: "directory",
      cors: true,
      // The proxy's playlist URL has no .m3u8 for the player to look for.
      hls: true,
    };
  }

  /** An episode's streams in one language: a fresh answer, or (playing a listed server) one under a minute old. */
  private async streams(a: number, n: number, l: ShonenLanguage, fresh = false): Promise<ShonenStream[]> {
    const key = `${a}:${n}:${l}`;
    const cached = this.streamLists.get(key);
    const now = Date.now();
    if (!fresh && cached && now - cached.at < STREAMS_TTL_MS && cached.streams.every((item) => item.expiresAt === null || item.expiresAt - now > STREAMS_TTL_MS)) {
      return cached.streams;
    }
    let json: unknown;
    try { json = JSON.parse(await this.get(shonenSourcesUrl(a, n, l), SOURCES_BYTES)); }
    catch (error) {
      if (error instanceof SyntaxError) throw new ShonenError("shonen.to sent a response AniTrack couldn't read.");
      throw error;
    }
    const streams = await this.workingFirst(parseShonenStreams(json));
    if (this.streamLists.size >= 50) this.streamLists.delete(this.streamLists.keys().next().value!);
    this.streamLists.set(key, { at: now, streams });
    return streams;
  }

  /**
   * The streams whose playlist answers first, the rest after in the site's order: one link
   * (stream.shonen.to, 22 Oct 2026) may not connect at all, and the player would wait it out.
   */
  private async workingFirst(streams: ShonenStream[]): Promise<ShonenStream[]> {
    if (streams.length < 2) return streams;
    const works = await Promise.all(streams.map(async (stream) => {
      try {
        const response = await fetch(stream.url, {
          headers: { Referer: `${SHONEN.ORIGIN}/`, Accept: "application/vnd.apple.mpegurl, */*", "User-Agent": `AniTrack/${app.getVersion()} (Desktop)` },
          signal: AbortSignal.timeout(PROBE_MS),
        });
        return response.ok && (await response.text()).trimStart().startsWith("#EXTM3U");
      } catch {
        return false;
      }
    }));
    return [...streams.filter((_, i) => works[i]), ...streams.filter((_, i) => !works[i])];
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
    this.streamLists.clear();
  }
}
