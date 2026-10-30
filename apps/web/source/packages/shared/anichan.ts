/**
 * AniChan's public catalogue and already-decoded page responses.
 * Session verification and decoding belong to the site's running reader page.
 * Mirrored by Android's data/providers/connectors/anichan/AniChan.kt.
 */
export const ANICHAN = {
  ORIGIN: "https://anichan.to",
  HOSTS: ["anichan.to"],
  MAX_EPISODES: 5_000,
};

export type AniChanCategory = "sub" | "dub";
export type AniChanTier = "fast" | "rest";

export interface AniChanSearchResult {
  anilistId: number;
  malId: number | null;
  title: string;
  poster: string | null;
  episodes: number | null;
  year: number | null;
  format: string | null;
}

export interface AniChanEpisode {
  number: number;
  title: string | null;
  snapshot: string | null;
  sub: boolean;
  dub: boolean;
}

export interface AniChanTitle {
  anilistId: number;
  malId: number | null;
  title: string;
  poster: string | null;
  year: number | null;
  episodes: AniChanEpisode[];
}

export interface AniChanSubtitle {
  file: string;
  label: string;
  default: boolean;
  kind: "subtitles";
}

export interface AniChanServer {
  id: string;
  name: string;
  label: string;
  category: AniChanCategory;
  tier: AniChanTier;
  occurrence: number;
  rank: number;
  url: string;
  hls: boolean;
  subtitles: AniChanSubtitle[];
  intro: { start: number; end: number } | null;
  outro: { start: number; end: number } | null;
}

export class AniChanError extends Error {
  readonly notFound: boolean;
  constructor(message: string, notFound = false) {
    super(message);
    this.name = "AniChanError";
    this.notFound = notFound;
  }
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim().slice(0, max) : "";
const integer = (value: unknown, max: number): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max ? value : null;
const year = (value: unknown): number | null => {
  const result = integer(value, 2200);
  return result !== null && result >= 1900 ? result : null;
};

export function isAniChanAnimeId(value: unknown): value is number {
  return integer(value, 2_147_483_647) !== null;
}

export function aniChanTitleUrl(anilistId: number): string {
  if (!isAniChanAnimeId(anilistId)) throw new AniChanError("Invalid AniChan show.");
  return `${ANICHAN.ORIGIN}/anime/${anilistId}/watch/1`;
}

export function aniChanMetadataUrl(anilistId: number): string {
  if (!isAniChanAnimeId(anilistId)) throw new AniChanError("Invalid AniChan show.");
  return `${ANICHAN.ORIGIN}/api/catalog/anime/${anilistId}`;
}

export function aniChanSearchUrl(query: string): string {
  return `${ANICHAN.ORIGIN}/api/suggest?q=${encodeURIComponent(text(query, 100))}`;
}

/** Images may use the catalogue's public image CDNs. Media has a stricter list. */
function httpsUrl(value: unknown, media = false): string | null {
  if (typeof value !== "string" || !value || value.length > 16_384 || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value, ANICHAN.ORIGIN);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) return null;
    if (media) {
      if (host !== "anichan.to" && host !== "c.toroplay.cymru") return null;
    } else if (!host.includes(".") || /^[0-9.]+$/.test(host) || host.includes(":") || /(?:^|\.)(?:localhost|local|internal)$/.test(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** `/api/suggest?q=…` results, deduplicated by their AniList identity. */
export function parseAniChanSearch(value: unknown): AniChanSearchResult[] {
  const root = object(value);
  if (!root || !Array.isArray(root.results)) throw new AniChanError("AniChan sent search results AniTrack couldn't read.");
  const out: AniChanSearchResult[] = [];
  const seen = new Set<number>();
  for (const raw of root.results.slice(0, 200)) {
    const item = object(raw);
    if (!item || !isAniChanAnimeId(item.id) || seen.has(item.id)) continue;
    const title = text(item.title, 300) || text(item.titleRomaji, 300);
    if (!title) continue;
    seen.add(item.id);
    out.push({
      anilistId: item.id,
      malId: integer(item.idMal, 2_147_483_647),
      title,
      poster: httpsUrl(item.poster),
      episodes: integer(item.episodes, ANICHAN.MAX_EPISODES),
      year: year(object(item.startDate)?.year),
      format: text(item.format, 30) || null,
    });
    if (out.length === 40) break;
  }
  return out;
}

function episodeSet(value: unknown): Set<number> {
  return new Set(Array.isArray(value) ? value.slice(0, ANICHAN.MAX_EPISODES * 2)
    .map((n) => integer(n, ANICHAN.MAX_EPISODES)).filter((n): n is number => n !== null) : []);
}

/**
 * Known availability arrays are authoritative, including empty arrays. A title's
 * announced episode total and future ep_meta entries are never playable rows.
 * The watch count is a fallback only for titles without availability arrays.
 */
export function parseAniChanTitle(value: unknown, expectedAniListId: number, episodeCountPayload?: unknown): AniChanTitle {
  const root = object(value);
  if (!isAniChanAnimeId(expectedAniListId) || !root || root.id !== expectedAniListId) {
    throw new AniChanError("AniChan returned a different show. Search for this title again.");
  }
  const title = text(root.title, 300) || text(root.titleRomaji, 300);
  if (!title) throw new AniChanError("AniChan sent show details AniTrack couldn't read.");
  const selfhost = object(root.selfhost);
  const available = object(root.available_eps);
  const arrays = [selfhost?.cached_eps, selfhost?.cached_sub, selfhost?.cached_dub, available?.sub, available?.dub, available?.hsub];
  const known = arrays.some(Array.isArray);
  const generic = episodeSet(selfhost?.cached_eps);
  const sub = new Set([...episodeSet(selfhost?.cached_sub), ...episodeSet(available?.sub), ...episodeSet(available?.hsub)]);
  const dub = new Set([...episodeSet(selfhost?.cached_dub), ...episodeSet(available?.dub)]);
  const all = new Set([...generic, ...sub, ...dub]);
  const counts = object(episodeCountPayload);
  const count = integer(counts?.episodes, ANICHAN.MAX_EPISODES);
  const sources = Array.isArray(counts?.sources) ? counts.sources.slice(0, 32).map(object).filter((v): v is JsonObject => v !== null) : [];
  const fallbackSub = sources.some((source) => source.sub === true) || !sources.some((source) => typeof source.sub === "boolean");
  const fallbackDub = counts?.dubAvailable === true || sources.some((source) => source.dub === true);
  if (!known && count !== null) for (let n = 1; n <= count; n++) all.add(n);
  const titles = object(selfhost?.ep_titles);
  const metadata = object(selfhost?.ep_meta);
  const episodes = [...all].sort((a, b) => a - b).slice(0, ANICHAN.MAX_EPISODES).map((number) => {
    const info = object(metadata?.[String(number)]);
    return {
      number,
      title: text(info?.title, 300) || text(titles?.[String(number)], 300) || null,
      snapshot: httpsUrl(info?.image),
      sub: known ? sub.has(number) || generic.has(number) : fallbackSub,
      dub: known ? dub.has(number) : fallbackDub,
    };
  });
  return {
    anilistId: expectedAniListId,
    malId: integer(root.idMal, 2_147_483_647),
    title,
    poster: httpsUrl(root.poster),
    year: year(object(root.startDate)?.year),
    episodes,
  };
}

function skip(value: unknown): { start: number; end: number } | null {
  const v = object(value);
  return typeof v?.start === "number" && typeof v.end === "number"
    && Number.isFinite(v.start) && Number.isFinite(v.end) && v.start >= 0 && v.end > v.start && v.end < 86_400
    ? { start: v.start, end: v.end } : null;
}

function subtitles(value: unknown): AniChanSubtitle[] {
  if (!Array.isArray(value)) return [];
  const out: AniChanSubtitle[] = [];
  const seen = new Set<string>();
  for (const raw of value.slice(0, 32)) {
    const track = object(raw);
    const file = httpsUrl(track?.url, true);
    if (!file || seen.has(file)) continue;
    const path = new URL(file).pathname;
    if (!/\.vtt$/i.test(path) && path !== "/api/watch/vtt") continue;
    seen.add(file);
    out.push({ file, label: text(track?.lang, 60) || "Subtitles", default: track?.default === true, kind: "subtitles" });
  }
  return out;
}

/** Direct playable choices from one decoded `/api/watch/servers` response. */
export function parseAniChanServers(value: unknown, category: AniChanCategory, tier: AniChanTier): AniChanServer[] {
  if ((category !== "sub" && category !== "dub") || (tier !== "fast" && tier !== "rest")) throw new AniChanError("Invalid AniChan server choice.");
  const root = object(value);
  if (root?.detail === "session") throw new AniChanError("Connect AniChan to verify this browser session, then try again.");
  if (!root || !Array.isArray(root.servers)) throw new AniChanError("AniChan sent servers AniTrack couldn't read.");
  const occurrences = new Map<string, number>();
  const out: AniChanServer[] = [];
  for (const raw of root.servers.slice(0, 256)) {
    const server = object(raw);
    const name = text(server?.name, 100);
    if (!server || !name) continue;
    const occurrence = occurrences.get(name) ?? 0;
    occurrences.set(name, occurrence + 1);
    const url = httpsUrl(server.stream, true);
    if (!url || (server.type !== "hls" && server.type !== "mp4")) continue;
    const kind = category === "dub" ? "Dub" : server.subType === "hard" ? "Hard sub" : "Sub";
    out.push({
      id: JSON.stringify([category, tier, name, occurrence]),
      name,
      label: `${text(server.label, 100) || name} · ${kind}`,
      category,
      tier,
      occurrence,
      rank: typeof server.rank === "number" && Number.isFinite(server.rank) && server.rank >= 0 && server.rank <= 1_000_000 ? server.rank : 1_000_000,
      url,
      hls: server.type === "hls",
      subtitles: subtitles(server.subtitles),
      intro: skip(server.intro),
      outro: skip(server.outro),
    });
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, 32);
}
