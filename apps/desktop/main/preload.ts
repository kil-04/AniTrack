import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../../../packages/shared/types";
import { MANGA_IPC } from "../../../packages/shared/manga";
import type { MediaAccessRejection, ProviderApi, ProviderFeed } from "../../../packages/shared/provider-types";

// Thin, typed-ish bridge. Renderer never touches Node directly.
contextBridge.exposeInMainWorld("api", {
  mal: {
    beginAuth: () => ipcRenderer.invoke(IPC.MAL_BEGIN_AUTH),
    state: () => ipcRenderer.invoke(IPC.MAL_STATE),
    disconnect: () => ipcRenderer.invoke(IPC.MAL_DISCONNECT),
    pull: () => ipcRenderer.invoke(IPC.MAL_PULL),
    push: () => ipcRenderer.invoke(IPC.MAL_PUSH_PROGRESS),
    setClientId: (id: string) => ipcRenderer.invoke(IPC.MAL_SET_CLIENT_ID, id),
    clientInfo: () => ipcRenderer.invoke(IPC.MAL_CLIENT_INFO),
  },
  al: {
    beginAuth: () => ipcRenderer.invoke(IPC.AL_BEGIN_AUTH),
    state: () => ipcRenderer.invoke(IPC.AL_STATE),
    disconnect: () => ipcRenderer.invoke(IPC.AL_DISCONNECT),
    pull: () => ipcRenderer.invoke(IPC.AL_PULL),
    setClientId: (id: string) => ipcRenderer.invoke(IPC.AL_SET_CLIENT_ID, id),
  },
  anilist: {
    search: (q: string) => ipcRenderer.invoke(IPC.ANILIST_SEARCH, q),
    advancedSearch: (filters: unknown) => ipcRenderer.invoke(IPC.ANILIST_ADVANCED_SEARCH, filters),
    trending: () => ipcRenderer.invoke(IPC.ANILIST_TRENDING),
    airing: (ids: number[]) => ipcRenderer.invoke(IPC.ANILIST_AIRING, ids),
    recent: (page = 1) => ipcRenderer.invoke(IPC.ANILIST_RECENT, page),
    recommendations: (seedIds: number[], excludedIds: number[]) =>
      ipcRenderer.invoke(IPC.ANILIST_RECOMMENDATIONS, seedIds, excludedIds),
    get: (id: number) => ipcRenderer.invoke(IPC.ANILIST_GET, id),
    relations: (id: number) => ipcRenderer.invoke(IPC.ANILIST_RELATIONS, id),
    story: (id: number) => ipcRenderer.invoke(IPC.ANILIST_STORY, id),
    premieredOn: (month: number, day: number) => ipcRenderer.invoke(IPC.ANILIST_PREMIERED_ON, month, day),
  },
  manga: {
    feed: () => ipcRenderer.invoke(MANGA_IPC.FEED),
    search: (filters: unknown) => ipcRenderer.invoke(MANGA_IPC.SEARCH, filters),
    get: (id: number) => ipcRenderer.invoke(MANGA_IPC.GET, id),
    adaptations: (id: number) => ipcRenderer.invoke(MANGA_IPC.ADAPTATIONS, id),
    sources: () => ipcRenderer.invoke(MANGA_IPC.SOURCES),
    find: (sourceId: string, mangaId: number) => ipcRenderer.invoke(MANGA_IPC.FIND, sourceId, mangaId),
    chapters: (title: unknown) => ipcRenderer.invoke(MANGA_IPC.CHAPTERS, title),
    savedChapters: (title: unknown) => ipcRenderer.invoke(MANGA_IPC.CHAPTERS_SAVED, title),
    pages: (title: unknown, chapterId: string, mangaId?: number) => ipcRenderer.invoke(MANGA_IPC.PAGES, title, chapterId, mangaId),
    connect: (sourceId: string) => ipcRenderer.invoke(MANGA_IPC.CONNECT, sourceId),
    reading: (mangaId: number) => ipcRenderer.invoke(MANGA_IPC.READING_GET, mangaId),
    saveReading: (row: unknown) => ipcRenderer.invoke(MANGA_IPC.READING_SAVE, row),
    markRead: (mangaId: number, chapters: unknown, read: boolean, title: string, cover: string | null, sourceId: string) =>
      ipcRenderer.invoke(MANGA_IPC.READING_MARK, mangaId, chapters, read, title, cover, sourceId),
    continueReading: () => ipcRenderer.invoke(MANGA_IPC.CONTINUE),
    forgetReading: (mangaId: number) => ipcRenderer.invoke(MANGA_IPC.READING_FORGET, mangaId),
    readingAll: () => ipcRenderer.invoke(MANGA_IPC.READING_ALL),
    applyReading: (upserts: unknown, removes: unknown) => ipcRenderer.invoke(MANGA_IPC.READING_APPLY, upserts, removes),
    status: (mangaId: number) => ipcRenderer.invoke(MANGA_IPC.LIST_GET, mangaId),
    setStatus: (mangaId: number, status: string | null, title: string, cover: string | null) =>
      ipcRenderer.invoke(MANGA_IPC.LIST_SET, mangaId, status, title, cover),
    list: () => ipcRenderer.invoke(MANGA_IPC.LIST_ALL),
    downloads: () => ipcRenderer.invoke(MANGA_IPC.DOWNLOADS),
    download: (manga: unknown, title: unknown, chapter: unknown) => ipcRenderer.invoke(MANGA_IPC.DOWNLOAD, manga, title, chapter),
    downloadRange: (manga: unknown, title: unknown, chapters: unknown) => ipcRenderer.invoke(MANGA_IPC.DOWNLOAD_RANGE, manga, title, chapters),
    removeDownload: (key: string) => ipcRenderer.invoke(MANGA_IPC.DOWNLOAD_REMOVE, key),
    cancelDownloads: (mangaId: number) => ipcRenderer.invoke(MANGA_IPC.DOWNLOAD_CANCEL, mangaId),
    onDownload: (fn: (event: unknown) => void) => {
      const sub = (_e: unknown, event: unknown) => fn(event);
      ipcRenderer.on(MANGA_IPC.DOWNLOAD_EVENT, sub);
      return () => { ipcRenderer.removeListener(MANGA_IPC.DOWNLOAD_EVENT, sub); };
    },
    tracked: () => ipcRenderer.invoke(MANGA_IPC.TRACKED),
    latest: (mangaId: number, preferred: string | null, skip: string[]) => ipcRenderer.invoke(MANGA_IPC.LATEST, mangaId, preferred, skip),
  },
  themes: {
    forAnime: (id: number) => ipcRenderer.invoke(IPC.THEMES_FOR_ANIME, id),
    radio: () => ipcRenderer.invoke(IPC.THEMES_RADIO),
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
    getForAnime: (id: number) => ipcRenderer.invoke(IPC.PROGRESS_GET_FOR_ANIME, id),
  },
  providers: {
    list: () => ipcRenderer.invoke(IPC.PROVIDERS_LIST),
    search: (q: string) => ipcRenderer.invoke(IPC.PAHE_SEARCH, q),
    episodes: (providerId: string, animeId: string, page: number) =>
      ipcRenderer.invoke(IPC.PAHE_EPISODES, providerId, animeId, page),
    links: (providerId: string, episodeId: string, animeId: string) =>
      ipcRenderer.invoke(IPC.PAHE_LINKS, providerId, episodeId, animeId),
    resolve: (providerId: string, linkId: string) => ipcRenderer.invoke(IPC.PAHE_RESOLVE, providerId, linkId),
    mediaAccessStatus: (mediaAccessId: string) => ipcRenderer.invoke(IPC.PROVIDERS_MEDIA_ACCESS_STATUS, mediaAccessId),
    onMediaAccessRejected: (listener: (rejection: MediaAccessRejection) => void) => {
      const receive = (_event: Electron.IpcRendererEvent, rejection: MediaAccessRejection) => listener(rejection);
      ipcRenderer.on(IPC.PROVIDERS_MEDIA_ACCESS_REJECTED, receive);
      return () => ipcRenderer.removeListener(IPC.PROVIDERS_MEDIA_ACCESS_REJECTED, receive);
    },
    prefetch: (providerId: string, linkId: string) => ipcRenderer.invoke(IPC.PAHE_PREFETCH, providerId, linkId),
    getExternalIds: (providerId: string, animeId: string, lookupId?: string | number) =>
      ipcRenderer.invoke(IPC.PROVIDERS_EXTERNAL_IDS, providerId, animeId, lookupId),
    findByExternalId: (anilistId?: number, malId?: number) =>
      ipcRenderer.invoke(IPC.PROVIDERS_FIND_BY_EXTERNAL_ID, anilistId, malId),
    feed: (feed: ProviderFeed, page = 1, count = 30) =>
      ipcRenderer.invoke(IPC.PROVIDERS_FEED, feed, page, count),
  } satisfies ProviderApi,
  pahe: {
    latest: (page = 1) => ipcRenderer.invoke(IPC.PAHE_LATEST, page),
    search: (q: string) => ipcRenderer.invoke(IPC.PAHE_SEARCH, q),
    episodes: (providerId: string, animeId: string, page: number) =>
      ipcRenderer.invoke(IPC.PAHE_EPISODES, providerId, animeId, page),
    links: (providerId: string, episodeId: string, animeId: string) =>
      ipcRenderer.invoke(IPC.PAHE_LINKS, providerId, episodeId, animeId),
    resolve: (providerId: string, linkId: string) => ipcRenderer.invoke(IPC.PAHE_RESOLVE, providerId, linkId),
    prefetch: (providerIdOrKwikUrl: string, linkId?: string) => ipcRenderer.invoke(IPC.PAHE_PREFETCH, providerIdOrKwikUrl, linkId),
    getIds: (paheId: number | string, session: string) => ipcRenderer.invoke(IPC.PAHE_GET_IDS, paheId, session),
    findById: (anilistId: number | undefined, malId?: number) => ipcRenderer.invoke(IPC.PAHE_FIND_BY_ID, anilistId, malId),
    getUrl: () => ipcRenderer.invoke(IPC.PAHE_GET_URL),
    setUrl: (url: string) => ipcRenderer.invoke(IPC.PAHE_SET_URL, url),
    anikotoTop: () => ipcRenderer.invoke(IPC.ANIKOTO_TOP),
  },
  updater: {
    check: () => ipcRenderer.invoke(IPC.UPDATE_CHECK),
    status: () => ipcRenderer.invoke(IPC.UPDATE_STATUS),
    install: () => ipcRenderer.invoke(IPC.UPDATE_INSTALL),
  },
  automation: {
    status: () => ipcRenderer.invoke(IPC.AUTOMATION_STATUS),
    refresh: () => ipcRenderer.invoke(IPC.AUTOMATION_REFRESH),
  },
  downloads: {
    start: (opts: unknown) => ipcRenderer.invoke(IPC.DOWNLOAD_START, opts),
    list: () => ipcRenderer.invoke(IPC.DOWNLOAD_LIST),
    remove: (id: string) => ipcRenderer.invoke(IPC.DOWNLOAD_REMOVE, id),
    getPlayUrl: (id: string) => ipcRenderer.invoke(IPC.DOWNLOAD_GET_PLAY_URL, id),
  },
  on: (channel: string, fn: (...args: unknown[]) => void) => {
    const sub = (_e: unknown, ...args: unknown[]) => fn(...args);
    ipcRenderer.on(channel, sub);
    return () => ipcRenderer.removeListener(channel, sub);
  },
});
