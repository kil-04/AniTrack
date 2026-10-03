import { net } from "electron";
import type { AnimeMeta } from "../../../../../packages/shared/types";
import { searchAnime } from "../anilist";
import { prepareAnikotoHlsAuthorization } from "./anikoto-hls";
import { MiruroClient } from "./miruro-client";
import { miruroChoices, miruroDirectMedia, miruroVariantLabel, type MiruroEpisodeChoice } from "./miruro-media";
import { MIRURO_ORIGIN, MiruroProtocolError, type MiruroRequest } from "./miruro-protocol";
import { authorizeResolvedStream } from "./stream-authorization";
import type { AnimeInfo, EpisodeInfo, ExternalIds, ProviderEpisodePage, StreamData, StreamLink, StreamProvider } from "./types";
import { PageVerificationError, VerifiedPageSession } from "./verified-page-session";

type Json = Record<string, unknown>;
type Reader = (request: MiruroRequest) => Promise<Json>;

export interface MiruroProviderOptions {
  read?: Reader;
  search?: (query: string) => Promise<AnimeMeta[]>;
  prepareHls?: (url: string, referer: string) => Promise<string>;
  now?: () => number;
}

const EPISODE_PAGE_SIZE = 100;
const CATALOGUE_TTL_MS = 5 * 60_000;

interface Catalogue { at: number; sub: MiruroEpisodeChoice[]; dub: MiruroEpisodeChoice[] }
interface LinkToken { a: number; n: number; s: string; c: string }

let session: VerifiedPageSession | null = null;

/** The user-operated Miruro page session used as the API transport. */
function pageSession(): VerifiedPageSession {
  session ??= new VerifiedPageSession({ origin: MIRURO_ORIGIN, partition: "persist:miruro", label: "Miruro", world: 1209 });
  return session;
}

function defaultReader(): Reader {
  const client = new MiruroClient({
    // The user completes a website check in the visible page, so a new request
    // right afterwards must work (as on Android). Requests already queued when
    // a block arrives still stop; rate limits keep a short pause.
    securityCooldownMs: 0,
    rateLimitCooldownMs: 60_000,
    fetcher: async (url, init) => {
      const accept = new Headers(init.headers).get("Accept") ?? "application/json, text/plain, */*";
      const response = await pageSession().get(url, accept, ["x-obfuscated"]);
      if (response.body === null) throw new MiruroProtocolError("Miruro response exceeded its size limit");
      return new Response(response.body, { status: response.status, headers: response.headers });
    },
  });
  return async (request) => {
    try {
      return await client.read(request);
    } catch (error) {
      // The page itself was challenged: show it to the user and stop here.
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

function encodeLink(token: LinkToken): string {
  return JSON.stringify(token);
}

function decodeLink(linkId: string): LinkToken {
  let parsed: unknown;
  try { parsed = JSON.parse(linkId); } catch { parsed = null; }
  const token = parsed as Partial<LinkToken> | null;
  if (!token || typeof token !== "object" || typeof token.a !== "number" || typeof token.n !== "number"
    || typeof token.s !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(token.s)
    || !["sub", "ssub", "dub"].includes(token.c as string) || !Number.isFinite(token.n)) {
    throw new MiruroProtocolError("Invalid Miruro server link. Reload the episode list.");
  }
  anilistIdOf(String(token.a));
  return token as LinkToken;
}

/**
 * Miruro catalogues shows by AniList id. Search therefore uses AniList metadata
 * (no Miruro traffic, so background matching never opens its verification
 * page); episodes and sources are read through the user-verified page session
 * and only direct HLS/MP4 media is returned — embeds are never loaded.
 */
export class MiruroProvider implements StreamProvider {
  readonly id = "miruro";
  readonly name = "Miruro";
  readonly capabilities = {
    externalIds: true,
    downloads: false,
    streamVariants: "server" as const,
    episodePageSize: EPISODE_PAGE_SIZE,
  };

  private readonly read: Reader;
  private readonly searchMetadata: (query: string) => Promise<AnimeMeta[]>;
  private readonly prepareHls: (url: string, referer: string) => Promise<string>;
  private readonly now: () => number;
  private readonly catalogues = new Map<number, Catalogue>();
  private config: { at: number; value: Json } | null = null;

  constructor(options: MiruroProviderOptions = {}) {
    this.read = options.read ?? defaultReader();
    this.searchMetadata = options.search ?? searchAnime;
    this.prepareHls = options.prepareHls ?? ((url, referer) => prepareAnikotoHlsAuthorization(
      url, referer, (target, init) => net.fetch(target, { ...init, redirect: "follow" }), { label: "Miruro" }));
    this.now = options.now ?? Date.now;
  }

  async search(query: string): Promise<AnimeInfo[]> {
    const results = await this.searchMetadata(query);
    return results.slice(0, 20).map((meta) => ({
      id: String(meta.id),
      providerId: this.id,
      title: meta.title,
      poster: meta.coverImage ?? "",
      episodes: meta.episodes ?? undefined,
      type: meta.format ?? undefined,
      status: meta.status ?? undefined,
      year: meta.year ?? undefined,
      externalLookupId: meta.id,
    }));
  }

  async getExternalIds(animeId: string): Promise<ExternalIds> {
    return { anilistId: anilistIdOf(animeId) };
  }

  async getEpisodes(animeId: string, page = 1): Promise<ProviderEpisodePage> {
    const catalogue = await this.catalogue(anilistIdOf(animeId));
    const titles = new Map<number, string | undefined>();
    for (const choice of [...catalogue.sub, ...catalogue.dub]) {
      if (!titles.has(choice.number) || (!titles.get(choice.number) && choice.title)) titles.set(choice.number, choice.title);
    }
    const numbers = [...titles.keys()].sort((a, b) => a - b);
    const lastPage = Math.max(1, Math.ceil(numbers.length / EPISODE_PAGE_SIZE));
    const safePage = Math.min(Math.max(1, Math.floor(Number(page) || 1)), lastPage);
    const data: EpisodeInfo[] = numbers
      .slice((safePage - 1) * EPISODE_PAGE_SIZE, safePage * EPISODE_PAGE_SIZE)
      .map((number) => ({ id: `ep:${number}`, episodeNumber: number, title: titles.get(number) || `Episode ${number}` }));
    return { data, total: numbers.length, lastPage };
  }

  async getStreamLinks(episodeId: string, animeId: string): Promise<StreamLink[]> {
    const anilistId = anilistIdOf(animeId);
    const match = /^ep:([0-9]+(?:\.[0-9]+)?)$/.exec(episodeId);
    if (!match) throw new MiruroProtocolError("Invalid Miruro episode reference. Reload the episode list.");
    const number = Number(match[1]);
    const catalogue = await this.catalogue(anilistId);
    const choices = [...catalogue.sub, ...catalogue.dub].filter((choice) => choice.number === number);
    if (choices.length === 0) throw new MiruroProtocolError("This episode is no longer listed on Miruro. Reload the episode list.");
    return choices.map((choice) => ({
      id: encodeLink({ a: anilistId, n: number, s: choice.server, c: choice.category }),
      quality: miruroVariantLabel(choice),
      audio: choice.category === "dub" ? "eng" : "jpn",
      variant: `${choice.server}:${choice.category}`,
    }));
  }

  async resolveStream(linkId: string): Promise<StreamData> {
    const token = decodeLink(linkId);
    const catalogue = await this.catalogue(token.a);
    const choice = [...catalogue.sub, ...catalogue.dub]
      .find((item) => item.number === token.n && item.server === token.s && item.category === token.c);
    // Never substitute another server for the one the user picked.
    if (!choice) throw new MiruroProtocolError("That Miruro server is not available for this episode");
    const source = await this.read({
      operation: "sources", anilistId: token.a, episodeId: choice.episodeId, provider: choice.server, category: choice.category,
    });
    const media = miruroDirectMedia(source)[0];
    if (!media) throw new MiruroProtocolError("This Miruro server did not return supported direct video. Choose another server.");
    for (const subtitle of media.subtitles) {
      authorizeResolvedStream({ url: subtitle.file, referer: media.referer || undefined, authorizationScope: "exact", cors: true });
    }
    // HLS can move to rotating CDN hosts: verify the playlists and authorize
    // exactly the observed media directories with the provider's Referer.
    const url = media.hls && media.referer ? await this.prepareHls(media.url, media.referer) : media.url;
    return {
      url,
      referer: media.referer || undefined,
      requestHeaders: media.referer ? { Referer: media.referer } : undefined,
      subtitles: media.subtitles,
      authorizationScope: media.hls ? "directory" : "exact",
      cors: true,
    };
  }

  /** Identity-checked catalogue, reused briefly so server lists do not re-read it. */
  private async catalogue(anilistId: number): Promise<Catalogue> {
    const cached = this.catalogues.get(anilistId);
    if (cached && this.now() - cached.at < CATALOGUE_TTL_MS) return cached;
    const info = await this.read({ operation: "info", anilistId });
    const media = info.media && typeof info.media === "object" ? info.media as Json : null;
    if (media?.id !== anilistId) throw new MiruroProtocolError("Miruro show identity could not be verified");
    if (!this.config || this.now() - this.config.at >= CATALOGUE_TTL_MS) {
      this.config = { at: this.now(), value: await this.read({ operation: "config" }) };
    }
    const episodes = await this.read({ operation: "episodes", anilistId });
    const catalogue: Catalogue = {
      at: this.now(),
      sub: miruroChoices(anilistId, "sub", this.config.value, episodes),
      dub: miruroChoices(anilistId, "dub", this.config.value, episodes),
    };
    if (catalogue.sub.length === 0 && catalogue.dub.length === 0) {
      throw new MiruroProtocolError("Miruro has no playable servers for this show");
    }
    if (this.catalogues.size >= 50) this.catalogues.delete(this.catalogues.keys().next().value!);
    this.catalogues.set(anilistId, catalogue);
    return catalogue;
  }

  onConfigChanged(): void {
    this.catalogues.clear();
    this.config = null;
  }
}

export { PageVerificationError };
