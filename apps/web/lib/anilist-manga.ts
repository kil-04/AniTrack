import { alGql as gql, MEDIA_FIELDS, mapMedia as toAnime } from "../source/apps/desktop/renderer/lib/capacitor-anilist";
type MediaNode = any;
import type { AnimeMeta } from "../source/packages/shared/types";
import type { MangaFeed, MangaMeta, MangaSearchFilters, MangaSearchPage } from "../source/packages/shared/manga";
import { readCached, writeCached } from "./browser-storage";

const MANGA_FIELDS = `
  id idMal isAdult title { romaji english native } coverImage { extraLarge large } bannerImage
  chapters volumes status format startDate { year } averageScore popularity genres countryOfOrigin synonyms
  description(asHtml: false)
`;

interface MangaNode {
  id: number;
  idMal?: number | null;
  isAdult?: boolean;
  title?: { romaji?: string | null; english?: string | null; native?: string | null };
  coverImage?: { extraLarge?: string | null; large?: string | null };
  bannerImage?: string | null;
  chapters?: number | null;
  volumes?: number | null;
  status?: string | null;
  format?: string | null;
  startDate?: { year?: number | null } | null;
  averageScore?: number | null;
  popularity?: number | null;
  genres?: string[] | null;
  countryOfOrigin?: string | null;
  synonyms?: string[] | null;
  description?: string | null;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();
const byId = new Map<number, MangaMeta>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await load();
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), value });
  return value;
}

function cleanDescription(text: string | null | undefined): string | null {
  if (!text) return null;
  const clean = text.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return clean || null;
}

function toManga(m: MangaNode): MangaMeta {
  const manga: MangaMeta = {
    id: m.id,
    malId: m.idMal ?? null,
    title: m.title?.english || m.title?.romaji || m.title?.native || "Unknown",
    titleRomaji: m.title?.romaji ?? null,
    cover: m.coverImage?.extraLarge || m.coverImage?.large || null,
    banner: m.bannerImage ?? null,
    chapters: m.chapters ?? null,
    volumes: m.volumes ?? null,
    status: m.status ?? null,
    format: m.format ?? null,
    year: m.startDate?.year ?? null,
    score: m.averageScore ?? null,
    synopsis: cleanDescription(m.description),
    genres: m.genres ?? [],
    popularity: m.popularity ?? null,
    country: m.countryOfOrigin ?? null,
    synonyms: (m.synonyms ?? []).filter((name) => !!name && name !== "null").slice(0, 20),
  };
  if (byId.size > 400) byId.delete(byId.keys().next().value!);
  byId.set(manga.id, manga);
  return manga;
}

const list = (nodes: MangaNode[] | undefined) => (nodes ?? []).filter((m) => !m.isAdult).map(toManga);

/** Manga home rows in one request, like the Android app. */
export function mangaFeed(): Promise<MangaFeed> {
  return cached("feed", async () => {
    const data = await gql<Record<string, { media: MangaNode[] }>>(
      `query {
        trending: Page(perPage: 30) { media(type: MANGA, sort: TRENDING_DESC, isAdult: false, popularity_greater: 5000) { ${MANGA_FIELDS} } }
        publishing: Page(perPage: 20) { media(type: MANGA, status: RELEASING, sort: POPULARITY_DESC, isAdult: false, popularity_greater: 5000) { ${MANGA_FIELDS} } }
        popular: Page(perPage: 20) { media(type: MANGA, sort: POPULARITY_DESC, isAdult: false, popularity_greater: 50000) { ${MANGA_FIELDS} } }
        topRated: Page(perPage: 20) { media(type: MANGA, sort: SCORE_DESC, isAdult: false, popularity_greater: 5000) { ${MANGA_FIELDS} } }
        manhwa: Page(perPage: 20) { media(type: MANGA, countryOfOrigin: "KR", sort: TRENDING_DESC, isAdult: false, popularity_greater: 2000) { ${MANGA_FIELDS} } }
      }`,
      {},
      "high",
    );
    return {
      trending: list(data.trending?.media),
      publishing: list(data.publishing?.media),
      popular: list(data.popular?.media),
      topRated: list(data.topRated?.media),
      manhwa: list(data.manhwa?.media),
    };
  });
}

const SORTS = new Set(["POPULARITY_DESC", "TRENDING_DESC", "SCORE_DESC", "START_DATE_DESC", "SEARCH_MATCH", "FAVOURITES_DESC"]);
const FORMATS = new Set(["MANGA", "ONE_SHOT", "NOVEL"]);
const STATUSES = new Set(["RELEASING", "FINISHED", "NOT_YET_RELEASED", "HIATUS", "CANCELLED"]);
const COUNTRIES = new Set(["JP", "KR", "CN", "TW"]);

/** Filtered manga search; an empty search lists popular titles (with a floor so AniList answers quickly). */
export function searchManga(filters: MangaSearchFilters): Promise<MangaSearchPage> {
  const query = filters.query?.trim().slice(0, 120) || null;
  const page = Math.min(Math.max(1, Math.floor(filters.page ?? 1)), 50);
  const sort = filters.sort && SORTS.has(filters.sort) ? filters.sort : query ? "SEARCH_MATCH" : "POPULARITY_DESC";
  const args = ["$page: Int", "$sort: [MediaSort]"];
  const media = ["type: MANGA", "isAdult: false", "sort: $sort"];
  const variables: Record<string, unknown> = { page, sort: [sort] };
  if (query) { args.push("$q: String"); media.push("search: $q"); variables.q = query; }
  if (filters.genre && /^[A-Za-z' -]{2,40}$/.test(filters.genre)) { args.push("$genre: String"); media.push("genre: $genre"); variables.genre = filters.genre; }
  if (filters.year && filters.year >= 1900 && filters.year <= 2100) {
    args.push("$from: FuzzyDateInt", "$to: FuzzyDateInt");
    media.push("startDate_greater: $from", "startDate_lesser: $to");
    variables.from = filters.year * 10000;
    variables.to = (filters.year + 1) * 10000;
  }
  if (filters.format && FORMATS.has(filters.format)) { args.push("$format: MediaFormat"); media.push("format: $format"); variables.format = filters.format; }
  if (filters.country && COUNTRIES.has(filters.country)) { args.push("$country: CountryCode"); media.push("countryOfOrigin: $country"); variables.country = filters.country; }
  if (filters.status && STATUSES.has(filters.status)) { args.push("$status: MediaStatus"); media.push("status: $status"); variables.status = filters.status; }
  if (media.length === 3) media.push("popularity_greater: 1000");
  return cached(`search:${JSON.stringify(variables)}`, async () => {
    const data = await gql<{ Page: { pageInfo: { hasNextPage: boolean }; media: MangaNode[] } }>(
      `query(${args.join(", ")}) {
        Page(page: $page, perPage: 30) { pageInfo { hasNextPage } media(${media.join(", ")}) { ${MANGA_FIELDS} } }
      }`,
      variables,
      "high",
    );
    return { items: list(data.Page.media), hasNextPage: data.Page.pageInfo.hasNextPage };
  });
}

// Titles opened before, kept on disk: Continue Reading, Updates, My List and
// Downloads open them at once (and offline) instead of waiting on AniList.
const KEPT_FILE = "anilist-meta";
const KEPT_MAX = 400;
const KEPT_FRESH_MS = 24 * 60 * 60 * 1000;
let kept: Promise<Map<number, { at: number; manga: MangaMeta }>> | null = null;
let keepTimer: NodeJS.Timeout | null = null;

function keptTitles() {
  kept ??= readCached<[number, { at: number; manga: MangaMeta }][]>(KEPT_FILE)
    .then((saved) => new Map(Array.isArray(saved?.value) ? saved.value.filter((e) => Array.isArray(e) && e[1]?.manga?.id === e[0]) : []));
  return kept;
}

async function keep(manga: MangaMeta) {
  const titles = await keptTitles();
  titles.delete(manga.id);
  titles.set(manga.id, { at: Date.now(), manga });
  while (titles.size > KEPT_MAX) titles.delete(titles.keys().next().value!);
  if (keepTimer) clearTimeout(keepTimer);
  keepTimer = setTimeout(() => { void writeCached(KEPT_FILE, [...titles]); }, 1500);
}

async function fetchMangaById(id: number, priority: "high" | "low"): Promise<MangaMeta | null> {
  const data = await gql<{ Media: MangaNode | null }>(
    `query($id: Int) { Media(id: $id, type: MANGA) { ${MANGA_FIELDS} } }`,
    { id },
    priority,
  );
  const manga = data.Media ? toManga(data.Media) : null;
  if (manga) void keep(manga);
  return manga;
}

export async function mangaById(id: number): Promise<MangaMeta | null> {
  const known = byId.get(id);
  if (known) {
    void keep(known);
    return known;
  }
  const saved = (await keptTitles()).get(id);
  if (saved) {
    byId.set(id, saved.manga);
    if (Date.now() - saved.at > KEPT_FRESH_MS) void fetchMangaById(id, "low").catch(() => {});
    return saved.manga;
  }
  return fetchMangaById(id, "high");
}

/** The anime made from a manga, series first (the manga page's "Watch the anime"). */
export function animeAdaptations(mangaId: number): Promise<AnimeMeta[]> {
  return cached(`adaptations:${mangaId}`, async () => {
    const data = await gql<{ Media: { relations: { edges: { node: MediaNode & { type?: string; isAdult?: boolean } }[] } } | null }>(
      `query($id: Int) { Media(id: $id, type: MANGA) { relations { edges { node { type ${MEDIA_FIELDS} } } } } }`,
      { id: mangaId },
      "low",
    );
    const rank: Record<string, number> = { TV: 0, TV_SHORT: 1, ONA: 2, MOVIE: 3, OVA: 4, SPECIAL: 5 };
    const seen = new Set<number>();
    return (data.Media?.relations.edges ?? [])
      .map((edge) => edge.node)
      .filter((node) => node.type === "ANIME" && !node.isAdult && node.format !== "MUSIC" && !seen.has(node.id) && seen.add(node.id))
      .map(toAnime)
      .sort((a, b) => (rank[a.format ?? ""] ?? 6) - (rank[b.format ?? ""] ?? 6) || (a.year ?? 9999) - (b.year ?? 9999))
      .slice(0, 15);
  });
}
