/** Provider-neutral streaming contracts shared by Electron main and renderer. */
export interface AnimeInfo {
  id: string;
  providerId: string;
  title: string;
  poster: string;
  episodes?: number;
  subCount?: number;
  dubCount?: number;
  type?: string;
  status?: string;
  season?: string;
  year?: number;
  score?: number;
  /** Provider-native lookup id used to verify AniList/MAL matches. */
  externalLookupId?: string | number;
}

export interface EpisodeInfo {
  id: string;
  episodeNumber: number;
  title: string;
  snapshot?: string;
  filler?: boolean;
}

export interface ProviderEpisodePage {
  data: EpisodeInfo[];
  total: number;
  lastPage: number;
}

export interface StreamLink {
  id: string;
  quality: string;
  audio: string;
  /** Connector-neutral choice key, such as `soft`, `hard`, or `dub`. */
  variant?: string;
}

export interface ProviderSubtitle {
  file: string;
  label: string;
  kind: string;
  default?: boolean;
}

export interface ProviderSkipRange {
  start: number;
  end: number;
}

export interface StreamData {
  url: string;
  cookies?: string;
  subtitles?: ProviderSubtitle[];
  intro?: ProviderSkipRange;
  outro?: ProviderSkipRange;
  /** Origin required by providers that enforce hotlink protection. */
  referer?: string;
}

export interface ExternalIds {
  anilistId?: number;
  malId?: number;
  kitsuId?: number;
}

export type ProviderFeed = "latest" | "top";

export interface ProviderFeedItem {
  id: string;
  providerId: string;
  animeId: string;
  title: string;
  titleAlternatives?: string[];
  poster?: string;
  snapshot?: string;
  episodeNumber?: number;
  subCount?: number;
  dubCount?: number;
  publishedAt?: string;
  externalLookupId?: string | number;
}

export interface ProviderFeedGroup {
  id: string;
  title: string;
  items: ProviderFeedItem[];
}

/** A stable feed envelope regardless of the connector supplying it. */
export interface ProviderFeedResult {
  providerId: string;
  feed: ProviderFeed;
  page: number;
  total: number;
  lastPage: number;
  groups: ProviderFeedGroup[];
}

export interface ProviderCapabilities {
  latest?: boolean;
  top?: boolean;
  externalIds?: boolean;
  downloads?: boolean;
  prefetch?: boolean;
  configurableBaseUrl?: boolean;
  streamVariants?: "quality" | "subtitle-type";
  /** Number of episodes returned by one connector page; defaults to 30. */
  episodePageSize?: number;
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  capabilities: ProviderCapabilities;
}

export interface StreamProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  search(query: string): Promise<AnimeInfo[]>;
  getEpisodes(animeId: string, page?: number): Promise<ProviderEpisodePage>;
  getStreamLinks(episodeId: string, animeId: string): Promise<StreamLink[]>;
  resolveStream(linkId: string): Promise<StreamData>;

  getExternalIds?(animeId: string, lookupId?: string | number): Promise<ExternalIds>;
  findByExternalId?(anilistId?: number, malId?: number): Promise<AnimeInfo | null>;
  getFeed?(feed: ProviderFeed, page?: number, count?: number): Promise<ProviderFeedResult>;
  prefetch?(linkId: string): void | Promise<void>;
  prewarm?(): void;
  onConfigChanged?(): void;
  getBaseUrl?(): string;
  setBaseUrl?(url: string): void;
}

/** Renderer-facing provider bridge exposed by Electron preload. */
export interface ProviderApi {
  list(): Promise<ProviderDescriptor[]>;
  search(query: string): Promise<AnimeInfo[]>;
  episodes(providerId: string, animeId: string, page: number): Promise<ProviderEpisodePage>;
  links(providerId: string, episodeId: string, animeId: string): Promise<StreamLink[]>;
  resolve(providerId: string, linkId: string): Promise<StreamData>;
  prefetch(providerId: string, linkId: string): Promise<{ ok: boolean }>;
  getExternalIds(
    providerId: string,
    animeId: string,
    lookupId?: string | number,
  ): Promise<ExternalIds>;
  findByExternalId(anilistId?: number, malId?: number): Promise<AnimeInfo | null>;
  feed(feed: ProviderFeed, page?: number, count?: number): Promise<ProviderFeedResult>;
}
