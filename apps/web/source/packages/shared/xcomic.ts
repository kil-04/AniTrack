/**
 * XComic (xcomic.me): a very large manga aggregator, plain HTTP, no browser check
 * (checked 19 Oct 2026). A title page (/title/<id>) links AniList and MyAnimeList and
 * lists the title's *editions* (/source/<id>): each language/upload group's copy, with
 * its own chapter count. AniTrack reads the English edition with the most chapters.
 * An edition lists ~200 chapters per page (?page=N, newest first); a chapter page
 * carries its image URLs in the page's own state ("imageUrls"). Images load from
 * rotating iNN.imgNN.org hosts without a Referer.
 *
 * Mirrored in Kotlin by data/manga/xcomic/XComicParser.kt; keep the two identical.
 */
import type { MangaChapter, SourceDetail, SourceLatest } from "./manga";

export const XCOMIC = {
  ORIGIN: "https://xcomic.me",
  HOSTS: ["xcomic.me"],
};

/** Title, edition and chapter ids are short lower-case base36 strings ("kolxr", "8kybo"). */
const XCOMIC_ID = /^[a-z0-9]{3,16}$/;
/** An AniTrack XComic title: "<title id>.<edition id>". */
const XCOMIC_TITLE_REF = /^([a-z0-9]{3,16})\.([a-z0-9]{3,16})$/;
const IMAGE_HOST = /^i\d{1,3}\.img\d{1,3}\.org$/;

export const XCOMIC_MAX_LIST_PAGES = 40;
export const XCOMIC_MAX_CHAPTERS = 20_000;

export const isXComicId = (value: string) => XCOMIC_ID.test(value);

export function xcomicTitleRef(titleId: string, editionId: string): string {
  return `${titleId}.${editionId}`;
}

export function parseXComicTitleRef(ref: string): { titleId: string; editionId: string } | null {
  const m = XCOMIC_TITLE_REF.exec(ref);
  return m ? { titleId: m[1], editionId: m[2] } : null;
}

export const xcomicSearchUrl = (query: string) => `${XCOMIC.ORIGIN}/search?word=${encodeURIComponent(query.trim().slice(0, 120))}`;
export const xcomicTitleUrl = (titleId: string) => `${XCOMIC.ORIGIN}/title/${titleId}`;
export const xcomicEditionUrl = (editionId: string, page = 1) =>
  `${XCOMIC.ORIGIN}/source/${editionId}${page > 1 ? `?page=${Math.min(XCOMIC_MAX_LIST_PAGES, Math.floor(page))}` : ""}`;
export const xcomicChapterUrl = (chapterId: string) => `${XCOMIC.ORIGIN}/chapter/${chapterId}`;

/** An XComic page image AniTrack may load: https on one of its numbered image hosts. */
export function isXComicImage(url: URL): boolean {
  return url.protocol === "https:" && IMAGE_HOST.test(url.hostname) && url.pathname.startsWith("/_f/") && !url.pathname.includes("..");
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
const count = (text: string | undefined) => {
  const n = Number((text ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Title ids on a search page, in the site's order (first ones are the closest). */
export function xcomicSearchIds(html: string, max = 5): string[] {
  const ids: string[] = [];
  for (const m of html.matchAll(/href="\/title\/([a-z0-9]{3,16})"/g)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
    if (ids.length >= max) break;
  }
  return ids;
}

/** A chapter label's number: "Chapter 1171", "Vol.TBE Ch.1170", "Volume 105 Chapter 1065.5". */
export function xcomicChapterNumber(label: string): number | null {
  const m = /\bch(?:apter)?\.?\s*([0-9]{1,5}(?:\.[0-9]{1,2})?)/i.exec(label) ?? /^\s*([0-9]{1,5}(?:\.[0-9]{1,2})?)\s*$/.exec(label);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface XComicEdition {
  id: string;
  name: string;
  /** The edition's flag emoji ("🇬🇧"), or "" when it shows none. */
  flag: string;
  chapters: number | null;
  follows: number | null;
  latestChapter: number | null;
  latestAt: number | null;
  /** The upload group's badge ("TCB Scans"), when shown. */
  group: string | null;
}

const ENGLISH_FLAGS = new Set(["🇬🇧", "🇺🇸"]);

/** Each edition card on a title page. */
export function xcomicEditions(html: string): XComicEdition[] {
  const cards = html.split(/<div\b[^>]*class="border border-base-300 hover:bg-base-200 relative"/).slice(1);
  const out: XComicEdition[] = [];
  const seen = new Set<string>();
  for (const card of cards.slice(0, 600)) {
    const link = /href="\/source\/([a-z0-9]{3,16})"[^>]*>([\s\S]{0,300}?)<\/a>/.exec(card);
    if (!link || seen.has(link[1])) continue;
    seen.add(link[1]);
    const stats = /([\d,]{1,9}) chapters? · ([\d,]{1,12}) follows?/.exec(card);
    const latest = /href="\/chapter\/[a-z0-9]{3,16}"[^>]*>([\s\S]{0,200}?)<\/a>/.exec(card);
    const time = /data-time="(\d{10,14})"/.exec(card);
    const badges = [...card.matchAll(/<span\b[^>]*rounded-box[^>]*>([^<]{1,80})<\/span>/g)];
    out.push({
      id: link[1],
      name: strip(link[2]).slice(0, 200),
      flag: (/NotoColorEmoji[^>]*>([^<]{1,16})</.exec(card)?.[1] ?? "").trim(),
      chapters: count(stats?.[1]),
      follows: count(stats?.[2]),
      latestChapter: latest ? xcomicChapterNumber(strip(latest[1])) : null,
      latestAt: time ? Number(time[1]) : null,
      group: badges.length ? decode(badges[badges.length - 1][1]).trim().slice(0, 80) || null : null,
    });
  }
  return out;
}

/** The English edition AniTrack reads: the most chapters, then the most follows, then the newest. */
export function xcomicBestEdition(editions: XComicEdition[]): XComicEdition | null {
  const english = editions.filter((e) => ENGLISH_FLAGS.has(e.flag) && (e.chapters ?? 0) > 0);
  english.sort((a, b) =>
    (b.chapters ?? 0) - (a.chapters ?? 0) || (b.follows ?? 0) - (a.follows ?? 0) || (b.latestAt ?? 0) - (a.latestAt ?? 0));
  return english[0] ?? null;
}

/** A title page as a [SourceDetail]: its tracker links decide matches. Null without an English edition. */
export function xcomicDetail(html: string, titleId: string): SourceDetail | null {
  if (!isXComicId(titleId)) return null;
  const edition = xcomicBestEdition(xcomicEditions(html));
  if (!edition) return null;
  const heading = strip(/<h3[^>]*>([\s\S]{1,400}?)<\/h3>/.exec(html)?.[1] ?? /<h1[^>]*>([\s\S]{1,400}?)<\/h1>/.exec(html)?.[1] ?? "");
  const anilist = /anilist\.co\/manga\/(\d{1,9})/.exec(html);
  const mal = /myanimelist\.net\/manga\/(\d{1,9})/.exec(html);
  return {
    id: xcomicTitleRef(titleId, edition.id),
    title: heading.slice(0, 300) || edition.name,
    altTitles: edition.name && edition.name !== heading ? [edition.name] : [],
    anilistId: anilist ? Number(anilist[1]) : null,
    malId: mal ? Number(mal[1]) : null,
    year: null,
    country: null,
    adult: false,
    latestChapter: edition.latestChapter,
    latestAt: edition.latestAt,
  };
}

/** One page of an edition's chapter list (newest first), and its last page number. */
export function xcomicChapters(html: string, group: string | null = null): { chapters: MangaChapter[]; lastPage: number } {
  const chapters: MangaChapter[] = [];
  const parts = html.split(/<div\b[^>]*class="break-inside-avoid /);
  const rows = parts.slice(1);
  // The edition's upload group, from its badge above the list ("TCB Scans"), when it shows one.
  const badge = /<span\b[^>]*rounded-box[^>]*>([^<]{1,80})<\/span>/.exec(parts[0]);
  group ??= badge ? decode(badge[1]).trim().slice(0, 80) || null : null;
  for (const row of rows.slice(0, 1000)) {
    const link = /href="\/chapter\/([a-z0-9]{3,16})"[^>]*>([\s\S]{0,200}?)<\/a>/.exec(row);
    if (!link) continue;
    const number = xcomicChapterNumber(strip(link[2]));
    if (number == null) continue;
    const name = strip(/<span\b[^>]*class="opacity-80"[^>]*>([\s\S]{0,300}?)<\/span>/.exec(row)?.[1] ?? "").replace(/^:\s*/, "");
    const time = /data-time="(\d{10,14})"/.exec(row);
    chapters.push({ id: link[1], number, title: name ? name.slice(0, 200) : null, group, pageCount: null, uploadedAt: time ? Number(time[1]) : null });
  }
  const pages = [...html.matchAll(/href="\/source\/[a-z0-9]{3,16}\?page=(\d{1,3})"/g)].map((m) => Number(m[1]));
  return { chapters, lastPage: Math.min(XCOMIC_MAX_LIST_PAGES, Math.max(1, ...pages)) };
}

/** The newest chapter on an edition's first list page. */
export function xcomicLatest(html: string): SourceLatest | null {
  const first = xcomicChapters(html).chapters[0];
  return first ? { chapter: first.number, at: first.uploadedAt } : null;
}

/** A chapter's page images, in reading order, from its page state's "imageUrls". */
export function xcomicPages(html: string): string[] {
  const at = html.indexOf('"imageUrls"');
  if (at < 0) return [];
  const end = html.indexOf("]", at);
  const block = html.slice(at, end < 0 ? at + 200_000 : end);
  const urls: string[] = [];
  for (const m of block.matchAll(/"(https:\/\/[^"\s\\]{10,400})"/g)) {
    try {
      const url = new URL(m[1]);
      if (isXComicImage(url) && !urls.includes(url.toString())) urls.push(url.toString());
    } catch { /* skipped */ }
    if (urls.length >= 500) break;
  }
  return urls;
}
