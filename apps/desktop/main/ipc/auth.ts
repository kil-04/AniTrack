import { ipcMain, BrowserWindow } from "electron";
import { IPC } from "../../../../packages/shared/types";
import {
  beginAuth,
  disconnect as malDisconnect,
  flushDirty,
  getState,
  getMalClientInfo,
  onMalStateChange,
  pullList,
  setMalClientId,
} from "../services/mal";
import { getById, getRelations, searchAnime, advancedSearchAnime, trending, getAiringFor, recentEpisodes, recommendations, premieredOn, getStory, timeMachineYear } from "../services/anilist";
import { themeRadio, themesForAnime } from "../services/animethemes";
import {
  beginAuth as alBeginAuth,
  disconnect as alDisconnect,
  getState as alGetState,
  pullList as alPullList,
  setClientId as alSetClientId,
} from "../services/anilist-sync";
import { getAnime, upsertAnime } from "../services/db";
import { repairAndNotify } from "../services/list-repair";

export function registerAuthIpc(getMainWindow: () => BrowserWindow | null) {
  // MAL
  ipcMain.handle(IPC.MAL_BEGIN_AUTH, () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { ok: false, reason: "no window" };
    return beginAuth(mainWindow);
  });
  ipcMain.handle(IPC.MAL_STATE, () => getState());
  // MAL can end the sign-in in the background: Settings and the sidebar repaint.
  onMalStateChange((state) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("mal:state-changed", state);
  });
  ipcMain.handle(IPC.MAL_DISCONNECT, () => {
    malDisconnect();
    return getState();
  });
  ipcMain.handle(IPC.MAL_PULL, async () => {
    const mainWindow = getMainWindow();
    const result = await pullList((n) =>
      mainWindow?.webContents.send("mal:pull-progress", n)
    );
    // Anything the import still had to keep under a stand-in id is folded in now.
    await repairAndNotify(mainWindow).catch((e) => console.warn("List repair failed", e));
    return result;
  });
  ipcMain.handle(IPC.MAL_PUSH_PROGRESS, async () => flushDirty());
  ipcMain.handle(IPC.MAL_SET_CLIENT_ID, (_e, id: string) => setMalClientId(id));
  ipcMain.handle(IPC.MAL_CLIENT_INFO, () => getMalClientInfo());

  // AniList sync
  ipcMain.handle(IPC.AL_BEGIN_AUTH, () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { ok: false, reason: "no window" };
    return alBeginAuth(mainWindow);
  });
  ipcMain.handle(IPC.AL_STATE, () => alGetState());
  ipcMain.handle(IPC.AL_DISCONNECT, () => { alDisconnect(); return alGetState(); });
  ipcMain.handle(IPC.AL_PULL, async () => {
    const mainWindow = getMainWindow();
    return alPullList((n) => mainWindow?.webContents.send("al:pull-progress", n));
  });
  ipcMain.handle(IPC.AL_SET_CLIENT_ID, (_e, id: string) => {
    alSetClientId(id);
    return alGetState();
  });

  // AniList metadata
  ipcMain.handle(IPC.ANILIST_SEARCH, (_e, q: string) => searchAnime(q));
  ipcMain.handle(IPC.ANILIST_ADVANCED_SEARCH, (_e, filters: import("../../../../packages/shared/types").AdvancedSearchFilters) => advancedSearchAnime(filters));
  ipcMain.handle(IPC.ANILIST_TRENDING, () => trending());
  ipcMain.handle(IPC.ANILIST_AIRING, (_e, ids: number[]) => getAiringFor(ids));
  ipcMain.handle(IPC.ANILIST_RECENT, (_e, page = 1) => recentEpisodes(page));
  ipcMain.handle(IPC.ANILIST_RECOMMENDATIONS, (_e, seedIds: number[], excludedIds: number[]) =>
    recommendations(seedIds, excludedIds));
  ipcMain.handle(IPC.ANILIST_RELATIONS, (_e, id: number) => getRelations(id));
  ipcMain.handle(IPC.THEMES_FOR_ANIME, (_e, id: unknown) => {
    const animeId = Number(id);
    if (!Number.isInteger(animeId) || animeId <= 0) throw new Error("Invalid anime id");
    return themesForAnime(animeId);
  });
  ipcMain.handle(IPC.THEMES_RADIO, () => themeRadio());
  ipcMain.handle(IPC.ANILIST_STORY, (_e, id: unknown) => {
    const animeId = Number(id);
    if (!Number.isInteger(animeId) || animeId <= 0) throw new Error("Invalid anime id");
    return getStory(animeId);
  });
  ipcMain.handle(IPC.ANILIST_PREMIERED_ON, (_e, month: unknown, day: unknown) => {
    const m = Number(month);
    const d = Number(day);
    if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(d) || d < 1 || d > 31) {
      throw new Error("Invalid date");
    }
    return premieredOn(m, d);
  });
  ipcMain.handle(IPC.ANILIST_TIME_MACHINE, (_e, year: unknown, part: unknown) => {
    const y = Number(year);
    if (!Number.isInteger(y) || y < 1900 || y > 2100) throw new Error("Invalid year");
    if (part !== "main" && part !== "gems") throw new Error("Invalid Time Machine part");
    return timeMachineYear(y, part);
  });
  ipcMain.handle(IPC.ANILIST_GET, async (_e, id: number) => {
    console.log(`[IPC.ANILIST_GET] Received id:`, id, `type:`, typeof id);
    // Skip AniList for synthetic IDs
    if (id <= 0 || id > 1_000_000_000) {
      console.log(`[IPC.ANILIST_GET] Synthetic/invalid ID, fallback to getAnime`);
      return getAnime(id);
    }
    const cached = getAnime(id);
    console.log(`[IPC.ANILIST_GET] Cached lookup:`, cached ? `Found (${cached.title})` : `Not found`);
    if (cached?.coverImage) return cached;
    try {
      console.log(`[IPC.ANILIST_GET] Fetching from AniList getById(${id})`);
      const anime = await getById(id);
      console.log(`[IPC.ANILIST_GET] AniList fetch result:`, anime ? `Success (${anime.title})` : `Null`);
      if (anime) upsertAnime(anime);
      return anime ?? cached ?? null;
    } catch (err) {
      console.error(`[IPC.ANILIST_GET] Error fetching getById(${id}):`, err);
      return cached ?? null;
    }
  });
}
