import { ipcMain } from "electron";
import { IPC } from "../../shared/types";
import { providerManager } from "../services/providers";
import {
  getLatestEpisodes as paheLatest,
  getAnimeIds as paheGetIds,
  findByExternalId as paheFindById,
  prefetchKwik,
  getPaheBaseUrl,
  setPaheBaseUrl,
} from "../services/providers/animepahe";
import { getAnikotoTop } from "../services/providers/anikoto";

export function registerPaheIpc(registerWebRequestHandlers: () => void) {
  ipcMain.handle(IPC.PAHE_LATEST, (_e, page = 1) => paheLatest(30, page));
  ipcMain.handle(IPC.PAHE_SEARCH, (_e, q: string) => providerManager.searchAll(q));
  
  // Notice that "session" is now treated as "animeId"
  ipcMain.handle(IPC.PAHE_EPISODES, (_e, providerId: string, animeId: string, page: number) =>
    providerManager.getEpisodes(providerId, animeId, page)
  );
  
  ipcMain.handle(IPC.PAHE_LINKS, (_e, providerId: string, episodeId: string, animeId: string) =>
    providerManager.getStreamLinks(providerId, episodeId, animeId)
  );
  
  ipcMain.handle(IPC.PAHE_RESOLVE, (_e, providerId: string, linkId: string) => 
    providerManager.resolveStream(providerId, linkId)
  );
  
  ipcMain.handle(IPC.PAHE_PREFETCH, (_e, providerIdOrKwikUrl: string, linkId?: string) => {
    if (linkId) {
      providerManager.resolveStream(providerIdOrKwikUrl, linkId).catch(() => {});
    } else {
      prefetchKwik(providerIdOrKwikUrl);
    }
    return { ok: true };
  });
  ipcMain.handle(IPC.PAHE_GET_IDS, (_e, paheId: number, session: string) =>
    paheGetIds(paheId, session)
  );
  ipcMain.handle(IPC.PAHE_FIND_BY_ID, (_e, anilistId: number | undefined, malId: number | undefined) =>
    paheFindById(anilistId, malId)
  );
  ipcMain.handle(IPC.ANIKOTO_TOP, () => getAnikotoTop());
  ipcMain.handle(IPC.PAHE_GET_URL, () => getPaheBaseUrl());
  ipcMain.handle(IPC.PAHE_SET_URL, (_e, url: string) => {
    try {
      setPaheBaseUrl(url);
      registerWebRequestHandlers(); // re-derive CDN/snapshot hosts from new URL
      return { ok: true, url: getPaheBaseUrl() };
    } catch (e: any) {
      return { ok: false, url: getPaheBaseUrl(), reason: e.message };
    }
  });
}
