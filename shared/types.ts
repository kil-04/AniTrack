// Types shared between Electron main process and React renderer.

export type WatchStatus =
  | "watching"
  | "completed"
  | "on_hold"
  | "dropped"
  | "plan_to_watch";

export interface AnimeMeta {
  id: number;           // AniList ID (primary key in our DB)
  malId?: number | null;
  title: string;
  titleEnglish?: string | null;
  titleRomaji?: string | null;
  synopsis?: string | null;
  episodes?: number | null;
  duration?: number | null;       // minutes per episode
  status?: string | null;          // FINISHED / RELEASING / etc
  coverImage?: string | null;
  bannerImage?: string | null;
  genres?: string[];
  averageScore?: number | null;
  year?: number | null;
  studios?: string[];
  format?: string | null;       // TV / MOVIE / OVA / ONA / SPECIAL / MUSIC
  popularity?: number | null;   // AniList popularity (user count)
}

export interface AdvancedSearchFilters {
  query?: string;
  genre?: string[];
  tag?: string[];
  season?: string;
  year?: number;
  format?: string;
  status?: string;
  source?: string;          // AniList MediaSource (MANGA, ORIGINAL, LIGHT_NOVEL, …)
  episodesGreater?: number; // episodes >= this
  episodesLesser?: number;  // episodes <= this
  sort?: string;
  page?: number;
}

export interface PaginatedAnime {
  results: AnimeMeta[];
  hasNextPage: boolean;
  lastPage?: number;
}

export interface ListEntry {
  animeId: number;        // AniList ID
  status: WatchStatus;
  episodesWatched: number;
  score?: number | null;
  updatedAt: number;      // unix ms
}

export interface PlaybackProgress {
  animeId: number;
  episode: number;
  positionSec: number;
  durationSec: number;
  updatedAt: number;
  // Extra metadata saved when the anime isn't in the local DB yet
  // (e.g. watched via Latest Episodes without going through ShowDetail)
  animeTitle?: string;
  animeCoverUrl?: string;
  animePaheSession?: string;
}

export interface ContinueWatchingItem {
  anime: AnimeMeta;
  episode: number;
  positionSec: number;
  durationSec: number;
  filePath?: string | null;
  percent: number;
  animePaheSession?: string | null;  // set for pahe-only watches (no AniList ID)
  updatedAt: number;                 // real watch time — cross-device sync ordering depends on this
}

export interface MalAuthState {
  connected: boolean;
  username?: string | null;
  expiresAt?: number | null;
}

export interface AniListAuthState {
  connected: boolean;
  username?: string | null;
  userId?: number | null;
  expiresAt?: number | null;
  hasClientId?: boolean;
}

export interface RelatedAnime {
  relationType: string; // SEQUEL | PREQUEL | SIDE_STORY | ALTERNATIVE | SPIN_OFF | PARENT
  anime: AnimeMeta;
}

export interface AiringInfo {
  animeId: number;          // AniList id
  title: string;
  coverImage?: string | null;
  episode: number;          // the episode that airs at airingAt
  airingAt: number;         // unix seconds
}

export type DownloadStatus = "queued" | "downloading" | "done" | "failed";

export interface DownloadItem {
  id: string;               // `${animeId}:${episode}`
  animeId: number;
  episode: number;
  title: string;            // show title
  coverUrl?: string | null;
  providerId: string;
  status: DownloadStatus;
  progress: number;         // 0..100
  doneSegments?: number;
  totalSegments?: number;
  sizeBytes?: number;
  error?: string;
  updatedAt: number;
  // Provider session ids — persisted so a failed download can be re-resolved and
  // retried from the Downloads page (kwik URLs expire, but these ids are stable).
  animeSession?: string;
  episodeSession?: string;
}

// IPC channel names. Keeping them in one place avoids drift.
export const IPC = {
  // MAL
  MAL_BEGIN_AUTH: "mal:begin-auth",
  MAL_STATE: "mal:state",
  MAL_DISCONNECT: "mal:disconnect",
  MAL_PULL: "mal:pull",
  MAL_PUSH_PROGRESS: "mal:push-progress",
  MAL_SET_CLIENT_ID: "mal:set-client-id",
  MAL_CLIENT_INFO: "mal:client-info",
  // AniList / metadata
  ANILIST_SEARCH: "anilist:search",
  ANILIST_ADVANCED_SEARCH: "anilist:advanced-search",
  ANILIST_TRENDING: "anilist:trending",
  ANILIST_GET: "anilist:get",
  ANILIST_AIRING: "anilist:airing",
  // Local state
  LIST_GET_ALL: "list:get-all",
  LIST_SET: "list:set",
  CONTINUE_WATCHING: "list:continue-watching",
  CW_PAGED: "cw:paged",
  PROGRESS_GET: "progress:get",
  PROGRESS_SET: "progress:set",
  CW_DISMISS: "cw:dismiss",
  // AnimePahe
  PAHE_SEARCH: "pahe:search",
  PAHE_EPISODES: "pahe:episodes",
  PAHE_LINKS: "pahe:links",
  PAHE_RESOLVE: "pahe:resolve",
  PAHE_PREFETCH: "pahe:prefetch",
  PAHE_LATEST: "pahe:latest",
  PAHE_GET_IDS: "pahe:get-ids",
  PAHE_FIND_BY_ID: "pahe:find-by-id",
  PAHE_GET_URL: "pahe:get-url",
  PAHE_SET_URL: "pahe:set-url",
  ANIKOTO_TOP: "anikoto:top",
  // AniList sync
  AL_BEGIN_AUTH: "al:begin-auth",
  AL_STATE: "al:state",
  AL_DISCONNECT: "al:disconnect",
  AL_PULL: "al:pull",
  AL_SET_CLIENT_ID: "al:set-client-id",
  // Extra
  ANILIST_RELATIONS: "anilist:relations",
  PROGRESS_GET_FOR_ANIME: "progress:get-for-anime",
  // Updater
  UPDATE_CHECK: "update:check",
  UPDATE_INSTALL: "update:install",
  // Offline downloads (desktop)
  DOWNLOAD_START: "download:start",
  DOWNLOAD_LIST: "download:list",
  DOWNLOAD_REMOVE: "download:remove",
  DOWNLOAD_GET_PLAY_URL: "download:get-play-url",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
