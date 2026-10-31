import type { WatchStatus } from "./types";

/** A list entry being merged, with whether it still has to be sent to MyAnimeList. */
export interface MergeableEntry {
  status: WatchStatus;
  episodesWatched: number;
  score: number | null;
  updatedAt: number;
  dirty: boolean;
}

/**
 * Two copies of one show's list entry (a stand-in id and the real AniList id)
 * as one. Completed wins, so a finished show never goes back to watching; the
 * episode count never goes backwards; otherwise a change not yet sent to MAL
 * wins over one that was, and then the newer change. The result is sent to MAL
 * again when it differs from a copy that was already in step with MAL.
 */
export function mergeListEntries(a: MergeableEntry, b: MergeableEntry): MergeableEntry {
  const newer = b.updatedAt > a.updatedAt ? b : a;
  const older = newer === a ? b : a;
  let status: WatchStatus;
  if (a.status === "completed" || b.status === "completed") status = "completed";
  else if (a.dirty !== b.dirty) status = (a.dirty ? a : b).status;
  else status = newer.status;
  const episodesWatched = Math.max(a.episodesWatched, b.episodesWatched);
  const differsFromSynced = [a, b].some((x) => !x.dirty && (x.status !== status || x.episodesWatched !== episodesWatched));
  return {
    status,
    episodesWatched,
    score: newer.score ?? older.score,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
    dirty: a.dirty || b.dirty || differsFromSynced,
  };
}

/** Title comparison key for matching a stand-in to the real show: case and outer spaces ignored. */
export function titleKey(title: string | null | undefined): string {
  return (title ?? "").trim().toLowerCase();
}
