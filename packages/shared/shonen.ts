/**
 * shonen.to: an anime catalogue keyed by AniList ids. Search and title pages are
 * server-rendered HTML; one JSON call per episode returns an HLS stream (through its
 * vidcloud proxy) with subtitle tracks. No cookies, Referer or human check needed
 * (checked 19 Oct 2026). Mirrored in Kotlin by data/providers/connectors/shonen/Shonen.kt.
 */

export const SHONEN = {
  ORIGIN: "https://shonen.to",
  HOSTS: ["shonen.to"],
};

export type ShonenLanguage = "sub" | "dub";

export interface ShonenSearchResult {
  anilistId: number;
  title: string;
  poster: string | null;
  /** Episodes out so far (the card's "EP n"). */
  episodes: number | null;
  /** 0–10. */
  score: number | null;
  format: string | null;
  year: number | null;
}

export interface ShonenSubtitle {
  file: string;
  label: string;
  kind: string;
  default: boolean;
}

export interface ShonenStream {
  url: string;
  subtitles: ShonenSubtitle[];
  intro: { start: number; end: number } | null;
  outro: { start: number; end: number } | null;
  /** When the signed proxy URL stops working (ms), if the API said. */
  expiresAt: number | null;
}

/** Thrown for an answer that isn't a usable stream: the message is safe to show. */
export class ShonenError extends Error {
  readonly notFound: boolean;
  constructor(message: string, notFound = false) {
    super(message);
    this.notFound = notFound;
  }
}

const MAX_ID = 2_147_483_647;
export const SHONEN_MAX_EPISODES = 5_000;

export function isShonenAnimeId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_ID;
}

export function shonenSearchUrl(query: string): string {
  return `${SHONEN.ORIGIN}/browse?q=${encodeURIComponent(query.trim().slice(0, 100))}`;
}

export function shonenAnimeUrl(anilistId: number): string {
  if (!isShonenAnimeId(anilistId)) throw new ShonenError("Invalid shonen.to show.");
  return `${SHONEN.ORIGIN}/anime/${anilistId}`;
}

export function shonenSourcesUrl(anilistId: number, episode: number, language: ShonenLanguage): string {
  if (!isShonenAnimeId(anilistId) || !Number.isInteger(episode) || episode < 1 || episode > SHONEN_MAX_EPISODES) {
    throw new ShonenError("Invalid shonen.to episode.");
  }
  return `${SHONEN.ORIGIN}/sources/shonen?id=${anilistId}&episode=${episode}&language=${language === "dub" ? "dub" : "sub"}`;
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

/** A public https URL (relative ones resolved against the site), else null. */
function httpsUrl(raw: string | null | undefined, base = SHONEN.ORIGIN): string | null {
  if (!raw) return null;
  try {
    const url = new URL(decode(raw.trim()), base);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Result cards on /browse?q=: `<a class="card" href="/anime/<anilistId>" title="…">`. */
export function parseShonenSearch(html: string): ShonenSearchResult[] {
  const out: ShonenSearchResult[] = [];
  const seen = new Set<number>();
  for (const m of html.matchAll(/<a\b[^>]*\bclass="card"[^>]*>[\s\S]*?<\/a>/g)) {
    const card = m[0];
    const id = Number(/href="\/anime\/([1-9][0-9]{0,9})"/.exec(card)?.[1]);
    if (!isShonenAnimeId(id) || seen.has(id)) continue;
    const title = decode(/\btitle="([^"]{1,300})"/.exec(card)?.[1] ?? "").trim()
      || strip(/<div class="ct">([\s\S]*?)<\/div>/.exec(card)?.[1] ?? "");
    if (!title) continue;
    seen.add(id);
    const meta = strip(/<div class="cm">([\s\S]*?)<\/div>/.exec(card)?.[1] ?? "");
    const [format, year] = meta.split("/").map((part) => part.trim());
    const episodes = Number(/class="pill ep">\s*EP\s*([0-9]{1,5})/i.exec(card)?.[1]);
    const score = Number(/class="pill score">\s*([0-9]{1,2}(?:\.[0-9])?)/.exec(card)?.[1]);
    out.push({
      anilistId: id,
      title: title.slice(0, 300),
      poster: httpsUrl(/<img\b[^>]*\bsrc="([^"]+)"/.exec(card)?.[1]),
      episodes: Number.isInteger(episodes) && episodes > 0 ? episodes : null,
      score: Number.isFinite(score) && score > 0 ? Math.min(10, score) : null,
      format: format ? format.slice(0, 20) : null,
      year: /^[12][0-9]{3}$/.test(year ?? "") ? Number(year) : null,
    });
    if (out.length >= 40) break;
  }
  return out;
}

/** Episodes a title page offers: its Follow button's data-eps, else the "Episodes" fact. */
export function parseShonenEpisodeCount(html: string): number | null {
  const raw = /\bdata-eps="([0-9]{1,5})"/.exec(html)?.[1] ?? /<dt>\s*Episodes\s*<\/dt>\s*<dd>\s*([0-9]{1,5})/i.exec(html)?.[1];
  const count = Number(raw);
  return Number.isInteger(count) && count > 0 ? Math.min(count, SHONEN_MAX_EPISODES) : null;
}

/** A title page's name and episode count (its `<h1>` and Follow button). */
export function parseShonenTitlePage(html: string): { title: string | null; episodes: number | null } {
  const title = strip(/<h1[^>]*>([\s\S]{1,600}?)<\/h1>/.exec(html)?.[1] ?? "").slice(0, 300);
  return { title: title || null, episodes: parseShonenEpisodeCount(html) };
}

function skip(value: unknown): { start: number; end: number } | null {
  const v = value as { start?: unknown; end?: unknown } | null;
  const start = Number(v?.start);
  const end = Number(v?.end);
  return v && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end < 24 * 3600 ? { start, end } : null;
}

/** The /sources/shonen answer: `{data:{sources:[{file,type}],tracks:[…],intro,outro,expiresAt}}` or `{error:{code,message}}`. */
export function parseShonenSources(json: unknown): ShonenStream {
  const root = json as { data?: any; error?: { code?: unknown; message?: unknown } } | null;
  if (!root || typeof root !== "object") throw new ShonenError("shonen.to sent a response AniTrack couldn't read.");
  if (root.error) {
    const notFound = root.error.code === "SOURCE_NOT_FOUND";
    throw new ShonenError(notFound ? "shonen.to has no stream for this episode in this language." : "shonen.to couldn't load this episode. Try again later.", notFound);
  }
  const data = root.data;
  if (!data || typeof data !== "object") throw new ShonenError("shonen.to sent a response AniTrack couldn't read.");
  const sources: any[] = Array.isArray(data.sources) ? data.sources : [];
  const hls = sources.find((s) => s && s.type === "hls" && httpsUrl(s.file)) ?? null;
  const url = httpsUrl(hls?.file ?? (typeof data.source === "string" ? data.source : null));
  if (!url) throw new ShonenError("shonen.to has no stream for this episode in this language.", true);
  const tracks: any[] = Array.isArray(data.tracks) && data.tracks.length ? data.tracks : Array.isArray(hls?.tracks) ? hls.tracks : [];
  const subtitles: ShonenSubtitle[] = [];
  for (const track of tracks.slice(0, 32)) {
    const file = httpsUrl(track?.file);
    const kind = typeof track?.kind === "string" ? track.kind : "subtitles";
    if (!file || (kind !== "subtitles" && kind !== "captions")) continue;
    subtitles.push({ file, label: typeof track.label === "string" && track.label.trim() ? track.label.trim().slice(0, 60) : "Subtitles", kind, default: track.default === true });
  }
  const expires = Date.parse(typeof data.expiresAt === "string" ? data.expiresAt : "");
  return {
    url,
    subtitles,
    intro: skip(data.intro ?? hls?.intro),
    outro: skip(data.outro ?? hls?.outro),
    expiresAt: Number.isFinite(expires) ? expires : null,
  };
}
