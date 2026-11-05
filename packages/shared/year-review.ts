/**
 * Year in Review: a recap of one calendar year built only from what this device
 * has recorded (episode playback rows and chapter reading rows). The Kotlin twin
 * is apps/android/.../data/YearReview.kt; keep the two deciding alike.
 */

/** One episode's playback row: one per show and episode, stamped when last played. */
export interface RecapWatch {
  animeId: number;
  episode: number;
  positionSec: number;
  durationSec: number;
  updatedAt: number;
  title?: string | null;
  cover?: string | null;
  genres?: string[] | null;
}

/** One chapter's reading row. `progress` is how far into the chapter, 0..1. */
export interface RecapRead {
  kind: "manga" | "novel";
  /** Identifies the title: manga id, or the novel's group key. */
  key: string;
  chapter: string;
  progress: number;
  updatedAt: number;
  title?: string | null;
  cover?: string | null;
}

export interface LocalTime {
  year: number;
  month: number; // 0..11
  day: number;   // 1..31
  hour: number;  // 0..23
  /** Whole days since 1970-01-01 in local time, so consecutive days differ by 1. */
  dayKey: number;
}

export interface RecapTitle {
  key: string;
  title: string;
  cover: string | null;
  /** Episodes watched, or chapters read. */
  count: number;
  minutes: number;
}

export interface RecapDay { year: number; month: number; day: number; count: number }

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export interface YearRecap {
  year: number;
  hasActivity: boolean;
  episodes: number;
  minutes: number;
  shows: number;
  topShows: RecapTitle[];
  firstShow: RecapTitle | null;
  topGenres: { label: string; count: number }[];
  /** Minutes watched in each month, January first. */
  monthMinutes: number[];
  /** Chapters read (manga and novels) in each month. */
  monthChapters: number[];
  busiestMonth: number | null;
  biggestDay: RecapDay | null;
  activeDays: number;
  longestStreak: number;
  timeOfDay: TimeOfDay | null;
  /** Share (0..100) of activity in timeOfDay. */
  timeOfDayShare: number;
  mangaChapters: number;
  novelChapters: number;
  titlesRead: number;
  topManga: RecapTitle | null;
  topNovel: RecapTitle | null;
  persona: { title: string; line: string };
}

/** Watched through: the same 85% that marks an episode watched on MAL. */
export const WATCHED_RATIO = 0.85;
/** Read: at least half of the chapter's pages or paragraphs. */
export const READ_RATIO = 0.5;
/** Rows of one title stamped closer together than this came from a bulk "mark read", not reading. */
export const BULK_GAP_MS = 1500;

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const TIME_OF_DAY_LABEL: Record<TimeOfDay, string> = {
  morning: "mornings", afternoon: "afternoons", evening: "evenings", night: "late nights",
};

export function localTime(ts: number): LocalTime {
  const d = new Date(ts);
  const year = d.getFullYear(), month = d.getMonth(), day = d.getDate();
  return { year, month, day, hour: d.getHours(), dayKey: Math.round(Date.UTC(year, month, day) / 86_400_000) };
}

export function timeOfDayFor(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

function isWatched(w: RecapWatch): boolean {
  return w.durationSec > 0 && w.positionSec / w.durationSec >= WATCHED_RATIO;
}

function isRead(r: RecapRead): boolean {
  return !(r.progress < READ_RATIO);
}

/** Drops rows of one title stamped within BULK_GAP_MS of a neighbour of the same title. */
function withoutBulk<T>(rows: T[], keyOf: (row: T) => string, at: (row: T) => number): T[] {
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    const list = byKey.get(keyOf(row));
    if (list) list.push(row); else byKey.set(keyOf(row), [row]);
  }
  const kept: T[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => at(a) - at(b));
    list.forEach((row, i) => {
      const prev = i > 0 ? at(row) - at(list[i - 1]) : Infinity;
      const next = i < list.length - 1 ? at(list[i + 1]) - at(row) : Infinity;
      if (prev >= BULK_GAP_MS && next >= BULK_GAP_MS) kept.push(row);
    });
  }
  return kept;
}

/** Years with any recorded watching or reading, newest first. */
export function recapYears(watches: RecapWatch[], reads: RecapRead[], local: (ts: number) => LocalTime = localTime): number[] {
  const years = new Set<number>();
  for (const w of watches) if (w.positionSec > 0) years.add(local(w.updatedAt).year);
  for (const r of reads) years.add(local(r.updatedAt).year);
  return [...years].sort((a, b) => b - a);
}

function cleanTitle(title: string | null | undefined, fallback: string): string {
  const t = (title ?? "").trim();
  return t && t !== "Unknown" ? t : fallback;
}

function topTitle(rows: RecapRead[]): RecapTitle | null {
  const map = new Map<string, RecapTitle & { last: number }>();
  for (const r of rows) {
    const t = map.get(r.key) ?? { key: r.key, title: cleanTitle(r.title, "Untitled"), cover: r.cover ?? null, count: 0, minutes: 0, last: 0 };
    t.count++;
    if (r.updatedAt > t.last) {
      t.last = r.updatedAt;
      if (r.cover) t.cover = r.cover;
      if (r.title && r.title !== "Unknown") t.title = r.title.trim();
    }
    map.set(r.key, t);
  }
  const best = [...map.values()].sort((a, b) => b.count - a.count || b.last - a.last)[0];
  return best ? { key: best.key, title: best.title, cover: best.cover, count: best.count, minutes: 0 } : null;
}

function personaFor(recap: Omit<YearRecap, "persona">): { title: string; line: string } {
  const genre = recap.topGenres[0]?.label;
  const top = recap.topShows[0];
  const chapters = recap.mangaChapters + recap.novelChapters;
  const hours = Math.round(recap.minutes / 60);
  const genreLine = genre ? ` ${genre} led the way.` : "";
  if (!recap.hasActivity) {
    return { title: "A Quiet Year", line: `Nothing was watched or read on this device in ${recap.year} yet.` };
  }
  if (chapters > 0 && chapters >= recap.episodes * 2) {
    return { title: "The Page Turner", line: `${chapters} chapters read against ${recap.episodes} episodes watched. The story was on the page this year.` };
  }
  if (top && recap.episodes >= 12 && top.count / recap.episodes >= 0.5) {
    return { title: "The Devotee", line: `${top.title} took ${Math.round((top.count / recap.episodes) * 100)}% of your episodes.${genreLine}` };
  }
  if (recap.timeOfDay === "night" && recap.timeOfDayShare >= 45) {
    return { title: "The Night Owl", line: `${recap.timeOfDayShare}% of your watching and reading happened after 10 pm.${genreLine}` };
  }
  if (recap.longestStreak >= 14) {
    return { title: "The Daily Ritual", line: `${recap.longestStreak} days in a row without missing a day.${genreLine}` };
  }
  if (recap.shows >= 25) {
    return { title: "The Explorer", line: `${recap.shows} different shows, ${hours} hours in all.${genreLine}` };
  }
  if (hours >= 200) {
    return { title: "The Marathoner", line: `${hours} hours of anime: more than ${Math.floor(hours / 24)} full days.${genreLine}` };
  }
  return { title: "The Steady Watcher", line: `${recap.episodes} episodes across ${recap.shows} shows.${genreLine}` };
}

export function buildYearRecap(
  year: number,
  watches: RecapWatch[],
  reads: RecapRead[],
  local: (ts: number) => LocalTime = localTime,
): YearRecap {
  const inYear = <T extends { updatedAt: number }>(rows: T[]) => rows
    .map((row) => ({ row, at: local(row.updatedAt) }))
    .filter(({ at }) => at.year === year);

  const yearWatches = inYear(watches.filter((w) => w.positionSec > 0));
  const finished = withoutBulk(yearWatches.filter(({ row }) => isWatched(row)), ({ row }) => String(row.animeId), ({ row }) => row.updatedAt);
  const finishedSet = new Set(finished);
  // A bulk-marked episode is not watching time either.
  const timed = yearWatches.filter((w) => !isWatched(w.row) || finishedSet.has(w));
  const yearReads = withoutBulk(inYear(reads).filter(({ row }) => isRead(row)), ({ row }) => `${row.kind}:${row.key}`, ({ row }) => row.updatedAt);

  const monthMinutes = new Array(12).fill(0);
  const monthChapters = new Array(12).fill(0);
  const days = new Map<number, RecapDay>();
  const activeDays = new Set<number>();
  const hours: Record<TimeOfDay, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  const shows = new Map<number, RecapTitle & { first: number; last: number; genres: string[] }>();
  let minutes = 0;

  for (const { row, at } of timed) {
    const m = Math.min(row.positionSec, row.durationSec > 0 ? row.durationSec : row.positionSec) / 60;
    minutes += m;
    monthMinutes[at.month] += m;
    activeDays.add(at.dayKey);
    hours[timeOfDayFor(at.hour)]++;
    const show = shows.get(row.animeId) ?? {
      key: String(row.animeId), title: cleanTitle(row.title, "Unknown show"), cover: row.cover ?? null,
      count: 0, minutes: 0, first: row.updatedAt, last: 0, genres: row.genres ?? [],
    };
    show.minutes += m;
    show.first = Math.min(show.first, row.updatedAt);
    if (row.updatedAt > show.last) {
      show.last = row.updatedAt;
      if (row.cover) show.cover = row.cover;
    }
    if (!show.genres.length && row.genres?.length) show.genres = row.genres;
    shows.set(row.animeId, show);
  }
  for (const { row, at } of finished) {
    shows.get(row.animeId)!.count++;
    const day = days.get(at.dayKey) ?? { year: at.year, month: at.month, day: at.day, count: 0 };
    day.count++;
    days.set(at.dayKey, day);
  }
  for (const { at } of yearReads) {
    monthChapters[at.month]++;
    activeDays.add(at.dayKey);
    hours[timeOfDayFor(at.hour)]++;
  }

  const watchedShows = [...shows.values()].filter((s) => s.count > 0 || s.minutes >= 10);
  const topShows = [...watchedShows]
    .sort((a, b) => b.count - a.count || b.minutes - a.minutes || b.last - a.last)
    .slice(0, 5)
    .map(({ key, title, cover, count, minutes }) => ({ key, title, cover, count, minutes: Math.round(minutes) }));
  const first = [...watchedShows].sort((a, b) => a.first - b.first)[0];

  const genreCounts = new Map<string, number>();
  for (const show of watchedShows) for (const g of show.genres) genreCounts.set(g, (genreCounts.get(g) ?? 0) + Math.max(1, show.count));
  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));

  const sortedDays = [...activeDays].sort((a, b) => a - b);
  let longestStreak = 0, run = 0;
  sortedDays.forEach((d, i) => {
    run = i > 0 && d - sortedDays[i - 1] === 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
  });

  const biggestDay = [...days.values()].sort((a, b) => b.count - a.count || a.month - b.month || a.day - b.day)[0] ?? null;
  const activity = monthMinutes.map((m, i) => m + monthChapters[i] * 5); // a chapter is roughly five minutes
  const busiest = activity.reduce((best, v, i) => (v > activity[best] ? i : best), 0);
  const totalHours = Object.values(hours).reduce((a, b) => a + b, 0);
  const timeOfDay = totalHours
    ? (Object.keys(hours) as TimeOfDay[]).reduce((best, k) => (hours[k] > hours[best] ? k : best), "morning")
    : null;

  const manga = yearReads.filter(({ row }) => row.kind === "manga").map(({ row }) => row);
  const novels = yearReads.filter(({ row }) => row.kind === "novel").map(({ row }) => row);

  const base: Omit<YearRecap, "persona"> = {
    year,
    hasActivity: watchedShows.length > 0 || yearReads.length > 0,
    episodes: finished.length,
    minutes: Math.round(minutes),
    shows: watchedShows.length,
    topShows,
    firstShow: first ? { key: first.key, title: first.title, cover: first.cover, count: first.count, minutes: Math.round(first.minutes) } : null,
    topGenres,
    monthMinutes: monthMinutes.map(Math.round),
    monthChapters,
    busiestMonth: activity[busiest] > 0 ? busiest : null,
    biggestDay,
    activeDays: activeDays.size,
    longestStreak,
    timeOfDay,
    timeOfDayShare: timeOfDay ? Math.round((hours[timeOfDay] / totalHours) * 100) : 0,
    mangaChapters: manga.length,
    novelChapters: novels.length,
    titlesRead: new Set(yearReads.map(({ row }) => `${row.kind}:${row.key}`)).size,
    topManga: topTitle(manga),
    topNovel: topTitle(novels),
  };
  return { ...base, persona: personaFor(base) };
}

export function timeOfDayLabel(t: TimeOfDay): string {
  return TIME_OF_DAY_LABEL[t];
}

/** "1,234 h" style duration for the headline stat. */
export function formatWatchTime(minutes: number): { value: string; unit: string } {
  if (minutes < 120) return { value: String(minutes), unit: minutes === 1 ? "minute" : "minutes" };
  const hours = Math.round(minutes / 60);
  return { value: hours.toLocaleString("en-US"), unit: "hours" };
}
