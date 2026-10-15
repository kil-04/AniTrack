/**
 * Background music: tracks the user imported on this device (never bundled with
 * the app), with Repeat one / Play all / Shuffle. Shared rules; Android mirrors
 * them in BackgroundMusicRules.kt.
 */

export type BgMusicMode = "one" | "all" | "shuffle";
export const BG_MUSIC_MODES: BgMusicMode[] = ["one", "all", "shuffle"];
export const BG_MUSIC_EXTENSIONS = [".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".flac"];
/** Largest single file accepted on import. */
export const BG_MUSIC_MAX_BYTES = 200 * 1024 * 1024;

export interface BgTrack {
  /** The file name inside the app's music folder. */
  id: string;
  title: string;
  /** A leading track number ("57 I Will Protect You.mp3"), for ordering. */
  number: number | null;
  /** Ships with the app (Android assets/music; desktop resources/music) instead of being imported. */
  bundled?: boolean;
}

/** The built-in track, the user's own piano recording: the default until another is starred. */
export const BG_MUSIC_BUNDLED_DEFAULT = "Because I Will Protect You.mp3";

/** Whether [name] is a file the music player accepts. */
export function isMusicFile(name: string): boolean {
  const lower = name.toLowerCase();
  return BG_MUSIC_EXTENSIONS.some((ext) => lower.endsWith(ext)) && !lower.startsWith(".");
}

/** "57 I Will Protect You -Reload-.mp3" → number 57, title "I Will Protect You -Reload-". */
export function trackFromFile(name: string): BgTrack | null {
  if (!isMusicFile(name)) return null;
  const base = name.slice(0, name.lastIndexOf(".")).trim();
  const match = /^(\d{1,3})(?:\s*[-._)]\s*|\s+)(.+)$/.exec(base);
  const title = (match ? match[2] : base).trim() || base;
  return { id: name, title, number: match ? Number(match[1]) : null };
}

/** Numbered tracks first, in number order, then the rest by title. */
export function sortTracks(tracks: BgTrack[]): BgTrack[] {
  return [...tracks].sort((a, b) => {
    if (a.number != null && b.number != null && a.number !== b.number) return a.number - b.number;
    if ((a.number == null) !== (b.number == null)) return a.number == null ? 1 : -1;
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
  });
}

/**
 * The track to play after track [current] (of [count]) ends. Repeat one plays it
 * again; Play all goes on in order and wraps; Shuffle picks another track, never the
 * one that just played (unless it is the only one). -1 when there is nothing to play.
 */
export function nextTrackIndex(mode: BgMusicMode, current: number, count: number, random: () => number = Math.random): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return 0;
  if (mode === "one") return current;
  if (mode === "all") return (current + 1) % count;
  if (count === 1) return 0;
  const pick = Math.floor(random() * (count - 1));
  return pick >= current ? pick + 1 : pick;
}

/** A track skipped with Next: Repeat one moves on in list order; the other modes as usual. */
export function skipTrackIndex(mode: BgMusicMode, current: number, count: number, random: () => number = Math.random): number {
  return nextTrackIndex(mode === "one" ? "all" : mode, current, count, random);
}

/** The track before [current] in list order, wrapping (Previous outside Shuffle history). */
export function previousTrackIndex(current: number, count: number): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return 0;
  return (current - 1 + count) % count;
}

/** Previous restarts the current track once it has played this many seconds. */
export const BG_MUSIC_RESTART_AFTER_SEC = 3;

/** The Repeat button's cycle: Play all, then Repeat one, then Shuffle. */
export function nextMode(mode: BgMusicMode): BgMusicMode {
  const order: BgMusicMode[] = ["all", "one", "shuffle"];
  return order[(order.indexOf(mode) + 1) % order.length];
}

/**
 * The track AniTrack opens with: the starred default when there is one, else the
 * track that was playing last time, else the first. null with no tracks.
 */
export function startTrackId(tracks: BgTrack[], lastId: string | null, defaultId: string | null): string | null {
  if (defaultId && tracks.some((t) => t.id === defaultId)) return defaultId;
  if (lastId && tracks.some((t) => t.id === lastId)) return lastId;
  return tracks[0]?.id ?? null;
}

/** A safe file name for an imported track: no folders, no characters Windows refuses. */
export function safeTrackName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/^\.+/, "").slice(0, 180) || "track.mp3";
}
