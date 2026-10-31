import type { AnimeMeta } from "./types";

export interface AnimeEra {
  start: number;
  end: number;
  label: string;
  headline: string;
  atmosphere: string;
  accent: string;
}

export const ANIME_ERAS: readonly AnimeEra[] = [
  { start: 1960, end: 1969, label: "1960s", headline: "The television frontier", atmosphere: "Limited animation became a new visual language as weekly anime found its identity.", accent: "#d6c29e" },
  { start: 1970, end: 1979, label: "1970s", headline: "Rebels, robots, and new worlds", atmosphere: "Bold directors expanded science fiction, drama, and the possibilities of televised animation.", accent: "#e0a44f" },
  { start: 1980, end: 1989, label: "1980s", headline: "The age of impossible ambition", atmosphere: "The OVA boom, expressive cel work, and fearless experimentation made anime feel limitless.", accent: "#e95f8e" },
  { start: 1990, end: 1999, label: "1990s", headline: "Analog dreams at full power", atmosphere: "A generation of landmark series joined cinematic craft with stranger, more personal stories.", accent: "#8d7cf6" },
  { start: 2000, end: 2009, label: "2000s", headline: "The digital crossing", atmosphere: "Studios reinvented their look while late-night anime and global fandom accelerated together.", accent: "#4ca8de" },
  { start: 2010, end: 2019, label: "2010s", headline: "Anime goes everywhere", atmosphere: "Simulcasts, ambitious adaptations, and a worldwide audience reshaped the medium.", accent: "#55c99a" },
  { start: 2020, end: 2029, label: "2020s", headline: "The borderless studio", atmosphere: "Hybrid pipelines and global collaboration are producing anime at an unprecedented scale.", accent: "#e65b52" },
] as const;

export function clampTimeMachineYear(year: number, currentYear = new Date().getFullYear()): number {
  const upper = Math.max(1960, Math.min(2029, currentYear));
  return Math.max(1960, Math.min(upper, Math.round(year)));
}

export function animeEraForYear(year: number): AnimeEra {
  const safeYear = clampTimeMachineYear(year, 2029);
  return ANIME_ERAS.find((era) => safeYear >= era.start && safeYear <= era.end) ?? ANIME_ERAS[0];
}

/** Where a year sits in its decade: "Early 1980s", "Mid-1980s", "Late 1980s". */
export function yearInDecade(year: number): string {
  const era = animeEraForYear(year);
  const offset = year - era.start;
  if (offset <= 2) return `Early ${era.label}`;
  if (offset >= 7) return `Late ${era.label}`;
  return `Mid-${era.label}`;
}

// ── A year's titles ──────────────────────────────────────────────────────────
//
// The Time Machine reads four AniList lists per year: the 100 most-followed titles
// that premiered in it (two pages), its 50 most-followed films, and its best-rated
// titles above a popularity floor (the hidden gems). Each title carries its
// relations, so new shows can be told apart from sequels, spin-offs and recaps.
// Android mirrors this in TimeMachineArchive.kt.

/** Formats in a year's sample; music videos are left out. */
export const TIME_MACHINE_FORMATS = ["TV", "TV_SHORT", "MOVIE", "OVA", "ONA", "SPECIAL"];
/** Formats a hidden gem can have. */
export const TIME_MACHINE_GEM_FORMATS = ["TV", "TV_SHORT", "MOVIE", "OVA", "ONA"];
/** Titles a row shows before "Show all"; gems come from beyond this. */
export const TIME_MACHINE_ROW = 20;

export type TimeMachineList = "popular" | "popular-2" | "films" | "gems";
export type TimeMachinePart = "main" | "gems";
export type TimeMachineSeason = "ALL" | "WINTER" | "SPRING" | "SUMMER" | "FALL";

/**
 * One page of titles that premiered in a year. [fields] is the caller's media
 * fragment and must include the description, format, episodes and popularity.
 * Unaired titles are left out; adult ones are kept.
 */
export function timeMachineQuery(fields: string): string {
  return `query($started: String, $page: Int, $sort: [MediaSort], $formats: [MediaFormat], $minPopularity: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(type: ANIME, startDate_like: $started, status_not: NOT_YET_RELEASED, format_in: $formats, sort: $sort, popularity_greater: $minPopularity) {
        ${fields}
        startDate { year month }
        relations { edges { relationType(version: 2) node { id type startDate { year month } } } }
      }
    }
  }`;
}

export function timeMachineVariables(year: number, list: TimeMachineList, minPopularity = 0) {
  const started = `${year}%`;
  switch (list) {
    case "popular": return { started, page: 1, sort: ["POPULARITY_DESC"], formats: TIME_MACHINE_FORMATS, minPopularity: 0 };
    case "popular-2": return { started, page: 2, sort: ["POPULARITY_DESC"], formats: TIME_MACHINE_FORMATS, minPopularity: 0 };
    case "films": return { started, page: 1, sort: ["POPULARITY_DESC"], formats: ["MOVIE"], minPopularity: 0 };
    case "gems": return { started, page: 1, sort: ["SCORE_DESC"], formats: TIME_MACHINE_GEM_FORMATS, minPopularity };
  }
}

/** Members a hidden gem needs: 1% of the year's most-followed title, and at least 250. */
export function gemPopularityFloor(topPopularity: number): number {
  return Math.max(250, Math.round(topPopularity * 0.01));
}

export interface TimeMachineRelationEdge {
  relationType?: string | null;
  node?: { id?: number | null; type?: string | null; startDate?: { year?: number | null; month?: number | null } | null } | null;
}

export interface TimeMachineCandidate {
  anime: AnimeMeta;
  /** 1–12, or null when AniList only knows the year. */
  startMonth: number | null;
  /** Follows a show from an earlier year (AniList PREQUEL). */
  prequelBefore: boolean;
  /** A prequel story made after its sequel (AniList SEQUEL that started earlier). */
  sequelBefore: boolean;
  /** A side story, spin-off or compilation of an earlier show (AniList PARENT). */
  parentBefore: boolean;
  /** Another version of an earlier show: a remake, a retelling or a recap film (AniList ALTERNATIVE). */
  alternativeBefore: boolean;
  /** Follows a prequel or a parent story that started earlier in the same year: a Season 2 in the fall. */
  followsEarlierThisYear: boolean;
  /** Its title or description calls it a recap, compilation or retelling. */
  recap: boolean;
  /** AniList ids of the anime it's related to within its franchise. */
  franchise: number[];
  /** "gems" when it came from the hidden-gems list. */
  source: "sample" | "gems";
}

// Relations that keep two titles in one franchise. CHARACTER and OTHER (crossovers,
// shared casts) don't, or unrelated shows would merge.
const FRANCHISE_RELATIONS = new Set(["PREQUEL", "SEQUEL", "PARENT", "SIDE_STORY", "SUMMARY", "ALTERNATIVE", "SPIN_OFF", "COMPILATION", "CONTAINS"]);
// How AniList's own descriptions mark recaps: "Compilation recap movie…", "theatrical film
// remake of…", "Soushuuhen", "A retelling of the first season…". A retelling of anything
// else ("…of the final Manga story", "…of a fairy tale") is a film in its own right.
const RECAP_WORDS = /\b(?:recaps?|compilation|soushuuhen|(?:film|movie|theatrical) remake)\b|総集編|\b(?:retelling|summary|summari[sz]es|condensed|re-?edit(?:ed)?|digest)\b[^.]{0,40}?\b(?:season|series|episodes?|tv|anime|show)\b/i;

/** Bump when timeMachineCandidate's rules change, so years cached with the old ones are read again. */
export const TIME_MACHINE_RULES = 2;

export function timeMachineCandidate(input: {
  anime: AnimeMeta;
  year: number;
  startMonth?: number | null;
  relations?: TimeMachineRelationEdge[] | null;
  source?: "sample" | "gems";
}): TimeMachineCandidate {
  const edges = (input.relations ?? []).filter((edge) => edge?.node?.type === "ANIME" && typeof edge.node.id === "number");
  // A prequel or a parent story always came first, even when AniList doesn't date it.
  // An undated alternative version is usually an announced remake, not an older show.
  const before = (type: string, undatedCounts: boolean) => edges.some((edge) => {
    if (edge.relationType !== type) return false;
    const started = edge.node?.startDate?.year;
    return started == null ? undatedCounts : started < input.year;
  });
  const anime = input.anime;
  const text = [anime.titleEnglish, anime.titleRomaji, anime.title, (anime.synopsis ?? "").slice(0, 400)].filter(Boolean).join(" ");
  const month = input.startMonth != null && input.startMonth >= 1 && input.startMonth <= 12 ? input.startMonth : null;
  // Only a dated, earlier month counts: AniList also calls a later-released OVA a "prequel".
  const followsEarlierThisYear = month != null && edges.some((edge) => (edge.relationType === "PREQUEL" || edge.relationType === "PARENT")
    && edge.node?.startDate?.year === input.year && edge.node.startDate.month != null && edge.node.startDate.month < month);
  return {
    anime,
    startMonth: month,
    prequelBefore: before("PREQUEL", true),
    sequelBefore: before("SEQUEL", false),
    parentBefore: before("PARENT", true),
    alternativeBefore: before("ALTERNATIVE", false),
    followsEarlierThisYear,
    recap: RECAP_WORDS.test(text),
    franchise: [...new Set(edges.filter((edge) => FRANCHISE_RELATIONS.has(edge.relationType ?? "")).map((edge) => edge.node!.id as number))],
    source: input.source ?? "sample",
  };
}

export interface TimeMachineStats {
  /** The most-followed new show or film. */
  biggestDebut: AnimeMeta | null;
  /** The best-rated new show or film with a real audience. */
  bestRated: AnimeMeta | null;
  /** The studio behind the most of the year's titles shown, when it made at least two. */
  busiestStudio: { name: string; count: number } | null;
  /** Up to three genres the new shows and films share most. */
  topGenres: string[];
}

export interface TimeMachineYear {
  /** First seasons and new shows, best first, one per franchise. */
  newShows: AnimeMeta[];
  /** New and franchise films without recap films, one per franchise. */
  films: AnimeMeta[];
  /** New seasons, sequels and spin-offs of earlier shows, one per franchise. */
  sequels: AnimeMeta[];
  /** Well-rated new titles with a smaller audience than the year's hits. */
  gems: AnimeMeta[];
  /** The three most-followed new shows and films: "The year of …". */
  headliners: AnimeMeta[];
  /** How many titles the rows were picked from. */
  titleCount: number;
  stats: TimeMachineStats;
}

const SEASON_MONTHS: Record<Exclude<TimeMachineSeason, "ALL">, [number, number]> = {
  WINTER: [1, 3],
  SPRING: [4, 6],
  SUMMER: [7, 9],
  FALL: [10, 12],
};

const popularityOf = (c: TimeMachineCandidate) => c.anime.popularity ?? 0;

/** Runs long enough to be a show of its own rather than an extra or a film. */
function seriesLength(c: TimeMachineCandidate): boolean {
  const format = c.anime.format;
  if (format === "TV" || format === "TV_SHORT" || format === "ONA") return true;
  return format === "OVA" && (c.anime.episodes == null || c.anime.episodes >= 3);
}

/** Tied to an earlier work: a sequel, a later-made prequel, a side story, or a short alternate take. A series-length remake is a new show. */
function continuesEarlier(c: TimeMachineCandidate): boolean {
  return c.prequelBefore || c.sequelBefore || c.parentBefore || (c.alternativeBefore && !seriesLength(c));
}

/**
 * Sorts a year's titles into the Time Machine's rows. Franchises are worked out
 * from the whole year, so a season's Part 2 still counts as a sequel when its
 * Part 1 aired earlier that year.
 */
export function curateTimeMachineYear(candidates: TimeMachineCandidate[], season: TimeMachineSeason = "ALL"): TimeMachineYear {
  // One entry per title; the main lists win over the gems list.
  const byId = new Map<number, TimeMachineCandidate>();
  for (const candidate of candidates) {
    const known = byId.get(candidate.anime.id);
    if (!known || (known.source === "gems" && candidate.source !== "gems")) byId.set(candidate.anime.id, candidate);
  }
  const all = [...byId.values()];
  const top = Math.max(1, ...all.map(popularityOf));
  // Titles a handful of people follow are noise, as are music videos and recaps.
  const minimum = Math.max(150, Math.round(top * 0.002));
  const kept = all.filter((c) => c.anime.format !== "MUSIC"
    && popularityOf(c) >= minimum
    && !(c.recap && !seriesLength(c) && (c.prequelBefore || c.parentBefore || c.alternativeBefore)));

  // Franchises: titles joined through their relations, including relatives outside the year.
  const parent = new Map<number, number>();
  const root = (id: number): number => {
    let at = id;
    while (parent.has(at) && parent.get(at) !== at) at = parent.get(at)!;
    return at;
  };
  const join = (a: number, b: number) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = root(a);
    const rb = root(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const c of kept) {
    join(c.anime.id, c.anime.id);
    for (const related of c.franchise) join(c.anime.id, related);
  }
  const franchiseOf = (c: TimeMachineCandidate) => root(c.anime.id);
  // A franchise continues when any of its titles this year follows an earlier one.
  const continuing = new Set(kept.filter(continuesEarlier).map(franchiseOf));
  // A new franchise's later entries (its fall Season 2) are sequels too: the whole
  // year shows the franchise once, as a new show, and a season view without the first
  // entry shows them under sequels.
  const kind = (c: TimeMachineCandidate): "new" | "film" | "sequel" | null => {
    if (c.anime.format === "MOVIE") return "film";
    if (continuing.has(franchiseOf(c)) || c.followsEarlierThisYear) return "sequel";
    return c.anime.format === "SPECIAL" ? null : "new";
  };
  const newWork = (c: TimeMachineCandidate) => !continuesEarlier(c) && !c.followsEarlierThisYear
    && (c.anime.format === "MOVIE" || !continuing.has(franchiseOf(c)));

  const months = season === "ALL" ? null : SEASON_MONTHS[season];
  const inSeason = (c: TimeMachineCandidate) => months == null || (c.startMonth != null && c.startMonth >= months[0] && c.startMonth <= months[1]);
  // Audience size relative to the year's biggest title, then score: neither an
  // obscure 90% nor a forgettable hit leads.
  const blend = (c: TimeMachineCandidate) => {
    const reach = Math.log10(popularityOf(c) + 1) / Math.log10(top + 1);
    const score = c.anime.averageScore == null ? 0.35 : Math.min(1, Math.max(0, (c.anime.averageScore - 35) / 55));
    return 0.6 * reach + 0.4 * score;
  };
  const ranked = (k: "new" | "film" | "sequel", fromGems: boolean) => kept
    .filter((c) => kind(c) === k && inSeason(c) && (c.source === "gems") === fromGems)
    .sort((a, b) => blend(b) - blend(a) || popularityOf(b) - popularityOf(a) || a.anime.id - b.anime.id);
  const onePerFranchise = (list: TimeMachineCandidate[], skip: (franchise: number, c: TimeMachineCandidate) => boolean) => {
    const seen = new Set<number>();
    return list.filter((c) => {
      const franchise = franchiseOf(c);
      if (seen.has(franchise) || skip(franchise, c)) return false;
      seen.add(franchise);
      return true;
    });
  };

  const newShows = onePerFranchise(ranked("new", false), () => false);
  const newFranchises = new Set(newShows.map(franchiseOf));
  // A franchise that premiered this year shows once, as a new show.
  const films = onePerFranchise(ranked("film", false), (franchise) => newFranchises.has(franchise));
  const filmFranchises = new Set(films.map(franchiseOf));
  // A franchise's film doesn't hide its new season, but does hide its extras.
  const sequels = onePerFranchise(ranked("sequel", false), (franchise, c) => newFranchises.has(franchise) || (filmFranchises.has(franchise) && !seriesLength(c)));

  const debuts = [...newShows, ...films.filter(newWork)];
  const scores = debuts.map((c) => c.anime.averageScore).filter((s): s is number => s != null).sort((a, b) => a - b);
  const gemScore = Math.max(70, Math.min(80, scores.length ? scores[Math.floor(scores.length * 0.75)] : 100));
  const floor = gemPopularityFloor(top);
  const shownFranchises = new Set([...newShows, ...films, ...sequels].map(franchiseOf));
  const fromGemsList = onePerFranchise(
    [...ranked("new", true), ...ranked("film", true)].filter(newWork),
    (franchise) => shownFranchises.has(franchise),
  );
  const gems = [...newShows.slice(TIME_MACHINE_ROW), ...films.slice(TIME_MACHINE_ROW).filter(newWork), ...fromGemsList]
    .filter((c) => (c.anime.averageScore ?? 0) >= gemScore && popularityOf(c) >= floor)
    .sort((a, b) => (b.anime.averageScore ?? 0) - (a.anime.averageScore ?? 0) || popularityOf(b) - popularityOf(a))
    .slice(0, TIME_MACHINE_ROW);

  const byPopularity = (a: TimeMachineCandidate, b: TimeMachineCandidate) => popularityOf(b) - popularityOf(a);
  const headliners = [...newShows, ...films].sort(byPopularity).slice(0, 3);
  const rated = debuts.filter((c) => c.anime.averageScore != null && popularityOf(c) >= floor)
    .sort((a, b) => (b.anime.averageScore ?? 0) - (a.anime.averageScore ?? 0) || byPopularity(a, b));
  const studios = new Map<string, { count: number; reach: number }>();
  for (const c of [...newShows, ...films, ...sequels]) {
    const name = c.anime.studios?.[0];
    if (!name) continue;
    const entry = studios.get(name) ?? { count: 0, reach: 0 };
    studios.set(name, { count: entry.count + 1, reach: entry.reach + popularityOf(c) });
  }
  const busiest = [...studios.entries()].sort((a, b) => b[1].count - a[1].count || b[1].reach - a[1].reach)[0];
  const genres = new Map<string, number>();
  for (const c of debuts) for (const genre of new Set(c.anime.genres ?? [])) genres.set(genre, (genres.get(genre) ?? 0) + 1);

  return {
    newShows: newShows.map((c) => c.anime),
    films: films.map((c) => c.anime),
    sequels: sequels.map((c) => c.anime),
    gems: gems.map((c) => c.anime),
    headliners: headliners.map((c) => c.anime),
    titleCount: kept.filter((c) => c.source !== "gems" && inSeason(c)).length,
    stats: {
      biggestDebut: [...debuts].sort(byPopularity)[0]?.anime ?? null,
      bestRated: rated[0]?.anime ?? null,
      busiestStudio: busiest && busiest[1].count >= 2 ? { name: busiest[0], count: busiest[1].count } : null,
      topGenres: [...genres.entries()].filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([genre]) => genre),
    },
  };
}

/** "A", "A and B", "A, B and C". */
export function joinTitles(titles: string[]): string {
  if (titles.length <= 1) return titles[0] ?? "";
  return `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
}

/** A random new show or gem from the year that isn't in your list yet (any new title when you've seen them all). */
export function mysteryPick(year: TimeMachineYear, listed: ReadonlySet<number>, random: () => number = Math.random): AnimeMeta | null {
  const pool = [...year.newShows.slice(0, TIME_MACHINE_ROW), ...year.gems];
  const fresh = pool.filter((anime) => !listed.has(anime.id));
  const choices = fresh.length ? fresh : pool.length ? pool : year.films;
  return choices.length ? choices[Math.floor(random() * choices.length)] : null;
}
