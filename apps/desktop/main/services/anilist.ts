import type { AnimeMeta, AnimeRecommendation, RecentEpisodesPage, RelatedAnime } from "../../../../packages/shared/types";

const ENDPOINT = "https://graphql.anilist.co";

// Simple TTL cache to stay under AniList's 90 req/min rate limit.
// Cleared on app restart — fine because AniList metadata doesn't change often.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_ENTRIES = 500; // bound memory; LRU eviction is overkill here
const cache = new Map<string, { value: unknown; expires: number }>();

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) { cache.delete(key); return undefined; }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Drop oldest 50 entries when full (insertion order, JS Map preserves it).
    const keys = Array.from(cache.keys()).slice(0, 50);
    for (const k of keys) cache.delete(k);
  }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

// Minimal fragment we reuse across queries.
const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english native }
  synonyms
  description(asHtml: false)
  episodes
  duration
  status
  format
  popularity
  isAdult
  coverImage { extraLarge large color }
  bannerImage
  genres
  averageScore
  seasonYear
  studios(isMain: true) { nodes { name } }
`;

interface MediaNode {
  id: number;
  idMal: number | null;
  title: { romaji?: string; english?: string; native?: string };
  synonyms?: string[];
  description?: string | null;
  episodes?: number | null;
  duration?: number | null;
  status?: string | null;
  format?: string | null;
  popularity?: number | null;
  isAdult?: boolean;
  coverImage?: { extraLarge?: string; large?: string; color?: string };
  bannerImage?: string | null;
  genres?: string[];
  averageScore?: number | null;
  seasonYear?: number | null;
  studios?: { nodes: { name: string }[] };
}

function toAnime(m: MediaNode): AnimeMeta {
  return {
    id: m.id,
    malId: m.idMal,
    title: m.title.english || m.title.romaji || m.title.native || "Untitled",
    titleEnglish: m.title.english ?? null,
    titleRomaji: m.title.romaji ?? null,
    synopsis: (m.description ?? "").replace(/<[^>]+>/g, ""),
    episodes: m.episodes ?? null,
    duration: m.duration ?? null,
    status: m.status ?? null,
    coverImage: m.coverImage?.extraLarge || m.coverImage?.large || null,
    bannerImage: m.bannerImage ?? null,
    genres: m.genres ?? [],
    averageScore: m.averageScore ?? null,
    year: m.seasonYear ?? null,
    studios: m.studios?.nodes.map((n) => n.name) ?? [],
    format: m.format ?? null,
    popularity: m.popularity ?? null,
  };
}

// AniList's SEARCH_MATCH sort frequently ranks an obscure entry whose
// title/synonym happens to equal the query ABOVE the obvious popular series
// (e.g. "demon slayer" -> a random short, "aot" -> a TV special). We re-rank
// the raw result set by a relevance TIER (exact/prefix > substring > word
// overlap) and break ties within a tier by popularity, so the show a user
// actually means surfaces first. Exact and prefix collapse into one top tier
// on purpose: a synonym-exact match on junk must not beat a prefix match on
// the real franchise title.
const normTitle = (s: string | undefined | null) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function relevanceTier(query: string, m: MediaNode): number {
  const nq = normTitle(query);
  if (!nq) return 0;
  const cands = [m.title.english, m.title.romaji, m.title.native, ...(m.synonyms ?? [])]
    .map(normTitle)
    .filter(Boolean);
  let tier = 0;
  for (const c of cands) {
    if (c === nq || c.startsWith(nq)) tier = Math.max(tier, 3);
    else if (c.includes(nq)) tier = Math.max(tier, 2);
    else {
      const qw = nq.split(" ");
      const cw = new Set(c.split(" "));
      if (qw.filter((w) => cw.has(w)).length / qw.length >= 0.5) tier = Math.max(tier, 1);
    }
  }
  return tier;
}

function rankByRelevance(query: string, media: MediaNode[]): MediaNode[] {
  return media
    .map((m, i) => ({
      m,
      // tier dominates; log-popularity orders within tier; original AniList
      // order is the final, stable tiebreak.
      score: relevanceTier(query, m) * 1000 + Math.log10((m.popularity ?? 0) + 1) * 10 - i * 0.001,
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m);
}

// Two-lane serial scheduler: only one AniList request in-flight at a time to
// prevent 429 storms, but interactive calls (search / filter / detail get) go
// through the HIGH lane and always run before queued background work (the
// watch-order relations crawl, trending, airing batches). Without the lanes a
// user search can sit behind dozens of queued background calls at 300ms
// spacing and appear to load forever.
const gqlHigh: Array<() => Promise<void>> = [];
const gqlLow: Array<() => Promise<void>> = [];
const gqlPending = new Map<string, Promise<unknown>>();
let gqlPumping = false;
let isStartup = true;
setTimeout(() => { isStartup = false; }, 6000); // 6 seconds for initial app bootup

const MAX_RETRIES = 3;

async function gqlPump() {
  if (gqlPumping) return;
  gqlPumping = true;
  try {
    while (gqlHigh.length || gqlLow.length) {
      const job = (gqlHigh.shift() ?? gqlLow.shift())!;
      await job();
      // Spaced gap to protect rate-limit: 700ms during startup storm, 300ms after.
      const gap = isStartup ? 700 : 300;
      await new Promise(r => setTimeout(r, gap));
    }
  } finally {
    gqlPumping = false;
  }
}

async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  priority: "high" | "low" = "high",
): Promise<T> {
  const key = JSON.stringify({ query, variables });
  const pending = gqlPending.get(key);
  if (pending) return pending as Promise<T>;

  const request = new Promise<T>((resolve, reject) => {
    const job = async () => {
      try {
        const result = await _doGql<T>(query, variables);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };
    (priority === "high" ? gqlHigh : gqlLow).push(job);
    void gqlPump();
  });
  gqlPending.set(key, request);
  request.finally(() => gqlPending.delete(key)).catch(() => {});
  return request;
}

async function _doGql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[AniList] request attempt ${attempt}/${MAX_RETRIES}`);
    // Time-box the request — the scheduler is a single serial pump, so one
    // hung fetch would otherwise stall EVERY AniList call in the app.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: ac.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (attempt < MAX_RETRIES) continue;
      throw err;
    }
    clearTimeout(timer);

    if (res.status === 429) {
      if (attempt < MAX_RETRIES) {
        const retryAfterSec = Number(res.headers.get("retry-after"));
        // Cap wait at 5s regardless of what the server says
        const waitMs = Math.min(5000, isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : 1500 * attempt);
        console.warn(`[AniList] 429 rate-limited, retrying in ${waitMs}ms (attempt ${attempt}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      console.error(`[AniList] 429 after ${MAX_RETRIES} attempts, giving up`);
      throw new Error(`AniList 429: Too Many Requests. Please wait a moment and try again.`);
    }

    if (!res.ok) throw new Error(`AniList ${res.status}: ${await res.text()}`);
    const json = await res.json() as any;
    if (json.errors)
      throw new Error(`AniList error: ${JSON.stringify(json.errors)}`);
    console.log(`[AniList] request succeeded on attempt ${attempt}`);
    return json.data as T;
  }
  throw new Error("AniList: exhausted all retries");
}


export async function searchAnime(q: string): Promise<AnimeMeta[]> {
  if (!q.trim()) return [];
  const key = `search:${q.trim().toLowerCase()}`;
  const hit = cacheGet<AnimeMeta[]>(key);
  if (hit) return hit;
  const data = await gql<{ Page: { media: MediaNode[] } }>(
    `query($q: String) {
      Page(perPage: 25) {
        media(search: $q, type: ANIME, sort: SEARCH_MATCH, isAdult: false) { ${MEDIA_FIELDS} }
      }
    }`,
    { q },
  );
  const result = rankByRelevance(q, data.Page.media).map(toAnime);
  cacheSet(key, result);
  return result;
}

/**
 * Next-airing-episode info for a batch of AniList IDs. Used by the Schedule page
 * and the new-episode notifier. Only entries with a known next episode are
 * returned. AniList caps `id_in` pages at 50, so we chunk and run sequentially
 * through the rate-limited queue.
 */
export async function getAiringFor(
  ids: number[],
): Promise<import("../../../../packages/shared/types").AiringInfo[]> {
  const unique = Array.from(new Set(ids.filter((n) => Number.isInteger(n) && n > 0)));
  if (unique.length === 0) return [];

  const key = `airing:${unique.slice().sort((a, b) => a - b).join(",")}`;
  const hit = cacheGet<import("../../../../packages/shared/types").AiringInfo[]>(key);
  if (hit) return hit;

  const out: import("../../../../packages/shared/types").AiringInfo[] = [];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const data = await gql<{
      Page: {
        media: {
          id: number;
          title: { romaji?: string; english?: string };
          coverImage?: { large?: string };
          nextAiringEpisode?: { airingAt: number; episode: number } | null;
        }[];
      };
    }>(
      `query($ids: [Int]) {
        Page(perPage: 50) {
          media(id_in: $ids, type: ANIME) {
            id
            title { romaji english }
            coverImage { large }
            nextAiringEpisode { airingAt episode }
          }
        }
      }`,
      { ids: chunk },
      "low",
    );
    for (const m of data.Page.media) {
      if (!m.nextAiringEpisode) continue;
      out.push({
        animeId: m.id,
        title: m.title.english || m.title.romaji || "Untitled",
        coverImage: m.coverImage?.large ?? null,
        episode: m.nextAiringEpisode.episode,
        airingAt: m.nextAiringEpisode.airingAt,
      });
    }
  }

  cacheSet(key, out);
  return out;
}

/** Recently aired episodes. This intentionally mirrors the native Android
 * home/latest feed so both apps show the same titles in the same order. */
export async function recentEpisodes(page = 1): Promise<RecentEpisodesPage> {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const key = `recent:${safePage}`;
  const hit = cacheGet<RecentEpisodesPage>(key);
  if (hit) return hit;

  const data = await gql<{
    Page: {
      pageInfo: { hasNextPage: boolean };
      airingSchedules: Array<{
        airingAt: number;
        episode: number;
        media: MediaNode | null;
      }>;
    };
  }>(
    `query($to: Int, $page: Int) {
      Page(page: $page, perPage: 30) {
        pageInfo { hasNextPage }
        airingSchedules(airingAt_lesser: $to, sort: TIME_DESC) {
          airingAt
          episode
          media { ${MEDIA_FIELDS} }
        }
      }
    }`,
    { to: Math.floor(Date.now() / 1000), page: safePage },
    "low",
  );

  const seen = new Set<number>();
  const result: RecentEpisodesPage = {
    data: data.Page.airingSchedules.flatMap((schedule) => {
      const media = schedule.media;
      if (!media || media.isAdult || seen.has(media.id)) return [];
      seen.add(media.id);
      return [{
        anime: toAnime(media),
        episode: schedule.episode,
        airingAt: schedule.airingAt,
      }];
    }),
    page: safePage,
    hasNextPage: data.Page.pageInfo.hasNextPage,
  };
  cacheSet(key, result);
  return result;
}

/** Personalized collaborative recommendations from AniList's recommendation
 * graph. Multiple seed shows reinforce the same candidate, while the strongest
 * individual edge supplies the user-facing explanation. */
export async function recommendations(
  seedIds: number[],
  excludedIds: number[] = [],
): Promise<AnimeRecommendation[]> {
  const seeds = Array.from(new Set(seedIds.filter((id) => Number.isInteger(id) && id > 0))).slice(0, 8);
  if (seeds.length === 0) return [];
  const excluded = new Set(excludedIds.filter((id) => Number.isInteger(id) && id > 0));
  for (const id of seeds) excluded.add(id);

  const key = `recommendations:${seeds.slice().sort((a, b) => a - b).join(",")}:${Array.from(excluded).sort((a, b) => a - b).join(",")}`;
  const hit = cacheGet<AnimeRecommendation[]>(key);
  if (hit) return hit;

  interface SeedNode {
    id: number;
    title: { romaji?: string; english?: string };
    recommendations?: {
      nodes: Array<{
        rating: number;
        mediaRecommendation: MediaNode | null;
      }>;
    };
  }

  const data = await gql<{ Page: { media: SeedNode[] } }>(
    `query($ids: [Int]) {
      Page(perPage: 8) {
        media(id_in: $ids, type: ANIME) {
          id
          title { romaji english }
          recommendations(sort: RATING_DESC, perPage: 12) {
            nodes {
              rating
              mediaRecommendation { ${MEDIA_FIELDS} }
            }
          }
        }
      }
    }`,
    { ids: seeds },
    "low",
  );

  const ranked = new Map<number, {
    anime: AnimeMeta;
    score: number;
    bestRating: number;
    reason: string;
    sources: Set<number>;
  }>();
  for (const seed of data.Page.media) {
    const seedTitle = seed.title.english || seed.title.romaji || "a show in your list";
    for (const node of seed.recommendations?.nodes ?? []) {
      const media = node.mediaRecommendation;
      if (!media || media.isAdult || excluded.has(media.id) || node.rating <= 0) continue;
      const edgeScore = Math.log2(node.rating + 1);
      const existing = ranked.get(media.id);
      if (existing) {
        existing.score += edgeScore;
        existing.sources.add(seed.id);
        if (node.rating > existing.bestRating) {
          existing.bestRating = node.rating;
          existing.reason = `Because you liked ${seedTitle}`;
        }
      } else {
        ranked.set(media.id, {
          anime: toAnime(media),
          score: edgeScore,
          bestRating: node.rating,
          reason: `Because you liked ${seedTitle}`,
          sources: new Set([seed.id]),
        });
      }
    }
  }

  const result = Array.from(ranked.values())
    .map((item) => ({
      anime: item.anime,
      reason: item.sources.size > 1
        ? `${item.reason} and ${item.sources.size - 1} more from your list`
        : item.reason,
      score: item.score + (item.sources.size - 1) * 2,
    }))
    .sort((a, b) => b.score - a.score
      || (b.anime.averageScore ?? 0) - (a.anime.averageScore ?? 0)
      || (b.anime.popularity ?? 0) - (a.anime.popularity ?? 0))
    .slice(0, 20);
  cacheSet(key, result);
  return result;
}

export async function advancedSearchAnime(filters: import("../../../../packages/shared/types").AdvancedSearchFilters): Promise<import("../../../../packages/shared/types").PaginatedAnime> {
  const page = filters.page || 1;
  const key = `advsearch:${page}:${JSON.stringify(filters)}`;
  const hit = cacheGet<import("../../../../packages/shared/types").PaginatedAnime>(key);
  if (hit) return hit;

  let queryArgs = [];
  let mediaArgs = [];
  const variables: Record<string, any> = {};

  if (filters.query?.trim()) {
    queryArgs.push("$q: String");
    mediaArgs.push("search: $q");
    variables.q = filters.query.trim();
  }
  if (filters.genre && filters.genre.length > 0) {
    queryArgs.push("$genre: [String]");
    mediaArgs.push("genre_in: $genre");
    variables.genre = filters.genre;
  }
  if (filters.tag && filters.tag.length > 0) {
    queryArgs.push("$tag: [String]");
    mediaArgs.push("tag_in: $tag");
    mediaArgs.push("minimumTagRank: 50");
    variables.tag = filters.tag;
  }
  if (filters.season) {
    queryArgs.push("$season: MediaSeason");
    mediaArgs.push("season: $season");
    variables.season = filters.season;
  }
  if (filters.year) {
    queryArgs.push("$year: Int");
    mediaArgs.push("seasonYear: $year");
    variables.year = filters.year;
  }
  if (filters.format) {
    queryArgs.push("$format: MediaFormat");
    mediaArgs.push("format: $format");
    variables.format = filters.format;
  }
  if (filters.status) {
    queryArgs.push("$status: MediaStatus");
    mediaArgs.push("status: $status");
    variables.status = filters.status;
  }
  if (filters.source) {
    queryArgs.push("$source: MediaSource");
    mediaArgs.push("source: $source");
    variables.source = filters.source;
  }
  if (filters.episodesGreater != null) {
    queryArgs.push("$epGt: Int");
    // episodes_greater is exclusive in AniList; subtract 1 to make it inclusive.
    mediaArgs.push("episodes_greater: $epGt");
    variables.epGt = Math.max(0, filters.episodesGreater - 1);
  }
  if (filters.episodesLesser != null) {
    queryArgs.push("$epLt: Int");
    mediaArgs.push("episodes_lesser: $epLt");
    variables.epLt = filters.episodesLesser + 1;
  }

  queryArgs.push("$sort: [MediaSort]");
  mediaArgs.push("sort: $sort");
  // A relevance search = a keyword with no explicit sort. Only those get re-ranked.
  const isRelevanceSearch = !!filters.query?.trim() && !filters.sort;
  variables.sort = filters.sort ? [filters.sort] : (filters.query?.trim() ? ["SEARCH_MATCH"] : ["TRENDING_DESC", "POPULARITY_DESC"]);

  queryArgs.push("$page: Int");
  const qArgsStr = queryArgs.length > 0 ? `(${queryArgs.join(", ")})` : "";
  const mArgsStr = mediaArgs.length > 0 ? `(${mediaArgs.join(", ")}, type: ANIME)` : "(type: ANIME)";

  const data = await gql<{ Page: { pageInfo: { hasNextPage: boolean, lastPage?: number, total?: number }, media: MediaNode[] } }>(
    `query${qArgsStr} {
      Page(page: $page, perPage: 36) {
        pageInfo { hasNextPage lastPage total }
        media${mArgsStr} { ${MEDIA_FIELDS} }
      }
    }`,
    { ...variables, page },
  );
  
  const media = isRelevanceSearch
    ? rankByRelevance(filters.query!.trim(), data.Page.media)
    : data.Page.media;
  const result = {
    results: media.map(toAnime),
    hasNextPage: data.Page.pageInfo.hasNextPage,
    lastPage: data.Page.pageInfo.lastPage ?? (data.Page.pageInfo.total ? Math.ceil(data.Page.pageInfo.total / 36) : undefined),
  };
  cacheSet(key, result);
  return result;
}

export async function trending(): Promise<AnimeMeta[]> {
  const hit = cacheGet<AnimeMeta[]>("trending");
  if (hit) return hit;
  const data = await gql<{ Page: { media: MediaNode[] } }>(
    `query {
      Page(perPage: 20) {
        media(type: ANIME, sort: TRENDING_DESC) { ${MEDIA_FIELDS} }
      }
    }`,
    {},
    "low",
  );
  const result = data.Page.media.map(toAnime);
  cacheSet("trending", result);
  return result;
}

export async function getById(id: number): Promise<AnimeMeta | null> {
  const key = `id:${id}`;
  const hit = cacheGet<AnimeMeta | null>(key);
  if (hit !== undefined) return hit;
  const data = await gql<{ Media: MediaNode | null }>(
    `query($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`,
    { id },
  );
  const result = data.Media ? toAnime(data.Media) : null;
  cacheSet(key, result);
  return result;
}

export async function getByMalId(malId: number): Promise<AnimeMeta | null> {
  const key = `mal:${malId}`;
  const hit = cacheGet<AnimeMeta | null>(key);
  if (hit !== undefined) return hit;
  const data = await gql<{ Media: MediaNode | null }>(
    `query($id: Int) { Media(idMal: $id, type: ANIME) { ${MEDIA_FIELDS} } }`,
    { id: malId },
  );
  const result = data.Media ? toAnime(data.Media) : null;
  cacheSet(key, result);
  return result;
}

export async function getRelations(id: number): Promise<RelatedAnime[]> {
  const key = `rel:${id}`;
  const hit = cacheGet<RelatedAnime[]>(key);
  if (hit) return hit;
  const data = await gql<{
    Media: { relations: { edges: { relationType: string; node: MediaNode }[] } } | null
  }>(
    `query($id: Int) {
      Media(id: $id, type: ANIME) {
        relations {
          edges {
            relationType
            node { ${MEDIA_FIELDS} }
          }
        }
      }
    }`,
    { id },
    "low",
  );
  if (!data.Media) return [];
  const result = data.Media.relations.edges
    .filter((e) => e.node.id !== id)
    .map((e) => ({ relationType: e.relationType, anime: toAnime(e.node) }));
  cacheSet(key, result);
  return result;
}
