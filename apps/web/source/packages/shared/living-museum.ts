import type { AnimeMeta } from "./types";

const MUSEUM_ERAS = [
  { start: 1960, end: 1969, label: "1960s", headline: "The television frontier" },
  { start: 1970, end: 1979, label: "1970s", headline: "Rebels, robots, and new worlds" },
  { start: 1980, end: 1989, label: "1980s", headline: "The age of impossible ambition" },
  { start: 1990, end: 1999, label: "1990s", headline: "Analog dreams at full power" },
  { start: 2000, end: 2009, label: "2000s", headline: "The digital crossing" },
  { start: 2010, end: 2019, label: "2010s", headline: "Anime goes everywhere" },
  { start: 2020, end: 2029, label: "2020s", headline: "The borderless studio" },
] as const;

export interface MuseumFact {
  label: string;
  value: string;
}

export interface MuseumExhibit {
  accession: string;
  eyebrow: string;
  room: string;
  curatorLine: string;
  facts: MuseumFact[];
  tags: string[];
}

export function readableAnimeFormat(format?: string | null): string {
  const labels: Record<string, string> = {
    TV: "television series",
    TV_SHORT: "short-form television series",
    MOVIE: "theatrical film",
    OVA: "original video animation",
    ONA: "original net animation",
    SPECIAL: "television special",
    MUSIC: "music animation",
  };
  return format ? labels[format] ?? format.toLowerCase().replaceAll("_", " ") : "anime work";
}

export function buildMuseumExhibit(anime: AnimeMeta): MuseumExhibit {
  const year = anime.year ?? null;
  const era = year ? MUSEUM_ERAS.find((candidate) => year >= candidate.start && year <= candidate.end) ?? null : null;
  const format = readableAnimeFormat(anime.format);
  const studio = anime.studios?.filter(Boolean)[0] ?? null;
  const score = anime.averageScore ?? null;
  const popularity = anime.popularity ?? null;
  const run = anime.episodes && anime.duration
    ? `${anime.episodes} × ${anime.duration} min`
    : anime.episodes
      ? `${anime.episodes} episode${anime.episodes === 1 ? "" : "s"}`
      : anime.duration
        ? `${anime.duration} min`
        : null;

  const facts: MuseumFact[] = [
    ...(year ? [{ label: "First broadcast", value: String(year) }] : []),
    { label: "Artifact type", value: format },
    ...(studio ? [{ label: "Primary studio", value: studio }] : []),
    ...(run ? [{ label: "Recorded length", value: run }] : []),
    ...(score ? [{ label: "AniList score", value: `${score}/100` }] : []),
    ...(popularity ? [{ label: "AniList audience", value: popularity.toLocaleString("en-US") }] : []),
  ];

  const catalogueYear = year ?? "UNDATED";
  const formatCode = (anime.format ?? "ANIME").replaceAll("_", "").slice(0, 4);
  const curatorLine = studio && year
    ? `Catalogued as a ${year} ${format} from ${studio}.`
    : year
      ? `Catalogued as a ${year} ${format}.`
      : `Catalogued as a ${format}; its original year is not recorded here.`;

  return {
    accession: `${catalogueYear}-${formatCode}-${anime.id}`,
    eyebrow: era ? `${era.label} collection` : "Unsorted collection",
    room: era?.headline ?? "The uncharted archive",
    curatorLine,
    facts,
    tags: [...new Set(anime.genres ?? [])].slice(0, 6),
  };
}
