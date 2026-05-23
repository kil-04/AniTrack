import type { AnimeMeta } from "../../shared/types";

const ENDPOINT = "https://graphql.anilist.co";

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

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}: ${await res.text()}`);
  // res.json() returns unknown in strict TS; cast to any for property access
  const json = await res.json() as any;
  if (json.errors)
    throw new Error(`AniList error: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

export async function searchAnime(q: string): Promise<AnimeMeta[]> {
  if (!q.trim()) return [];
  const data = await gql<{ Page: { media: MediaNode[] } }>(
    `query($q: String) {
      Page(perPage: 24) {
        media(search: $q, type: ANIME, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} }
      }
    }`,
    { q },
  );
  return data.Page.media.map(toAnime);
}

export async function trending(): Promise<AnimeMeta[]> {
  const data = await gql<{ Page: { media: MediaNode[] } }>(
    `query {
      Page(perPage: 20) {
        media(type: ANIME, sort: TRENDING_DESC) { ${MEDIA_FIELDS} }
      }
    }`,
  );
  return data.Page.media.map(toAnime);
}

export async function getById(id: number): Promise<AnimeMeta | null> {
  const data = await gql<{ Media: MediaNode | null }>(
    `query($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`,
    { id },
  );
  return data.Media ? toAnime(data.Media) : null;
}

export async function getByMalId(malId: number): Promise<AnimeMeta | null> {
  const data = await gql<{ Media: MediaNode | null }>(
    `query($id: Int) { Media(idMal: $id, type: ANIME) { ${MEDIA_FIELDS} } }`,
    { id: malId },
  );
  return data.Media ? toAnime(data.Media) : null;
}
