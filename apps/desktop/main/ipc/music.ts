import { dialog, ipcMain, shell, type BrowserWindow } from "electron";
import { IPC } from "../../../../packages/shared/types";
import { BG_MUSIC_EXTENSIONS } from "../../../../packages/shared/bg-music";
import { importTracks, listTracks, musicDir, removeTrack } from "../services/music";

/** Background music: the user's own tracks in userData/music (see services/music.ts). */
export function registerMusicIpc(getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle(IPC.MUSIC_LIST, () => listTracks());
  ipcMain.handle(IPC.MUSIC_IMPORT, async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Import music",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Audio or .zip", extensions: [...BG_MUSIC_EXTENSIONS.map((ext) => ext.slice(1)), "zip"] }],
    };
    const win = getMainWindow();
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const result = picked.canceled ? { added: 0, skipped: 0 } : await importTracks(picked.filePaths);
    return { ...result, tracks: listTracks() };
  });
  ipcMain.handle(IPC.MUSIC_REMOVE, (_e, id: unknown) => {
    removeTrack(id);
    return listTracks();
  });
  ipcMain.handle(IPC.MUSIC_OPEN_FOLDER, async () => {
    const error = await shell.openPath(musicDir());
    return { ok: !error };
  });
}
