import { net } from "electron";
import type { AnimeMeta } from "../../../../../packages/shared/types";
import { searchAnime } from "../anilist";
import { prepareAnikotoHlsAuthorization } from "./anikoto-hls";
import { MIRURO_ORIGIN, MiruroProtocolError } from "./miruro-protocol";
import { miruroV1Choices, miruroV1Episodes, miruroV1Show, type MiruroV1Episode } from "./miruro-v1-catalogue";
import { MiruroV1Client, type MiruroV1Reader } from "./miruro-v1-client";
import { authorizeResolvedStream } from "./stream-authorization";
import type { AnimeInfo, ExternalIds, ProviderEpisodePage, StreamData, StreamLink, StreamProvider } from "./types";
import { PageVerificationError, VerifiedPageSession } from "./verified-page-session";

export interface MiruroProviderOptions {
  read?: MiruroV1Reader;
  search?: (query: string) => Promise<AnimeMeta[]>;
  prepareHls?: (url: string, referer: string, headers: Record<string, string>) => Promise<string>;
  now?: () => number;
}
interface Catalogue { at: number; showId: string; episodes: MiruroV1Episode[] }
interface LinkToken { v: 2; a: number; n: number; p: string; s: string; c: "sub" | "ssub" | "dub"; o: number }
const CATALOGUE_TTL_MS = 5 * 60_000;
const EPISODE_PAGE_SIZE = 100;
let session: VerifiedPageSession | null = null;

function pageSession(): VerifiedPageSession {
  session ??= new VerifiedPageSession({ origin: MIRURO_ORIGIN, partition: "persist:miruro", label: "Miruro", world: 1209 });
  return session;
}
function defaultReader(): MiruroV1Reader {
  const client = new MiruroV1Client({
    securityCooldownMs: 0, rateLimitCooldownMs: 60_000,
    fetcher: async (url) => {
      const response = await pageSession().get(url, "application/json, application/octet-stream", ["content-type"], "base64");
      if (response.body === null) throw new MiruroProtocolError("Miruro response exceeded its size limit");
      return new Response(Buffer.from(response.body, "base64"), { status: response.status, headers: response.headers });
    },
  });
  return async request => {
    try { return await client.read(request); }
    catch (error) {
      if (error instanceof MiruroProtocolError && error.code === "SECURITY_CHECK") throw pageSession().requireVerification();
      throw error;
    }
  };
}
function anilistIdOf(value: string): number {
  if (!/^[1-9][0-9]{0,9}$/.test(value)) throw new MiruroProtocolError("Invalid Miruro show reference. Reload the episode list.");
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id > 2_147_483_647) throw new MiruroProtocolError("Invalid Miruro show reference. Reload the episode list.");
  return id;
}
function decodeLink(value: string): LinkToken {
  let parsed: unknown = null;
  try { if (value.length <= 1024) parsed = JSON.parse(value); } catch {}
  const token = parsed as Partial<LinkToken> | null;
  if (!token || typeof token !== "object" || token.v !== 2 || typeof token.a !== "number"
    || typeof token.n !== "number" || !Number.isFinite(token.n) || token.n < 0 || token.n > 100_000
    || typeof token.p !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(token.p)
    || typeof token.s !== "string" || !/^[A-Za-z0-9 _.-]{1,100}$/.test(token.s)
    || !["sub", "ssub", "dub"].includes(token.c as string)
    || !Number.isSafeInteger(token.o) || token.o! < 0 || token.o! > 31) {
    throw new MiruroProtocolError("Invalid Miruro server link. Reload the episode list.");
  }
  anilistIdOf(String(token.a));
  return token as LinkToken;
}

/** Current REST catalogue; browser session is transport only, video stays native. */
export class MiruroProvider implements StreamProvider {
  readonly id = "miruro";
  readonly name = "Miruro";
  readonly capabilities = { externalIds: true, downloads: false, prefetch: false, streamVariants: "server" as const, episodePageSize: EPISODE_PAGE_SIZE };
  private readonly read: MiruroV1Reader;
  private readonly searchMetadata: (query: string) => Promise<AnimeMeta[]>;
  private readonly prepareHls: NonNullable<MiruroProviderOptions["prepareHls"]>;
  private readonly now: () => number;
  private readonly catalogues = new Map<number, Catalogue>();
  private readonly pending = new Map<number, Promise<Catalogue>>();
  private generation = 0;

  constructor(options: MiruroProviderOptions = {}) {
    this.read = options.read ?? defaultReader();
    this.searchMetadata = options.search ?? searchAnime;
    this.now = options.now ?? Date.now;
    this.prepareHls = options.prepareHls ?? ((url, referer, headers) => prepareAnikotoHlsAuthorization(
      url, referer, (target, init) => net.fetch(target, { ...init, redirect: "manual", credentials: "omit" }),
      { label: "Miruro", requestHeaders: headers, maxRenditions: 8 }));
  }

  async search(query: string): Promise<AnimeInfo[]> {
    return (await this.searchMetadata(query)).slice(0, 20).map(meta => ({
      id: String(meta.id), providerId: this.id, title: meta.title, poster: meta.coverImage ?? "",
      episodes: meta.episodes ?? undefined, type: meta.format ?? undefined, status: meta.status ?? undefined,
      year: meta.year ?? undefined, externalLookupId: meta.id,
    }));
  }
  async getExternalIds(animeId: string): Promise<ExternalIds> { return { anilistId: anilistIdOf(animeId) }; }

  async getEpisodes(animeId: string, page = 1): Promise<ProviderEpisodePage> {
    const catalogue = await this.catalogue(anilistIdOf(animeId));
    const lastPage = Math.max(1, Math.ceil(catalogue.episodes.length / EPISODE_PAGE_SIZE));
    const safePage = Math.min(Math.max(1, Math.floor(Number(page) || 1)), lastPage);
    return { data: catalogue.episodes.slice((safePage - 1) * EPISODE_PAGE_SIZE, safePage * EPISODE_PAGE_SIZE),
      total: catalogue.episodes.length, lastPage };
  }

  async getStreamLinks(episodeId: string, animeId: string): Promise<StreamLink[]> {
    const a = anilistIdOf(animeId);
    const match = /^ep:([0-9]+(?:\.[0-9]+)?)$/.exec(episodeId);
    if (!match) throw new MiruroProtocolError("Invalid Miruro episode reference. Reload the episode list.");
    const n = Number(match[1]);
    const catalogue = await this.catalogue(a);
    this.requireEpisode(catalogue, n);
    // The current API returns all server metadata in one episode /play read.
    // Do not probe those servers here or cache any signed media URLs.
    const choices = miruroV1Choices(await this.read({ operation: "play", showId: catalogue.showId, episode: n }), n);
    if (!choices.length) throw new MiruroProtocolError("Miruro has no supported direct servers for this episode.");
    return choices.map(choice => {
      const token: LinkToken = { v: 2, a, n, p: choice.provider, s: choice.server, c: choice.track, o: choice.occurrence };
      const kind = choice.track === "ssub" ? "Soft sub" : choice.track === "dub" ? "Dub" : "Sub";
      return { id: JSON.stringify(token), quality: choice.provider.toUpperCase() + " · " + choice.server + " · " + kind,
        audio: choice.track === "dub" ? "eng" : "jpn",
        variant: JSON.stringify([choice.track, choice.provider, choice.server, choice.occurrence]) };
    });
  }

  async resolveStream(linkId: string): Promise<StreamData> {
    const token = decodeLink(linkId);
    const catalogue = await this.catalogue(token.a);
    const episode = this.requireEpisode(catalogue, token.n);
    const choices = miruroV1Choices(await this.read({ operation: "play", showId: catalogue.showId, episode: token.n }), token.n);
    const choice = choices.find(item => item.track === token.c && item.provider === token.p
      && item.server === token.s && item.occurrence === token.o);
    if (!choice) throw new MiruroProtocolError("That Miruro server is no longer available. Reload servers or choose another.");
    const media = choice.media;
    const url = media.hls && media.referer ? await this.prepareHls(media.url, media.referer, choice.headers) : media.url;
    for (const subtitle of media.subtitles) authorizeResolvedStream({
      url: subtitle.file, requestHeaders: choice.headers, authorizationScope: "exact", cors: true,
    });
    return { url, referer: media.referer || undefined, requestHeaders: choice.headers, subtitles: media.subtitles,
      intro: episode.intro, outro: episode.outro, authorizationScope: media.hls ? "directory" : "exact", cors: true };
  }

  private requireEpisode(catalogue: Catalogue, number: number): MiruroV1Episode {
    const episode = catalogue.episodes.find(item => item.episodeNumber === number);
    if (!episode) throw new MiruroProtocolError("This episode is no longer listed on Miruro. Reload the episode list.");
    return episode;
  }
  private catalogue(anilistId: number): Promise<Catalogue> {
    const cached = this.catalogues.get(anilistId);
    if (cached && this.now() - cached.at < CATALOGUE_TTL_MS) return Promise.resolve(cached);
    const existing = this.pending.get(anilistId);
    if (existing) return existing;
    const generation = this.generation;
    const task = (async () => {
      const showId = miruroV1Show(await this.read({ operation: "lookup", anilistId }), anilistId);
      const episodes = miruroV1Episodes(await this.read({ operation: "episodes", showId }));
      if (generation !== this.generation) throw new MiruroProtocolError("Miruro configuration changed. Reload the episode list.");
      const catalogue = { at: this.now(), showId, episodes };
      if (!episodes.length) throw new MiruroProtocolError("Miruro has no episodes for this show.");
      if (this.catalogues.size >= 50) this.catalogues.delete(this.catalogues.keys().next().value!);
      this.catalogues.set(anilistId, catalogue);
      return catalogue;
    })();
    this.pending.set(anilistId, task);
    task.finally(() => { if (this.pending.get(anilistId) === task) this.pending.delete(anilistId); }).catch(() => {});
    return task;
  }
  onConfigChanged(): void { this.generation++; this.catalogues.clear(); this.pending.clear(); }
}
export { PageVerificationError };
