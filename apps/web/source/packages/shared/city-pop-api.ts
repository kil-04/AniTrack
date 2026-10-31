import type { CityPopTrack } from "./city-pop";
import type { ArchiveMediaFilter, ArchiveSearchResult, ArchiveTrack, CityPopDownload } from "./city-pop-archive";

export type CityPopMode = "listen" | "watch";

/** Optional music expansion bridge; no arbitrary URLs or file paths cross IPC. */
export interface CityPopApi {
  /** `saved`: saved search favorites in the queue, so the player shows their titles (main validates them). */
  open(trackIds: string[], mode: CityPopMode, saved?: CityPopTrack[]): Promise<{ ok: boolean }>;
  close(): Promise<void>;
  status(): Promise<boolean>;
  onPlaybackChanged(fn: (active: boolean) => void): () => void;
  search(query: string): Promise<CityPopTrack[]>;
  archiveSearch(query: string, page?: number, media?: ArchiveMediaFilter): Promise<ArchiveSearchResult>;
  archiveItem(id: string): Promise<ArchiveTrack[]>;
  /** Plays an album's files in order from `start` (saved files offline); main resolves every file. */
  playArchive(itemId: string, fileNames: string[], start: number, mode: CityPopMode): Promise<{ ok: boolean }>;
  downloadArchive(itemId: string, fileName: string): Promise<{ key: string }>;
  downloads(): Promise<CityPopDownload[]>;
  cancelDownload(key: string): Promise<void>;
  removeDownload(key: string): Promise<void>;
  playDownload(key: string, mode: CityPopMode): Promise<{ ok: boolean }>;
}
