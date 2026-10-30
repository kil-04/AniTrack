/**
 * Theme songs from AnimeThemes.moe (a public, community-run catalogue), matched by
 * AniList id. Mirrors the Android app's AnimeThemes and ThemeRadio.
 */

/** One opening or ending, with its song and the AnimeThemes media to play. */
export interface ThemeSong {
  animeId: number;
  animeTitle: string;
  cover: string | null;
  /** "OP1", "ED2", "ED1-TV"… */
  slug: string;
  type: "OP" | "ED";
  title: string;
  artists: string[];
  /** Episodes it plays over, as AnimeThemes writes them ("1-16, 18"). */
  episodes: string | null;
  spoiler: boolean;
  nsfw: boolean;
  audioUrl: string | null;
  videoUrl: string | null;
}

export interface ThemeShow {
  id: number;
  title: string;
  cover: string | null;
}

export const THEMES_BATCH = 25;

export function themesUrl(ids: number[]): string {
  const params = [
    "filter[has]=resources",
    "filter[site]=AniList",
    `filter[external_id]=${ids.join(",")}`,
    "include=animethemes.animethemeentries.videos.audio,animethemes.song.artists,resources",
    `page[size]=${THEMES_BATCH}`,
  ];
  return `https://api.animethemes.moe/anime?${params.join("&")}`;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : null);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/** Only AnimeThemes' own HTTPS media hosts are played. */
export function isThemeMedia(url: string | null): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && (parsed.hostname === "a.animethemes.moe" || parsed.hostname === "v.animethemes.moe");
  } catch {
    return false;
  }
}

/** A creditless, unannotated video at up to 1080p, else the first one. */
function pickVideo(videos: unknown[]): Json | null {
  let best: Json | null = null;
  let bestScore = Infinity;
  for (const raw of videos) {
    const video = obj(raw);
    if (!video) continue;
    const resolution = typeof video.resolution === "number" ? video.resolution : 720;
    const score = (video.nc === true ? 0 : 8)
      + (video.overlap === "None" ? 0 : 4)
      + (video.lyrics === true || video.subbed === true ? 2 : 0)
      + (resolution > 1080 ? 3 : 0)
      + Math.floor((1080 - Math.min(resolution, 1080)) / 360);
    if (score < bestScore) {
      best = video;
      bestScore = score;
    }
  }
  return best;
}

const themeNumber = (slug: string) => Number(/\d+/.exec(slug)?.[0] ?? 0);

export function parseThemes(show: ThemeShow, themes: unknown): ThemeSong[] {
  const songs: ThemeSong[] = [];
  for (const raw of arr(themes)) {
    const theme = obj(raw);
    const type = theme?.type;
    if (!theme || (type !== "OP" && type !== "ED")) continue;
    const entry = obj(arr(theme.animethemeentries)[0]);
    if (!entry) continue;
    const video = pickVideo(arr(entry.videos));
    const song = obj(theme.song);
    const audioUrl = str(obj(video?.audio)?.link);
    const videoUrl = str(video?.link);
    const sequence = typeof theme.sequence === "number" ? theme.sequence : 1;
    songs.push({
      animeId: show.id,
      animeTitle: show.title,
      cover: show.cover,
      slug: str(theme.slug) ?? `${type}${sequence}`,
      type,
      title: str(song?.title) ?? "Untitled",
      artists: arr(song?.artists).map((artist) => str(obj(artist)?.name)).filter((name): name is string => !!name),
      episodes: str(entry.episodes),
      spoiler: entry.spoiler === true,
      nsfw: entry.nsfw === true,
      audioUrl: isThemeMedia(audioUrl) ? audioUrl : null,
      videoUrl: isThemeMedia(videoUrl) ? videoUrl : null,
    });
  }
  return songs
    .filter((song) => song.audioUrl || song.videoUrl)
    .sort((a, b) => (a.type === b.type ? 0 : a.type === "OP" ? -1 : 1) || themeNumber(a.slug) - themeNumber(b.slug));
}

/** Themes per AniList id from one /anime response (shows it doesn't list are left out). */
export function parseThemesResponse(json: unknown, shows: ThemeShow[]): Map<number, ThemeSong[]> {
  const byId = new Map(shows.map((show) => [show.id, show]));
  const out = new Map<number, ThemeSong[]>();
  for (const raw of arr(obj(json)?.anime)) {
    const anime = obj(raw);
    if (!anime) continue;
    for (const resource of arr(anime.resources)) {
      const link = obj(resource);
      if (link?.site !== "AniList") continue;
      const show = byId.get(Number(link.external_id));
      if (show) out.set(show.id, parseThemes(show, anime.animethemes));
    }
  }
  return out;
}

const RADIO_PER_SHOW = 4;
const RADIO_MAX = 80;

/**
 * Whether `count` songs split as `sizes` can follow a song from `last` with no
 * show twice in a row.
 */
function canSpread(sizes: Map<number, number>, last: number, count: number): boolean {
  let others = 0;
  for (const [id, size] of sizes) if (id !== last) others = Math.max(others, size);
  return (sizes.get(last) ?? 0) <= Math.floor(count / 2) && others <= Math.ceil(count / 2);
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The theme radio's queue: up to four songs a show (openings first), shuffled so
 * the same show doesn't play twice in a row while another one could.
 */
export function mixRadio(songs: ThemeSong[], random: () => number = Math.random): ThemeSong[] {
  const groups = new Map<number, ThemeSong[]>();
  for (const song of songs) {
    if (!song.audioUrl) continue;
    groups.set(song.animeId, [...(groups.get(song.animeId) ?? []), song]);
  }
  for (const [id, list] of groups) {
    const capped = [...list].sort((a, b) => (a.type === b.type ? 0 : a.type === "OP" ? -1 : 1)).slice(0, RADIO_PER_SHOW);
    groups.set(id, shuffled(capped, random));
  }
  const out: ThemeSong[] = [];
  let last: number | null = null;
  while (groups.size && out.length < RADIO_MAX) {
    const sizes = new Map([...groups].map(([id, list]) => [id, list.length]));
    const left = [...sizes.values()].reduce((sum, size) => sum + size, 0);
    const others = [...groups.keys()].filter((id) => id !== last);
    const safe = others.filter((id) => canSpread(new Map(sizes).set(id, sizes.get(id)! - 1), id, left - 1));
    const choices = safe.length ? safe : others.length ? others : [...groups.keys()];
    // Weighted by what's left, so a show's songs spread through the whole queue.
    let pick = Math.floor(random() * choices.reduce((sum, id) => sum + sizes.get(id)!, 0));
    const id = choices.find((candidate) => (pick -= sizes.get(candidate)!) < 0) ?? choices[0];
    const queue = groups.get(id)!;
    out.push(queue.shift()!);
    if (!queue.length) groups.delete(id);
    last = id;
  }
  return out;
}
