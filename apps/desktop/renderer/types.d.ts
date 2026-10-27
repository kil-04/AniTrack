import type {
  AniListAuthState,
  AnimeMeta,
  ContinueWatchingItem,
  MalAuthState,
  PlaybackProgress,
  RelatedAnime,
  ListEntry,
} from "../../../packages/shared/types";
import type { AnimeInfo, ExternalIds, ProviderApi } from "../../../packages/shared/provider-types";

interface ApiBridge {
  cityPop?: import("../../../packages/shared/city-pop-api").CityPopApi;
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
    advancedSearch(filters: import("../../../packages/shared/types").AdvancedSearchFilters): Promise<import("../../../packages/shared/types").PaginatedAnime>;
    trending(): Promise<AnimeMeta[]>;
    airing(ids: number[]): Promise<import("../../../packages/shared/types").AiringInfo[]>;
    recent(page?: number): Promise<import("../../../packages/shared/types").RecentEpisodesPage>;
    recommendations(seedIds: number[], excludedIds: number[]): Promise<import("../../../packages/shared/types").AnimeRecommendation[]>;
    get(id: number): Promise<AnimeMeta | null>;
    relations(id: number): Promise<RelatedAnime[]>;
    story(id: number): Promise<import("../../../packages/shared/story-bridge").StoryPlan>;
    premieredOn(month: number, day: number): Promise<import("../../../packages/shared/types").PremieredAnime[]>;
    /** A year's titles for the Time Machine: "main" first, then "gems". */
    timeMachineYear(year: number, part: import("../../../packages/shared/time-machine").TimeMachinePart): Promise<import("../../../packages/shared/time-machine").TimeMachineCandidate[]>;
  };
  /** Manga mode (Electron only; the legacy Android shell has no manga sources). */
  manga?: import("./lib/manga-api").MangaApi;
  /** Novels mode (Electron only). */
  novel?: import("./lib/novel-api").NovelApi;
  themes: {
    forAnime(id: number): Promise<import("../../../packages/shared/anime-themes").ThemeSong[]>;
    radio(): Promise<import("../../../packages/shared/anime-themes").ThemeSong[]>;
  };
  /** Anime openings and endings from AnisongDB, with shipped decade charts. */
  songs: {
    charts(): Promise<import("../../../packages/shared/anisongs").SongCharts>;
    season(season: import("../../../packages/shared/anisongs").SeasonName, year: number): Promise<import("../../../packages/shared/anisongs").AniSong[]>;
    search(query: string, by: import("../../../packages/shared/anisongs").SongSearchBy): Promise<import("../../../packages/shared/anisongs").AniSong[]>;
    /** A show's openings and endings, by its MyAnimeList id. */
    show(malId: number): Promise<import("../../../packages/shared/anisongs").AniSong[]>;
  };
  /** Background music: the user's own tracks (desktop only; absent in the legacy Android shell). */
  music?: {
    list(): Promise<import("../../../packages/shared/bg-music").BgTrack[]>;
    import(): Promise<{ added: number; skipped: number; tracks: import("../../../packages/shared/bg-music").BgTrack[] }>;
    remove(id: string): Promise<import("../../../packages/shared/bg-music").BgTrack[]>;
    openFolder(): Promise<{ ok: boolean }>;
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
  /** Includes the typed opaque media-access status/event bridge on Electron. */
  providers?: ProviderApi;
  pahe: {
    latest(page?: number): Promise<{ data: any[]; total: number; lastPage: number }>;
    search(q: string): Promise<AnimeInfo[]>;
    episodes(providerId: string, animeId: string, page: number): Promise<{ data: any[]; total: number; lastPage: number }>;
    links(providerId: string, episodeId: string, animeId: string): Promise<any[]>;
    resolve(providerId: string, linkId: string): Promise<{ url: string; cookies?: string; subtitles?: any[]; intro?: any; outro?: any; referer?: string }>;
    prefetch(providerIdOrKwikUrl: string, linkId?: string): Promise<{ ok: boolean }>;
    // paheId is the numeric AnimePahe id, OR an Anikoto slug (string) — the
    // handler routes by shape so id verification works for both providers.
    getIds(paheId: number | string, session: string): Promise<ExternalIds>;
    findById(anilistId: number | undefined, malId?: number): Promise<AnimeInfo | null>;
    getUrl(): Promise<string>;
    setUrl(url: string): Promise<{ ok: boolean; url: string; reason?: string }>;
    fetchUrl?(url: string, binary?: boolean, headers?: Record<string, string>): Promise<{ data: string; status: number; binary: boolean }>;
    anikotoTop(): Promise<{ day: any[]; week: any[]; month: any[] }>;
  };
  updater: {
    check(): Promise<{ ok: boolean; version?: string | null; reason?: string }>;
    status?(): Promise<import("../../../packages/shared/types").DesktopUpdateState>;
    install(): Promise<void>;
  };
  automation?: {
    status(): Promise<import("../../../packages/shared/runtime-config").RuntimeConfigStatus>;
    refresh(): Promise<import("../../../packages/shared/runtime-config").RuntimeConfigStatus>;
  };
  downloads?: {
    start(opts: any): Promise<{ ok: boolean }>;
    list(): Promise<{ items: import("../../../packages/shared/types").DownloadItem[] }>;
    remove(id: string): Promise<{ ok: boolean }>;
    getPlayUrl(id: string): Promise<{ url: string }>;
  };
  on(channel: string, fn: (...args: unknown[]) => void): () => void;
}

declare global {
  interface Window {
    api: ApiBridge;
  }
  const __APP_VERSION__: string;
}
