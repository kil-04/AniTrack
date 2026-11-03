/**
 * Xanime (xanime.me): a ~10,000-title anime catalogue with plain HTTP and no human check
 * (checked 3 Nov 2026). Its pages are Qwik apps whose server state (the
 * `<script type="qwik/json">` block) carries the data AniTrack needs, read without running
 * any site code:
 *
 * - each show's AniList and MAL ids, title, year, episode total and latest episode id
 *   (search results and title pages);
 * - an episode page's episode list, 50 to a page: the page holding that episode
 *   (One Piece's latest page is 1151-1180 of 1,180);
 * - that episode's sub and dub streams: a signed HLS master on its xanivsrc*.org hosts
 *   (a day's lifetime), English captions and intro/outro times.
 *
 * Streams need no Referer or cookie; renditions and segments sit beside the master (segments
 * are MPEG-TS under image-like names). Mirrored in Kotlin by
 * data/providers/connectors/xanime/Xanime.kt; keep the two identical.
 */

export const XANIME = {
  ORIGIN: "https://xanime.me",
  HOSTS: ["xanime.me"],
};

export const XANIME_EPISODES_PER_PAGE = 50;
const MAX_ID = 2_147_483_647;
const MEDIA_HOST = /^xanivsrc\d{1,3}\.org$/;

export class XanimeError extends Error {
  readonly notFound: boolean;
  constructor(message: string, notFound = false) {
    super(message);
    this.name = "XanimeError";
    this.notFound = notFound;
  }
}

export interface XanimeShow {
  /** Xanime's own show id ("91594"). */
  id: string;
  anilistId: number | null;
  malId: number | null;
  title: string;
  poster: string | null;
  year: number | null;
  type: string | null;
  episodes: number | null;
  subCount: number | null;
  dubCount: number | null;
  latestEpisodeId: string | null;
  adult: boolean;
}

export interface XanimeEpisode {
  id: string;
  number: number;
  title: string;
}

export interface XanimeEpisodeList {
  show: XanimeShow | null;
  episodes: XanimeEpisode[];
  /** Episodes the show has in all; more than [episodes] holds when it runs past one page. */
  total: number | null;
}

export interface XanimeSubtitle { file: string; label: string; kind: string; default: boolean }
export interface XanimeSkip { start: number; end: number }

export interface XanimeStream {
  id: string;
  episodeId: string;
  language: "sub" | "dub";
  /** The site's name for the server ("Vidplay"), or null when it only numbers them. */
  server: string | null;
  url: string;
  subtitles: XanimeSubtitle[];
  intro: XanimeSkip | null;
  outro: XanimeSkip | null;
}

export const isXanimeId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,9}$/.test(value) && Number(value) <= MAX_ID;

export const xanimeSearchUrl = (query: string) => `${XANIME.ORIGIN}/search?word=${encodeURIComponent(query.trim().slice(0, 100))}`;
export const xanimeTitleUrl = (showId: string) => `${XANIME.ORIGIN}/title/${showId}`;
export const xanimeEpisodeUrl = (showId: string, episodeId: string) => `${XANIME.ORIGIN}/title/${showId}/${episodeId}`;

/** A stream or caption AniTrack may load: https on an xanivsrc host, under /media/. */
export function isXanimeMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && (url.port === "" || url.port === "443") && !url.username && !url.password &&
      MEDIA_HOST.test(url.hostname) && url.pathname.startsWith("/media/") && !url.pathname.includes("..");
  } catch {
    return false;
  }
}

// ── Qwik server state ─────────────────────────────────────────────────────────
// `objs` is a flat array; inside an object or array every value is a reference: the
// base-36 index of another `objs` entry, sometimes followed by "!". Literals are the
// entries themselves. Strings starting with a control character are Qwik's own markers.

type QwikValue = unknown;

class QwikState {
  private readonly objs: QwikValue[];
  constructor(objs: QwikValue[]) {
    this.objs = objs;
  }

  static parse(html: string): QwikState | null {
    const m = /<script type="qwik\/json">([\s\S]*?)<\/script>/.exec(html);
    if (!m) return null;
    try {
      const value = JSON.parse(m[1]) as { objs?: unknown };
      return Array.isArray(value?.objs) ? new QwikState(value.objs) : null;
    } catch {
      return null;
    }
  }

  get entries(): readonly QwikValue[] { return this.objs; }

  ref(value: unknown): QwikValue {
    if (typeof value !== "string" || !/^[0-9a-z]{1,6}!?$/.test(value)) return undefined;
    const index = parseInt(value.replace(/!$/, ""), 36);
    return index < this.objs.length ? this.objs[index] : undefined;
  }

  field(object: Record<string, unknown>, key: string): QwikValue {
    return key in object ? this.ref(object[key]) : undefined;
  }

  text(object: Record<string, unknown>, key: string): string | null {
    const value = this.field(object, key);
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return typeof value === "string" && !/^[\u0000-\u001f]/.test(value) ? value : null;
  }

  int(object: Record<string, unknown>, key: string): number | null {
    const raw = this.field(object, key);
    const n = typeof raw === "number" ? raw : typeof raw === "string" && /^-?\d{1,10}$/.test(raw) ? Number(raw) : NaN;
    return Number.isInteger(n) ? n : null;
  }

  object(value: unknown): Record<string, unknown> | null {
    const resolved = this.ref(value);
    return resolved && typeof resolved === "object" && !Array.isArray(resolved) ? resolved as Record<string, unknown> : null;
  }

  list(object: Record<string, unknown>, key: string): unknown[] {
    const value = this.field(object, key);
    return Array.isArray(value) ? value.slice(0, 500) : [];
  }

  /** Objects carrying every one of [keys]. */
  objectsWith(...keys: string[]): Record<string, unknown>[] {
    return this.objs.filter((o): o is Record<string, unknown> =>
      !!o && typeof o === "object" && !Array.isArray(o) && keys.every((key) => key in (o as object)));
  }
}

const positive = (n: number | null) => (n != null && n > 0 && n <= MAX_ID ? n : null);

function available(state: QwikState, counts: Record<string, unknown> | null, language: string): number | null {
  const entry = counts ? state.object(counts[language]) : null;
  return entry ? positive(state.int(entry, "downloaded")) : null;
}

function showOf(state: QwikState, o: Record<string, unknown>): XanimeShow | null {
  const id = state.text(o, "ani_id");
  const title = state.text(o, "info_title")?.trim();
  if (!isXanimeId(id) || !title) return null;
  const counts = state.object(o.info_sou_counts);
  const types = state.list(o, "info_meta_type").map((v) => state.ref(v)).filter((v): v is string => typeof v === "string");
  const year = state.int(o, "info_meta_year");
  const latest = state.text(o, "ep_up_id");
  const poster = state.text(o, "urlCover600") ?? state.text(o, "urlCoverOri");
  return {
    id,
    anilistId: positive(state.int(o, "al_id")),
    malId: positive(state.int(o, "ani_id_mal")),
    title: title.slice(0, 300),
    poster: poster && /^https:\/\//.test(poster) ? poster : null,
    year: year != null && year > 1900 && year < 2100 ? year : null,
    type: types[0]?.toUpperCase().slice(0, 20) ?? null,
    episodes: positive(state.int(o, "ep_total")),
    // { sub: { downloaded: 26 }, dub: { downloaded: 26 } }
    subCount: available(state, counts, "sub"),
    dubCount: available(state, counts, "dub"),
    latestEpisodeId: isXanimeId(latest) ? latest : null,
    adult: state.field(o, "info_meta_rating_nsfw") === true,
  };
}

/** Every show a page describes (search results, or a title or episode page's own show), once each. */
export function parseXanimeShows(html: string): XanimeShow[] {
  const state = QwikState.parse(html);
  if (!state) return [];
  const seen = new Set<string>();
  const out: XanimeShow[] = [];
  for (const o of state.objectsWith("ani_id", "info_title", "al_id")) {
    const show = showOf(state, o);
    if (show && !seen.has(show.id)) {
      seen.add(show.id);
      out.push(show);
    }
    if (out.length >= 60) break;
  }
  return out;
}

/** The show a title or episode page is about. */
export function parseXanimeShow(html: string, showId: string): XanimeShow | null {
  return parseXanimeShows(html).find((show) => show.id === showId) ?? null;
}

/** An episode page's episode list (the 50-episode page holding it), ascending, and the show's total. */
export function parseXanimeEpisodes(html: string, showId: string): XanimeEpisodeList {
  const state = QwikState.parse(html);
  if (!state) return { show: null, episodes: [], total: null };
  const byId = new Map<string, XanimeEpisode>();
  for (const o of state.objectsWith("ep_id", "ep_index", "epPath")) {
    if (state.text(o, "ani_id") !== showId) continue;
    const id = state.text(o, "ep_id");
    const index = state.int(o, "ep_index");
    if (!isXanimeId(id) || index == null || index < 0 || index > 100_000) continue;
    const part = state.int(o, "ep_sub_index") ?? 0;
    const number = part > 0 && part < 10 ? index + part / 10 : index;
    const title = state.text(o, "ep_title")?.trim();
    byId.set(id, { id, number, title: (title || `Episode ${number}`).slice(0, 200) });
  }
  const show = parseXanimeShow(html, showId);
  const episodes = [...byId.values()].sort((a, b) => a.number - b.number);
  return { show, episodes, total: show?.episodes ?? null };
}

/** The episode's streams, Sub first, each with its captions and skip times. */
export function parseXanimeStreams(html: string, episodeId: string): XanimeStream[] {
  const state = QwikState.parse(html);
  if (!state) return [];
  const out: XanimeStream[] = [];
  const seen = new Set<string>();
  for (const o of state.objectsWith("sou_id", "src_type", "souPath")) {
    const id = state.text(o, "sou_id");
    const language = state.text(o, "src_type");
    const url = state.text(o, "souPath");
    if (state.text(o, "ep_id") !== episodeId || !isXanimeId(id) || seen.has(id)) continue;
    if ((language !== "sub" && language !== "dub") || !url || !isXanimeMediaUrl(url)) continue;
    seen.add(id);
    const subtitles: XanimeSubtitle[] = [];
    for (const ref of state.list(o, "track")) {
      const track = state.object(ref);
      const file = track ? state.text(track, "trackPath") : null;
      if (!track || !file || !isXanimeMediaUrl(file) || subtitles.some((s) => s.file === file)) continue;
      subtitles.push({
        file,
        label: (state.text(track, "label") ?? "English").slice(0, 60),
        kind: state.text(track, "kind") === "subtitles" ? "subtitles" : "captions",
        default: state.field(track, "default") === true,
      });
    }
    const jump = state.object(o.jump);
    const skip = (key: string): XanimeSkip | null => {
      const range = jump ? state.object(jump[key]) : null;
      const start = range ? state.int(range, "start") : null;
      const end = range ? state.int(range, "end") : null;
      return start != null && end != null && start >= 0 && end > start && end < 24 * 3600 ? { start, end } : null;
    };
    const name = state.text(o, "src_name")?.trim() ?? "";
    out.push({
      id,
      episodeId,
      language,
      // Bebop's servers are just "1"; current shows name theirs ("Vidplay").
      server: name && !/^\d{1,3}$/.test(name) ? name.slice(0, 40) : null,
      url,
      subtitles: subtitles.slice(0, 16),
      intro: skip("intro"),
      outro: skip("outro"),
    });
  }
  return out.sort((a, b) => Number(a.language === "dub") - Number(b.language === "dub"));
}

/** A stream's choice label: "Sub", "Dub · Vidplay", "Sub 2" when one language has several. */
export function xanimeStreamLabel(stream: XanimeStream, all: XanimeStream[]): string {
  const same = all.filter((s) => s.language === stream.language);
  const base = stream.language === "dub" ? "Dub" : "Sub";
  if (stream.server) return `${base} · ${stream.server}`;
  return same.length > 1 ? `${base} ${same.indexOf(stream) + 1}` : base;
}
