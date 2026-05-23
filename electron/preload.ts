import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/types";

// Thin, typed-ish bridge. Renderer never touches Node directly.
contextBridge.exposeInMainWorld("api", {
  mal: {
    beginAuth: () => ipcRenderer.invoke(IPC.MAL_BEGIN_AUTH),
    state: () => ipcRenderer.invoke(IPC.MAL_STATE),
    disconnect: () => ipcRenderer.invoke(IPC.MAL_DISCONNECT),
    pull: () => ipcRenderer.invoke(IPC.MAL_PULL),
    push: () => ipcRenderer.invoke(IPC.MAL_PUSH_PROGRESS),
  },
  anilist: {
    search: (q: string) => ipcRenderer.invoke(IPC.ANILIST_SEARCH, q),
    trending: () => ipcRenderer.invoke(IPC.ANILIST_TRENDING),
    get: (id: number) => ipcRenderer.invoke(IPC.ANILIST_GET, id),
  },
  library: {
    addFolder: () => ipcRenderer.invoke(IPC.LIBRARY_ADD_FOLDER),
    removeFolder: (p: string) =>
      ipcRenderer.invoke(IPC.LIBRARY_REMOVE_FOLDER, p),
    listFolders: () => ipcRenderer.invoke(IPC.LIBRARY_LIST_FOLDERS),
    scan: () => ipcRenderer.invoke(IPC.LIBRARY_SCAN),
    episodesFor: (id: number) =>
      ipcRenderer.invoke(IPC.LIBRARY_EPISODES_FOR, id),
  },
  list: {
    getAll: () => ipcRenderer.invoke(IPC.LIST_GET_ALL),
    set: (entry: unknown) => ipcRenderer.invoke(IPC.LIST_SET, entry),
    continueWatching: () => ipcRenderer.invoke(IPC.CONTINUE_WATCHING),
    continueWatchingPaged: (page: number, pageSize: number) =>
      ipcRenderer.invoke(IPC.CW_PAGED, page, pageSize),
    dismissContinueWatching: (animeId: number) => ipcRenderer.invoke(IPC.CW_DISMISS, animeId),
  },
  progress: {
    get: (id: number, ep: number) =>
      ipcRenderer.invoke(IPC.PROGRESS_GET, id, ep),
    set: (p: unknown) => ipcRenderer.invoke(IPC.PROGRESS_SET, p),
  },
  player: {
    resolveFile: (p: string) =>
      ipcRenderer.invoke(IPC.PLAYER_RESOLVE_FILE, p),
  },
  legal: {
    links: (id: number) => ipcRenderer.invoke(IPC.LEGAL_LINKS, id),
    open: (url: string) => ipcRenderer.invoke(IPC.LEGAL_OPEN, url),
  },
  pahe: {
    latest: (page = 1) => ipcRenderer.invoke(IPC.PAHE_LATEST, page),
    search: (q: string) => ipcRenderer.invoke(IPC.PAHE_SEARCH, q),
    episodes: (session: string, page: number) =>
      ipcRenderer.invoke(IPC.PAHE_EPISODES, session, page),
    links: (epSession: string, animeSession: string) =>
      ipcRenderer.invoke(IPC.PAHE_LINKS, epSession, animeSession),
    resolve: (kwikUrl: string) => ipcRenderer.invoke(IPC.PAHE_RESOLVE, kwikUrl),
    prefetch: (kwikUrl: string) => ipcRenderer.invoke(IPC.PAHE_PREFETCH, kwikUrl),
    getIds: (paheId: number, session: string) => ipcRenderer.invoke(IPC.PAHE_GET_IDS, paheId, session),
    findById: (anilistId: number | undefined, malId?: number) => ipcRenderer.invoke(IPC.PAHE_FIND_BY_ID, anilistId, malId),
  },
  on: (channel: string, fn: (...args: unknown[]) => void) => {
    const sub = (_e: unknown, ...args: unknown[]) => fn(...args);
    ipcRenderer.on(channel, sub);
    return () => ipcRenderer.removeListener(channel, sub);
  },
});
