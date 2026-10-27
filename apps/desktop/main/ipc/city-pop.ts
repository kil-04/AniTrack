import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { IPC } from "../../../../packages/shared/types";
import { closeCityPop, cityPopIsOpen, openCityPop, playArchiveCityPop, playOfflineCityPop, searchCityPop } from "../services/city-pop-player";
import { searchCityPopArchive, cityPopArchiveItem, downloadCityPopArchive, cityPopDownloads, cancelCityPopDownload, removeCityPopDownload } from "../services/city-pop-archive";
import type { CityPopMode } from "../../../../packages/shared/city-pop-api";

export function registerCityPopIpc(getMainWindow: () => BrowserWindow | null): void {
  const owner = (event: IpcMainInvokeEvent): BrowserWindow => {
    const win = getMainWindow();
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error("City Pop is only available in AniTrack.");
    return win;
  };
  const mode = (value: unknown): CityPopMode => {
    if (value !== "listen" && value !== "watch") throw new Error("Choose Listen or Watch.");
    return value;
  };
  const text = (value: unknown, max = 1024): string => {
    if (typeof value !== "string" || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error("Invalid City Pop selection.");
    return value;
  };
  /** Search text: a tab pasted from a tracklist is a space (as in the shared Archive query and on Android). Ids stay strict. */
  const query = (value: unknown): string => {
    if (typeof value !== "string" || value.length > 200) throw new Error("Invalid City Pop selection.");
    return value.replace(/[\x00-\x1f\x7f]/g, " ");
  };
  const key = (value: unknown) => {
    const result = text(value, 64);
    if (!/^[a-f0-9]{64}$/.test(result)) throw new Error("Choose a City Pop download.");
    return result;
  };
  ipcMain.handle(IPC.CITY_POP_OPEN, (event, ids: unknown, value: unknown, saved: unknown) => openCityPop(owner(event), ids, mode(value), saved));
  ipcMain.handle(IPC.CITY_POP_CLOSE, (event) => { owner(event); closeCityPop(); });
  ipcMain.handle(IPC.CITY_POP_STATUS, (event) => { owner(event); return cityPopIsOpen(); });
  ipcMain.handle(IPC.CITY_POP_SEARCH, (event, value: unknown) => { owner(event); return searchCityPop(query(value)); });
  ipcMain.handle(IPC.CITY_POP_ARCHIVE_SEARCH, (event, value: unknown, page: unknown = 1, media: unknown = "all") => {
    owner(event);
    if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || page > 1000) throw new Error("Invalid search page.");
    if (media !== "all" && media !== "audio" && media !== "video") throw new Error("Invalid Archive media filter.");
    return searchCityPopArchive(query(value), page, media);
  });
  ipcMain.handle(IPC.CITY_POP_ARCHIVE_ITEM, (event, id: unknown) => { owner(event); return cityPopArchiveItem(text(id, 100)); });
  /** An album's files (each once) and the one to start from. */
  const files = (value: unknown, from: unknown): { names: string[]; start: number } => {
    if (!Array.isArray(value) || value.length < 1 || value.length > 200) throw new Error("Invalid City Pop selection.");
    const names = value.map((name) => text(name));
    if (new Set(names).size !== names.length) throw new Error("Invalid City Pop selection.");
    if (typeof from !== "number" || !Number.isSafeInteger(from) || from < 0 || from >= names.length) throw new Error("Invalid City Pop selection.");
    return { names, start: from };
  };
  ipcMain.handle(IPC.CITY_POP_ARCHIVE_PLAY, (event, id: unknown, names: unknown, from: unknown, value: unknown) => {
    const win = owner(event);
    const queue = files(names, from);
    return playArchiveCityPop(win, text(id, 100), queue.names, queue.start, mode(value));
  });
  ipcMain.handle(IPC.CITY_POP_ARCHIVE_DOWNLOAD, (event, id: unknown, file: unknown) => { owner(event); return downloadCityPopArchive(text(id, 100), text(file)); });
  ipcMain.handle(IPC.CITY_POP_DOWNLOADS, (event) => { owner(event); return cityPopDownloads(); });
  ipcMain.handle(IPC.CITY_POP_DOWNLOAD_CANCEL, (event, value: unknown) => { owner(event); cancelCityPopDownload(key(value)); });
  ipcMain.handle(IPC.CITY_POP_DOWNLOAD_REMOVE, (event, value: unknown) => { owner(event); removeCityPopDownload(key(value)); });
  ipcMain.handle(IPC.CITY_POP_DOWNLOAD_PLAY, (event, value: unknown, selectedMode: unknown) => playOfflineCityPop(owner(event), key(value), mode(selectedMode)));
}
