import { app, net } from "electron";
import {
  isXanimeId,
  parseXanimeEpisodes,
  parseXanimeShow,
  parseXanimeShows,
  parseXanimeStreams,
  XANIME,
  XanimeError,
  xanimeEpisodeUrl,
  xanimeSearchUrl,
  xanimeStreamLabel,
  xanimeTitleUrl,
  type XanimeEpisodeList,
  type XanimeShow,
  type XanimeStream,
} from "../../../../../packages/shared/xanime";
import { MangaSourceError, SourceHttp } from "../manga/sources";
import { authorizeResolvedStream } from "./stream-authorization";
import type { AnimeInfo, ExternalIds, ProviderEpisodePage, StreamData, StreamLink, StreamProvider } from "./types";

const PAGE_BYTES = 3 * 1024 * 1024;
const SHOW_TTL_MS = 30 * 60_000;
const EPISODES_TTL_MS = 10 * 60_000;
/** An episode page is reused this long, so listing its servers and playing one is one request. */
const STREAMS_TTL_MS = 60_000;
const NO_SUB = "Xanime has no subtitled stream for this episode. Choose another source.";

interface LinkToken { a: string; e: string; s: string; l: "sub" | "dub" }

function decodeLink(value: string): LinkToken {
  let token: Partial<LinkToken> | null = null;
  try { if (value.length <= 200) token = JSON.parse(value); } catch {}
  if (!token || !isXanimeId(token.a) || !isXanimeId(token.e) || !isXanimeId(token.s) || (token.l !== "sub" && token.l !== "dub")) {
    throw new XanimeError("Invalid Xanime server link. Reload the episode list.");
  }
  return token as LinkToken;
}

function showIdOf(value: string): string {
  if (!isXanimeId(value)) throw new XanimeError("Invalid Xanime show. Reload the episode list.");
  return value;
}

/**
 * Xanime (packages/shared/xanime.ts): plain HTTP on its own host, one paced request at a
 * time with AniTrack's honest user agent. Its pages carry each show's AniList id, so a
 * match is verified without guessing. Streams are signed HLS on its xanivsrc*.org hosts
 * that need no Referer or cookie; captions come from a sibling host and are authorized
 * one by one.
 */
export class XanimeProvider implements StreamProvider {
  readonly id = "xanime";
  readonly name = "Xanime";
  readonly capabilities = {
    externalIds: true, downloads: true, prefetch: false,
    // An episode's sub and dub streams are server choices; a failed one hands over in the same language.
    streamVariants: "server" as const, episodePageSize: 50,
  };
  private readonly http = new SourceHttp("Xanime", new Set(XANIME.HOSTS), 600, () => net.fetch, `AniTrack/${app.getVersion()} (Desktop)`);
  private readonly shows = new Map<string, { at: number; show: XanimeShow }>();
  private readonly episodeLists = new Map<string, { at: number; list: XanimeEpisodeList }>();
  private readonly episodePages = new Map<string, { at: number; html: string }>();

  private async get(url: string): Promise<string> {
    try {
      return await this.http.get(url, PAGE_BYTES);
    } catch (error) {
      if (error instanceof MangaSourceError && error.status === 404) throw new XanimeError("Xanime doesn't have this show or episode.", true);
      throw error;
    }
  }

  private remember(show: XanimeShow) {
    if (this.shows.size >= 200) this.shows.delete(this.shows.keys().next().value!);
    this.shows.set(show.id, { at: Date.now(), show });
  }

  async search(query: string): Promise<AnimeInfo[]> {
    if (!query.trim()) return [];
    const shows = parseXanimeShows(await this.get(xanimeSearchUrl(query))).filter((show) => !show.adult);
    for (const show of shows) this.remember(show);
    return shows.slice(0, 20).map((show) => ({
      id: show.id,
      providerId: this.id,
      title: show.title,
      poster: show.poster ?? "",
      episodes: show.episodes ?? undefined,
      subCount: show.subCount ?? undefined,
      dubCount: show.dubCount ?? undefined,
      type: show.type ?? undefined,
      year: show.year ?? undefined,
      externalLookupId: show.anilistId ?? undefined,
    }));
  }

  async getExternalIds(animeId: string): Promise<ExternalIds> {
    const show = await this.show(showIdOf(animeId));
    return { anilistId: show.anilistId ?? undefined, malId: show.malId ?? undefined };
  }

  async getEpisodes(animeId: string): Promise<ProviderEpisodePage> {
    const { episodes } = await this.episodeList(showIdOf(animeId));
    if (!episodes.length) throw new XanimeError("Xanime has no episodes for this show.");
    // Long shows list only their latest 50-episode page (see packages/shared/xanime.ts).
    return {
      data: episodes.map((episode) => ({ id: episode.id, episodeNumber: episode.number, title: episode.title })),
      total: episodes.length,
      lastPage: 1,
    };
  }

  async getStreamLinks(episodeId: string, animeId: string): Promise<StreamLink[]> {
    const a = showIdOf(animeId);
    if (!isXanimeId(episodeId)) throw new XanimeError("Invalid Xanime episode. Reload the episode list.");
    // Always ask afresh, so Retry sees a stream Xanime added since.
    const streams = await this.streams(a, episodeId, true);
    // AniTrack never starts a dub the viewer didn't pick, so without Sub nothing is offered.
    if (!streams.some((stream) => stream.language === "sub")) throw new XanimeError(NO_SUB, true);
    return streams.map((stream) => ({
      id: JSON.stringify({ a, e: episodeId, s: stream.id, l: stream.language } satisfies LinkToken),
      quality: xanimeStreamLabel(stream, streams),
      audio: stream.language === "dub" ? "eng" : "jpn",
      variant: stream.language,
    }));
  }

  async resolveStream(linkId: string): Promise<StreamData> {
    const { a, e, s, l } = decodeLink(linkId);
    const streams = await this.streams(a, e);
    const stream = streams.find((item) => item.id === s) ?? streams.find((item) => item.language === l);
    if (!stream) throw new XanimeError("That Xanime server is no longer listed. Reload the servers or choose another.");
    // Captions sit on another xanivsrc host than the video: authorize each exact file.
    for (const subtitle of stream.subtitles) authorizeResolvedStream({ url: subtitle.file, authorizationScope: "exact", cors: true });
    return {
      url: stream.url,
      subtitles: stream.subtitles.map((item) => ({ file: item.file, label: item.label, kind: item.kind, default: item.default })),
      intro: stream.intro ?? undefined,
      outro: stream.outro ?? undefined,
      // Renditions and segments sit beside the master playlist, under its signed media path.
      authorizationScope: "directory",
      cors: true,
    };
  }

  private async show(showId: string): Promise<XanimeShow> {
    const cached = this.shows.get(showId);
    if (cached && Date.now() - cached.at < SHOW_TTL_MS) return cached.show;
    const show = parseXanimeShow(await this.get(xanimeTitleUrl(showId)), showId);
    if (!show) throw new XanimeError("Xanime sent a page AniTrack couldn't read.");
    this.remember(show);
    return show;
  }

  /** The show's episodes, from the page of its latest episode. */
  private async episodeList(showId: string): Promise<XanimeEpisodeList> {
    const cached = this.episodeLists.get(showId);
    if (cached && Date.now() - cached.at < EPISODES_TTL_MS) return cached.list;
    const show = await this.show(showId);
    if (!show.latestEpisodeId) throw new XanimeError("Xanime has no episodes for this show.");
    const html = await this.episodePage(showId, show.latestEpisodeId, true);
    const list = parseXanimeEpisodes(html, showId);
    if (list.show) this.remember(list.show);
    if (this.episodeLists.size >= 50) this.episodeLists.delete(this.episodeLists.keys().next().value!);
    this.episodeLists.set(showId, { at: Date.now(), list });
    return list;
  }

  private async streams(showId: string, episodeId: string, fresh = false): Promise<XanimeStream[]> {
    return parseXanimeStreams(await this.episodePage(showId, episodeId, fresh), episodeId);
  }

  private async episodePage(showId: string, episodeId: string, fresh = false): Promise<string> {
    const key = `${showId}/${episodeId}`;
    const cached = this.episodePages.get(key);
    if (!fresh && cached && Date.now() - cached.at < STREAMS_TTL_MS) return cached.html;
    const html = await this.get(xanimeEpisodeUrl(showId, episodeId));
    if (this.episodePages.size >= 8) this.episodePages.delete(this.episodePages.keys().next().value!);
    this.episodePages.set(key, { at: Date.now(), html });
    return html;
  }

  onConfigChanged(): void {
    this.shows.clear();
    this.episodeLists.clear();
    this.episodePages.clear();
  }
}
