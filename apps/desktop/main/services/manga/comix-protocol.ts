import type { MangaChapter, MangaPageImage, SourceDetail } from "../../../../../packages/shared/manga";

export const COMIX_ORIGIN = "https://comix.to";
export const COMIX_MAX_RESPONSE = 200_000;
export type ComixParams = Record<string, string | number>;
/**
 * Comix rate-limits by rows served: on 2026-10-14 a sixth 20-row chapter page within
 * ~2 s (or a second 100-row page) got HTTP 502 with Retry-After: 60, while 20-row
 * pages ~1.9 s apart passed 60 times in a row. Chapter pages are paced to that.
 */
export const COMIX_CHAPTER_PAGE_INTERVAL_MS = 2_000;
/** A whole paced traversal: the 200-page cap at the interval, plus the reads. */
export const COMIX_CHAPTER_LIST_DEADLINE_MS = 480_000;
const RATE_LIMIT_STATUSES = new Set([429, 502, 503]);

/** How long to stop asking after a rate-limit answer, or null when it isn't one. Bounded to 1 s–5 min. */
export function comixRetryAfterMs(status: number, header: string | null | undefined, now = Date.now()): number | null {
  if (!RATE_LIMIT_STATUSES.has(status) || typeof header !== "string" || !header.trim()) return null;
  const value = header.trim();
  const ms = /^\d{1,6}$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.min(300_000, Math.max(1_000, ms)) : null;
}

export const comixIsChapterList = (path: string): boolean => MANGA_CHAPTERS.test(path);

const HID = /^[a-zA-Z0-9]{1,32}$/;
const CHAPTER_ID = /^[0-9]{1,15}$/;
const MANGA_DETAIL = /^\/manga\/[a-zA-Z0-9]{1,32}$/;
const MANGA_CHAPTERS = /^\/manga\/[a-zA-Z0-9]{1,32}\/chapters$/;
const CHAPTER_DETAIL = /^\/chapters\/[0-9]{1,15}$/;
const PUBLIC_TITLE_PAGE = /^\/title\/[a-zA-Z0-9]{1,32}(?:-[a-zA-Z0-9-]{1,200})?$/;
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".localdomain"];
const LANGUAGE_COUNTRY: Record<string, string> = {
  ja: "JP", jp: "JP", ko: "KR", kr: "KR", zh: "CN", cn: "CN", "zh-cn": "CN", "zh-hk": "CN", "zh-tw": "TW",
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

function text(value: unknown, limit: number): string | null {
  return typeof value === "string" && value.trim() && value.trim() !== "null" ? value.trim().slice(0, limit) : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !/^[0-9]+(?:\.[0-9]+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value: unknown, min: number, max: number): number | null {
  const number = numeric(value);
  return number !== null && Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

/** Public catalogue operations only; neither account calls nor arbitrary parameters cross the session boundary. */
export function comixValidRequest(path: string, params: ComixParams): boolean {
  const value = record(params);
  if (!value || typeof path !== "string") return false;
  if (path === "/manga") {
    return exactKeys(value, ["keyword", "page", "limit", "order[relevance]"])
      && typeof value.keyword === "string" && value.keyword.length >= 1 && value.keyword.length <= 200
      && integer(value.page, 1, 1) === 1 && integer(value.limit, 20, 20) === 20 && value["order[relevance]"] === "desc";
  }
  if (MANGA_CHAPTERS.test(path)) {
    return exactKeys(value, ["page", "limit", "order[number]"])
      && integer(value.page, 1, 200) !== null && integer(value.limit, 100, 100) === 100 && value["order[number]"] === "asc";
  }
  return (MANGA_DETAIL.test(path) || CHAPTER_DETAIL.test(path)) && exactKeys(value, []);
}

/** Syntax check only. Native image transport must separately reject private DNS answers. */
function publicImageUrl(raw: string): URL | null {
  if (typeof raw !== "string" || !raw || raw.length > 4096 || /[\u0000-\u0020\u007f\\#]/.test(raw) || /^https:\/\/[^/]*@/i.test(raw)) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hash
      || !host.includes(".") || /^[0-9.]+$/.test(host) || host.includes(":") || host === "localhost"
      || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
    return url;
  } catch { return null; }
}

/** Do not let URL normalization disguise encoded or traversing website paths. */
function websiteUrl(raw: string): URL | null {
  const url = publicImageUrl(raw);
  if (!url) return null;
  const rawPath = /^https:\/\/[^/?#]+([^?#]*)/i.exec(raw)?.[1] || "/";
  if (rawPath.includes("%") || rawPath.includes("//") || rawPath.split("/").some((part) => part === "." || part === "..")) return null;
  return url;
}

function publicPage(path: string): boolean {
  return path === "/" || path === "/browse" || PUBLIC_TITLE_PAGE.test(path);
}

/** Normal pages a user may browse while connecting; never account or website reader routes. */
export function comixPublicConnectionPage(raw: string): boolean {
  const url = websiteUrl(raw);
  return !!url && url.origin === COMIX_ORIGIN && publicPage(url.pathname);
}

/** Same-origin catalogue/assets, with user-operated challenge resources enabled only while connecting. */
export function comixNetworkAllowed(raw: string, method: string, isMainFrame: boolean, connecting: boolean): boolean {
  const url = publicImageUrl(raw);
  if (!url || !["GET", "POST"].includes(method)) return false;
  if (url.origin === "https://challenges.cloudflare.com") return connecting && !isMainFrame;
  if (url.origin !== COMIX_ORIGIN || !websiteUrl(raw)) return false;
  // These are the ordinary site's manual image-check endpoints, not a solver.
  if (url.pathname === "/@waf/challenge") return connecting && method === "GET";
  if (url.pathname === "/@waf/generate") return connecting && !isMainFrame && method === "GET";
  if (url.pathname === "/@waf/verify") return connecting && !isMainFrame && method === "POST";
  // Comix's normal title links fetch page HTML before updating browser history.
  if (connecting && method === "GET" && publicPage(url.pathname)) return true;
  // Cloudflare's full-page check ("Just a moment...") returns to the homepage with a
  // document POST once the user completes it in the visible window. Permit only that
  // navigation while connecting (as on Android); it never submits a check itself.
  if (connecting && isMainFrame && method === "POST" && url.pathname === "/") return true;
  if (isMainFrame) return method === "GET" && (url.pathname === "/" || (connecting && publicPage(url.pathname)));
  if (url.pathname.startsWith("/cdn-cgi/challenge-platform/")) return connecting;
  if (method !== "GET") return false;
  if (url.pathname.startsWith("/assets/") || url.pathname === "/favicon.ico") return true;
  if (!url.pathname.startsWith("/api/v1/")) return false;
  const path = url.pathname.slice("/api/v1".length);
  // The visible website title page unconditionally reads its public group filters.
  // Keep this out of hidden catalogue reads and the native transport contract.
  if (/^\/manga\/[a-zA-Z0-9]{1,32}\/groups$/.test(path)) return connecting && !raw.includes("?");
  return path === "/manga" || MANGA_DETAIL.test(path) || MANGA_CHAPTERS.test(path) || CHAPTER_DETAIL.test(path);
}

function items(payload: unknown): unknown[] {
  const value = record(payload)?.items;
  if (!Array.isArray(value)) throw new Error("Comix changed its catalogue format.");
  return value;
}

export function comixSearchIds(payload: unknown): string[] {
  const seen = new Set<string>();
  for (const value of items(payload).slice(0, 20)) {
    const hid = record(value)?.hid;
    if (typeof hid === "string" && HID.test(hid)) seen.add(hid);
  }
  return [...seen];
}

function tracker(value: unknown, host: string): number | null {
  if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u0020\\]/.test(value) || /^https:\/\/[^/]*@/i.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== host || url.username || url.password || (url.port && url.port !== "443")) return null;
    const match = /^\/manga\/([0-9]+)(?:\/.*)?$/.exec(url.pathname);
    return match ? integer(match[1], 1, 2_147_483_647) : null;
  } catch { return null; }
}

/** Never fill unknown year/country from the requested AniList title: a same-name match needs genuine source metadata. */
export function comixDetail(payload: unknown, expectedId?: string): SourceDetail | null {
  const value = record(payload);
  const id = value?.hid;
  const title = text(value?.title, 300);
  if (!value || typeof id !== "string" || !HID.test(id) || !title || (expectedId !== undefined && id !== expectedId)) return null;
  const links = record(value.links);
  const year = typeof value.year === "number" ? integer(value.year, 1000, 2100) : null;
  const language = typeof value.originalLanguage === "string" ? value.originalLanguage.toLowerCase() : "";
  const latest = numeric(value.latestChapter);
  return {
    id, title,
    altTitles: Array.isArray(value.altTitles) ? value.altTitles.slice(0, 100).map((name) => text(name, 300)).filter((name): name is string => !!name) : [],
    anilistId: tracker(links?.al, "anilist.co"),
    malId: tracker(links?.mal, "myanimelist.net"),
    year,
    country: Object.hasOwn(LANGUAGE_COUNTRY, language) ? LANGUAGE_COUNTRY[language] : null,
    adult: value.is18plus === true,
    latestChapter: latest !== null && latest >= 0 && latest < 100_000 ? latest : null,
    latestAt: null,
  };
}

export function comixChapters(payload: unknown): MangaChapter[] {
  const rows = items(payload);
  if (rows.length > 100) throw new Error("Comix returned too many chapters in one page.");
  const chapters: MangaChapter[] = [];
  for (const raw of rows) {
    const value = record(raw);
    const id = typeof value?.id === "string" ? value.id : typeof value?.id === "number" && Number.isSafeInteger(value.id) ? String(value.id) : "";
    const number = numeric(value?.number);
    if (!value || !CHAPTER_ID.test(id) || number === null || number < 0 || number >= 100_000) continue;
    chapters.push({
      id, number, title: text(value.name, 300), group: text(record(value.group)?.name, 120), pageCount: null, uploadedAt: null,
    });
  }
  return chapters;
}

/** Missing/contradictory pagination must fail, rather than pretending the first page is the whole title. */
export function comixHasNext(payload: unknown, page: number): boolean {
  if (!Number.isInteger(page) || page < 1 || page > 200) throw new Error("Invalid Comix chapter page.");
  const root = record(payload);
  const meta = record(root?.pagination) ?? record(root?.meta);
  if (!meta) throw new Error("Comix omitted chapter pagination; refusing a partial list.");
  for (const key of ["page", "current_page"]) {
    if (key in meta && integer(meta[key], 1, 200) !== page) throw new Error("Comix repeated a chapter page.");
  }
  const lastKey = "lastPage" in meta ? "lastPage" : "last_page" in meta ? "last_page" : null;
  const last = lastKey ? integer(meta[lastKey], page, 200) : null;
  if (lastKey && last === null) throw new Error("Comix changed its chapter pagination.");
  if ("hasNext" in meta && typeof meta.hasNext !== "boolean") throw new Error("Comix changed its chapter pagination.");
  if (last !== null) {
    const next = page < last;
    if ("hasNext" in meta && meta.hasNext !== next) throw new Error("Comix returned conflicting chapter pagination.");
    return next;
  }
  if (typeof meta.hasNext === "boolean" && !(page === 200 && meta.hasNext)) return meta.hasNext;
  throw new Error("Comix changed its chapter pagination.");
}

export function comixPages(payload: unknown): MangaPageImage[] {
  const raw = Array.isArray(payload) ? payload : record(payload)?.pages;
  const wrapper = record(raw);
  const rows = Array.isArray(raw) ? raw : wrapper?.items;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) throw new Error("Comix returned an invalid page count.");
  const base = typeof wrapper?.baseUrl === "string" ? wrapper.baseUrl : "";
  return rows.map((rawRow) => {
    const row = record(rawRow);
    const path = typeof rawRow === "string" ? rawRow : row?.url;
    if (typeof path !== "string" || !path || /[\u0000-\u0020\\]/.test(path)) throw new Error("Invalid Comix image URL.");
    // baseUrl is a directory even when a page starts with '/'. Absolute URLs are independent of baseUrl.
    const absolute = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path);
    const baseUrl = absolute ? null : publicImageUrl(base);
    if (!absolute && (!baseUrl || baseUrl.search)) throw new Error("Invalid Comix image base URL.");
    const joined = absolute ? path : `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
    const url = publicImageUrl(joined);
    if (!url) throw new Error("Unsafe Comix image URL.");
    // Append a bare flag without re-encoding an existing (possibly signed) query string.
    const value = url.toString();
    const v3 = row?.s === 1 && !url.searchParams.has("v3") ? `${value}${url.search ? "&" : value.endsWith("?") ? "" : "?"}v3` : value;
    return { url: v3, width: integer(row?.width, 1, 20_000), height: integer(row?.height, 1, 20_000) };
  });
}
