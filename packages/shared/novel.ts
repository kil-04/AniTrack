/**
 * Novels mode: shared types and the reading-source parsers (NovelBuddy's and
 * NovelArchive's JSON APIs, Novel Phoenix's pages). Mirrors the Android app's
 * data/novel package.
 *
 * Novels are source-first: many web novels have no AniList entry, so a title is
 * identified by its source and that source's id, never by a metadata catalogue.
 * Chapter ids are the source's own request locators; the display label and the
 * position in the list are kept apart (labels like "769.5" or a missing number
 * must never be turned into a request).
 */

// ── IPC ───────────────────────────────────────────────────────────────────────

export const NOVEL_IPC = {
  SOURCES: "novel:sources",
  HOME: "novel:home",
  SEARCH: "novel:search",
  TITLE: "novel:title",
  /** The title page saved from the last fetch, shown while a fresh one loads. */
  TITLE_SAVED: "novel:title-saved",
  CHAPTERS: "novel:chapters",
  /** The same list once every chapter name is in (a long Novel Phoenix list arrives in pages). */
  CHAPTERS_COMPLETE: "novel:chapters-complete",
  CHAPTER: "novel:chapter",
  READING_GET: "novel:reading-get",
  READING_SAVE: "novel:reading-save",
  READING_MARK: "novel:reading-mark",
  CONTINUE: "novel:continue",
  READING_FORGET: "novel:reading-forget",
  LIST_GET: "novel:list-get",
  LIST_SET: "novel:list-set",
  LIST_ALL: "novel:list-all",
  /** The same novel's copies on other sources (linked by title and author). */
  GROUP: "novel:group",
  /** Finds a title's copy on another source: linked, a few candidates, or none. */
  FIND_ON: "novel:find-on",
  LINK: "novel:link",
  UNLINK: "novel:unlink",
  /** New chapters for titles being read or on the list. */
  UPDATES: "novel:updates",
  DOWNLOADS: "novel:downloads",
  DOWNLOAD: "novel:download",
  DOWNLOAD_CANCEL: "novel:download-cancel",
  DOWNLOAD_REMOVE: "novel:download-remove",
  /** A title's chapter ids saved on disk. */
  DOWNLOADED: "novel:downloaded",
  /** Main → renderer: a title's download state changed ([NovelDownloadTitle], or `{ removed }`). */
  DOWNLOAD_EVENT: "novel:download-event",
  /** Cross-device sync (packages/shared/novel-sync.ts): this device's tables and pending removals. */
  SYNC_SNAPSHOT: "novel:sync-snapshot",
  /** Applies a reconcile's local side. */
  SYNC_APPLY: "novel:sync-apply",
  /** After an upload: removals sent, and the removals the gist holds. */
  SYNC_ACK: "novel:sync-ack",
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type NovelSourceId = "novelbuddy" | "novelarchive" | "novelphoenix";

export interface NovelSourceInfo {
  id: NovelSourceId;
  label: string;
  /** What the source is good at, shown under its name in the picker. */
  blurb: string;
}

export const NOVEL_SOURCES: NovelSourceInfo[] = [
  { id: "novelbuddy", label: "NovelBuddy", blurb: "Large translated web-novel library, complete chapter lists" },
  { id: "novelarchive", label: "NovelArchive", blurb: "110k+ titles; chapter labels can skip or repeat numbers" },
  { id: "novelphoenix", label: "Novel Phoenix", blurb: "NovelFire's library: quick with new chapters; long chapter lists load in pages" },
];

export const isNovelSource = (value: unknown): value is NovelSourceId =>
  value === "novelbuddy" || value === "novelarchive" || value === "novelphoenix";

export const novelSourceLabel = (id: string) => NOVEL_SOURCES.find((s) => s.id === id)?.label ?? id;

export type NovelPublishStatus = "ongoing" | "completed" | null;

/** A title as a source lists it (search results, home rows). */
export interface NovelCard {
  sourceId: NovelSourceId;
  id: string;
  title: string;
  cover: string | null;
  status: NovelPublishStatus;
  chapters: number | null;
  /** 0–5 as the source rates it; null when nobody rated it. */
  rating: number | null;
  genres: string[];
  /** Machine translation (NovelBuddy marks these); hidden from the home rows. */
  mtl: boolean;
  /** Plain-text blurb (short in lists, full on the title page). */
  synopsis: string | null;
}

/** The newest chapter a source has for a title, from its details (one small request). */
export interface NovelLatest {
  /** How many chapters the source lists. */
  count: number;
  label: string | null;
  at: number | null;
}

export interface NovelDetail extends NovelCard {
  author: string | null;
  altNames: string[];
  /** The title's page on the source's website. */
  url: string;
  latest: NovelLatest | null;
}

/** One chapter: [id] is the source's request locator, [order] its 0-based position. */
export interface NovelChapter {
  id: string;
  order: number;
  label: string;
  updatedAt: number | null;
}

export interface NovelChapterText {
  id: string;
  label: string;
  paragraphs: string[];
}

export interface NovelHome {
  trending: NovelCard[];
  popular: NovelCard[];
  latest: NovelCard[];
  completed: NovelCard[];
  /** Most bookmarked: the readers' favourites. */
  favourites: NovelCard[];
  /** Set when this isn't NovelBuddy's live feed (a source is down): why, shown above the rows. */
  notice?: string | null;
}

/** Where a request goes when its own source is down: NovelBuddy, or NovelArchive for NovelBuddy itself. */
export const otherNovelSource = (id: NovelSourceId): NovelSourceId => (id === "novelbuddy" ? "novelarchive" : "novelbuddy");

/** What Home says when it isn't showing NovelBuddy's live feed. */
export const NOVEL_HOME_NOTICES = {
  fallback: "NovelBuddy isn't responding right now, so Home shows NovelArchive's lists. Your reading and lists are untouched.",
  saved: "The novel sources aren't responding right now, so this is the Home saved earlier. Your reading and lists are untouched.",
} as const;

/** What search says when its source didn't answer and the other one did. */
export const novelFallbackNotice = (failed: NovelSourceId, used: NovelSourceId) =>
  `${novelSourceLabel(failed)} isn't responding right now, so these results are from ${novelSourceLabel(used)}.`;

/** NovelArchive listings that stand in for NovelBuddy's Home while it's down (filters and page size). */
export const NOVELARCHIVE_HOME_LISTS = {
  popular: { filters: { sort: "popular" }, limit: 40 },
  latest: { filters: { sort: "latest" }, limit: 40 },
  completed: { filters: { sort: "popular", status: "completed" }, limit: 30 },
  favourites: { filters: { sort: "rating" }, limit: 30 },
} as const satisfies Record<string, { filters: Omit<NovelSearchFilters, "sourceId">; limit: number }>;

const ARCHIVE_TRENDING = 12;

/** Home rows from NovelArchive's listings (machine translations dropped); null when they're all empty. */
export function novelArchiveHome(lists: Record<keyof typeof NOVELARCHIVE_HOME_LISTS, NovelCard[]>): NovelHome | null {
  const human = (list: NovelCard[]) => list.filter((c) => !c.mtl);
  const popular = human(lists.popular);
  const home: NovelHome = {
    trending: popular.slice(0, ARCHIVE_TRENDING),
    popular: popular.slice(ARCHIVE_TRENDING),
    latest: human(lists.latest),
    completed: human(lists.completed),
    favourites: human(lists.favourites),
    notice: NOVEL_HOME_NOTICES.fallback,
  };
  return home.trending.length || home.latest.length || home.completed.length || home.favourites.length ? home : null;
}

export type NovelSort = "popular" | "favourites" | "rating" | "latest" | "newest";

export const NOVEL_SORTS: { id: NovelSort; label: string }[] = [
  { id: "popular", label: "Popular" },
  { id: "favourites", label: "Fan favourites" },
  { id: "rating", label: "Top rated" },
  { id: "latest", label: "Recently updated" },
  { id: "newest", label: "Newly added" },
];

export const NOVEL_GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Harem", "Historical", "Horror", "Martial Arts",
  "Mature", "Mecha", "Mystery", "Psychological", "Romance", "School Life", "Sci-fi", "Seinen", "Shoujo",
  "Shounen", "Slice of Life", "Supernatural", "Tragedy", "Wuxia", "Xianxia", "Xuanhuan",
] as const;

export interface NovelSearchFilters {
  sourceId: NovelSourceId;
  query?: string;
  genre?: string;
  status?: "ongoing" | "completed";
  sort?: NovelSort;
  page?: number;
}

export interface NovelSearchPage {
  items: NovelCard[];
  hasNextPage: boolean;
}

/** [partial]: a chapter list whose later names are still being read (see NOVEL_IPC.CHAPTERS_COMPLETE). */
export type NovelResult<T> = { ok: true; value: T; partial?: boolean } | { ok: false; error: string };

/** Where a title stands in the reader: one row per chapter opened. */
export interface NovelReadingRow {
  sourceId: NovelSourceId;
  titleId: string;
  chapterId: string;
  chapterOrder: number;
  chapterLabel: string;
  /** The first paragraph on screen, and how many the chapter has. */
  paragraph: number;
  paragraphCount: number;
  title: string;
  cover: string | null;
  updatedAt: number;
}

export interface NovelReadState {
  paragraph: number;
  paragraphCount: number;
  updatedAt: number;
}

/** Where a chapter stands, and on which source copy it was read. */
export interface NovelProgress extends NovelReadState {
  sourceId: NovelSourceId;
  chapterId: string;
  chapterLabel: string;
  chapterOrder: number;
}

/**
 * A novel's progress across all its linked sources: [chapterKey] → the newest
 * state. Chapters are matched by label, never by position (see [chapterKey]).
 */
export type NovelProgressMap = Record<string, NovelProgress>;

export const NOVEL_STATUSES = ["reading", "completed", "on_hold", "dropped", "plan_to_read"] as const;
export type NovelStatus = (typeof NOVEL_STATUSES)[number];
export const NOVEL_STATUS_LABELS: Record<NovelStatus, string> = {
  reading: "Reading",
  completed: "Completed",
  on_hold: "On hold",
  dropped: "Dropped",
  plan_to_read: "Plan to read",
};

export interface NovelListEntry {
  sourceId: NovelSourceId;
  titleId: string;
  status: NovelStatus;
  title: string;
  cover: string | null;
  updatedAt: number;
}

/** A chapter counts as read once its last paragraphs were on screen. */
export const isChapterFinished = (state: Pick<NovelReadState, "paragraph" | "paragraphCount">) =>
  state.paragraphCount > 0 && state.paragraph >= Math.max(0, state.paragraphCount - 3);

// ── Chapters across sources ───────────────────────────────────────────────────

/**
 * A chapter's identity across sources, from its label: the (volume and) number,
 * plus "part N" or "teaser" when the entry is a separate piece. Positions are
 * never used: the same novel can have a teaser entry or a missing number on one
 * source (NovelArchive's Overgeared has "Chapter 1733 (Teaser)" and no 2009), so
 * the n-th chapter differs between sources. Labels without a number compare as words.
 */
export function chapterKey(label: string): string {
  const s = label.normalize("NFKC").toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim();
  const chapter = s.match(/\b(?:chapter|chap|ch)\.?\s*(\d+(?:\.\d+)?)/)
    ?? s.match(/^(?:episode|ep)\.?\s*(\d+(?:\.\d+)?)/)
    ?? s.match(/^#?\s*(\d+(?:\.\d+)?)(?!\d|\.\d)/);
  if (!chapter) return `~${s.replace(/[^\p{L}\p{N}]+/gu, " ").trim()}`;
  const volume = s.match(/\b(?:volume|vol)\.?\s*(\d+)\b/);
  let part: string | null = null;
  let teaser = false;
  for (const m of s.matchAll(/[([]([^)\]]{1,40})[)\]]/g)) {
    const q = m[1].replace(/[^a-z0-9/]+/g, " ").trim();
    if (/^(?:teaser|preview)$/.test(q)) teaser = true;
    const p = q.match(/^(?:part|pt)\s*(\d+)$/) ?? q.match(/^(\d+)\s*\/\s*\d+$/) ?? q.match(/^(\d+)$/);
    if (p) part = String(Number(p[1]));
  }
  const loose = s.match(/\b(?:part|pt)\.?\s*(\d+)\b/);
  if (!part && loose) part = String(Number(loose[1]));
  return [volume ? `v${Number(volume[1])}` : null, String(Number(chapter[1])), part ? `p${part}` : null, teaser ? "teaser" : null]
    .filter(Boolean)
    .join(" ");
}

interface KeyParts { volume: number; number: number; part: number; teaser: boolean }

function keyParts(key: string): KeyParts | null {
  if (key.startsWith("~")) return null;
  const parts: KeyParts = { volume: 0, number: NaN, part: 0, teaser: false };
  for (const token of key.split(" ")) {
    if (token === "teaser") parts.teaser = true;
    else if (token[0] === "v") parts.volume = Number(token.slice(1));
    else if (token[0] === "p") parts.part = Number(token.slice(1));
    else parts.number = Number(token);
  }
  return Number.isFinite(parts.number) ? parts : null;
}

const compareParts = (a: KeyParts, b: KeyParts) =>
  a.volume - b.volume || a.number - b.number || a.part - b.part || Number(b.teaser) - Number(a.teaser);

/** The progress shown for one chapter of a source's list (matched by label across sources). */
export const progressFor = (progress: NovelProgressMap, chapter: Pick<NovelChapter, "label">): NovelProgress | undefined =>
  progress[chapterKey(chapter.label)];

export interface NovelResume {
  chapter: NovelChapter;
  /** Exact paragraph when resuming the same copy. */
  paragraph: number;
  /** How far through, when the place came from another source's copy (its paragraphs differ). */
  fraction: number | null;
  /** How the place was found: this copy, the same label elsewhere, the nearest earlier chapter, or the start. */
  via: "same" | "label" | "nearest" | "start";
}

/**
 * Where Continue lands on [sourceId]'s list: the newest chapter read on any linked
 * source, found here by id (same copy) or label, or the one after it once
 * finished. A chapter this source lacks continues after its nearest earlier chapter.
 */
export function novelResumeTarget(chapters: NovelChapter[], progress: NovelProgressMap, sourceId: NovelSourceId): NovelResume | null {
  if (!chapters.length) return null;
  const start: NovelResume = { chapter: chapters[0], paragraph: 0, fraction: null, via: "start" };
  let newest: NovelProgress | null = null;
  for (const state of Object.values(progress)) if (!newest || state.updatedAt > newest.updatedAt) newest = state;
  if (!newest) return start;
  const from = newest;
  let index = from.sourceId === sourceId ? chapters.findIndex((c) => c.id === from.chapterId) : -1;
  let via: NovelResume["via"] = "same";
  const key = chapterKey(from.chapterLabel);
  if (index < 0) {
    index = chapters.findIndex((c) => chapterKey(c.label) === key);
    via = "label";
  }
  if (index >= 0) {
    if (isChapterFinished(from) && index < chapters.length - 1) return { chapter: chapters[index + 1], paragraph: 0, fraction: null, via };
    if (via === "same") return { chapter: chapters[index], paragraph: from.paragraph, fraction: null, via };
    return { chapter: chapters[index], paragraph: 0, fraction: from.paragraphCount > 0 ? from.paragraph / from.paragraphCount : 0, via };
  }
  const target = keyParts(key);
  if (!target) return start;
  let best = -1;
  let bestParts: KeyParts | null = null;
  chapters.forEach((c, i) => {
    const parts = keyParts(chapterKey(c.label));
    if (parts && compareParts(parts, target) < 0 && (!bestParts || compareParts(parts, bestParts) >= 0)) {
      best = i;
      bestParts = parts;
    }
  });
  if (best < 0) return start;
  return { chapter: chapters[Math.min(best + 1, chapters.length - 1)], paragraph: 0, fraction: null, via: "nearest" };
}

// ── Linked sources ────────────────────────────────────────────────────────────

/** One copy of a novel on one source. */
export interface NovelMember {
  sourceId: NovelSourceId;
  id: string;
  title: string;
  cover: string | null;
}

/** A novel's copies on every linked source; [key] is its first copy's "source:id". */
export interface NovelGroup {
  key: string;
  members: NovelMember[];
}

export const novelTitleKey = (sourceId: string, id: string) => `${sourceId}:${id}`;

export type NovelFindResult =
  | { state: "linked"; member: NovelMember }
  | { state: "candidates"; items: NovelCard[] }
  | { state: "none" };

/** New chapters on a title being read (or on the list) since the furthest one read. */
export interface NovelUpdate {
  sourceId: NovelSourceId;
  titleId: string;
  title: string;
  cover: string | null;
  newCount: number;
  latestLabel: string | null;
  latestAt: number | null;
}

// ── Downloads ─────────────────────────────────────────────────────────────────

/** One source copy's offline chapters. */
export interface NovelDownloadTitle {
  sourceId: NovelSourceId;
  titleId: string;
  title: string;
  cover: string | null;
  /** Chapters saved on disk. */
  saved: number;
  /** Chapters waiting or in progress. */
  queued: number;
  failed: number;
  /** The chapter being fetched now. */
  current: string | null;
  /** Per-chapter state for the chapter rows: the one being fetched, the ones waiting, the ones that failed. */
  currentId: string | null;
  queuedIds: string[];
  failedIds: string[];
  sizeBytes: number;
  error: string | null;
  updatedAt: number;
}

// ── Limits and ids ────────────────────────────────────────────────────────────

export const NOVEL_MAX_CHAPTERS = 20_000;
export const NOVEL_MAX_PARAGRAPHS = 5_000;

/**
 * NovelBuddy ids are short case-sensitive base62 strings; NovelArchive's are Mongo
 * object ids; Novel Phoenix's are the lower-case slugs of its addresses. NovelArchive
 * and Novel Phoenix chapters are requested by their 1-based position.
 */
const NB_ID = /^[A-Za-z0-9]{4,24}$/;
const NA_ID = /^[a-f0-9]{24}$/;
const NA_CHAPTER = /^[1-9][0-9]{0,5}$/;
const NP_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;

export function isNovelTitleId(sourceId: string, id: string): boolean {
  if (sourceId === "novelbuddy") return NB_ID.test(id);
  if (sourceId === "novelarchive") return NA_ID.test(id);
  if (sourceId === "novelphoenix") return NP_ID.test(id);
  return false;
}

export function isNovelChapterId(sourceId: string, id: string): boolean {
  if (sourceId === "novelbuddy") return NB_ID.test(id);
  if (sourceId === "novelarchive" || sourceId === "novelphoenix") return NA_CHAPTER.test(id);
  return false;
}

// ── Text ──────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", middot: "·", bull: "•",
  copy: "©", reg: "®", trade: "™", deg: "°", times: "×", eacute: "é", egrave: "è", iexcl: "¡", iquest: "¿",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Collapses runs of spaces and drops control characters, keeping the text itself. */
function cleanLine(line: string): string {
  return line.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​﻿]/g, "").replace(/[ \t ]+/g, " ").trim();
}

/**
 * Chapter HTML as plain paragraphs. Only text survives: scripts, styles and every
 * tag are removed (nothing from the source is ever rendered as markup), block
 * ends and line breaks become paragraph breaks.
 */
export function htmlToParagraphs(html: string): string[] {
  const text = html
    .replace(/<(script|style|noscript|iframe|template|svg)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|section|article|tr)\s*>/gi, "\n")
    .replace(/<hr\b[^>]*>/gi, "\n* * *\n")
    .replace(/<[^>]*>/g, "");
  return textToParagraphs(decodeEntities(text));
}

/** Plain chapter text (one paragraph per line) as paragraphs. */
export function textToParagraphs(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = cleanLine(raw);
    if (line) out.push(line);
    if (out.length >= NOVEL_MAX_PARAGRAPHS) break;
  }
  return out;
}

/** Strips a chapter's leading heading when it only repeats the label ("Chapter 12"). */
export function dropRepeatedHeading(paragraphs: string[], label: string): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (paragraphs.length > 1 && norm(paragraphs[0]) === norm(label)) return paragraphs.slice(1);
  return paragraphs;
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown, max = 500): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const num = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const time = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
};

function publishStatus(value: unknown): NovelPublishStatus {
  const s = typeof value === "string" ? value.toLowerCase().replace(/[^a-z]/g, "") : "";
  if (s === "ongoing" || s === "releasing" || s === "publishing") return "ongoing";
  if (s === "completed" || s === "complete" || s === "finished") return "completed";
  return null;
}

/** HTTPS image URLs only (relative ones resolved against [base]); anything else is dropped. */
function imageUrl(value: unknown, base: string): string | null {
  const raw = str(value, 2048);
  if (!raw) return null;
  try {
    const url = new URL(raw, base);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function unique(values: (string | null)[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

// ── NovelBuddy (api.novelbuddy.me) ────────────────────────────────────────────

export const NOVELBUDDY = {
  API: "https://api.novelbuddy.me",
  SITE: "https://novelbuddy.me",
  HOSTS: ["api.novelbuddy.me"],
};

const NB_SORT: Record<NovelSort, string> = { popular: "views", favourites: "bookmarks", rating: "rating", latest: "latest", newest: "newest" };

export function novelBuddySearchUrl(filters: Omit<NovelSearchFilters, "sourceId">, limit = 24): string {
  const params = new URLSearchParams();
  const query = filters.query?.trim();
  if (query) params.set("q", query.slice(0, 120));
  if (filters.genre) params.set("genres", filters.genre.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  if (filters.status) params.set("status", filters.status);
  if (filters.sort && !query) params.set("sort", NB_SORT[filters.sort]);
  else if (!query) params.set("sort", "views");
  params.set("page", String(Math.max(1, Math.min(500, Math.floor(filters.page ?? 1)))));
  params.set("limit", String(limit));
  return `${NOVELBUDDY.API}/titles/search?${params}`;
}

export const novelBuddyHomeUrl = () => `${NOVELBUDDY.API}/titles/home`;
export const novelBuddyTitleUrl = (id: string) => `${NOVELBUDDY.API}/titles/${encodeURIComponent(id)}`;
export const novelBuddyChaptersUrl = (id: string) => `${NOVELBUDDY.API}/titles/${encodeURIComponent(id)}/chapters`;
export const novelBuddyChapterUrl = (titleId: string, chapterId: string) =>
  `${NOVELBUDDY.API}/titles/${encodeURIComponent(titleId)}/chapters/${encodeURIComponent(chapterId)}`;

function nbData(json: unknown): Json {
  const root = obj(json);
  if (!root || root.success === false) throw new Error(str(root?.message, 200) ?? "NovelBuddy sent an error.");
  return obj(root.data) ?? {};
}

function nbCard(value: unknown): NovelCard | null {
  const o = obj(value);
  const id = str(o?.id, 40);
  const title = str(o?.name, 300);
  if (!o || !id || !title || !NB_ID.test(id)) return null;
  const stats = obj(o.stats);
  const mtl = o.is_mtl === true || /^mtl\s*-/i.test(title);
  return {
    sourceId: "novelbuddy",
    id,
    title,
    cover: imageUrl(o.cover, NOVELBUDDY.SITE),
    status: publishStatus(o.status),
    chapters: num(stats?.chapters_count),
    rating: (() => { const r = num(o.rating_avg ?? o.rating); return r && r > 0 ? Math.min(5, r) : null; })(),
    genres: unique(
      arr(o.genres).length
        ? arr(o.genres).map((g) => str(obj(g)?.name, 40))
        : (typeof o.genre_slugs === "string" ? o.genre_slugs.split(",") : arr(o.genre_slugs))
          .map((g) => { const slug = str(g, 40); return slug ? slug[0].toUpperCase() + slug.slice(1).replace(/-/g, " ") : null; }),
      12,
    ),
    mtl,
    synopsis: plainText(o.summary, 600),
  };
}

/** A blurb as plain text (sources send HTML or text), cut to [max] characters. */
function plainText(value: unknown, max: number): string | null {
  const raw = str(value, 20_000);
  if (!raw) return null;
  const text = htmlToParagraphs(raw).join("\n").trim();
  return text ? (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text) : null;
}

const cards = (values: unknown[], parse: (v: unknown) => NovelCard | null) =>
  values.map(parse).filter((c): c is NovelCard => !!c);

export function novelBuddySearch(json: unknown): NovelSearchPage {
  const data = nbData(json);
  const pagination = obj(data.pagination);
  return { items: cards(arr(data.items), nbCard), hasNextPage: pagination?.has_next === true };
}

export function novelBuddyHome(json: unknown): Omit<NovelHome, "completed" | "favourites"> {
  const data = nbData(json);
  const human = (list: NovelCard[]) => list.filter((c) => !c.mtl);
  return {
    trending: human(cards(arr(data.trending), nbCard)),
    popular: human(cards(arr(data.popular), nbCard)),
    latest: human(cards(arr(obj(data.latest)?.items), nbCard)),
  };
}

export function novelBuddyDetail(json: unknown): NovelDetail {
  const data = nbData(json);
  const t = obj(data.title) ?? data;
  const card = nbCard(t);
  if (!card) throw new Error("NovelBuddy doesn't have this title.");
  const slug = str(t.slug, 200);
  // The detail embeds only the newest chapters: the count comes from its stats.
  const newest = obj(arr(t.latest_chapters)[0]) ?? obj(arr(t.chapters)[0]);
  const count = card.chapters ?? num(obj(arr(t.chapters)[0])?.number);
  return {
    ...card,
    author: unique(arr(t.authors).map((a) => str(obj(a)?.name, 120)), 4).join(", ") || null,
    altNames: unique(arr(t.alt_names).flatMap((a) => (str(obj(a)?.name, 300) ?? "").split(",").map((s) => s.trim())), 8)
      .filter((n) => n.toLowerCase() !== card.title.toLowerCase()),
    synopsis: plainText(t.summary, 6000),
    url: slug ? `${NOVELBUDDY.SITE}/${encodeURIComponent(slug)}` : NOVELBUDDY.SITE,
    latest: count ? { count, label: str(newest?.name, 200), at: time(newest?.updated_at) ?? time(t.updated_at) } : null,
  };
}

/** The full chapter list (the API sends it newest first) in reading order. */
export function novelBuddyChapters(json: unknown): NovelChapter[] {
  const data = nbData(json);
  const rows = arr(data.chapters)
    .map((value) => {
      const o = obj(value);
      const id = str(o?.id, 40);
      if (!o || !id || !NB_ID.test(id)) return null;
      return { id, position: num(o.number), label: str(o.name, 200) ?? "Chapter", updatedAt: time(o.updated_at) };
    })
    .filter((c): c is { id: string; position: number | null; label: string; updatedAt: number | null } => !!c)
    .slice(0, NOVEL_MAX_CHAPTERS);
  // The API's "number" is a position, not the printed chapter number; sort by it when
  // every row has one, otherwise trust the (reversed) feed order.
  const positioned = rows.every((r) => r.position != null);
  const ordered = positioned ? [...rows].sort((a, b) => a.position! - b.position!) : [...rows].reverse();
  const seen = new Set<string>();
  const out: NovelChapter[] = [];
  for (const row of ordered) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ id: row.id, order: out.length, label: row.label, updatedAt: row.updatedAt });
  }
  return out;
}

export function novelBuddyChapterText(json: unknown): NovelChapterText {
  const data = nbData(json);
  const chapter = obj(data.chapter);
  const id = str(chapter?.id, 40);
  const content = typeof chapter?.content === "string" ? chapter.content : null;
  if (!chapter || !id || content == null) throw new Error("NovelBuddy sent this chapter without its text.");
  const label = str(chapter.name, 200) ?? "Chapter";
  return { id, label, paragraphs: dropRepeatedHeading(htmlToParagraphs(content), label) };
}

// ── NovelArchive (novelarchive.cc) ────────────────────────────────────────────

export const NOVELARCHIVE = {
  ORIGIN: "https://novelarchive.cc",
  HOSTS: ["novelarchive.cc"],
};

// NovelArchive sorts by recent, popular, rating or chapters only (anything else falls back to recent).
const NA_SORT: Record<NovelSort, string> = { popular: "popular", favourites: "popular", rating: "rating", latest: "recent", newest: "recent" };

export function novelArchiveSearchUrl(filters: Omit<NovelSearchFilters, "sourceId">, limit = 24): string {
  const params = new URLSearchParams();
  const query = filters.query?.trim();
  if (query) {
    params.set("search", query.slice(0, 120));
    params.set("fuzzy", "1");
  }
  if (filters.genre) params.set("genres_include", filters.genre);
  if (filters.status) params.set("status", filters.status);
  if (!query) params.set("sort", NA_SORT[filters.sort ?? "popular"]);
  params.set("ai_generated", "exclude");
  params.set("page", String(Math.max(1, Math.min(500, Math.floor(filters.page ?? 1)))));
  params.set("limit", String(limit));
  return `${NOVELARCHIVE.ORIGIN}/api/novels?${params}`;
}

export const novelArchiveTitleUrl = (id: string) => `${NOVELARCHIVE.ORIGIN}/api/novels/${encodeURIComponent(id)}`;
export const novelArchiveChapterUrl = (titleId: string, position: string) =>
  `${NOVELARCHIVE.ORIGIN}/api/novels/${encodeURIComponent(titleId)}/chapters/${encodeURIComponent(position)}?prefetch=1`;

function naCard(value: unknown): NovelCard | null {
  const o = obj(value);
  const id = str(o?.id, 40);
  const title = str(o?.title, 300);
  if (!o || !id || !title || !NA_ID.test(id)) return null;
  const genres = typeof o.genres === "string" ? o.genres.split(",").map((g) => g.trim()) : arr(o.genres).map((g) => str(g, 40));
  const rating = num(o.rating);
  return {
    sourceId: "novelarchive",
    id,
    title,
    cover: imageUrl(o.cover_url ?? o.novel_image ?? o.image_url, NOVELARCHIVE.ORIGIN),
    status: publishStatus(o.release_status ?? o.ongoing),
    chapters: num(o.total_chapters),
    rating: rating && rating > 0 && num(o.rating_count) ? Math.min(5, rating) : null,
    genres: unique(genres.map((g) => (g ? g.slice(0, 40) : null)), 12),
    mtl: /^mtl\s*-/i.test(title),
    synopsis: plainText(o.description, 600),
  };
}

export function novelArchiveSearch(json: unknown): NovelSearchPage {
  const root = obj(json);
  if (!root || !Array.isArray(root.novels)) throw new Error("NovelArchive sent a response AniTrack couldn't read.");
  return { items: cards(root.novels, naCard), hasNextPage: obj(root.pagination)?.has_next === true };
}

export function novelArchiveDetail(json: unknown): NovelDetail {
  const novel = obj(obj(json)?.novel);
  const card = novel ? naCard(novel) : null;
  if (!novel || !card) throw new Error("NovelArchive doesn't have this title.");
  const names = arr(novel.chapter_names);
  const count = names.length || card.chapters;
  return {
    ...card,
    chapters: count,
    author: str(novel.author, 200),
    altNames: unique(arr(novel.associated_names).map((n) => str(n, 300)), 8),
    synopsis: plainText(novel.description, 6000),
    url: `${NOVELARCHIVE.ORIGIN}/novel?id=${encodeURIComponent(card.id)}`,
    latest: count ? { count, label: str(names.at(-1), 200), at: time(novel.updated_at) } : null,
  };
}

/**
 * NovelArchive requests a chapter by its 1-based position in `chapter_names`, so
 * the id is that position; the label is only shown (it can skip or repeat numbers).
 */
export function novelArchiveChapters(json: unknown): NovelChapter[] {
  const novel = obj(obj(json)?.novel);
  if (!novel) throw new Error("NovelArchive doesn't have this title.");
  return arr(novel.chapter_names)
    .slice(0, NOVEL_MAX_CHAPTERS)
    .map((name, index) => ({ id: String(index + 1), order: index, label: str(name, 200) ?? `Chapter ${index + 1}`, updatedAt: null }));
}

export function novelArchiveChapterText(json: unknown, position: string): NovelChapterText {
  const chapter = obj(obj(json)?.chapter);
  const content = typeof chapter?.content === "string" ? chapter.content : null;
  if (!chapter || content == null) throw new Error("NovelArchive sent this chapter without its text.");
  const label = str(chapter.name, 200) ?? `Chapter ${position}`;
  // The text is plain, but strip any markup that slips in rather than show it.
  const paragraphs = /<\/?(p|br|div)\b/i.test(content) ? htmlToParagraphs(content) : textToParagraphs(decodeEntities(content));
  return { id: position, label, paragraphs: dropRepeatedHeading(paragraphs, label) };
}

// ── Novel Phoenix (novelphoenix.com, NovelFire's library) ─────────────────────

/*
 * Novel Phoenix has no JSON API: search, browse, title, chapter-list and chapter
 * pages are server-rendered HTML, read here with small patterns (no markup is
 * ever rendered). A title's id is the slug of its address; a chapter is requested
 * by its 1-based position (`/chapter-<n>`), and its label is only shown. Chapter
 * lists come 100 to a page.
 */
export const NOVELPHOENIX = {
  ORIGIN: "https://novelphoenix.com",
  HOSTS: ["novelphoenix.com"],
  CHAPTERS_PER_PAGE: 100,
};

// The site sorts by popular, new or latest release only (anything else falls back to new).
const NP_SORT: Record<NovelSort, string> = { popular: "popular", favourites: "popular", rating: "popular", latest: "latest-release", newest: "new" };

/** A search by name, or (without a query) a browse by genre, status and sort. */
export function novelPhoenixSearchUrl(filters: Omit<NovelSearchFilters, "sourceId">): string {
  const page = Math.max(1, Math.min(500, Math.floor(filters.page ?? 1)));
  const query = filters.query?.trim();
  if (query) return `${NOVELPHOENIX.ORIGIN}/search?${new URLSearchParams({ keyword: query.slice(0, 120), page: String(page) })}`;
  const genre = filters.genre ? filters.genre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : "";
  return `${NOVELPHOENIX.ORIGIN}/genre-${genre || "all"}/sort-${NP_SORT[filters.sort ?? "popular"]}/status-${filters.status ?? "all"}/all-novel?page=${page}`;
}

export const novelPhoenixTitleUrl = (id: string) => `${NOVELPHOENIX.ORIGIN}/novel/${encodeURIComponent(id)}`;
export const novelPhoenixChaptersUrl = (id: string, page: number) =>
  `${NOVELPHOENIX.ORIGIN}/novel/${encodeURIComponent(id)}/chapters?page=${Math.max(1, Math.floor(page))}`;
export const novelPhoenixChapterUrl = (titleId: string, position: string) =>
  `${NOVELPHOENIX.ORIGIN}/novel/${encodeURIComponent(titleId)}/chapter-${encodeURIComponent(position)}`;

/** A fragment's text: tags dropped, entities decoded, spaces collapsed. */
const fragmentText = (html: string | null | undefined, max = 300): string | null =>
  html == null ? null : str(cleanLine(decodeEntities(html.replace(/<[^>]*>/g, " "))), max);

const wholeNumber = (value: string | null | undefined): number | null => {
  const n = value == null ? NaN : Number(value.replace(/,/g, ""));
  return Number.isInteger(n) && n >= 0 ? n : null;
};

const TIME_UNITS: Record<string, number> = {
  second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000, year: 365 * 86_400_000,
};

/** "13 hours ago" (or a date) as a time, counted back from [now]; null when it isn't one. */
export function relativeTime(text: string | null | undefined, now: number): number | null {
  if (!text) return null;
  const m = text.toLowerCase().match(/\b(\d{1,4}|an?)\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/);
  if (m) return now - (m[1][0] === "a" ? 1 : Number(m[1])) * TIME_UNITS[m[2]];
  return /\d{4}/.test(text) ? time(text.trim()) : null;
}

function npCard(chunk: string): NovelCard | null {
  const id = chunk.match(/href="(?:https:\/\/novelphoenix\.com)?\/novel\/([a-z0-9][a-z0-9-]*)"/)?.[1];
  const title = fragmentText(chunk.match(/<h[1-6] class="(?:novel-)?title[^"]*">([\s\S]*?)<\/h[1-6]>/)?.[1])
    ?? fragmentText(chunk.match(/<a title="([^"]*)"/)?.[1]);
  if (!id || !title || !NP_ID.test(id)) return null;
  const rating = Number(chunk.match(/icon-star"><\/i>\s*([0-5](?:\.\d+)?)/)?.[1]);
  return {
    sourceId: "novelphoenix",
    id,
    title,
    // Covers are lazy-loaded: the real address is in data-src, with a blank image in src.
    cover: imageUrl(chunk.match(/<img[^>]*\sdata-src="([^"]+)"/)?.[1] ?? chunk.match(/<img[^>]*\ssrc="(?!data:)([^"]+)"/)?.[1], NOVELPHOENIX.ORIGIN),
    // "Ch. 3242 · Ongoing" (search results); browse cards don't say.
    status: publishStatus(chunk.match(/(?:·|&middot;)\s*(Ongoing|Completed)\b/i)?.[1]),
    chapters: wholeNumber(chunk.match(/\bCh\.\s*([\d,]+)/)?.[1] ?? chunk.match(/([\d,]+)\s*Chapters\b/i)?.[1]),
    rating: rating > 0 ? Math.min(5, rating) : null,
    genres: [],
    mtl: false,
    synopsis: null,
  };
}

/** A search or browse page: its first list holds the results (later ones are suggestions). */
export function novelPhoenixSearch(html: string, page = 1): NovelSearchPage {
  const start = html.indexOf('<ul class="novel-list');
  if (start < 0) throw new Error("Novel Phoenix sent a page AniTrack couldn't read.");
  const end = html.indexOf("</ul>", start);
  const items = html.slice(start, end < 0 ? html.length : end).split('<li class="novel-item"').slice(1).map(npCard).filter((c): c is NovelCard => !!c);
  return { items, hasNextPage: new RegExp(`[?&](?:amp;)?page=${Math.floor(page) + 1}"`).test(html) };
}

export function novelPhoenixDetail(html: string, id: string, now: number): NovelDetail {
  const title = fragmentText(html.match(/<h1 class="novel-title[^"]*">([\s\S]*?)<\/h1>/)?.[1]);
  if (!title || !NP_ID.test(id)) throw new Error("Novel Phoenix doesn't have this title.");
  const authors = html.match(/<div class="author">([\s\S]*?)<\/div>/)?.[1] ?? "";
  const genres = html.match(/<div class="categories">([\s\S]*?)<\/ul>/)?.[1] ?? "";
  const summary = html.match(/<div class="summary">[\s\S]*?<div class="content[^"]*">([\s\S]*?)(?:<div class="expand">|<\/div>\s*<\/div>)/)?.[1];
  const rating = Number(html.match(/class="my-rating" data-rating="([0-5](?:\.\d+)?)"/)?.[1]);
  const chapters = wholeNumber(html.match(/icon-book-open"><\/i>\s*([\d,]+)/)?.[1]);
  const latest = html.match(/chapter-latest-container[\s\S]*?<p class="latest[^"]*">([\s\S]*?)<\/p>\s*<p class="update">([\s\S]*?)<\/p>/);
  return {
    sourceId: "novelphoenix",
    id,
    title,
    cover: imageUrl(html.match(/<figure class="cover">\s*<img[^>]*\s(?:data-)?src="(?!data:)([^"]+)"/)?.[1], NOVELPHOENIX.ORIGIN),
    status: publishStatus(html.match(/<strong class="(ongoing|completed)">/i)?.[1]),
    chapters,
    rating: rating > 0 ? Math.min(5, rating) : null,
    genres: unique([...genres.matchAll(/class="property-item">([^<]*)<\/a>/g)].map((m) => fragmentText(m[1], 40)), 12),
    mtl: false,
    synopsis: summary ? plainText(summary, 6000) : null,
    author: unique([...authors.matchAll(/itemprop="author">([^<]*)</g)].map((m) => fragmentText(m[1], 120)), 4).join(", ") || null,
    altNames: [],
    url: novelPhoenixTitleUrl(id),
    latest: chapters ? { count: chapters, label: fragmentText(latest?.[1], 200), at: relativeTime(fragmentText(latest?.[2], 80), now) } : null,
  };
}

/** A chapter's label: the site's number with its title, or the title alone when it already says "Chapter N". */
function npChapterLabel(position: string, numberText: string | null, title: string | null): string {
  const number = numberText?.replace(/^ch(?:apter)?\.?\s*/i, "").trim() || position;
  if (!title) return `Chapter ${number}`;
  return (/^(?:chapter|chap|ch)\b\.?\s*\d/i.test(title) ? title : `Chapter ${number}: ${title}`).slice(0, 200);
}

export interface NovelPhoenixChapterPage {
  /** This page's chapters in reading order; the id is the position the site requests. */
  chapters: { id: string; label: string; updatedAt: number | null }[];
  /** How many pages the list has. */
  pages: number;
  /** How many chapters the title has in all, when the page says. */
  total: number | null;
}

/** One page (100 chapters) of a title's chapter list. */
export function novelPhoenixChapterPage(html: string, now: number): NovelPhoenixChapterPage {
  const start = html.indexOf('<ul class="chapter-list');
  if (start < 0) throw new Error("Novel Phoenix doesn't have this title's chapters.");
  const end = html.indexOf("</ul>", start);
  const chapters: NovelPhoenixChapterPage["chapters"] = [];
  for (const m of html.slice(start, end < 0 ? html.length : end).matchAll(/<a href="[^"]*\/chapter-([1-9][0-9]{0,5})"[^>]*>([\s\S]*?)<\/a>/g)) {
    const label = npChapterLabel(
      m[1],
      fragmentText(m[2].match(/class="chapter-no">([^<]*)</)?.[1], 40),
      fragmentText(m[2].match(/class="chapter-title">([\s\S]*?)<\/strong>/)?.[1], 200),
    );
    chapters.push({ id: m[1], label, updatedAt: relativeTime(fragmentText(m[2].match(/class="chapter-update"[^>]*>([^<]*)</)?.[1], 80), now) });
  }
  let pages = 1;
  for (const m of html.matchAll(/\/chapters\?page=(\d{1,4})\b/g)) pages = Math.max(pages, Number(m[1]));
  const total = wholeNumber(html.match(/id="gotochapno"[^>]*\smax="(\d{1,6})"/)?.[1] ?? html.match(/A total of ([\d,]+) chapters/)?.[1]);
  return { chapters, pages: Math.min(pages, Math.ceil(NOVEL_MAX_CHAPTERS / NOVELPHOENIX.CHAPTERS_PER_PAGE)), total };
}

/**
 * The whole list while some of its pages are still unread: a chapter on an unread
 * page stands in as "Chapter N". Chapters are requested by position, so every one
 * can be opened already; only its name is missing.
 */
export function novelPhoenixProvisional(total: number, pages: Iterable<NovelPhoenixChapterPage["chapters"]>): NovelChapter[] {
  const known = new Map<string, NovelPhoenixChapterPage["chapters"][number]>();
  for (const rows of pages) for (const row of rows) known.set(row.id, row);
  const count = Math.min(Math.max(0, Math.floor(total)), NOVEL_MAX_CHAPTERS);
  return Array.from({ length: count }, (_, i) => {
    const row = known.get(String(i + 1));
    return { id: String(i + 1), order: i, label: row?.label ?? `Chapter ${i + 1}`, updatedAt: row?.updatedAt ?? null };
  });
}

/** A title's chapter-list pages (in page order) as one list in reading order. */
export function novelPhoenixChapters(pages: NovelPhoenixChapterPage["chapters"][]): NovelChapter[] {
  const seen = new Set<string>();
  const out: NovelChapter[] = [];
  for (const row of pages.flat()) {
    if (seen.has(row.id) || out.length >= NOVEL_MAX_CHAPTERS) continue;
    seen.add(row.id);
    out.push({ id: row.id, order: out.length, label: row.label, updatedAt: row.updatedAt });
  }
  return out;
}

/** Where the `<div>` opened just before [from] closes (nested ones skipped); the end of the text when it never does. */
function closingDiv(html: string, from: number): number {
  const tags = /<(\/?)div\b/gi;
  tags.lastIndex = from;
  let depth = 1;
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index;
  }
  return html.length;
}

export function novelPhoenixChapterText(html: string, position: string): NovelChapterText {
  // The "chapter not found" page has a #content block too (its layout's), without a chapter id.
  const open = html.match(/<div id="content"[^>]*\sdata-chapter-id="\d+"[^>]*>/);
  if (!open || open.index == null) {
    throw new Error(/<title>[^<]*Not Found/i.test(html) ? "Novel Phoenix doesn't have this chapter." : "Novel Phoenix sent this chapter without its text.");
  }
  const from = open.index + open[0].length;
  const label = fragmentText(html.match(/<span class="chapter-title">([\s\S]*?)<\/span>/)?.[1], 200) ?? `Chapter ${position}`;
  return { id: position, label, paragraphs: dropRepeatedHeading(htmlToParagraphs(html.slice(from, closingDiv(html, from))), label) };
}

// ── Matching across sources ───────────────────────────────────────────────────

const normal = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/\(web novel\)|\(wn\)|\(ln\)|\(light novel\)/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Whether two author lines name the same person; null when either is missing. */
export function authorsMatch(a: string | null, b: string | null): boolean | null {
  if (!a?.trim() || !b?.trim()) return null;
  const parts = (s: string) => s.split(/[/,&;|]|\band\b/i).map(normal).filter((p) => p.length >= 2);
  const pa = parts(a);
  const pb = parts(b);
  return pa.some((x) => pb.some((y) => x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)))));
}

type Identity = { title: string; altNames: string[]; author: string | null };

/**
 * Whether two source copies are the same novel. "yes" needs a shared name and the
 * same author; "maybe" is the same main title where one source names no author;
 * anything else is "no" (the user can still link them by hand).
 */
export function sameNovel(a: Identity, b: Identity): "yes" | "maybe" | "no" {
  const names = (x: Identity) => new Set([x.title, ...x.altNames].map(normal).filter((n) => n.length >= 2));
  const na = names(a);
  const nb = names(b);
  const strong = na.has(normal(b.title)) || nb.has(normal(a.title));
  const weak = !strong && [...na].some((n) => n.length >= 3 && nb.has(n));
  if (!strong && !weak) return "no";
  const authors = authorsMatch(a.author, b.author);
  if (authors === true) return "yes";
  return authors === null && strong ? "maybe" : "no";
}

/** Candidates on another source for [title], best first: exact name matches, then the source's order. */
export function rankNovelMatches(title: string, altNames: string[], candidates: NovelCard[]): NovelCard[] {
  const names = new Set([title, ...altNames].map(normal).filter(Boolean));
  const score = (c: NovelCard) => (names.has(normal(c.title)) ? 2 : normal(c.title).includes(normal(title)) ? 1 : 0);
  return candidates
    .filter((c) => !c.mtl)
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}
