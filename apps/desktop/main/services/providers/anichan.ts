import { app, net } from "electron";
import { ANICHAN, AniChanError, aniChanMetadataUrl, aniChanSearchUrl, isAniChanAnimeId, parseAniChanSearch,
  parseAniChanTitle, parseAniChanServers, type AniChanTitle, type AniChanCategory, type AniChanTier } from "../../../../../packages/shared/anichan";
import { SourceHttp, MangaSourceError } from "../manga/sources";
import { aniChanPageReader, type AniChanReader } from "./anichan-session";
import { prepareAnikotoHlsAuthorization } from "./anikoto-hls";
import { authorizeResolvedStream } from "./stream-authorization";
import type { AnimeInfo, ExternalIds, ProviderEpisodePage, StreamData, StreamLink, StreamProvider } from "./types";

interface Options {
  get?: (url: string) => Promise<unknown>;
  read?: AniChanReader;
  prepareHls?: (url: string) => Promise<string>;
  now?: () => number;
}
interface LinkToken { a: number; n: number; c: AniChanCategory; t: AniChanTier; s: string; o: number }
const PAGE_SIZE = 100, TTL = 5 * 60_000;
function animeId(value: string): number {
  const id = /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : NaN;
  if (!isAniChanAnimeId(id)) throw new AniChanError("Invalid AniChan show. Reload the episode list.");
  return id;
}
function tokenOf(value: string): LinkToken {
  let t: Partial<LinkToken> | null = null;
  try { if (value.length <= 1024) t = JSON.parse(value); } catch { /* invalid data */ }
  if (!t || !isAniChanAnimeId(t.a) || !Number.isInteger(t.n) || t.n! < 1 || t.n! > ANICHAN.MAX_EPISODES ||
    !["sub", "dub"].includes(t.c!) || !["fast", "rest"].includes(t.t!) || typeof t.s !== "string" || !t.s || t.s.length > 100 ||
    !Number.isInteger(t.o) || t.o! < 0 || t.o! > 255) throw new AniChanError("Invalid AniChan server link. Reload servers.");
  return t as LinkToken;
}

export class AniChanProvider implements StreamProvider {
  readonly id = "anichan";
  readonly name = "AniChan";
  readonly capabilities = { externalIds: true, downloads: true, prefetch: false, streamVariants: "server" as const, episodePageSize: PAGE_SIZE };
  private readonly get: NonNullable<Options["get"]>;
  private readonly read: AniChanReader;
  private readonly prepareHls: NonNullable<Options["prepareHls"]>;
  private readonly now: () => number;
  private readonly cache = new Map<number, { at: number; title: AniChanTitle }>();
  private readonly pending = new Map<number, Promise<AniChanTitle>>();
  private generation = 0;

  constructor(options: Options = {}) {
    const http = new SourceHttp("AniChan", new Set(ANICHAN.HOSTS), 500, () => net.fetch, `AniTrack/${app.getVersion()} (Desktop)`);
    this.get = options.get ?? (async url => {
      try { return JSON.parse(await http.get(url, 2 * 1024 * 1024)); }
      catch (error) {
        if (error instanceof MangaSourceError && error.status === 404) throw new AniChanError("AniChan doesn't have this title.", true);
        if (error instanceof SyntaxError) throw new AniChanError("AniChan sent details AniTrack couldn't read.");
        throw error;
      }
    });
    this.read = options.read ?? aniChanPageReader();
    this.now = options.now ?? Date.now;
    this.prepareHls = options.prepareHls ?? (url => prepareAnikotoHlsAuthorization(url, ANICHAN.ORIGIN + "/",
      (target, init) => {
        if (new URL(target).hostname !== "c.toroplay.cymru" && new URL(target).hostname !== "anichan.to") throw new AniChanError("AniChan returned an unsupported media host.");
        // This signed proxy carries its upstream Referer in the URL, so extra
        // browser hotlink headers are unnecessary.
        return net.fetch(target, { ...init, headers: {}, redirect: "error", credentials: "omit" });
      }, { label: "AniChan", maxRenditions: 8,
        publicMediaPrefixes: ["https://c.toroplay.cymru/assets/"],
        authorize: stream => authorizeResolvedStream({ url: stream.url, authorizationScope: stream.authorizationScope, cors: true }),
      }));
  }
  async search(query: string): Promise<AnimeInfo[]> {
    if (!query.trim()) return [];
    return parseAniChanSearch(await this.get(aniChanSearchUrl(query))).slice(0, 20).map(r => ({ id: String(r.anilistId), providerId: this.id,
      title: r.title, poster: r.poster ?? "", episodes: r.episodes ?? undefined, year: r.year ?? undefined,
      type: r.format ?? undefined, externalLookupId: r.anilistId }));
  }
  async getExternalIds(id: string): Promise<ExternalIds> { return { anilistId: animeId(id) }; }
  async findByExternalId(id?: number): Promise<AnimeInfo | null> {
    if (!isAniChanAnimeId(id)) return null;
    try {
      const t = await this.title(id);
      if (!t.episodes.length) return null;
      return { id: String(id), providerId: this.id, title: t.title, poster: t.poster ?? "", episodes: t.episodes.length, externalLookupId: id };
    } catch (error) { if (error instanceof AniChanError && error.notFound) return null; throw error; }
  }
  async getEpisodes(id: string, page = 1): Promise<ProviderEpisodePage> {
    const title = await this.title(animeId(id));
    const lastPage = Math.max(1, Math.ceil(title.episodes.length / PAGE_SIZE));
    const p = Math.min(lastPage, Math.max(1, Math.floor(Number(page) || 1)));
    return { total: title.episodes.length, lastPage, data: title.episodes.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE).map(e => ({
      id: `ep:${e.number}`, episodeNumber: e.number, title: e.title ?? `Episode ${e.number}`, snapshot: e.snapshot ?? undefined,
    })) };
  }
  private async requireEpisode(a: number, n: number) {
    const episode = (await this.title(a)).episodes.find(e => e.number === n);
    if (!episode) throw new AniChanError("This episode is not listed on AniChan. Reload episodes.");
    return episode;
  }
  async getStreamLinks(episodeId: string, id: string): Promise<StreamLink[]> {
    const a = animeId(id), m = /^ep:([1-9][0-9]{0,3})$/.exec(episodeId);
    if (!m || Number(m[1]) > ANICHAN.MAX_EPISODES) throw new AniChanError("Invalid AniChan episode.");
    const n = Number(m[1]), episode = await this.requireEpisode(a, n);
    const links: StreamLink[] = [];
    for (const c of ["sub", "dub"] as const) {
      if (!episode[c]) continue;
      let t: AniChanTier = "fast";
      let choices = parseAniChanServers(await this.read({ animeId: a, episode: n, category: c, tier: t }), c, t);
      if (!choices.length) {
        t = "rest";
        choices = parseAniChanServers(await this.read({ animeId: a, episode: n, category: c, tier: t }), c, t);
      }
      for (const choice of choices) links.push({ id: JSON.stringify({ a, n, c, t, s: choice.name, o: choice.occurrence } satisfies LinkToken),
        quality: choice.label, audio: c === "dub" ? "eng" : "jpn", variant: choice.id });
    }
    // Without a Sub server nothing is offered: AniTrack never starts a dub the viewer
    // didn't pick (the player tries the other Sub servers in turn).
    if (!links.some(link => link.audio === "jpn")) {
      throw new AniChanError("AniChan has no subtitled stream for this episode right now. Retry later or choose another source.");
    }
    return links;
  }
  async resolveStream(id: string): Promise<StreamData> {
    const t = tokenOf(id), episode = await this.requireEpisode(t.a, t.n);
    if (!episode[t.c]) throw new AniChanError("This language is not listed on AniChan. Reload servers.");
    const choices = parseAniChanServers(await this.read({ animeId: t.a, episode: t.n, category: t.c, tier: t.t }), t.c, t.t);
    const choice = choices.find(c => c.name === t.s && c.occurrence === t.o);
    if (!choice) throw new AniChanError("That AniChan server is no longer available. Reload servers or choose another.");
    const url = choice.hls ? await this.prepareHls(choice.url) : choice.url;
    for (const sub of choice.subtitles) authorizeResolvedStream({ url: sub.file, authorizationScope: "exact", cors: true });
    return { url, hls: choice.hls, subtitles: choice.subtitles,
      intro: choice.intro ?? undefined, outro: choice.outro ?? undefined, authorizationScope: choice.hls ? "directory" : "exact", cors: true, conservativeNetwork: true };
  }
  private title(id: number): Promise<AniChanTitle> {
    const cached = this.cache.get(id);
    if (cached && this.now() - cached.at < TTL) return Promise.resolve(cached.title);
    if (this.pending.has(id)) return this.pending.get(id)!;
    const generation = this.generation;
    const task = (async () => {
      const raw = await this.get(aniChanMetadataUrl(id));
      let title = parseAniChanTitle(raw, id);
      // A watch count is only a fallback when no availability arrays exist.
      const r = raw as Record<string, any>;
      if (![r?.selfhost?.cached_eps, r?.selfhost?.cached_sub, r?.selfhost?.cached_dub, r?.available_eps?.sub, r?.available_eps?.dub, r?.available_eps?.hsub].some(Array.isArray)) {
        title = parseAniChanTitle(raw, id, await this.get(`${ANICHAN.ORIGIN}/api/watch/episodes?anilistId=${id}`));
      }
      if (generation !== this.generation) throw new AniChanError("AniChan configuration changed. Reload episodes.");
      if (this.cache.size >= 50) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(id, { at: this.now(), title });
      return title;
    })();
    this.pending.set(id, task);
    task.finally(() => { if (this.pending.get(id) === task) this.pending.delete(id); }).catch(() => {});
    return task;
  }
  onConfigChanged(): void { this.generation++; this.cache.clear(); this.pending.clear(); }
}
