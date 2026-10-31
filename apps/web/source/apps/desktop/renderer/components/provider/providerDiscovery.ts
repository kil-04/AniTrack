import { pickVerifiedCandidate, scoreMatch } from "../../lib/match.ts";
import { providerClient } from "../../lib/provider-api";
import { normalizeProviderTitle } from "./providerSearch";

export interface ProviderDiscoveryOptions {
  title: string;
  anilistId: number;
  year?: number;
  episodes?: number;
  status?: string;
  onOptimistic?: (sources: any[]) => void;
  shouldStop?: () => boolean;
}

/**
 * Match one anime against every enabled connector. The UI receives an
 * optimistic result immediately; slower provider-ID verification may replace it.
 */
export async function discoverProviderSources(options: ProviderDiscoveryOptions): Promise<any[]> {
  let targetYear = options.year;
  let targetEpisodes = options.episodes;
  let targetStatus = options.status;
  const searchQueries = [options.title];
  let meta: any = null;

  try {
    if (options.anilistId > 0 && options.anilistId < 1_000_000_000) {
      meta = await window.api.anilist.get(options.anilistId);
    } else {
      // Provider-only feed entries have no AniList id. Metadata supplies title
      // variants so every connector gets a fair search query.
      const results = await window.api.anilist.search(options.title);
      if (results?.length) meta = results[0];
    }
  } catch (error) {
    console.warn("[StreamPlayer] Failed to load AniList metadata:", error);
  }

  let targetMalId: number | undefined;
  if (meta) {
    if (meta.year) targetYear = meta.year;
    if (meta.episodes) targetEpisodes = meta.episodes;
    if (meta.status) targetStatus = meta.status;
    if (meta.malId) targetMalId = meta.malId;
    if (meta.titleRomaji && meta.titleRomaji.toLowerCase() !== options.title.toLowerCase()) {
      searchQueries.push(meta.titleRomaji);
    }
    if (
      meta.title
      && meta.title.toLowerCase() !== options.title.toLowerCase()
      && (!meta.titleRomaji || meta.title.toLowerCase() !== meta.titleRomaji.toLowerCase())
    ) {
      searchQueries.push(meta.title);
    }
  }

  const searchResults = await Promise.all(
    searchQueries.map((query) => providerClient.search(query).catch(() => [])),
  );
  const combined = new Map<string, { item: any; matchedQuery: string }>();
  searchResults.forEach((results, index) => {
    for (const item of results) {
      const key = `${item.providerId ?? "animepahe"}:${item.id}`;
      if (!combined.has(key)) combined.set(key, { item, matchedQuery: searchQueries[index] });
    }
  });

  const scored = Array.from(combined.values())
    .filter(({ item }) => !targetYear || !item.year || Math.abs(Number(item.year) - targetYear) <= 3)
    .map(({ item, matchedQuery }) => ({
      item,
      score: Math.max(
        ...searchQueries.map((query) => scoreMatch(item, query, targetYear, targetEpisodes, targetStatus)),
        scoreMatch(item, matchedQuery, targetYear, targetEpisodes, targetStatus),
      ),
    }))
    .filter(({ score }) => score >= 20)
    .sort((left, right) => right.score - left.score)
    .map(({ item }) => item);

  if (scored.length === 0 || options.shouldStop?.()) return [];

  const byProvider = new Map<string, any[]>();
  for (const item of scored) {
    const providerId = item.providerId || "animepahe";
    const candidates = byProvider.get(providerId) ?? [];
    if (candidates.length < 3) candidates.push(item);
    byProvider.set(providerId, candidates);
  }

  const optimistic = Array.from(byProvider.values()).map((candidates) => candidates[0]);
  options.onOptimistic?.(optimistic);

  const realAnilistId = options.anilistId > 0 && options.anilistId < 1_000_000_000
    ? options.anilistId
    : undefined;
  if (!realAnilistId && !targetMalId) return optimistic;

  // A provider can expose a correct id under a misleading title/year. Keep a
  // small set of plausible rejected candidates available to ID verification.
  const plausibleRejects = Array.from(combined.values())
    .filter(({ item }) => targetYear && item.year && Math.abs(Number(item.year) - targetYear) > 3)
    .filter(({ item }) => {
      const candidate = normalizeProviderTitle(item.title);
      return searchQueries.some((query) => {
        const target = normalizeProviderTitle(query);
        return Boolean(target && candidate && (candidate.includes(target) || target.includes(candidate)));
      });
    })
    .map(({ item }) => item);

  const verified: any[] = [];
  let changed = false;
  for (const [providerId, candidates] of byProvider.entries()) {
    if (options.shouldStop?.()) return optimistic;
    const rejected = plausibleRejects
      .filter((item) => (item.providerId || "animepahe") === providerId)
      .slice(0, 2);
    const selected = await pickVerifiedCandidate(
      [...candidates, ...rejected],
      realAnilistId,
      targetMalId,
    ) ?? candidates[0];
    if (selected !== candidates[0]) changed = true;
    verified.push(selected);
  }
  return changed ? verified : optimistic;
}
