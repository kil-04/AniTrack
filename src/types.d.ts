import type {
  AnimeMeta,
  ContinueWatchingItem,
  LocalEpisode,
  MalAuthState,
  PlaybackProgress,
  StreamingServiceLink,
  ListEntry,
} from "../shared/types";

interface ApiBridge {
  mal: {
    beginAuth(): Promise<{ ok: boolean; reason?: string }>;
    state(): Promise<MalAuthState>;
    disconnect(): Promise<MalAuthState>;
    pull(): Promise<{ imported: number }>;
    push(): Promise<{ pushed: number; errors: number }>;
    setClientId(id: string): Promise<{ ok: boolean }>;
  };
  anilist: {
    search(q: string): Promise<AnimeMeta[]>;
    trending(): Promise<AnimeMeta[]>;
    get(id: number): Promise<AnimeMeta | null>;
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
    dismissContinueWatching(animeId: number): Promise<{ ok: boolean }>;
  };
  progress: {
    get(id: number, ep: number): Promise<PlaybackProgress | null>;
    set(p: PlaybackProgress): Promise<{ ok: boolean }>;
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
    episodes(session: string, page: number): Promise<{ data: any[]; total: number; lastPage: number }>;
    links(epSession: string, animeSession: string): Promise<any[]>;
    resolve(kwikUrl: string): Promise<{ url: string; cookies: string }>;
    prefetch(kwikUrl: string): Promise<{ ok: boolean }>;
  };
  on(channel: string, fn: (...args: unknown[]) => void): () => void;
}

declare global {
  interface Window {
    api: ApiBridge;
  }
}
