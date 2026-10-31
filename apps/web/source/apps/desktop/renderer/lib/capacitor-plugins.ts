import { registerPlugin } from "@capacitor/core";

export interface DbPlugin {
  getAll(): Promise<{ value: string }>;
  listSet(opts: { entry: string }): Promise<{ value: string }>;
  continueWatching(): Promise<{ value: string }>;
  continueWatchingPaged(opts: { page: number; pageSize: number }): Promise<{ value: string }>;
  dismissContinueWatching(opts: { animeId: number }): Promise<{ ok: boolean }>;
  progressGet(opts: { animeId: number; episode: number }): Promise<{ value: string | null }>;
  progressSet(opts: { progress: string }): Promise<{ ok: boolean }>;
  progressGetForAnime(opts: { animeId: number }): Promise<{ value: string }>;
}

export interface PahePlugin {
  ensureSession(): Promise<{ ok: boolean }>;
  latest(opts: { page: number }): Promise<{ value: string }>;
  search(opts: { query: string }): Promise<{ value: string }>;
  episodes(opts: { providerId: string; session: string; page: number }): Promise<{ value: string }>;
  links(opts: { providerId: string; epSession: string; animeSession: string }): Promise<{ value: string }>;
  resolve(opts: { providerId: string; kwikUrl: string }): Promise<{ url: string; cookies: string }>;
  prefetch(opts: { kwikUrl: string }): Promise<{ ok: boolean }>;
  getIds(opts: { paheId: number; session: string }): Promise<{ value: string }>;
  findById(opts: { anilistId?: number; malId?: number }): Promise<{ value: string | null }>;
  getUrl(): Promise<{ url: string }>;
  setUrl(opts: { url: string }): Promise<{ ok: boolean; url: string; reason?: string }>;
  fetchUrl(opts: { url: string; binary?: boolean; headers?: Record<string, string> }): Promise<{ data: string; status: number; binary: boolean }>;
}

export interface MalPlugin {
  beginAuth(opts: { clientId: string }): Promise<{ ok: boolean; reason?: string }>;
  getState(): Promise<{ value: string }>;
  disconnect(): Promise<{ value: string }>;
  pull(): Promise<{ imported: number }>;
  push(): Promise<{ pushed: number; errors: number }>;
  setClientId(opts: { clientId: string }): Promise<{ ok: boolean; usingCustom: boolean }>;
  clientInfo(): Promise<{ usingCustom: boolean; clientId?: string }>;
  addListener(event: string, handler: (data: unknown) => void): Promise<any>;
}

export interface SettingsPlugin {
  get(opts: { key: string }): Promise<{ value: string | null }>;
  set(opts: { key: string; value: string }): Promise<{ ok: boolean }>;
  del(opts: { key: string }): Promise<{ ok: boolean }>;
}

export const AniTrackDb = registerPlugin<DbPlugin>("AniTrackDb");
export const AniTrackPahe = registerPlugin<PahePlugin>("AniTrackPahe");
export const AniTrackMal = registerPlugin<MalPlugin>("AniTrackMal");
export const AniTrackSettings = registerPlugin<SettingsPlugin>("AniTrackSettings");
