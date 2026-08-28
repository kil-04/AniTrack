import type { WatchStatus } from "./types";

export interface RecommendationSeedCandidate {
  id: number;
  status: WatchStatus;
  score?: number | null;
  updatedAt?: number;
  year?: number | null;
}

/** Explicit preference supplied by the user, calibrated by their MAL data.
 * The 1980s have the strongest evidence; the 1970s and 1990s are still
 * deliberately favored. Applied once per candidate, after graph aggregation. */
export function classicEraBoost(year?: number | null): number {
  if (year == null) return 0;
  if (year >= 1980 && year <= 1989) return 3;
  if ((year >= 1970 && year <= 1979) || (year >= 1990 && year <= 1999)) return 2.5;
  return 0;
}

export function classicEraLabel(year?: number | null): string | null {
  if (year == null || classicEraBoost(year) === 0) return null;
  return `Classic ${Math.floor(year / 10) * 10}s match`;
}

/** Reserve one strong seed from each preferred classic decade, then fill with
 * the best remaining ratings. This gets classic candidates into the graph;
 * a score boost alone cannot help a title that was never retrieved. */
export function selectRecommendationSeedIds(
  candidates: RecommendationSeedCandidate[],
  limit = 8,
): number[] {
  if (limit <= 0) return [];
  const eligible = candidates
    .filter((candidate) => candidate.id > 0
      && (candidate.status === "completed" || candidate.status === "watching"))
    .sort((a, b) => ((b.score ?? 0) * 10 + classicEraBoost(b.year))
      - ((a.score ?? 0) * 10 + classicEraBoost(a.year))
      || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const selected: number[] = [];
  const add = (candidate?: RecommendationSeedCandidate) => {
    if (candidate && !selected.includes(candidate.id) && selected.length < limit) {
      selected.push(candidate.id);
    }
  };

  for (const start of [1970, 1980, 1990]) {
    add(eligible.find((candidate) => (candidate.score ?? 0) >= 7
      && candidate.year != null
      && candidate.year >= start
      && candidate.year <= start + 9));
  }
  for (const candidate of eligible) add(candidate);
  return selected;
}
