import { ipcMain, BrowserWindow } from "electron";
import { IPC } from "../../shared/types";
import {
  deleteListEntry,
  dismissFromContinueWatching,
  getAllListEntries,
  getAnime,
  getContinueWatching,
  getContinueWatchingPaged,
  getListEntry,
  getProgress,
  getProgressForAnime,
  migrateAnimeId,
  setListEntry,
  setProgress,
  upsertAnime,
} from "../services/db";
import { searchAnime } from "../services/anilist";
import { markEpisodeWatched } from "../services/mal";
import { alMarkEpisodeWatched } from "../services/anilist-sync";

export function registerDbIpc(_getMainWindow: () => BrowserWindow | null) {
  // List + progress
  ipcMain.handle(IPC.LIST_GET_ALL, () => {
    const entries = getAllListEntries();
    return entries.map((e) => ({ entry: e, anime: getAnime(e.animeId) }));
  });
  
  ipcMain.handle(IPC.LIST_SET, (_e, entry: any) => {
    setListEntry(entry, { markDirty: true });
    return getAllListEntries();
  });
  
  ipcMain.handle(IPC.CONTINUE_WATCHING, () => getContinueWatching());
  
  ipcMain.handle(IPC.CW_PAGED, (_e, page: number, pageSize: number) =>
    getContinueWatchingPaged(page, pageSize)
  );
  
  ipcMain.handle(IPC.CW_DISMISS, (_e, animeId: number) => {
    dismissFromContinueWatching(animeId);
    return { ok: true };
  });
  
  ipcMain.handle(IPC.PROGRESS_GET, (_e, id: number, ep: number) =>
    getProgress(id, ep)
  );
  
  ipcMain.handle(IPC.PROGRESS_GET_FOR_ANIME, (_e, id: number) =>
    getProgressForAnime(id)
  );
  
  ipcMain.handle(IPC.PROGRESS_SET, async (_e, p: any) => {
    // Ensure the anime row exists so getContinueWatching()'s JOIN succeeds.
    if (p.animeTitle) {
      const existing = getAnime(p.animeId);
      if (!existing) {
        // Create a stub immediately so continue-watching works right away.
        upsertAnime({ id: p.animeId, title: p.animeTitle, coverImage: p.animeCoverUrl ?? null });

        // Fire-and-forget: resolve to the real AniList entry so MAL sync works.
        if (p.animePaheSession || p.animeId) {
          (async () => {
            try {
              const results = await searchAnime(p.animeTitle);
              const hit = results.find(
                (a) =>
                  a.title.toLowerCase() === p.animeTitle.toLowerCase() ||
                  (a.titleEnglish ?? "").toLowerCase() === p.animeTitle.toLowerCase(),
              );
              if (!hit) return;

              // Save the full AniList record (includes malId, episodes, etc.)
              upsertAnime(hit);

              // If we were tracking under a stub/negative ID, migrate all data across tables.
              if (hit.id !== p.animeId) {
                migrateAnimeId(p.animeId, hit.id);
              }
            } catch { /* best-effort */ }
          })();
        }
      } else if (!existing.coverImage && p.animeCoverUrl) {
        upsertAnime({ ...existing, coverImage: p.animeCoverUrl });
      }
    }

    // Read existing progress BEFORE writing so we can detect the threshold crossing.
    const prev = getProgress(p.animeId, p.episode);
    setProgress(p);

    // Auto-mark watched on the FIRST crossing of 85%.
    if (p.animeId !== 0 && p.durationSec) {
      const prevPct = prev && prev.durationSec ? prev.positionSec / prev.durationSec : 0;
      const newPct = p.positionSec / p.durationSec;
      const justCrossed = prevPct < 0.85 && newPct >= 0.85;
      if (justCrossed) {
        try {
          await markEpisodeWatched(p.animeId, p.episode);
        } catch (e) {
          console.warn("markEpisodeWatched failed", e);
        }
        try {
          await alMarkEpisodeWatched(p.animeId, p.episode);
        } catch (e) {
          console.warn("alMarkEpisodeWatched failed", e);
        }
      }
    }
    return { ok: true };
  });
}
