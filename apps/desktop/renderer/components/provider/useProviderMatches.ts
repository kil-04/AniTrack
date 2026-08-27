import { useEffect, useState } from "react";
import { pickVerifiedCandidate, scoreMatch } from "../../lib/match";
import { providerClient } from "../../lib/provider-api";
import {
  buildProviderSearchQueries,
  normalizeProviderTitle,
  pickProviderResult,
} from "./providerSearch";

interface ProviderMatchOptions {
  animeTitle: string;
  animeTitleAlt?: string;
  animeTitleRomaji?: string;
  animeId?: number;
  animeMalId?: number;
  animeYear?: number;
  animeEpisodes?: number;
  animeStatus?: string;
  showManualWhenEmpty: boolean;
}

interface CachedProviderMatch {
  results: any[];
  selected: any;
}

const searchCache = new Map<string | number, CachedProviderMatch>();

function cacheMatch(key: string | number, value: CachedProviderMatch): void {
  if (searchCache.size >= 100) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
  searchCache.set(key, value);
}

export function useProviderMatches(options: ProviderMatchOptions) {
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState("");
  const [showManualSearch, setShowManualSearch] = useState(false);

  useEffect(() => {
    if (!options.animeTitle) return;
    let cancelled = false;
    setShowManualSearch(false);
    setError(null);

    const cacheKey: string | number = options.animeId && options.animeId < 1_000_000_000
      ? options.animeId
      : options.animeTitle;
    const cached = searchCache.get(cacheKey);
    if (cached) {
      setResults(cached.results);
      setSelected(cached.selected);
      return;
    }

    setSelected(null);
    setResults([]);
    setSearching(true);

    const runSearch = async () => {
      const queries = buildProviderSearchQueries(
        options.animeTitle,
        options.animeTitleAlt,
        options.animeTitleRomaji,
      );
      const searchResults = await Promise.all(
        queries.map((query) => providerClient.search(query).catch(() => [])),
      );
      if (cancelled) return;

      const combined = new Map<string, { candidate: any; matchedQuery: string }>();
      searchResults.forEach((list, index) => {
        for (const candidate of list) {
          const key = `${candidate.providerId ?? "animepahe"}:${candidate.id}`;
          if (!combined.has(key)) combined.set(key, { candidate, matchedQuery: queries[index] });
        }
      });

      const realAnilistId = options.animeId && options.animeId < 1_000_000_000
        ? options.animeId
        : undefined;
      const realMalId = options.animeMalId
        ?? (options.animeId && options.animeId >= 1_000_000_000
          ? options.animeId - 1_000_000_000
          : undefined);
      if (realAnilistId || realMalId) {
        const externalMatch = await providerClient.findByExternalId(realAnilistId, realMalId).catch(() => null);
        if (cancelled) return;
        if (externalMatch) {
          const key = `${externalMatch.providerId ?? "animepahe"}:${externalMatch.id}`;
          if (!combined.has(key)) {
            combined.set(key, { candidate: externalMatch, matchedQuery: options.animeTitle });
          }
        }
      }

      const allCandidates = Array.from(combined.values());
      const validResults = allCandidates
        .filter(({ candidate }) => (
          !options.animeYear
          || !candidate.year
          || Math.abs(Number(candidate.year) - options.animeYear) <= 3
        ))
        .map(({ candidate, matchedQuery }) => ({
          candidate,
          score: Math.max(
            scoreMatch(
              candidate,
              matchedQuery,
              options.animeYear,
              options.animeEpisodes,
              options.animeStatus,
            ),
            ...queries.map((query) => scoreMatch(
              candidate,
              query,
              options.animeYear,
              options.animeEpisodes,
              options.animeStatus,
            )),
          ),
        }))
        .filter(({ score }) => score >= 20)
        .sort((left, right) => right.score - left.score)
        .map(({ candidate }) => candidate);

      if (cancelled) return;
      if (validResults.length === 0) {
        setResults([]);
        setManualQuery(options.animeTitle);
        if (options.showManualWhenEmpty) setShowManualSearch(true);
        return;
      }

      setResults(validResults);
      setSelected(validResults[0]);
      if (!realAnilistId && !realMalId) {
        cacheMatch(cacheKey, { results: validResults, selected: validResults[0] });
        return;
      }

      const plausibleRejects = allCandidates
        .filter(({ candidate }) => (
          options.animeYear
          && candidate.year
          && Math.abs(Number(candidate.year) - options.animeYear) > 3
        ))
        .filter(({ candidate }) => {
          const normalizedCandidate = normalizeProviderTitle(candidate.title ?? "");
          return queries.some((query) => {
            const normalizedQuery = normalizeProviderTitle(query);
            return Boolean(
              normalizedQuery
              && normalizedCandidate
              && (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)),
            );
          });
        })
        .map(({ candidate }) => candidate)
        .slice(0, 3);
      const pool = [...validResults.slice(0, 3), ...plausibleRejects];
      const best = await pickVerifiedCandidate(pool, realAnilistId, realMalId ?? undefined).catch(() => null);
      if (cancelled || !best) return;
      const finalResults = validResults.includes(best) ? validResults : [best, ...validResults];
      setResults(finalResults);
      setSelected(best);
      cacheMatch(cacheKey, { results: finalResults, selected: best });
    };

    runSearch()
      .catch((reason: unknown) => { if (!cancelled) setError(String(reason)); })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [
    options.animeTitle,
    options.animeTitleAlt,
    options.animeTitleRomaji,
    options.animeId,
    options.animeMalId,
    options.animeYear,
    options.animeEpisodes,
    options.animeStatus,
    options.showManualWhenEmpty,
  ]);

  async function searchManually() {
    const query = manualQuery.trim();
    if (!query) return;
    setSearching(true);
    setError(null);
    try {
      const candidates = await providerClient.search(query);
      const filtered = candidates.filter((candidate) => (
        !options.animeYear
        || !candidate.year
        || Math.abs(Number(candidate.year) - options.animeYear) <= 3
      ));
      setResults(filtered);
      const best = pickProviderResult(filtered, query, {
        year: options.animeYear,
        episodes: options.animeEpisodes,
        status: options.animeStatus,
      }) ?? filtered[0];
      if (best) {
        setSelected(best);
        setShowManualSearch(false);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSearching(false);
    }
  }

  return {
    results,
    setResults,
    selected,
    setSelected,
    searching,
    error,
    setError,
    manualQuery,
    setManualQuery,
    showManualSearch,
    setShowManualSearch,
    searchManually,
  };
}
