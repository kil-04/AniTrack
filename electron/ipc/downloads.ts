import { ipcMain, BrowserWindow } from "electron";
import { IPC } from "../../shared/types";
import {
  startDownload,
  listDownloads,
  removeDownload,
  getDownloadPlayUrl,
  setDownloadEmitter,
  assertDownloadId,
  assertStartOpts,
  type StartOpts,
} from "../services/downloads";

export function registerDownloadsIpc(getMainWindow: () => BrowserWindow | null) {
  // Push progress events to the renderer (mirrors the Android plugin's listener).
  setDownloadEmitter((item) => {
    getMainWindow()?.webContents.send("download:progress", item);
  });

  ipcMain.handle(IPC.DOWNLOAD_START, (_e, opts: unknown) => {
    assertStartOpts(opts);
    startDownload(opts as StartOpts);
    return { ok: true };
  });
  ipcMain.handle(IPC.DOWNLOAD_LIST, () => listDownloads());
  ipcMain.handle(IPC.DOWNLOAD_REMOVE, (_e, id: unknown) => {
    assertDownloadId(id);
    removeDownload(id);
    return { ok: true };
  });
  ipcMain.handle(IPC.DOWNLOAD_GET_PLAY_URL, (_e, id: unknown) => {
    assertDownloadId(id);
    return getDownloadPlayUrl(id);
  });
}
