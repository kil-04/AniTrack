import { ipcMain } from "electron";
import { IPC } from "../../../../packages/shared/types";
import type { ProviderFeed } from "../../../../packages/shared/provider-types";
import { providerManager } from "../services/providers";
import { getLatestEpisodes } from "../services/providers/animepahe";
import { getAnikotoTop } from "../services/providers/anikoto";

export function registerProviderIpc(registerWebRequestHandlers: () => void) {
  ipcMain.handle(IPC.PROVIDERS_LIST, () => providerManager.descriptors());
  ipcMain.handle(
    IPC.PROVIDERS_EXTERNAL_IDS,
    (_e, providerId: string, animeId: string, lookupId?: string | number) =>
      providerManager.getExternalIds(providerId, animeId, lookupId),
  );
  ipcMain.handle(
    IPC.PROVIDERS_FIND_BY_EXTERNAL_ID,
    (_e, anilistId: number | undefined, malId: number | undefined) =>
      providerManager.findByExternalId(anilistId, malId),
  );
  ipcMain.handle(
    IPC.PROVIDERS_FEED,
    (_e, feed: ProviderFeed, page = 1, count = 30) =>
      providerManager.getPreferredFeed(feed, page, count),
  );
  // Provider-specific legacy channels keep their historical response shapes.
  ipcMain.handle(IPC.PAHE_LATEST, (_e, page = 1) => getLatestEpisodes(30, page));
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
      providerManager.prefetch(providerIdOrKwikUrl, linkId);
    } else {
      // Compatibility for older renderers that passed only an AnimePahe URL.
      providerManager.prefetch("animepahe", providerIdOrKwikUrl);
    }
    return { ok: true };
  });
  ipcMain.handle(IPC.PAHE_GET_IDS, (_e, paheId: number | string, session: string) => {
    // Anikoto candidates pass their slug (non-numeric string) as the id; pahe
    // candidates pass a numeric paheId + UUID session. Route accordingly so
    // match verification works for BOTH providers (anikoto entries can be
    // mislabeled — only their embedded MAL id tells the truth).
    if (typeof paheId === "string" && !/^\d+$/.test(paheId)) {
      return providerManager.getExternalIds("anikoto", paheId);
    }
    return providerManager.getExternalIds("animepahe", session, paheId);
  });
  ipcMain.handle(IPC.PAHE_FIND_BY_ID, (_e, anilistId: number | undefined, malId: number | undefined) =>
    providerManager.findByExternalId(anilistId, malId)
  );
  ipcMain.handle(IPC.ANIKOTO_TOP, () => getAnikotoTop());
  ipcMain.handle(IPC.PAHE_GET_URL, () => providerManager.getBaseUrl("animepahe"));
  ipcMain.handle(IPC.PAHE_SET_URL, (_e, url: string) => {
    try {
      providerManager.setBaseUrl("animepahe", url);
      registerWebRequestHandlers(); // re-derive CDN/snapshot hosts from new URL
      return { ok: true, url: providerManager.getBaseUrl("animepahe") };
    } catch (e: any) {
      return { ok: false, url: providerManager.getBaseUrl("animepahe"), reason: e.message };
    }
  });
}
