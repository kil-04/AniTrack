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

export function yearTransmission(year: number): string {
  const era = animeEraForYear(year);
  const offset = year - era.start;
  if (offset <= 2) return `Early ${era.label} transmission`;
  if (offset >= 7) return `Late ${era.label} transmission`;
  return `Mid-${era.label} transmission`;
}
