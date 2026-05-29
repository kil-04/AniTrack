export interface AnimeInfo {
  id: string; // The provider's internal ID for this anime
  providerId: string; // "animepahe" or "anikoto"
  title: string;
  poster: string;
  episodes?: number;
  type?: string;
  status?: string;
  season?: string;
  year?: number;
  score?: number;
}

export interface EpisodeInfo {
  id: string; // The provider's internal ID for this episode
  episodeNumber: number;
  title: string;
  snapshot?: string;
  filler?: boolean;
}

export interface StreamLink {
  id: string;
  quality: string;
  audio: string;
}

export interface StreamData {
  url: string;
  cookies?: string; // Any session cookies needed by the player/downloader
  subtitles?: { file: string; label: string; kind: string; default?: boolean }[];
  intro?: { start: number; end: number };
  outro?: { start: number; end: number };
}

export interface StreamProvider {
  id: string; // e.g. "animepahe", "anikoto"
  name: string; // e.g. "AnimePahe", "Anikoto"
  
  search(query: string): Promise<AnimeInfo[]>;
  
  getEpisodes(animeId: string, page?: number): Promise<{ data: EpisodeInfo[]; total: number; lastPage: number }>;
  
  getStreamLinks(episodeId: string, animeId: string): Promise<StreamLink[]>;
  
  resolveStream(linkId: string): Promise<StreamData>;
}
