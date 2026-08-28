export interface TasteGenomeEntry {
  status: string;
  score?: number | null;
  year?: number | null;
  genres?: string[] | null;
  format?: string | null;
}

export interface TasteAffinity {
  key: string;
  label: string;
  count: number;
  averageScore: number | null;
  strength: number;
}

export interface TasteGenome {
  analyzed: number;
  rated: number;
  meanScore: number | null;
  classicShare: number;
  confidence: number;
  archetype: string;
  summary: string;
  eras: TasteAffinity[];
  genres: TasteAffinity[];
  formats: TasteAffinity[];
}

type Bucket = { key: string; label: string; count: number; weight: number; scoreTotal: number; rated: number };

const FORMAT_LABELS: Record<string, string> = {
  TV: "TV Series", TV_SHORT: "TV Shorts", MOVIE: "Films", OVA: "OVAs",
  ONA: "ONAs", SPECIAL: "Specials", MUSIC: "Music",
};

function entryWeight(entry: TasteGenomeEntry): number {
  const statusWeight = entry.status === "completed" ? 1
    : entry.status === "watching" ? 0.85
      : entry.status === "on_hold" ? 0.35
        : entry.status === "dropped" ? 0.15 : 0;
  if (statusWeight === 0) return 0;
  const ratingWeight = entry.score != null && entry.score > 0 ? 0.55 + entry.score / 10 : 0.75;
  return statusWeight * ratingWeight;
}

function addBucket(map: Map<string, Bucket>, key: string, label: string, entry: TasteGenomeEntry, weight: number) {
  const bucket = map.get(key) ?? { key, label, count: 0, weight: 0, scoreTotal: 0, rated: 0 };
  bucket.count++;
  bucket.weight += weight;
  if (entry.score != null && entry.score > 0) {
    bucket.scoreTotal += entry.score;
    bucket.rated++;
  }
  map.set(key, bucket);
}

function finishBuckets(map: Map<string, Bucket>, limit: number): TasteAffinity[] {
  const ranked = [...map.values()].sort((a, b) => b.weight - a.weight || b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit);
  const strongest = ranked[0]?.weight ?? 1;
  return ranked.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: bucket.count,
    averageScore: bucket.rated ? Number((bucket.scoreTotal / bucket.rated).toFixed(2)) : null,
    strength: Math.round(bucket.weight / strongest * 100),
  }));
}

export function analyzeTasteGenome(entries: TasteGenomeEntry[]): TasteGenome {
  const watched = entries.filter((entry) => entryWeight(entry) > 0);
  const eras = new Map<string, Bucket>();
  const genres = new Map<string, Bucket>();
  const formats = new Map<string, Bucket>();
  let rated = 0;
  let scoreTotal = 0;
  let classic = 0;

  for (const entry of watched) {
    const weight = entryWeight(entry);
    if (entry.score != null && entry.score > 0) { rated++; scoreTotal += entry.score; }
    if (entry.year != null) {
      const decade = Math.floor(entry.year / 10) * 10;
      addBucket(eras, `${decade}`, `${decade}s`, entry, weight);
      if (entry.year < 2000) classic++;
    }
    for (const genre of new Set(entry.genres ?? [])) addBucket(genres, genre.toLowerCase(), genre, entry, weight);
    if (entry.format) addBucket(formats, entry.format, FORMAT_LABELS[entry.format] ?? entry.format, entry, weight);
  }

  const eraResults = finishBuckets(eras, 6);
  const genreResults = finishBuckets(genres, 8);
  const formatResults = finishBuckets(formats, 5);
  const leadEra = eraResults[0]?.label;
  const leadGenre = genreResults[0]?.label;
  const classicShare = watched.length ? Math.round(classic / watched.length * 100) : 0;
  const archetype = leadEra && leadGenre
    ? `${leadEra} ${leadGenre} ${Number.parseInt(leadEra) < 2000 ? "Archivist" : "Explorer"}`
    : leadGenre ? `${leadGenre} Explorer` : leadEra ? `${leadEra} Time Traveller` : "Uncharted Viewer";
  const summary = leadEra && leadGenre
    ? `Your strongest signal comes from ${leadGenre.toLowerCase()} anime of the ${leadEra}, with ${classicShare}% of your watched taste rooted before 2000.`
    : watched.length ? "Your taste signal is forming as more list metadata is collected." : "Watch or complete anime to reveal your taste signal.";

  const metadataPoints = watched.reduce((sum, entry) => sum + Number(entry.year != null) + Number((entry.genres?.length ?? 0) > 0) + Number(entry.format != null), 0);
  const confidence = watched.length ? Math.min(100, Math.round((Math.min(1, watched.length / 80) * 0.55 + metadataPoints / (watched.length * 3) * 0.45) * 100)) : 0;

  return {
    analyzed: watched.length,
    rated,
    meanScore: rated ? Number((scoreTotal / rated).toFixed(2)) : null,
    classicShare,
    confidence,
    archetype,
    summary,
    eras: eraResults,
    genres: genreResults,
    formats: formatResults,
  };
}
