import { ipcMain, BrowserWindow } from "electron";
import { IPC } from "../../shared/types";
import {
  startDownload,
  listDownloads,
  removeDownload,
  getDownloadPlayUrl,
  setDownloadEmitter,
  type StartOpts,
} from "../services/downloads";

export function registerDownloadsIpc(getMainWindow: () => BrowserWindow | null) {
  // Push progress events to the renderer (mirrors the Android plugin's listener).
  setDownloadEmitter((item) => {
    getMainWindow()?.webContents.send("download:progress", item);
  });

  ipcMain.handle(IPC.DOWNLOAD_START, (_e, opts: StartOpts) => { startDownload(opts); return { ok: true }; });
  ipcMain.handle(IPC.DOWNLOAD_LIST, () => listDownloads());
  ipcMain.handle(IPC.DOWNLOAD_REMOVE, (_e, id: string) => { removeDownload(id); return { ok: true }; });
  ipcMain.handle(IPC.DOWNLOAD_GET_PLAY_URL, (_e, id: string) => getDownloadPlayUrl(id));
}
