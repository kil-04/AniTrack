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
import { getAnikotoTop, AnikotoProvider } from "../services/providers/anikoto";

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
  ipcMain.handle(IPC.PAHE_GET_IDS, (_e, paheId: number | string, session: string) => {
    // Anikoto candidates pass their slug (non-numeric string) as the id; pahe
    // candidates pass a numeric paheId + UUID session. Route accordingly so
    // match verification works for BOTH providers (anikoto entries can be
    // mislabeled — only their embedded MAL id tells the truth).
    if (typeof paheId === "string" && !/^\d+$/.test(paheId)) {
      const anikoto = providerManager.getProvider("anikoto") as AnikotoProvider;
      return anikoto.getAnimeIds(paheId);
    }
    return paheGetIds(Number(paheId), session);
  });
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
