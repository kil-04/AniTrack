import { ipcMain, BrowserWindow } from "electron";
import { IPC } from "../../shared/types";
import {
  beginAuth,
  disconnect as malDisconnect,
  flushDirty,
  getState,
  getMalClientInfo,
  pullList,
  setMalClientId,
} from "../services/mal";
import { getById, getRelations, searchAnime, advancedSearchAnime, trending, getAiringFor, recentEpisodes } from "../services/anilist";
import {
  beginAuth as alBeginAuth,
  disconnect as alDisconnect,
  getState as alGetState,
  pullList as alPullList,
  setClientId as alSetClientId,
} from "../services/anilist-sync";
import { getAnime, upsertAnime } from "../services/db";

export function registerAuthIpc(getMainWindow: () => BrowserWindow | null) {
  // MAL
  ipcMain.handle(IPC.MAL_BEGIN_AUTH, () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { ok: false, reason: "no window" };
    return beginAuth(mainWindow);
  });
  ipcMain.handle(IPC.MAL_STATE, () => getState());
  ipcMain.handle(IPC.MAL_DISCONNECT, () => {
    malDisconnect();
    return getState();
  });
  ipcMain.handle(IPC.MAL_PULL, async () => {
    const mainWindow = getMainWindow();
    return await pullList((n) =>
      mainWindow?.webContents.send("mal:pull-progress", n)
    );
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
  ipcMain.handle(IPC.ANILIST_ADVANCED_SEARCH, (_e, filters: import("../../shared/types").AdvancedSearchFilters) => advancedSearchAnime(filters));
  ipcMain.handle(IPC.ANILIST_TRENDING, () => trending());
  ipcMain.handle(IPC.ANILIST_AIRING, (_e, ids: number[]) => getAiringFor(ids));
  ipcMain.handle(IPC.ANILIST_RECENT, (_e, page = 1) => recentEpisodes(page));
  ipcMain.handle(IPC.ANILIST_RELATIONS, (_e, id: number) => getRelations(id));
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
