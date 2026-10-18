import type {
  NovelCard,
  NovelChapter,
  NovelChapterText,
  NovelDetail,
  NovelDownloadTitle,
  NovelFindResult,
  NovelGroup,
  NovelHome,
  NovelListEntry,
  NovelProgressMap,
  NovelReadingRow,
  NovelResult,
  NovelUpdate,
  NovelSearchFilters,
  NovelSearchPage,
  NovelSourceId,
  NovelSourceInfo,
  NovelStatus,
} from "../../../../packages/shared/novel";
import type { NovelSyncLocal, NovelSyncPlan, NovelSyncRemovals } from "../../../../packages/shared/novel-sync";

/** The Electron bridge for novels mode (see main/ipc/novel.ts). */
export interface NovelApi {
  sources(): Promise<NovelSourceInfo[]>;
  home(): Promise<NovelResult<NovelHome>>;
  search(filters: NovelSearchFilters): Promise<NovelResult<NovelSearchPage>>;
  title(sourceId: NovelSourceId, id: string): Promise<NovelResult<NovelDetail>>;
  /** The title page saved by the last visit (shown at once, and offline). */
  savedTitle(sourceId: NovelSourceId, id: string): Promise<{ detail: NovelDetail; chapters: NovelChapter[] } | null>;
  chapters(sourceId: NovelSourceId, id: string): Promise<NovelResult<NovelChapter[]>>;
  chapter(sourceId: NovelSourceId, id: string, chapterId: string): Promise<NovelResult<NovelChapterText>>;
  /** The novel's progress on every linked source, by chapter key. */
  reading(sourceId: NovelSourceId, id: string): Promise<NovelProgressMap>;
  saveReading(row: Omit<NovelReadingRow, "updatedAt">): Promise<{ ok: boolean }>;
  markRead(
    sourceId: NovelSourceId,
    id: string,
    chapters: { id: string; order: number; label: string }[],
    read: boolean,
    title: string,
    cover: string | null,
  ): Promise<{ ok: boolean }>;
  continueReading(): Promise<NovelReadingRow[]>;
  forgetReading(sourceId: NovelSourceId, id: string): Promise<{ ok: boolean }>;
  status(sourceId: NovelSourceId, id: string): Promise<NovelStatus | null>;
  setStatus(sourceId: NovelSourceId, id: string, status: NovelStatus | null, title: string, cover: string | null): Promise<{ ok: boolean }>;
  list(): Promise<NovelListEntry[]>;
  /** The novel's copies on linked sources, this one first. */
  group(sourceId: NovelSourceId, id: string): Promise<NovelGroup>;
  /** Finds (and, when sure, links) this novel's copy on [target]. */
  findOn(sourceId: NovelSourceId, id: string, target: NovelSourceId): Promise<NovelResult<NovelFindResult>>;
  link(a: { sourceId: NovelSourceId; id: string }, b: { sourceId: NovelSourceId; id: string }): Promise<NovelGroup>;
  unlink(sourceId: NovelSourceId, id: string): Promise<{ ok: boolean }>;
  updates(force?: boolean): Promise<NovelResult<NovelUpdate[]>>;
  downloads(): Promise<NovelDownloadTitle[]>;
  downloaded(sourceId: NovelSourceId, id: string): Promise<string[]>;
  /** Queues chapters to save offline; resolves to how many were added. */
  download(detail: NovelDetail, chapters: Pick<NovelChapter, "id" | "order" | "label">[]): Promise<number>;
  cancelDownloads(sourceId: NovelSourceId, id: string): Promise<void>;
  removeDownloads(sourceId: NovelSourceId, id: string, chapterIds?: string[]): Promise<void>;
  onDownload(listener: (event: NovelDownloadTitle | { removed: string }) => void): () => void;
  /** Cross-device sync: this device's tables and the removals not uploaded yet. */
  syncSnapshot(): Promise<NovelSyncLocal & { pending: NovelSyncRemovals }>;
  syncApply(change: Pick<NovelSyncPlan, "reading" | "list" | "titles">): Promise<{ applied: number }>;
  syncAck(sent: NovelSyncRemovals, known: NovelSyncRemovals): Promise<{ ok: boolean }>;
}

export type { NovelCard };

export const hasNovelMode = () => !!window.api.novel;

export function novelApi(): NovelApi {
  const api = window.api.novel;
  if (!api) throw new Error("Novels mode needs the AniTrack desktop app.");
  return api;
}

export const isNovelPath = (pathname: string) => pathname === "/novels" || pathname.startsWith("/novels/");

export const novelTitlePath = (sourceId: string, id: string) => `/novels/t/${sourceId}/${encodeURIComponent(id)}`;

/** The reader at a chapter: an exact paragraph, or a fraction through (a place carried over from another source). */
export const novelReaderPath = (sourceId: string, id: string, chapterId: string, paragraph = 0, fraction: number | null = null) =>
  `/novels/read?s=${sourceId}&t=${encodeURIComponent(id)}&c=${encodeURIComponent(chapterId)}${paragraph > 0 ? `&p=${paragraph}` : ""}${fraction != null && fraction > 0 ? `&f=${fraction.toFixed(3)}` : ""}`;

/** Bytes as "820 KB" / "12 MB". */
export function humanBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : mb >= 1 ? `${mb.toFixed(mb >= 10 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Unwraps a source result, throwing its (user-facing) message. */
export async function unwrap<T>(result: Promise<NovelResult<T>>): Promise<T> {
  const r = await result;
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

// ── Reader preferences (per viewer) ───────────────────────────────────────────

export type NovelTheme = "night" | "dusk" | "sepia" | "paper";
export type NovelFont = "serif" | "sans";

export interface NovelReaderPrefs {
  /** Text size in px. */
  size: number;
  /** Line height multiplier. */
  leading: number;
  /** Column width in characters. */
  width: number;
  theme: NovelTheme;
  font: NovelFont;
}

const READER_KEY = "anitrack.novel.reader";
export const NOVEL_READER_DEFAULTS: NovelReaderPrefs = { size: 19, leading: 1.75, width: 68, theme: "night", font: "serif" };

export function novelReaderPrefs(): NovelReaderPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(READER_KEY) ?? "{}") as Partial<NovelReaderPrefs>;
    const p = { ...NOVEL_READER_DEFAULTS, ...saved };
    return {
      size: Math.min(32, Math.max(14, Number(p.size) || NOVEL_READER_DEFAULTS.size)),
      leading: Math.min(2.4, Math.max(1.3, Number(p.leading) || NOVEL_READER_DEFAULTS.leading)),
      width: Math.min(110, Math.max(44, Number(p.width) || NOVEL_READER_DEFAULTS.width)),
      theme: (["night", "dusk", "sepia", "paper"] as const).includes(p.theme) ? p.theme : NOVEL_READER_DEFAULTS.theme,
      font: p.font === "sans" ? "sans" : "serif",
    };
  } catch {
    return NOVEL_READER_DEFAULTS;
  }
}

export function saveNovelReaderPrefs(prefs: NovelReaderPrefs) {
  try { localStorage.setItem(READER_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
}

/** The source last picked on the search page. */
export function preferredNovelSource(): NovelSourceId {
  try { return localStorage.getItem("anitrack.novel.source") === "novelarchive" ? "novelarchive" : "novelbuddy"; } catch { return "novelbuddy"; }
}

export function setPreferredNovelSource(id: NovelSourceId) {
  try { localStorage.setItem("anitrack.novel.source", id); } catch { /* storage unavailable */ }
}
