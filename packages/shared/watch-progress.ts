import type { WatchStatus } from "./types";

/** A list entry as far as finishing an episode is concerned. */
export interface WatchedEntry {
  status: WatchStatus;
  episodesWatched: number;
}

/**
 * The list entry after an episode was watched through, or null to leave the list
 * alone. A completed show stays completed while you rewatch it: no status or
 * episode change, and nothing is sent to MyAnimeList or AniList. The episode count
 * never goes backwards (rewatching an earlier episode of a show in progress keeps
 * the furthest one), and a dropped show stays dropped.
 */
export function entryAfterEpisode(
  existing: WatchedEntry | null | undefined,
  episode: number,
  totalEpisodes: number | null | undefined,
): WatchedEntry | null {
  if (existing?.status === "completed") return null;
  const episodesWatched = Math.max(episode, existing?.episodesWatched ?? 0);
  if (existing?.status === "dropped") return { status: "dropped", episodesWatched };
  const total = totalEpisodes ?? Infinity;
  return { status: episodesWatched >= total ? "completed" : "watching", episodesWatched };
}
