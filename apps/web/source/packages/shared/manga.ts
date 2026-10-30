/**
 * Desktop manga mode: shared types, chapter helpers and the reading-source parsers
 * (MangaBall and MangaDot JSON APIs). Mirrors the Android app's data/manga package.
 */

// ── IPC ───────────────────────────────────────────────────────────────────────

export const MANGA_IPC = {
  FEED: "manga:feed",
  SEARCH: "manga:search",
  GET: "manga:get",
  ADAPTATIONS: "manga:adaptations",
  SOURCES: "manga:sources",
  FIND: "manga:find",
  CHAPTERS: "manga:chapters",
  /** The chapter list saved from the last fetch, shown while a fresh one loads. */
  CHAPTERS_SAVED: "manga:chapters-saved",
  PAGES: "manga:pages",
  CONNECT: "manga:connect",
  READING_GET: "manga:reading-get",
  READING_SAVE: "manga:reading-save",
  READING_MARK: "manga:reading-mark",
  CONTINUE: "manga:continue",
  READING_FORGET: "manga:reading-forget",
  /** Every reading row, for cross-device sync (packages/shared/manga-sync.ts). */
  READING_ALL: "manga:reading-all",
  /** Applies a sync reconcile: rows from another device, and rows a removal hides. */
  READING_APPLY: "manga:reading-apply",
  LIST_GET: "manga:list-get",
  LIST_SET: "manga:list-set",
  LIST_ALL: "manga:list-all",
  DOWNLOADS: "manga:downloads",
  DOWNLOAD: "manga:download",
  DOWNLOAD_RANGE: "manga:download-range",
  DOWNLOAD_REMOVE: "manga:download-remove",
  DOWNLOAD_CANCEL: "manga:download-cancel",
  /** Main → renderer: a download changed ([MangaDownloadEvent]). */
  DOWNLOAD_EVENT: "manga:download-event",
  TRACKED: "manga:tracked",
  LATEST: "manga:latest",
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

/** An AniList MANGA entry (manga, manhwa, manhua, one-shots and novels). */
export interface MangaMeta {
  id: number;
  malId: number | null;
  title: string;
  titleRomaji: string | null;
  cover: string | null;
  banner: string | null;
  chapters: number | null;
  volumes: number | null;
  status: string | null;
  format: string | null;
  year: number | null;
  /** AniList averageScore, 0–100. */
  score: number | null;
  synopsis: string | null;
  genres: string[];
  popularity: number | null;
  country: string | null;
  /** Alternative names, used to match reading sources. */
  synonyms: string[];
}

export interface MangaFeed {
  trending: MangaMeta[];
  publishing: MangaMeta[];
  popular: MangaMeta[];
  topRated: MangaMeta[];
  manhwa: MangaMeta[];
}

export interface MangaSearchFilters {
  query?: string;
  genre?: string;
  year?: number;
  format?: string;
  /** JP (manga), KR (manhwa) or CN (manhua). */
  country?: string;
  status?: string;
  sort?: string;
  page?: number;
}

export interface MangaSearchPage {
  items: MangaMeta[];
  hasNextPage: boolean;
}

/** A title as a reading source knows it, matched to an AniList manga. */
export interface SourceTitle {
  sourceId: string;
  id: string;
  title: string;
}

/** One upload of a chapter. Several groups can upload the same number. */
export interface MangaChapter {
  id: string;
  number: number;
  title: string | null;
  group: string | null;
  pageCount: number | null;
  /** When the source received this upload (epoch ms). */
  uploadedAt: number | null;
}

/** One page image, as the renderer loads it (through the app's image protocol). */
export interface MangaPageImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface MangaSourceInfo {
  id: string;
  label: string;
  /** The user passes this source's browser check once, in a window the app opens. */
  needsConnect: boolean;
  /** Website availability; a source's verified native session is not portable. */
  web?: {state: "available" | "limited" | "native-required"; downloads: boolean; description: string; website: string};
}

/** A source call's outcome; [verify] means the source wants its one-time check. */
export type SourceResult<T> = { ok: true; value: T } | { ok: false; error: string; verify?: boolean };

export interface ReadState {
  page: number;
  pageCount: number;
  updatedAt: number;
}

export interface ReadingRow {
  mangaId: number;
  chapter: number;
  chapterId: string;
  page: number;
  pageCount: number;
  title: string;
  cover: string | null;
  sourceId: string;
  updatedAt: number;
}

export const MANGA_STATUSES = ["reading", "completed", "on_hold", "dropped", "plan_to_read"] as const;
export type MangaStatus = (typeof MANGA_STATUSES)[number];
export const MANGA_STATUS_LABELS: Record<MangaStatus, string> = {
  reading: "Reading",
  completed: "Completed",
  on_hold: "On hold",
  dropped: "Dropped",
  plan_to_read: "Plan to read",
};

export interface MangaListEntry {
  mangaId: number;
  status: MangaStatus;
  title: string;
  cover: string | null;
  updatedAt: number;
}

export type MangaDownloadStatus = "queued" | "downloading" | "done" | "failed";

/** A chapter saved (or on its way) for offline reading. */
export interface MangaDownload {
  /** [downloadKey]: "<anilistId>:<chapterId>". */
  key: string;
  mangaId: number;
  mangaTitle: string;
  cover: string | null;
  /** AniList country of origin, so offline reading picks the same layout. */
  country: string | null;
  sourceId: string;
  sourceTitleId: string;
  sourceTitle: string;
  chapter: MangaChapter;
  status: MangaDownloadStatus;
  /** Pages saved so far, of [total]. */
  done: number;
  total: number;
  error: string | null;
  sizeBytes: number;
}

/** What the main process sends as downloads change: one row's new state, or rows that are gone. */
export type MangaDownloadEvent = { item: MangaDownload } | { removed: string[] };

/** The manga fields a download keeps with its chapter. */
export interface DownloadManga {
  id: number;
  title: string;
  cover: string | null;
  country: string | null;
}

/** A title the Updates page checks, with the furthest chapter read (null when none). */
export interface TrackedTitle {
  mangaId: number;
  title: string;
  cover: string | null;
  lastRead: number | null;
}

/** The newest chapter a source lists for a title, and when it came out (epoch ms). */
export interface SourceLatest {
  chapter: number | null;
  at: number | null;
}

/** One Updates lookup: the newest chapter where the title reads, and sources that asked for their check. */
export interface LatestResult {
  found: (SourceLatest & { sourceId: string; label: string }) | null;
  blocked: string[];
}

export const isFinished = (state: ReadState) => state.pageCount > 0 && state.page >= state.pageCount - 1;

/** "Manhwa" / "Manhua" for Korean and Chinese comics, otherwise the AniList format. */
export function mangaKind(manga: Pick<MangaMeta, "format" | "country">): string | null {
  switch (manga.format) {
    case "MANGA": return manga.country === "KR" ? "Manhwa" : manga.country === "CN" ? "Manhua" : "Manga";
    case "ONE_SHOT": return "One-shot";
    case "NOVEL": return "Light novel";
    default: return null;
  }
}

export function publishLabel(status: string | null): string | null {
  switch (status) {
    case "RELEASING": return "Publishing";
    case "FINISHED": return "Completed";
    case "NOT_YET_RELEASED": return "Not yet published";
    case "HIATUS": return "On hiatus";
    case "CANCELLED": return "Cancelled";
    default: return null;
  }
}

// ── Chapters ──────────────────────────────────────────────────────────────────

const valid = (chapters: MangaChapter[]) => chapters.filter((c) => Number.isFinite(c.number) && c.number >= 0);

export const chapterLabel = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** Groups with how many chapter numbers each uploaded, most first. */
export function chapterGroups(chapters: MangaChapter[]): [string, number][] {
  const numbers = new Map<string, Set<number>>();
  for (const c of valid(chapters)) {
    if (!c.group) continue;
    if (!numbers.has(c.group)) numbers.set(c.group, new Set());
    numbers.get(c.group)!.add(c.number);
  }
  return [...numbers].map(([group, set]) => [group, set.size] as [string, number]).sort((a, b) => b[1] - a[1]);
}

/**
 * One upload per chapter number, ascending. [preferredGroup] wins where it uploaded
 * that number; otherwise the group covering the most chapters, so reading keeps one
 * group's style.
 */
export function normalizeChapters(chapters: MangaChapter[], preferredGroup: string | null = null): MangaChapter[] {
  const usable = valid(chapters);
  const rank = new Map(chapterGroups(usable).map(([group], i) => [group, i]));
  const byNumber = new Map<number, MangaChapter[]>();
  for (const c of usable) byNumber.set(c.number, [...(byNumber.get(c.number) ?? []), c]);
  const out: MangaChapter[] = [];
  for (const same of byNumber.values()) {
    const preferred = preferredGroup ? same.find((c) => c.group === preferredGroup) : undefined;
    const best = preferred ?? [...same].sort((a, b) => (rank.get(a.group ?? "") ?? 1e9) - (rank.get(b.group ?? "") ?? 1e9))[0];
    out.push(best);
  }
  return out.sort((a, b) => a.number - b.number);
}

/** Every upload (or one [group]'s), matching [query] by number or title, newest or oldest first. */
export function chapterListing(uploads: MangaChapter[], group: string | null, query: string, newestFirst: boolean): MangaChapter[] {
  const q = query.trim().toLowerCase().replace(/^ch\./, "").replace(/^chapter/, "").trim();
  const rows = valid(uploads)
    .filter((c) => group == null || c.group === group)
    .filter((c) => !q || chapterLabel(c.number).startsWith(q) || (c.title ?? "").toLowerCase().includes(q))
    .sort((a, b) => a.number - b.number || (a.uploadedAt ?? 0) - (b.uploadedAt ?? 0));
  return newestFirst ? rows.reverse() : rows;
}

/** The chapter to open: the one read last (or the next once finished), else the first. */
export function resumeTarget(chapters: MangaChapter[], progress: Record<string, ReadState>): MangaChapter | null {
  if (!chapters.length) return null;
  let last: [number, ReadState] | null = null;
  for (const [key, state] of Object.entries(progress)) {
    if (!last || state.updatedAt > last[1].updatedAt) last = [Number(key), state];
  }
  if (!last) return chapters[0];
  const index = chapters.findIndex((c) => c.number === last![0]);
  if (index < 0) return chapters[0];
  return isFinished(last[1]) ? chapters[index + 1] ?? chapters[index] : chapters[index];
}

/** [chapters] (one per number) with [choice] standing in for its number. */
export function withUpload(chapters: MangaChapter[], choice: MangaChapter): MangaChapter[] {
  return chapters.map((c) => (c.number === choice.number ? choice : c));
}

/** What a range download fetches ([chapters]) and the numbers its group didn't upload ([gaps]). */
export interface RangeChoice {
  chapters: MangaChapter[];
  gaps: MangaChapter[];
}

/**
 * A range download from one [group]: one upload per chapter number in [from]..[to]
 * (either order, inclusive), never the same chapter from two groups. Where [group]
 * has no upload of a number, [fillGaps] takes another group's (the group with the
 * most chapters first); otherwise that number is left out. A null [group] (the
 * source names no groups) takes one upload per number.
 */
export function rangeChoice(uploads: MangaChapter[], group: string | null, from: number, to: number, fillGaps: boolean): RangeChoice {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const all = normalizeChapters(uploads, group).filter((c) => c.number >= low && c.number <= high);
  const gaps = group == null ? [] : all.filter((c) => c.group !== group);
  return { chapters: fillGaps || group == null ? all : all.filter((c) => c.group === group), gaps };
}

/**
 * Range presets as [label, from, to] over one-per-number [chapters]: the next 10 and
 * 25 from [start] (the next unread chapter), everything from [start] on, and
 * everything. When presets coincide (a short series), the broadest label stays.
 */
export function rangePresets(chapters: MangaChapter[], start: MangaChapter | null): [string, number, number][] {
  const ordered = [...chapters].sort((a, b) => a.number - b.number);
  if (!ordered.length) return [];
  const first = Math.max(0, ordered.findIndex((c) => c.number === start?.number));
  const last = ordered[ordered.length - 1].number;
  const upTo = (count: number) => ordered[Math.min(first + count - 1, ordered.length - 1)].number;
  const presets: [string, number, number][] = [
    ["Next 10", ordered[first].number, upTo(10)],
    ["Next 25", ordered[first].number, upTo(25)],
    [first === 0 ? "All" : "All unread", ordered[first].number, last],
    ["All", ordered[0].number, last],
  ];
  return presets.filter(([, low, high], i) => !presets.slice(i + 1).some(([, l, h]) => l === low && h === high));
}

/** A series' chapter numbers downloaded or on the way, from any group (failed tries don't count). */
export function heldChapters(items: MangaDownload[], mangaId: number): Map<number, MangaDownload> {
  const out = new Map<number, MangaDownload>();
  for (const item of items) if (item.mangaId === mangaId && item.status !== "failed") out.set(item.chapter.number, item);
  return out;
}

/**
 * What a range download queues: [add] in reading order, one per chapter number.
 * A number already downloaded or on the way, from any group, is skipped, so a range
 * never saves the same chapter twice; failed tries at an added number ([drop]) are
 * replaced.
 */
export function planRange(chapters: MangaChapter[], items: MangaDownload[], mangaId: number): { add: MangaChapter[]; drop: string[] } {
  const add: MangaChapter[] = [];
  const drop: string[] = [];
  const seen = new Set<number>();
  for (const chapter of [...chapters].sort((a, b) => a.number - b.number)) {
    if (seen.has(chapter.number)) continue;
    seen.add(chapter.number);
    const same = items.filter((item) => item.mangaId === mangaId && item.chapter.number === chapter.number);
    if (same.some((item) => item.status !== "failed")) continue;
    const key = downloadKey(mangaId, chapter.id);
    drop.push(...same.filter((item) => item.key !== key).map((item) => item.key));
    add.push(chapter);
  }
  return { add, drop };
}

/**
 * The group a range download starts with: the one this title's downloads already
 * use most (so batches don't mix groups), else the chapter list's group, else the
 * group with the most chapters.
 */
export function rangeStartGroup(held: Iterable<MangaDownload>, groups: [string, number][], listGroup: string | null): string | null {
  const counts = new Map<string, number>();
  for (const item of held) {
    const group = item.chapter.group;
    if (group && groups.some(([g]) => g === group)) counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  let best: [string, number] | null = null;
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
  return best?.[0] ?? listGroup ?? groups[0]?.[0] ?? null;
}

/**
 * Reading progress on [chapters] only (by number). Continuing a title's downloads
 * uses it, so a chapter read online but not saved doesn't send you back to the
 * first download.
 */
export function progressFor(chapters: MangaChapter[], progress: Record<string, ReadState>): Record<string, ReadState> {
  const numbers = new Set(chapters.map((c) => c.number));
  return Object.fromEntries(Object.entries(progress).filter(([key]) => numbers.has(Number(key))));
}

/** "5m", "3h", "6d" for the past week; then "Sep 19", or "Sep 19, 2024" in another year. */
export function uploadedLabel(epochMs: number, nowMs = Date.now()): string {
  const minutes = Math.floor((nowMs - epochMs) / 60_000);
  if (minutes >= 0 && minutes < 60) return `${Math.max(1, minutes)}m`;
  if (minutes >= 60 && minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  if (minutes >= 24 * 60 && minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))}d`;
  const date = new Date(epochMs);
  const month = date.toLocaleString("en-US", { month: "short" });
  return date.getFullYear() === new Date(nowMs).getFullYear()
    ? `${month} ${date.getDate()}`
    : `${month} ${date.getDate()}, ${date.getFullYear()}`;
}

// ── Titles and URLs ───────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Title normalization shared by the source matchers. */
export function normalizeTitle(value: string): string {
  return decodeEntities(value).normalize("NFKD").replace(/\p{Mn}+/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The AniList names a source title may legitimately carry. */
export function titleNames(manga: Pick<MangaMeta, "title" | "titleRomaji" | "synonyms">): Set<string> {
  return new Set(
    [manga.title, manga.titleRomaji, ...manga.synonyms]
      .filter((name): name is string => !!name)
      .map(normalizeTitle)
      .filter((name) => name.length >= 2),
  );
}

const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".localdomain"];

/** An HTTPS address of a public host (no credentials, IP literals, local names or odd ports). */
export function publicHttps(value: string): URL | null {
  if (value.length > 2048 || /[\u0000- \u007f]/.test(value)) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return null;
  if (host.includes(":") || host.startsWith("[") || /^[0-9.]+$/.test(host)) return null;
  return url;
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : null);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text !== "null" ? text : null;
};
const num = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
/**
 * A chapter number without floating-point noise: sources list both 7.199999999999999
 * and 7.2 for one chapter (Android's Float numbers merge them the same way).
 */
const chapterNum = (value: unknown): number | null => {
  const n = num(value);
  return n == null ? null : Math.round(n * 10_000) / 10_000;
};
const positiveInt = (value: unknown): number | null => {
  const n = num(value);
  return n != null && Number.isInteger(n) && n > 0 ? n : null;
};

/** Identity fields a source reports for a title, used to confirm a match. */
export interface SourceDetail {
  id: string;
  title: string;
  altTitles: string[];
  anilistId: number | null;
  malId: number | null;
  year: number | null;
  country: string | null;
  adult: boolean;
  /**
   * The newest chapter the source lists, and when the title last got one (epoch ms).
   * Updates reads MangaDot's from here; MangaBall's `updated_at` is the title's own
   * time and lags, so its newest upload comes from [mangaBallLatest] instead.
   */
  latestChapter: number | null;
  latestAt: number | null;
}

const chapterNumberOrNull = (value: unknown): number | null => {
  const n = chapterNum(value);
  return n != null && n >= 0 && n < 100_000 ? n : null;
};

/**
 * Whether a source title is this AniList manga. A tracker link decides on its own
 * (a conflicting link is a rejection); unlinked titles need an exact normalized
 * name plus the same year (±1) and country.
 */
export function sourceMatches(detail: SourceDetail, manga: MangaMeta): boolean {
  if (detail.adult) return false;
  if (detail.anilistId != null) return detail.anilistId === manga.id;
  if (detail.malId != null && manga.malId != null) return detail.malId === manga.malId;
  const names = titleNames(manga);
  const named = [detail.title, ...detail.altTitles].some((name) => names.has(normalizeTitle(name)));
  if (!named || detail.year == null || manga.year == null || Math.abs(detail.year - manga.year) > 1) return false;
  return detail.country == null || manga.country == null || detail.country.toUpperCase() === manga.country.toUpperCase();
}

const BARE_TITLE = /^\s*(?:ch(?:apter)?\.?\s*)?[\d.]+\s*$/i;
const TITLE_PREFIX = /^\s*ch(?:apter)?\.?\s*[\d.]+\s*[:\-–—]?\s*/i;

/** A chapter's own name, without a bare "Chapter 12" label. */
function chapterTitle(raw: string | null): string | null {
  const name = (raw ?? "").trim();
  if (!name || BARE_TITLE.test(name)) return null;
  return name.replace(TITLE_PREFIX, "").trim().slice(0, 200) || null;
}

export const MAX_CHAPTERS = 20_000;
export const MAX_PAGES = 500;

// ── MangaBall (api.mangaball.com/api/v1, public JSON) ─────────────────────────

export const MANGABALL = {
  API: "https://api.mangaball.com/api/v1",
  SITE: "https://mangaball.com",
};

const MANGABALL_ID = /^[a-f0-9]{24}$/;
const MANGABALL_COUNTRIES: Record<string, string> = { ja: "JP", jp: "JP", ko: "KR", kr: "KR", zh: "CN", cn: "CN", "zh-hk": "CN" };

export const isMangaBallId = (value: string) => MANGABALL_ID.test(value);

/** "2025-10-02T13:07:48.357000" (UTC, no zone) → epoch ms. */
export function mangaBallTime(value: string | null): number | null {
  const text = (value ?? "").trim();
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] ? match[2].slice(0, 4) : "";
  const zone = match[3] ?? "Z";
  const ms = Date.parse(`${match[1]}${fraction}${zone}`);
  return Number.isFinite(ms) ? ms : null;
}

export function mangaBallSearch(json: unknown): { id: string; name: string; adult: boolean }[] {
  const seen = new Set<string>();
  const out: { id: string; name: string; adult: boolean }[] = [];
  for (const raw of arr(obj(json)?.data)) {
    const item = obj(raw);
    const id = str(item?.id) ?? str(item?._id);
    if (!item || !id || !isMangaBallId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: str(item.name) ?? "", adult: item.is18plus === true });
  }
  return out;
}

export function mangaBallDetail(json: unknown): SourceDetail | null {
  const d = obj(obj(json)?.data);
  const id = str(d?.id) ?? str(d?._id);
  if (!d || !id || !isMangaBallId(id)) return null;
  const year = Number((str(d.date_published) ?? "").slice(0, 4));
  return {
    id,
    title: str(d.name) ?? "",
    altTitles: arr(d.alternateName).slice(0, 60).map(str).filter((name): name is string => !!name),
    anilistId: null,
    malId: positiveInt(str(obj(d.links)?.myanimelist)),
    year: year >= 1900 && year <= 2100 ? year : null,
    country: MANGABALL_COUNTRIES[(str(d.originalLanguage) ?? "").toLowerCase()] ?? null,
    adult: d.is18plus === true,
    latestChapter: chapterNumberOrNull(d.latest_chapter_number),
    latestAt: mangaBallTime(str(d.updated_at)),
  };
}

export function mangaBallChapters(json: unknown): { chapters: MangaChapter[]; totalPages: number } {
  const root = obj(json);
  const chapters: MangaChapter[] = [];
  for (const raw of arr(root?.data).slice(0, MAX_CHAPTERS)) {
    const item = obj(raw);
    if (!item || (str(item.lang) ?? "").toLowerCase() !== "en") continue;
    if ("status" in item && !["published", ""].includes(String(item.status ?? ""))) continue;
    const id = str(item.id) ?? str(item._id);
    if (!id || !isMangaBallId(id)) continue;
    const number = chapterNum(item.number) ?? chapterNum(item.chapter_number);
    if (number == null || number < 0) continue;
    chapters.push({
      id,
      number,
      title: chapterTitle(str(item.name)),
      group: str(obj(item.group)?.name) ?? str(item.group_name),
      pageCount: null,
      uploadedAt: mangaBallTime(str(item.created_at)),
    });
  }
  const totalPages = Math.max(1, positiveInt(obj(root?.pagination)?.total_pages) ?? 1);
  return { chapters, totalPages };
}

/**
 * Rows asked for in each page of MangaBall's chapter listing. Up to 100 come back in a
 * few seconds, bigger pages far more slowly (27 Oct 2026, Solo Leveling's 728 uploads:
 * 200 rows took 33 s, 500 took 68 s, and the one-call listing 105 s), past the 25 s a
 * request may take.
 */
export const MANGABALL_LIST_PAGE = 100;

/** Listing pages read at most: 10,000 uploads. */
export const MANGABALL_MAX_LIST_PAGES = 100;

/** One page of a title's English uploads, oldest first. */
export const mangaBallListingUrl = (titleId: string, page: number) =>
  `${MANGABALL.API}/title/chapter-listing?title_id=${titleId}&page=${page}&limit=${MANGABALL_LIST_PAGE}&group_by=flat&sort_order=asc&language=en&search=`;

/**
 * The newest English chapter in a newest-first `/title/chapter-listing` page, and
 * when it was uploaded (Kagurabachi's `updated_at` said 24 Oct 2025 while chapter
 * 134 went up on 11 Oct 2026).
 */
export function mangaBallLatest(json: unknown): SourceLatest | null {
  const uploads = mangaBallChapters(json).chapters;
  if (!uploads.length) return null;
  const newest = Math.max(...uploads.map((c) => c.number));
  const at = Math.max(0, ...uploads.filter((c) => c.number === newest).map((c) => c.uploadedAt ?? 0));
  return { chapter: newest, at: at || null };
}

/** Page images on MangaBall's CDN (it wants the site as Referer). */
/**
 * A chapter's page images. MangaBall rotates its image CDN host (bulbasaur.poke-black-and-white.net,
 * then chikorita.red-and-blue.net for new chapters in Oct 2026), but one chapter's pages share a
 * host: only pages on the chapter's most common public HTTPS host are kept.
 */
export function mangaBallPages(json: unknown): string[] {
  const urls = arr(obj(obj(obj(json)?.data)?.chapter)?.pages).slice(0, MAX_PAGES)
    .map((value) => publicHttps(typeof value === "string" ? value.trim() : ""))
    .filter((url): url is URL => !!url);
  const counts = new Map<string, number>();
  for (const url of urls) counts.set(url.hostname.toLowerCase(), (counts.get(url.hostname.toLowerCase()) ?? 0) + 1);
  let host: string | null = null;
  for (const [name, count] of counts) if (host === null || count > counts.get(host)!) host = name;
  return urls.filter((url) => url.hostname.toLowerCase() === host).map((url) => url.toString());
}

// ── MangaDot (mangadot.net JSON API behind Cloudflare) ────────────────────────

export const MANGADOT = { ORIGIN: "https://mangadot.net" };

const MANGADOT_SOURCES = new Set(["user", "scraper"]);
const MANGADOT_CHAPTER_REF = /^(user|scraper):(\d{1,12})$/;
const MANGADOT_PAGE_PATH = /^\/(?:chapters|uploads)\/[A-Za-z0-9/_.-]{1,300}$/;

/** "2026-04-29 20:49:55+00" (optionally with fractions) → epoch ms. */
export function mangaDotTime(value: string | null): number | null {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,9})?([+-]\d{2}(?::?\d{2})?|Z)$/.exec((value ?? "").trim());
  if (!match) return null;
  const [, date, time, fraction = "", offset] = match;
  const zone = offset === "Z" ? "Z" : offset.length === 3 ? `${offset}:00` : offset.includes(":") ? offset : `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const ms = Date.parse(`${date}T${time}${fraction.slice(0, 4)}${zone}`);
  return Number.isFinite(ms) ? ms : null;
}

export function mangaDotSuggestions(json: unknown): number[] {
  const ids = arr(obj(json)?.suggestions).map((item) => positiveInt(obj(item)?.id)).filter((id): id is number => id != null);
  return [...new Set(ids)].slice(0, 5);
}

export function mangaDotDetail(json: unknown): SourceDetail | null {
  const m = obj(obj(json)?.manga);
  const id = positiveInt(m?.id);
  if (!m || id == null) return null;
  return {
    id: String(id),
    title: str(m.title) ?? "",
    altTitles: arr(m.alt_titles).slice(0, 60).map(str).filter((name): name is string => !!name),
    anilistId: positiveInt(m.anilist_id),
    malId: positiveInt(m.mal_id),
    year: positiveInt(m.year),
    country: str(m.country_of_origin),
    adult: false,
    latestChapter: chapterNumberOrNull(m.latest_chapter_number),
    latestAt: mangaDotTime(str(m.last_chapter_date)),
  };
}

/** English uploads; ids carry their source ("user:25424"). */
export function mangaDotChapters(json: unknown): MangaChapter[] {
  const out: MangaChapter[] = [];
  for (const raw of arr(json).slice(0, MAX_CHAPTERS)) {
    const c = obj(raw);
    if (!c) continue;
    const language = typeof c.language === "string" ? c.language : "en";
    if (language && language !== "en") continue;
    const source = typeof c.source === "string" ? c.source : "user";
    if (!MANGADOT_SOURCES.has(source)) continue;
    const id = positiveInt(c.id);
    if (id == null) continue;
    const pageCount = num(c.page_count);
    if (pageCount != null && pageCount <= 0) continue;
    const number = chapterNum(c.chapter_number);
    if (number == null || number < 0 || number >= 100_000) continue;
    out.push({
      id: `${source}:${id}`,
      number,
      title: chapterTitle(str(c.chapter_title)),
      group: (str(c.group_name) ?? str(c.scanlator_name))?.slice(0, 80) ?? null,
      pageCount: pageCount != null && pageCount > 0 ? pageCount : null,
      uploadedAt: mangaDotTime(str(c.date_added)),
    });
  }
  return out;
}

/** The API path holding a chapter's pages, from its "user:25424" id. */
export function mangaDotImagesPath(chapterId: string): string | null {
  const match = MANGADOT_CHAPTER_REF.exec(chapterId);
  if (!match) return null;
  return match[1] === "user" ? `/api/uploads/${match[2]}/images` : `/api/chapters/${match[2]}/images`;
}

/** Same-origin page images (requested with the user-verified session). */
export function mangaDotPages(json: unknown): { url: string; width: number | null; height: number | null }[] {
  const out: { url: string; width: number | null; height: number | null }[] = [];
  for (const raw of arr(obj(json)?.images).slice(0, MAX_PAGES)) {
    const image = obj(raw);
    const path = str(image?.url) ?? "";
    if (!MANGADOT_PAGE_PATH.test(path) || path.includes("..") || path.includes("//")) continue;
    const url = publicHttps(`${MANGADOT.ORIGIN}${path}`);
    if (!url) continue;
    const width = positiveInt(image?.w);
    const height = positiveInt(image?.h);
    out.push({
      url: url.toString(),
      width: width != null && width <= 20_000 ? width : null,
      height: height != null && height <= 60_000 ? height : null,
    });
  }
  return out;
}

export function isMangaDotPage(url: URL): boolean {
  return url.origin === MANGADOT.ORIGIN && MANGADOT_PAGE_PATH.test(url.pathname) && !url.pathname.includes("..");
}

// ── Downloads ─────────────────────────────────────────────────────────────────

export function downloadKey(mangaId: number, chapterId: string): string {
  return `${mangaId}:${chapterId}`;
}

/** Whether [chapterId] has the shape [sourceId] gives its chapters (it also names a folder on disk). */
export function isSourceChapterId(sourceId: string, chapterId: string): boolean {
  if (sourceId === "mangaball") return isMangaBallId(chapterId);
  if (sourceId === "mangadot") return MANGADOT_CHAPTER_REF.test(chapterId);
  if (sourceId === "comix") return /^\d{1,15}$/.test(chapterId);
  if (sourceId === "xcomic") return /^[a-z0-9]{3,16}$/.test(chapterId);
  if (sourceId === "toonkotsu") return /^[1-9]\d{0,14}$/.test(chapterId);
  return false;
}

/** A chapter's folder under its title's download folder ("user:25424" → "user_25424"); null for other ids. */
export function chapterFolder(chapterId: string): string | null {
  return /^[A-Za-z0-9:_-]{1,64}$/.test(chapterId) ? chapterId.replace(/:/g, "_") : null;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
};
const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif" };

/** A saved page's file name: "001.webp" (an unknown image type is kept as ".img"). */
export const PAGE_FILE = /^\d{3,4}\.(?:jpg|png|webp|gif|avif|img)$/;

/** The extension a page is saved under: from its Content-Type, else its address, else "img". */
export function pageExtension(contentType: string | null, url: string): string {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (IMAGE_EXTENSIONS[type]) return IMAGE_EXTENSIONS[type];
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(url.split(/[?#]/)[0])?.[1] ?? "").toLowerCase();
  const known = ext === "jpeg" ? "jpg" : ext;
  return IMAGE_TYPES[known] ? known : "img";
}

/** The Content-Type a saved page is served with. */
export function pageContentType(file: string): string {
  return IMAGE_TYPES[file.slice(file.lastIndexOf(".") + 1)] ?? "application/octet-stream";
}

/**
 * Pixel size from an image's header (PNG, GIF, WebP, JPEG), or null. JPEGs with
 * Exif data are skipped: their orientation can swap the displayed sides.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const at = (i: number) => bytes[i] ?? 0;
  const be16 = (i: number) => (at(i) << 8) | at(i + 1);
  const le16 = (i: number) => at(i) | (at(i + 1) << 8);
  const ascii = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n));
  const sized = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);
  if (bytes.length >= 24 && at(0) === 0x89 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") {
    return sized(be16(16) * 65536 + be16(18), be16(20) * 65536 + be16(22));
  }
  if (bytes.length >= 10 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return sized(le16(6), le16(8));
  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 " && at(23) === 0x9d && at(24) === 0x01 && at(25) === 0x2a) return sized(le16(26) & 0x3fff, le16(28) & 0x3fff);
    if (chunk === "VP8L" && at(20) === 0x2f) {
      const bits = at(21) | (at(22) << 8) | (at(23) << 16) | (at(24) << 24);
      return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (chunk === "VP8X") return sized(1 + at(24) + (at(25) << 8) + (at(26) << 16), 1 + at(27) + (at(28) << 8) + (at(29) << 16));
    return null;
  }
  if (bytes.length >= 4 && at(0) === 0xff && at(1) === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (at(i) !== 0xff) return null;
      const marker = at(i + 1);
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xe1 && ascii(i + 4, 4) === "Exif") return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return sized(be16(i + 7), be16(i + 5));
      }
      if (marker === 0xd9 || marker === 0xda) return null;
      i += 2 + be16(i + 2);
    }
  }
  return null;
}

export interface SavedPage {
  file: string;
  w: number | null;
  h: number | null;
}

/** A downloaded chapter's meta.json: who it belongs to, its pages, and whether it finished. */
export interface DownloadMeta {
  manga: DownloadManga;
  title: SourceTitle;
  chapter: MangaChapter;
  pages: SavedPage[];
  complete: boolean;
  sizeBytes: number;
}

export function downloadMetaJson(meta: DownloadMeta): string {
  return JSON.stringify({
    version: 1,
    mangaId: meta.manga.id,
    mangaTitle: meta.manga.title,
    cover: meta.manga.cover,
    country: meta.manga.country,
    sourceId: meta.title.sourceId,
    sourceTitleId: meta.title.id,
    sourceTitle: meta.title.title,
    chapterId: meta.chapter.id,
    number: meta.chapter.number,
    chapterTitle: meta.chapter.title,
    group: meta.chapter.group,
    uploadedAt: meta.chapter.uploadedAt,
    pages: meta.pages,
    complete: meta.complete,
    sizeBytes: meta.sizeBytes,
  });
}

/** A meta.json read back, or null when it isn't one of ours. */
export function downloadMeta(json: unknown): DownloadMeta | null {
  const m = obj(json);
  const mangaId = positiveInt(m?.mangaId);
  const sourceId = str(m?.sourceId);
  const chapterId = str(m?.chapterId);
  const titleId = str(m?.sourceTitleId);
  const number = num(m?.number);
  if (!m || mangaId == null || !sourceId || !chapterId || !titleId || number == null || number < 0) return null;
  if (!isSourceChapterId(sourceId, chapterId) || titleId.length > 64) return null;
  const pages: SavedPage[] = [];
  for (const raw of arr(m.pages).slice(0, MAX_PAGES)) {
    const page = obj(raw);
    const file = str(page?.file);
    if (!file || !PAGE_FILE.test(file)) return null;
    pages.push({ file, w: positiveInt(page?.w), h: positiveInt(page?.h) });
  }
  const text = (value: unknown, max: number) => str(value)?.slice(0, max) ?? null;
  return {
    manga: { id: mangaId, title: text(m.mangaTitle, 300) ?? "Unknown", cover: text(m.cover, 2048), country: text(m.country, 8) },
    title: { sourceId, id: titleId, title: text(m.sourceTitle, 300) ?? "" },
    chapter: {
      id: chapterId,
      number,
      title: text(m.chapterTitle, 200),
      group: text(m.group, 80),
      pageCount: pages.length || null,
      uploadedAt: positiveInt(m.uploadedAt),
    },
    pages,
    complete: m.complete === true && pages.length > 0,
    sizeBytes: Math.max(0, num(m.sizeBytes) ?? 0),
  };
}

/** The downloads list after one [MangaDownloadEvent] (rows keep their place). */
export function applyDownloadEvent(items: MangaDownload[], event: MangaDownloadEvent): MangaDownload[] {
  if ("removed" in event) {
    const gone = new Set(event.removed);
    return items.filter((item) => !gone.has(item.key));
  }
  const index = items.findIndex((item) => item.key === event.item.key);
  if (index < 0) return [...items, event.item];
  const next = [...items];
  next[index] = event.item;
  return next;
}

/** "640 KB", "12 MB", "1.4 GB" (empty for nothing). */
export function humanSize(bytes: number): string {
  if (bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${Math.floor(mb)} MB`;
  return `${Math.max(1, Math.floor(bytes / 1024))} KB`;
}

// ── Updates ───────────────────────────────────────────────────────────────────

export const UPDATES_MAX = 40;

/**
 * Titles the Updates page checks: the reading history (most recent first), then
 * the list's titles you aren't done with (dropped and completed ones are left out).
 */
export function trackedTitles(
  reading: ReadingRow[],
  list: MangaListEntry[],
  lastRead: Record<number, number>,
  max = UPDATES_MAX,
): TrackedTitle[] {
  const out = new Map<number, TrackedTitle>();
  const add = (mangaId: number, title: string, cover: string | null) => {
    if (!out.has(mangaId)) out.set(mangaId, { mangaId, title, cover, lastRead: lastRead[mangaId] ?? null });
  };
  for (const row of reading) add(row.mangaId, row.title, row.cover);
  for (const entry of list) if (entry.status !== "dropped" && entry.status !== "completed") add(entry.mangaId, entry.title, entry.cover);
  return [...out.values()].slice(0, max);
}

/** Chapters out since the one you last read: null when you haven't started the title. */
export function newChapterCount(latest: number | null, lastRead: number | null): number | null {
  if (lastRead == null) return null;
  if (latest == null || latest <= lastRead) return 0;
  return Math.max(1, Math.floor(latest) - Math.floor(lastRead));
}

// ── Reader ────────────────────────────────────────────────────────────────────

/**
 * Groups page indexes into what's shown together, like an open book: the first
 * page (usually the cover) alone, then pairs. A wide page (an already-joined
 * double-page scan) always stands alone. [shift] pairs from the first page instead.
 */
export function spreadsOf(count: number, shift: boolean, wide: (index: number) => boolean): number[][] {
  const out: number[][] = [];
  let i = 0;
  if (!shift && count > 0) {
    out.push([0]);
    i = 1;
  }
  while (i < count) {
    if (!wide(i) && i + 1 < count && !wide(i + 1)) {
      out.push([i, i + 1]);
      i += 2;
    } else {
      out.push([i]);
      i += 1;
    }
  }
  return out;
}
