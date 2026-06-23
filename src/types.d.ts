import type {
  AniListAuthState,
  AnimeMeta,
  ContinueWatchingItem,
  LocalEpisode,
  MalAuthState,
  PlaybackProgress,
  RelatedAnime,
  StreamingServiceLink,
  ListEntry,
} from "../shared/types";

interface ApiBridge {
  al: {
    beginAuth(): Promise<{ ok: boolean; reason?: string }>;
    state(): Promise<AniListAuthState>;
    disconnect(): Promise<AniListAuthState>;
    pull(): Promise<{ imported: number }>;
    setClientId(id: string): Promise<AniListAuthState>;
  };
  mal: {
    beginAuth(): Promise<{ ok: boolean; reason?: string }>;
    state(): Promise<MalAuthState>;
    disconnect(): Promise<MalAuthState>;
    pull(): Promise<{ imported: number }>;
    push(): Promise<{ pushed: number; errors: number }>;
    setClientId(id: string): Promise<{ ok: boolean; usingCustom: boolean }>;
    clientInfo(): Promise<{ usingCustom: boolean; clientId?: string }>;
  };
  anilist: {
    search(q: string): Promise<AnimeMeta[]>;
    advancedSearch(filters: import("../shared/types").AdvancedSearchFilters): Promise<import("../shared/types").PaginatedAnime>;
    trending(): Promise<AnimeMeta[]>;
    get(id: number): Promise<AnimeMeta | null>;
    relations(id: number): Promise<RelatedAnime[]>;
  };
  library: {
    addFolder(): Promise<string[]>;
    removeFolder(p: string): Promise<string[]>;
    listFolders(): Promise<string[]>;
    scan(): Promise<{ shows: number; episodes: number }>;
    episodesFor(id: number): Promise<LocalEpisode[]>;
  };
  list: {
    getAll(): Promise<{ entry: ListEntry; anime: AnimeMeta | null }[]>;
    set(entry: ListEntry): Promise<ListEntry[]>;
    continueWatching(): Promise<ContinueWatchingItem[]>;
    continueWatchingPaged(page: number, pageSize: number): Promise<{ items: ContinueWatchingItem[]; total: number }>;
    dismissContinueWatching(animeId: number): Promise<{ ok: boolean }>;
  };
  progress: {
    get(id: number, ep: number): Promise<PlaybackProgress | null>;
    set(p: PlaybackProgress): Promise<{ ok: boolean }>;
    getForAnime(id: number): Promise<PlaybackProgress[]>;
  };
  player: {
    resolveFile(p: string): Promise<string>;
  };
  legal: {
    links(id: number): Promise<StreamingServiceLink[]>;
    open(url: string): Promise<{ ok: boolean }>;
  };
  pahe: {
    latest(page?: number): Promise<{ data: any[]; total: number; lastPage: number }>;
    search(q: string): Promise<any[]>;
    episodes(providerId: string, animeId: string, page: number): Promise<{ data: any[]; total: number; lastPage: number }>;
    links(providerId: string, episodeId: string, animeId: string): Promise<any[]>;
    resolve(providerId: string, linkId: string): Promise<{ url: string; cookies?: string; subtitles?: any[]; intro?: any; outro?: any; referer?: string }>;
    prefetch(providerIdOrKwikUrl: string, linkId?: string): Promise<{ ok: boolean }>;
    getIds(paheId: number, session: string): Promise<{ malId?: number; anilistId?: number; kitsuId?: number }>;
    findById(anilistId: number | undefined, malId?: number): Promise<any>;
    getUrl(): Promise<string>;
    setUrl(url: string): Promise<{ ok: boolean; url: string; reason?: string }>;
    fetchUrl?(url: string, binary?: boolean, headers?: Record<string, string>): Promise<{ data: string; status: number; binary: boolean }>;
  };
  updater: {
    check(): Promise<{ ok: boolean; version?: string | null; reason?: string }>;
    install(): Promise<void>;
  };
  on(channel: string, fn: (...args: unknown[]) => void): () => void;
}

declare global {
  interface Window {
    api: ApiBridge;
  }
  const __APP_VERSION__: string;
}
