import { scoreMatch } from "../../lib/match.ts";

export interface ProviderMatchContext {
  year?: number;
  episodes?: number;
  status?: string;
}

const TITLE_PARTICLES = new Set(["no", "na", "wa", "ga", "wo", "ni", "de", "to", "mo", "ya", "ka"]);

function meaningfulWords(title: string, count: number): string {
  return title.split(/\s+/)
    .filter((word) => !TITLE_PARTICLES.has(word.toLowerCase()))
    .slice(0, count)
    .join(" ");
}

function addUniqueQuery(queries: string[], query?: string): void {
  const value = query?.trim();
  if (!value || queries.some((item) => item.toLowerCase() === value.toLowerCase())) return;
  queries.push(value);
}

export function buildProviderSearchQueries(title: string, alternative?: string, romaji?: string): string[] {
  const queries: string[] = [];
  addUniqueQuery(queries, title);
  addUniqueQuery(queries, alternative);
  addUniqueQuery(queries, romaji);

  const shortTitle = meaningfulWords(title, 2);
  if (shortTitle !== title && shortTitle.length > 3) addUniqueQuery(queries, shortTitle);
  if (alternative) {
    const shortAlternative = meaningfulWords(alternative, 2);
    if (shortAlternative !== alternative && shortAlternative.length > 3) addUniqueQuery(queries, shortAlternative);
  }
  const firstWord = meaningfulWords(title, 1);
  if (firstWord.length > 3) addUniqueQuery(queries, firstWord);
  return queries;
}

export function pickProviderResult<T>(results: T[], title: string, context: ProviderMatchContext): T | null {
  if (results.length === 0) return null;
  if (results.length === 1) return results[0];
  const scored = results.map((result) => ({
    result,
    score: scoreMatch(result, title, context.year, context.episodes, context.status),
  })).sort((left, right) => right.score - left.score);
  return scored[0].score >= 20 ? scored[0].result : null;
}

export function normalizeProviderTitle(value: string): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}
