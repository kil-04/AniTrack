/** Toonkotsu catalogue, observed 19 Oct 2026. Kotlin twin: data/manga/toonkotsu/ToonkotsuParser.kt. */
import type { MangaChapter, SourceDetail } from './manga';

export const TOONKOTSU = { ORIGIN: 'https://toonkotsu.com', MAX_CHAPTERS: 20_000, MAX_PAGES: 500, MAX_BYTES: 16 * 1024 * 1024 };
const HID = /^[a-z][a-z0-9]{4}$/;
const REF = /^([a-z][a-z0-9]{4})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const CHAPTER = /^[1-9]\d{0,14}$/;
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown, max = 300) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const number = (v: unknown): number | null => {
  if (typeof v !== 'number' && !(typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v))) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const positiveInt = (v: unknown) => { const n = number(v); return n != null && Number.isSafeInteger(n) && n > 0 ? n : null; };
export const isToonkotsuChapter = (v: string) => CHAPTER.test(v);
export function toonkotsuHid(ref: string): string | null {
  return ref.length <= 190 ? REF.exec(ref)?.[1] ?? null : null;
}
export const toonkotsuSearchUrl = (query: string) => `${TOONKOTSU.ORIGIN}/cdn/v1/search?q=${encodeURIComponent(query.trim().slice(0, 120))}&limit=5`;
export function toonkotsuSeriesUrl(ref: string): string {
  const hid = HID.test(ref) ? ref : toonkotsuHid(ref);
  if (!hid) throw new Error('Unrecognised Toonkotsu title.');
  return `${TOONKOTSU.ORIGIN}/cdn/v1/series/${hid}`;
}
export function toonkotsuSearch(value: unknown): string[] {
  const items = row(value).items;
  if (!Array.isArray(items)) throw new Error('Toonkotsu sent an unreadable search result.');
  return [...new Set(items.slice(0, 5).map(v => {
    const s = row(v), ref = `${text(s.hid)}-${text(s.slug, 180)}`;
    return toonkotsuHid(ref) ? ref : '';
  }).filter(Boolean))];
}
export function toonkotsuDetail(value: unknown, expectedRef: string): SourceDetail | null {
  const s = row(row(value).series);
  const ref = `${text(s.hid)}-${text(s.slug, 180)}`;
  if (!toonkotsuHid(ref) || toonkotsuHid(ref) !== toonkotsuHid(expectedRef) || !text(s.title)) return null;
  const trackers = row(s.trackers), external = row(s.externalIds), latest = row(s.latest);
  return {
    id: ref, title: text(s.title), altTitles: Array.isArray(s.alt) ? s.alt.filter((v): v is string => typeof v === 'string').slice(0, 60).map(v => v.slice(0, 300)) : [],
    anilistId: positiveInt(trackers.anilist) ?? positiveInt(external.anilist),
    malId: positiveInt(trackers.myanimelist) ?? positiveInt(external.myanimelist),
    year: positiveInt(s.year), country: text(s.country, 2) || null, adult: s.adult === true,
    latestChapter: number(latest.n), latestAt: positiveInt(latest.at),
  };
}
export function toonkotsuChapters(value: unknown): MangaChapter[] {
  const rows = row(value).chapters;
  if (!Array.isArray(rows)) throw new Error('Toonkotsu sent an unreadable chapter list.');
  const out = new Map<string, MangaChapter>();
  let visited = 0;
  for (const item of rows) {
    const canonical = row(item), alternatives = canonical.alts;
    if (alternatives != null && !Array.isArray(alternatives)) throw new Error('Toonkotsu sent unreadable alternate uploads.');
    for (const raw of [canonical, ...(Array.isArray(alternatives) ? alternatives : [])]) {
      if (++visited > TOONKOTSU.MAX_CHAPTERS) throw new Error('Toonkotsu chapter list exceeds the supported limit.');
      const upload = row(raw), id = String(upload.id ?? ''), n = number(canonical.n);
      if (!CHAPTER.test(id) || n == null || n > 100_000) continue; // Volume-only rows have no chapter number.
      const label = text(upload.label ?? canonical.label, 200);
      const group = row(upload.group ?? canonical.group);
      const pages = positiveInt(upload.pages ?? canonical.pages);
      out.set(id, { id, number: n, title: label || null, group: text(group.name, 80) || /\[([^\]]{1,80})\]\s*$/.exec(label)?.[1] || null,
        pageCount: pages && pages <= TOONKOTSU.MAX_PAGES ? pages : null, uploadedAt: positiveInt(upload.at ?? canonical.at) });
    }
  }
  return [...out.values()];
}
/** A real reader URL is an opaque page handle; native transports return its decoded image bytes. */
export function toonkotsuPageUrl(ref: string, chapter: MangaChapter, page: number): string {
  if (!toonkotsuHid(ref) || !isToonkotsuChapter(chapter.id) || !Number.isFinite(chapter.number) || chapter.number < 0 || chapter.number > 100_000 || !Number.isInteger(page) || page < 1 || page > TOONKOTSU.MAX_PAGES) throw new Error('Unrecognised Toonkotsu page.');
  return `${TOONKOTSU.ORIGIN}/title/${ref}/${chapter.id}-chapter-${chapter.number}/${page}`;
}
export function toonkotsuPageRef(url: URL): { ref: string; chapterId: string; page: number } | null {
  if (url.origin !== TOONKOTSU.ORIGIN || url.username || url.password || url.search || url.hash) return null;
  const m = /^\/title\/([^/]+)\/([1-9]\d{0,14})-chapter-(\d{1,6}(?:\.\d{1,4})?)\/([1-9]\d{0,2})$/.exec(url.pathname);
  return m && toonkotsuHid(m[1]) && Number(m[3]) <= 100_000 && Number(m[4]) <= TOONKOTSU.MAX_PAGES ? { ref: m[1], chapterId: m[2], page: Number(m[4]) } : null;
}
