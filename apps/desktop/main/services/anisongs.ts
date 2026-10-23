import { app } from "electron";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ANISONGS,
  anisongdbRefusal,
  isSeasonQuery,
  parseAniSongs,
  parseCharts,
  searchBody,
  type AniSong,
  type SeasonName,
  type SongCharts,
  type SongSearchBy,
} from "../../../../packages/shared/anisongs";

/**
 * Openings and endings from AnisongDB (packages/shared/anisongs.ts). Charts ship with the
 * app; seasons and searches are fetched one at a time and kept for a day, so browsing
 * back and forth doesn't ask AnisongDB again.
 */
const TTL_MS = 24 * 60 * 60_000;
const MAX_BYTES = 16 * 1024 * 1024;
const cache = new Map<string, { at: number; songs: AniSong[] }>();
let charts: SongCharts | null = null;
let lane: Promise<unknown> = Promise.resolve();

export function songCharts(): SongCharts {
  charts ??= parseCharts(JSON.parse(readFileSync(join(app.getAppPath(), "apps/android/app/src/main/assets/song_charts.json"), "utf8")));
  return charts;
}

async function post(key: string, path: string, body: unknown): Promise<AniSong[]> {
  const held = cache.get(key);
  if (held && Date.now() - held.at < TTL_MS) return held.songs;
  const run = lane.then(async () => {
    const again = cache.get(key);
    if (again && Date.now() - again.at < TTL_MS) return again.songs;
    const response = await fetch(`${ANISONGS.API}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": `AniTrack/${app.getVersion()} (Desktop; songs)` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`AnisongDB answered ${response.status}. Try again later.`);
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error("AnisongDB sent too much.");
    const json = JSON.parse(text);
    const refusal = anisongdbRefusal(json);
    if (refusal) throw new Error(refusal);
    const songs = parseAniSongs(json);
    if (cache.size >= 40) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), songs });
    return songs;
  });
  lane = run.catch(() => {});
  return run;
}

export function seasonSongs(season: SeasonName, year: number): Promise<AniSong[]> {
  if (!isSeasonQuery(season, year)) throw new Error("Invalid season.");
  return post(`season:${season} ${year}`, "season_request", { season: `${season} ${year}` });
}

/** A show's openings and endings, by its MyAnimeList id. */
export async function showSongs(malId: number): Promise<AniSong[]> {
  if (!Number.isSafeInteger(malId) || malId <= 0) return [];
  return post(`show:${malId}`, "mal_ids_request", { mal_ids: [malId] });
}

export async function searchSongs(query: string, by: SongSearchBy): Promise<AniSong[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  return post(`search:${by}:${q.toLowerCase()}`, "search_request", searchBody(q, by));
}
