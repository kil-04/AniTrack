import type { BrowserWindow } from "electron";
import { getByMalIds } from "./anilist";
import { mergeAnimeInto, realAnimeIdForMal, realAnimeIdsByTitle, standInAnime, upsertAnime } from "./db";
import { titleKey } from "../../../../packages/shared/list-merge";

export interface ListRepairResult {
  /** Stand-in ids folded into another show: old id → id it now lives under, and whether it had playback rows. */
  moved: { from: number; to: number; hadPlayback: boolean }[];
  /** Stand-ins whose real show is still unknown (kept as they are). */
  unresolved: number;
}

let running: Promise<ListRepairResult> | null = null;

/**
 * Folds stand-in shows into the real AniList entries, so My List shows each show
 * once with the right status (merge rules: packages/shared/list-merge.ts):
 *  - MAL-only stand-ins (1e9 + MAL id), from imports whose AniList lookup failed,
 *    by MAL id (looked up on AniList 50 at a time when not known locally);
 *  - streaming-site stubs (negative ids) whose title exactly matches one real show;
 *  - remaining stubs that repeat each other's title, into the most recent one.
 * Safe to run repeatedly; an AniList failure leaves the rest for the next run.
 */
export function repairStandInIds(): Promise<ListRepairResult> {
  running ??= (async () => {
    const moved: ListRepairResult["moved"] = [];
    const standIns = standInAnime();

    const malOnly = standIns.filter((s) => s.id >= 1_000_000_000 && s.malId);
    const unknown = malOnly.filter((s) => realAnimeIdForMal(s.malId!) == null).map((s) => s.malId!);
    if (unknown.length) {
      try {
        for (const meta of (await getByMalIds(unknown)).values()) upsertAnime(meta);
      } catch (error) {
        console.warn("[list-repair] AniList lookup failed; retrying next time", error);
      }
    }
    let unresolved = 0;
    for (const s of malOnly) {
      const real = realAnimeIdForMal(s.malId!);
      if (real == null) { unresolved++; continue; }
      mergeAnimeInto(s.id, real);
      moved.push({ from: s.id, to: real, hadPlayback: s.hasPlayback });
    }

    const stubs = standIns.filter((s) => s.id < 0);
    const byTitle = new Map<string, number>();
    for (const s of stubs) {
      const matches = realAnimeIdsByTitle(s.title);
      if (matches.length === 1) {
        mergeAnimeInto(s.id, matches[0]);
        moved.push({ from: s.id, to: matches[0], hadPlayback: s.hasPlayback });
        continue;
      }
      // Several stubs of one title (one per streaming session) become the newest one.
      const key = titleKey(s.title);
      const keep = key ? byTitle.get(key) : undefined;
      if (keep != null) {
        mergeAnimeInto(s.id, keep);
        moved.push({ from: s.id, to: keep, hadPlayback: s.hasPlayback });
      } else {
        if (key) byTitle.set(key, s.id);
        unresolved++;
      }
    }
    return { moved, unresolved };
  })().finally(() => { running = null; });
  return running;
}

/**
 * Runs [repairStandInIds] and, when it moved anything, tells the window (My List
 * and Continue Watching refresh; old ids with playback are retired in gist sync).
 */
export async function repairAndNotify(win: BrowserWindow | null): Promise<ListRepairResult> {
  const result = await repairStandInIds();
  if (result.moved.length && win && !win.isDestroyed()) win.webContents.send("list:repaired", result.moved);
  return result;
}
