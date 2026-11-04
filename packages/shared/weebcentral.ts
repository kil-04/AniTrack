/**
 * Weeb Central (weebcentral.com): a medium-large manga library with official
 * translations where they exist, plain HTTP and no browser check (checked 3 Nov 2026).
 * A series page (/series/<ULID>) links AniList, so AniTrack matches the exact manga.
 * Its full chapter list is one HTML fragment (/series/<ULID>/full-chapter-list, newest
 * first); a chapter's images come from /chapters/<ULID>/images, on the site's
 * *.planeptune.us, *.lastation.us and *.lowee.us hosts, which need no Referer.
 *
 * Mirrored in Kotlin by data/manga/weebcentral/WeebCentralParser.kt; keep the two identical.
 */
import type { MangaChapter, SourceDetail, SourceLatest } from "./manga";

export const WEEBCENTRAL = {
  ORIGIN: "https://weebcentral.com",
  HOSTS: ["weebcentral.com"],
};

/** Series and chapter ids are ULIDs: 26 Crockford base32 characters. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const IMAGE_HOST = /^(?:[a-z0-9-]{1,40}\.)?(?:planeptune|lastation|lowee|leanbox)\.us$/;

export const WEEBCENTRAL_MAX_CHAPTERS = 20_000;
export const WEEBCENTRAL_MAX_PAGES = 500;

export const isWeebCentralId = (value: string) => ULID.test(value);

export const weebCentralSearchUrl = (query: string) =>
  `${WEEBCENTRAL.ORIGIN}/search/data?author=&text=${encodeURIComponent(query.trim().slice(0, 120))}` +
  "&sort=Best+Match&order=Descending&official=Any&anime=Any&adult=Any&display_mode=Full+Display";
export const weebCentralSeriesUrl = (id: string) => `${WEEBCENTRAL.ORIGIN}/series/${id}`;
export const weebCentralChapterListUrl = (id: string) => `${WEEBCENTRAL.ORIGIN}/series/${id}/full-chapter-list`;
export const weebCentralImagesUrl = (chapterId: string) =>
  `${WEEBCENTRAL.ORIGIN}/chapters/${chapterId}/images?is_prev=False&current_page=1&reading_style=long_strip`;

/** A Weeb Central page image AniTrack may load: https on one of its image hosts, under /manga/. */
export function isWeebCentralImage(url: URL): boolean {
  return url.protocol === "https:" && (url.port === "" || url.port === "443") && !url.username &&
    IMAGE_HOST.test(url.hostname) && url.pathname.startsWith("/manga/") && !url.pathname.includes("..");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) => safeChar(parseInt(hex, 16)))
    .replace(/&#([0-9]{1,7});/g, (_, dec: string) => safeChar(parseInt(dec, 10)))
    .replace(/&([a-z]+|#39);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}
function safeChar(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
}
const strip = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** Series ids on a search page, in the site's order (first ones are the closest). */
export function weebCentralSearchIds(html: string, max = 5): string[] {
  const ids: string[] = [];
  for (const m of html.matchAll(/href="https:\/\/weebcentral\.com\/series\/([0-9A-HJKMNP-TV-Z]{26})(?:\/[^"]*)?"/g)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
    if (ids.length >= max) break;
  }
  return ids;
}

/**
 * A chapter label's number: "Chapter 1197", "Chapter 12.5", "Episode 40". Berserk's
 * opening arc is "Prologue 1" to "Prologue 16"; those file before chapter 1, as
 * 0.01 to 0.16 (the numbering MangaDex uses). Other labels give null.
 */
export function weebCentralChapterNumber(label: string): number | null {
  const m = /^\s*(chapter|episode|prologue)\s+([0-9]{1,5}(?:\.[0-9]{1,2})?)\s*$/i.exec(label);
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isFinite(n) || n < 0) return null;
  if (m[1].toLowerCase() !== "prologue") return n;
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n / 100 : null;
}

/**
 * A chapter label's title. Prologues keep their own name ("Prologue 10"), so a row
 * doesn't read "Chapter 0.1"; numbered chapters have none.
 */
export function weebCentralChapterTitle(label: string): string | null {
  const n = weebCentralChapterNumber(label);
  return n != null && /^\s*prologue\b/i.test(label) ? `Prologue ${Math.round(n * 100)}` : null;
}

const COUNTRIES: Record<string, string> = { manga: "JP", manhwa: "KR", manhua: "CN" };

/** The value of one "Label: value" row in a series page's facts list. */
function fact(html: string, label: string): string | null {
  const at = html.indexOf(`<strong>${label}:`);
  if (at < 0) return null;
  const end = html.indexOf("</li>", at);
  const row = html.slice(at, end < 0 ? at + 600 : Math.min(end, at + 2000));
  return strip(row.replace(/<strong>[\s\S]*?<\/strong>/, "")) || null;
}

/** One entry of a chapter list, wherever it appears (series page or full list). */
const CHAPTER_ENTRY = /<a href="\/chapters\/([0-9A-HJKMNP-TV-Z]{26})"[^>]*>([\s\S]{0,4000}?)<\/a>/g;

function entryChapter(id: string, body: string): MangaChapter | null {
  const label = /<span class="">([^<]{1,80})<\/span>/.exec(body);
  const text = label ? decode(label[1]) : "";
  const number = weebCentralChapterNumber(text);
  if (number == null) return null;
  const time = /<time\b[^>]*datetime="([^"]{10,40})"/.exec(body);
  const at = time ? Date.parse(time[1]) : NaN;
  return { id, number, title: weebCentralChapterTitle(text), group: null, pageCount: null, uploadedAt: Number.isFinite(at) ? at : null };
}

/** A series page as a [SourceDetail]: its AniList link decides matches. */
export function weebCentralDetail(html: string, id: string): SourceDetail | null {
  if (!isWeebCentralId(id)) return null;
  const heading = strip(/<h1\b[^>]*>([\s\S]{1,400}?)<\/h1>/.exec(html)?.[1] ?? "");
  if (!heading) return null;
  const anilist = /anilist\.co\/manga\/(\d{1,9})/.exec(html);
  const mal = /myanimelist\.net\/manga\/(\d{1,9})/.exec(html);
  const year = Number(fact(html, "Released"));
  const type = (fact(html, "Type") ?? "").toLowerCase();
  const latest = latestEntry(html);
  return {
    id,
    title: heading.slice(0, 300),
    altTitles: [],
    anilistId: anilist ? Number(anilist[1]) : null,
    malId: mal ? Number(mal[1]) : null,
    year: Number.isInteger(year) && year > 1900 && year < 2100 ? year : null,
    country: COUNTRIES[type] ?? null,
    // The site's "Adult Content" also marks violent seinen (Berserk). AniTrack only lists
    // AniList titles that aren't adult, so with an AniList link that rating decides;
    // without one, the site's flag keeps the title from matching.
    adult: !anilist && (fact(html, "Adult Content") ?? "").toLowerCase() === "yes",
    latestChapter: latest?.number ?? null,
    latestAt: latest?.uploadedAt ?? null,
  };
}

function latestEntry(html: string): MangaChapter | null {
  for (const m of html.matchAll(CHAPTER_ENTRY)) {
    const chapter = entryChapter(m[1], m[2]);
    if (chapter) return chapter;
  }
  return null;
}

/** The newest chapter a series page lists. */
export function weebCentralLatest(html: string): SourceLatest | null {
  const first = latestEntry(html);
  return first ? { chapter: first.number, at: first.uploadedAt } : null;
}

/** Every chapter in a full chapter list (newest first), skipping labels without a number. */
export function weebCentralChapters(html: string): MangaChapter[] {
  const out: MangaChapter[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(CHAPTER_ENTRY)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const chapter = entryChapter(m[1], m[2]);
    if (chapter) out.push(chapter);
    if (out.length >= WEEBCENTRAL_MAX_CHAPTERS) break;
  }
  return out;
}

/** A chapter's page images, in reading order. */
export function weebCentralPages(html: string): string[] {
  const urls: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*?\ssrc="(https:\/\/[^"\s]{10,400})"/g)) {
    try {
      const url = new URL(decode(m[1]));
      if (isWeebCentralImage(url) && !urls.includes(url.toString())) urls.push(url.toString());
    } catch { /* skipped */ }
    if (urls.length >= WEEBCENTRAL_MAX_PAGES) break;
  }
  return urls;
}
