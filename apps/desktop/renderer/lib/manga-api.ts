import type { AnimeMeta } from "../../../../packages/shared/types";
import type {
  DownloadManga,
  LatestResult,
  MangaChapter,
  MangaDownload,
  MangaDownloadEvent,
  MangaFeed,
  MangaListEntry,
  MangaMeta,
  MangaPageImage,
  MangaSearchFilters,
  MangaSearchPage,
  MangaSourceInfo,
  MangaStatus,
  ReadingRow,
  ReadState,
  SourceResult,
  SourceTitle,
  TrackedTitle,
} from "../../../../packages/shared/manga";

/** The Electron bridge for manga mode (see main/ipc/manga.ts). */
export interface MangaApi {
  feed(): Promise<MangaFeed>;
  search(filters: MangaSearchFilters): Promise<MangaSearchPage>;
  get(id: number): Promise<MangaMeta | null>;
  adaptations(id: number): Promise<AnimeMeta[]>;
  sources(): Promise<MangaSourceInfo[]>;
  find(sourceId: string, mangaId: number): Promise<SourceResult<SourceTitle | null>>;
  chapters(title: SourceTitle): Promise<SourceResult<MangaChapter[]>>;
  /** The list saved by the last fetch (shown at once, and offline), with when it was saved. */
  savedChapters(title: SourceTitle): Promise<{ at: number; list: MangaChapter[] } | null>;
  /** A chapter's pages; with [mangaId], a downloaded copy is opened first. */
  pages(title: SourceTitle, chapterId: string, mangaId?: number): Promise<SourceResult<MangaPageImage[]>>;
  /** Opens the source's site so the user can pass its check; true once the source answers. */
  connect(sourceId: string): Promise<boolean>;
  reading(mangaId: number): Promise<Record<string, ReadState>>;
  saveReading(row: Omit<ReadingRow, "updatedAt">): Promise<{ ok: boolean }>;
  markRead(
    mangaId: number,
    chapters: { number: number; id: string; pageCount: number }[],
    read: boolean,
    title: string,
    cover: string | null,
    sourceId: string,
  ): Promise<{ ok: boolean }>;
  continueReading(): Promise<ReadingRow[]>;
  forgetReading(mangaId: number): Promise<{ ok: boolean }>;
  status(mangaId: number): Promise<MangaStatus | null>;
  setStatus(mangaId: number, status: MangaStatus | null, title: string, cover: string | null): Promise<{ ok: boolean }>;
  list(): Promise<MangaListEntry[]>;
  downloads(): Promise<MangaDownload[]>;
  /** Queues one chapter; false when it's downloaded or on its way already. */
  download(manga: DownloadManga, title: SourceTitle, chapter: MangaChapter): Promise<boolean>;
  /** Queues chapters one per number, skipping numbers already held; resolves to how many were added. */
  downloadRange(manga: DownloadManga, title: SourceTitle, chapters: MangaChapter[]): Promise<number>;
  removeDownload(key: string): Promise<void>;
  /** Stops a title's queued and running downloads. */
  cancelDownloads(mangaId: number): Promise<number>;
  /** Follows download progress; returns the unsubscribe function. */
  onDownload(listener: (event: MangaDownloadEvent) => void): () => void;
  /** Titles the Updates page checks. */
  tracked(): Promise<TrackedTitle[]>;
  latest(mangaId: number, preferredSource: string | null, skip: string[]): Promise<LatestResult>;
}

export const hasMangaMode = () => !!window.api.manga;

export function mangaApi(): MangaApi {
  const api = window.api.manga;
  if (!api) throw new Error("Manga mode needs the AniTrack desktop app.");
  return api;
}

// ── Anime / Manga mode, remembered between launches ───────────────────────────

const MODE_KEY = "anitrack.mode";

export const isMangaPath = (pathname: string) => pathname === "/manga" || pathname.startsWith("/manga/");

export function rememberMode(manga: boolean) {
  try { localStorage.setItem(MODE_KEY, manga ? "manga" : "anime"); } catch { /* storage unavailable */ }
}

export function lastModeWasManga(): boolean {
  try { return localStorage.getItem(MODE_KEY) === "manga"; } catch { return false; }
}

// ── Reader preferences (per viewer) ───────────────────────────────────────────

export type ReaderMode = "auto" | "vertical" | "ltr" | "rtl";
export type ReaderSpread = "auto" | "single" | "double";
export type ReaderBackground = "black" | "gray" | "white";
export type ReaderWidth = "narrow" | "medium" | "full";

export interface ReaderPrefs {
  mode: ReaderMode;
  spread: ReaderSpread;
  shift: boolean;
  background: ReaderBackground;
  width: ReaderWidth;
}

const READER_KEY = "anitrack.reader";
const DEFAULT_PREFS: ReaderPrefs = { mode: "auto", spread: "auto", shift: false, background: "black", width: "medium" };

export function readerPrefs(): ReaderPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(READER_KEY) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveReaderPrefs(prefs: ReaderPrefs) {
  try { localStorage.setItem(READER_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
}

/** The source and reading group picked for a title, remembered per title. */
export function titlePref(mangaId: number, key: "source" | "group"): string | null {
  try { return localStorage.getItem(`anitrack.manga.${key}.${mangaId}`); } catch { return null; }
}

export function setTitlePref(mangaId: number, key: "source" | "group", value: string | null) {
  try {
    if (value == null) localStorage.removeItem(`anitrack.manga.${key}.${mangaId}`);
    else localStorage.setItem(`anitrack.manga.${key}.${mangaId}`, value);
  } catch { /* storage unavailable */ }
}
