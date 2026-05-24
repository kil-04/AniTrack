import type { AnimeMeta, RelatedAnime } from "../../shared/types";

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
  description(asHtml: false)
  episodes
  duration
  status
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
  description?: string | null;
  episodes?: number | null;
  duration?: number | null;
  status?: string | null;
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
  };
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}, attempt = 1): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  // Retry on 429 only — capped at 1 retry, max 1.5s wait.
  if (res.status === 429 && attempt < 2) {
    // retry-after header is seconds; convert to ms and cap.
    const retryAfterSec = Number(res.headers.get("retry-after"));
    const waitMs = Math.min(1500, isFinite(retryAfterSec) ? retryAfterSec * 1000 : 800);
    await new Promise((r) => setTimeout(r, waitMs));
    return gql<T>(query, variables, attempt + 1);
  }
  if (!res.ok) throw new Error(`AniList ${res.status}: ${await res.text()}`);
  const json = await res.json() as any;
  if (json.errors)
    throw new Error(`AniList error: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

export async function searchAnime(q: string): Promise<AnimeMeta[]> {
  if (!q.trim()) return [];
  const key = `search:${q.trim().toLowerCase()}`;
  const hit = cacheGet<AnimeMeta[]>(key);
  if (hit) return hit;
  const data = await gql<{ Page: { media: MediaNode[] } }>(
    `query($q: String) {
      Page(perPage: 24) {
        media(search: $q, type: ANIME, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} }
      }
    }`,
    { q },
  );
  const result = data.Page.media.map(toAnime);
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
  );
  if (!data.Media) return [];
  const result = data.Media.relations.edges
    .filter((e) => e.node.id !== id)
    .map((e) => ({ relationType: e.relationType, anime: toAnime(e.node) }));
  cacheSet(key, result);
  return result;
}
