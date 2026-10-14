import {
  mixRadio,
  parseThemesResponse,
  themesUrl,
  THEMES_BATCH,
  type ThemeShow,
  type ThemeSong,
} from "../../../../packages/shared/anime-themes";
import { getAllListEntries, getAnime, getContinueWatching } from "./db";
import { getById } from "./anilist";

// Theme lists rarely change, and AnimeThemes asks clients to stay under 90
// requests a minute: answers are kept for a few hours.
const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<number, { at: number; songs: ThemeSong[] }>();

async function fetchThemes(shows: ThemeShow[]): Promise<Map<number, ThemeSong[]>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    const res = await fetch(themesUrl(shows.map((show) => show.id)), {
      headers: { Accept: "application/json", "User-Agent": "AniTrack/8 (anime tracker; theme songs)" },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`AnimeThemes ${res.status}`);
    return parseThemesResponse(await res.json(), shows);
  } finally {
    clearTimeout(timer);
  }
}

/** Themes for each show, from the cache where fresh, in batches otherwise. */
export async function themesFor(shows: ThemeShow[]): Promise<Map<number, ThemeSong[]>> {
  const now = Date.now();
  const out = new Map<number, ThemeSong[]>();
  const missing: ThemeShow[] = [];
  for (const show of shows) {
    const hit = cache.get(show.id);
    if (hit && now - hit.at < TTL_MS) out.set(show.id, hit.songs);
    else if (!missing.some((other) => other.id === show.id)) missing.push(show);
  }
  for (let i = 0; i < missing.length; i += THEMES_BATCH) {
    const chunk = missing.slice(i, i + THEMES_BATCH);
    const fetched = await fetchThemes(chunk);
    for (const show of chunk) {
      const songs = fetched.get(show.id) ?? [];
      out.set(show.id, songs);
      cache.set(show.id, { at: now, songs });
    }
  }
  return out;
}

async function showFor(id: number): Promise<ThemeShow | null> {
  const meta = getAnime(id) ?? await getById(id).catch(() => null);
  return meta ? { id, title: meta.title, cover: meta.coverImage ?? null } : null;
}

/** A show's openings and endings, openings first. */
export async function themesForAnime(id: number): Promise<ThemeSong[]> {
  const show = await showFor(id);
  if (!show) return [];
  return (await themesFor([show])).get(id) ?? [];
}

/** The theme radio: songs from Continue Watching and your Completed / Watching lists. */
export async function themeRadio(): Promise<ThemeSong[]> {
  const ids = new Set<number>();
  for (const item of getContinueWatching(60)) if (item.anime.id > 0) ids.add(item.anime.id);
  for (const entry of getAllListEntries()) {
    if (entry.status === "completed" || entry.status === "watching") ids.add(entry.animeId);
  }
  const shows: ThemeShow[] = [];
  for (const id of [...ids].slice(0, 50)) {
    // Local metadata only: the radio shouldn't queue dozens of AniList lookups.
    const meta = getAnime(id);
    if (meta) shows.push({ id, title: meta.title, cover: meta.coverImage ?? null });
  }
  if (!shows.length) return [];
  const themes = await themesFor(shows);
  return mixRadio([...themes.values()].flat());
}
