import { create } from "zustand";
import {
  BG_MUSIC_BUNDLED_DEFAULT,
  BG_MUSIC_MODES,
  BG_MUSIC_RESTART_AFTER_SEC,
  nextMode,
  nextTrackIndex,
  previousTrackIndex,
  skipTrackIndex,
  startTrackId,
  type BgMusicMode,
  type BgTrack,
} from "../../../../packages/shared/bg-music";
import { useThemePlayer } from "./useThemePlayer";

/**
 * Background music while browsing: the user's own tracks (imported into
 * userData/music, never bundled), one at a time on a private <audio> element.
 * It steps aside for anything else that makes sound: episodes, the player
 * screen, theme songs, and a minimized or hidden window. Settings are per device.
 */
export type BgHold = "episode" | "player" | "theme" | "hidden";

interface Saved {
  /** Background music is on: it plays whenever nothing holds it and it is not paused. */
  enabled: boolean;
  mode: BgMusicMode;
  trackId: string | null;
  volume: number;
  /** The starred track AniTrack opens with (null: carry on from the last one). */
  defaultId: string | null;
}

interface BgMusicState extends Saved {
  tracks: BgTrack[];
  /** Paused with the Pause button, for this session; the music stays on. */
  paused: boolean;
  /** The element is actually playing. */
  playing: boolean;
  holds: BgHold[];
  loaded: boolean;
  setEnabled: (on: boolean) => void;
  toggle: () => void;
  /** Play (turning the music on) or Pause. */
  togglePlay: () => void;
  /** Picks a track and plays it (turning the music on). */
  select: (trackId: string) => void;
  next: () => void;
  previous: () => void;
  setMode: (mode: BgMusicMode) => void;
  /** The Repeat button: Play all → Repeat one → Shuffle. */
  cycleMode: () => void;
  /** Stars [trackId] as the track to open with, or clears the star (null). */
  setDefault: (trackId: string | null) => void;
  setVolume: (volume: number) => void;
  refresh: () => Promise<void>;
  importTracks: () => Promise<{ added: number; skipped: number }>;
  remove: (trackId: string) => Promise<void>;
}

const SETTINGS_KEY = "anitrack.bgm.v1";
const FADE_MS = 450;
const HISTORY_LIMIT = 100;

function loadSaved(): Saved {
  // The built-in piano track is the default until the user stars another (or none).
  const fallback: Saved = { enabled: false, mode: "all", trackId: null, volume: 0.5, defaultId: BG_MUSIC_BUNDLED_DEFAULT };
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    if (!value || typeof value !== "object") return fallback;
    return {
      enabled: value.enabled === true,
      mode: BG_MUSIC_MODES.includes(value.mode) ? value.mode : fallback.mode,
      trackId: typeof value.trackId === "string" ? value.trackId : null,
      volume: typeof value.volume === "number" && value.volume >= 0 && value.volume <= 1 ? value.volume : fallback.volume,
      defaultId: !("defaultId" in value) ? fallback.defaultId : typeof value.defaultId === "string" ? value.defaultId : null,
    };
  } catch { return fallback; }
}

function save(state: Saved) {
  try {
    const { enabled, mode, trackId, volume, defaultId } = state;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enabled, mode, trackId, volume, defaultId }));
  } catch { /* storage unavailable: settings last this session */ }
}

export const trackUrl = (trackId: string) => `anitrack-music://t/${encodeURIComponent(trackId)}`;

let audio: HTMLAudioElement | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;
let failures = 0;
/** The track the element holds (its src is re-encoded by the browser, so not compared). */
let loadedId: string | null = null;
/** Tracks played before the current one, for Previous in Shuffle. */
const history: string[] = [];

/** Ramps the volume to [target], then runs [done]. */
function fade(target: number, done?: () => void) {
  const el = audio;
  if (!el) return;
  if (fadeTimer) clearInterval(fadeTimer);
  const start = el.volume;
  const began = performance.now();
  fadeTimer = setInterval(() => {
    const t = Math.min(1, (performance.now() - began) / FADE_MS);
    el.volume = Math.max(0, Math.min(1, start + (target - start) * t));
    if (t >= 1) {
      if (fadeTimer) clearInterval(fadeTimer);
      fadeTimer = null;
      done?.();
    }
  }, 30);
}

function element(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "auto";
  audio.volume = 0;
  audio.addEventListener("play", () => useBgMusic.setState({ playing: true }));
  audio.addEventListener("pause", () => useBgMusic.setState({ playing: false }));
  audio.addEventListener("playing", () => { failures = 0; });
  audio.addEventListener("ended", () => moveTo("ended"));
  audio.addEventListener("error", () => {
    // A missing or unplayable file moves on, but never loops through a broken list.
    failures++;
    if (failures < useBgMusic.getState().tracks.length) moveTo("skip");
    else useBgMusic.setState({ playing: false });
  });
  return audio;
}

/** Switches to [trackId] (remembering the one before it) and starts it if music should play. */
function playTrack(trackId: string) {
  const current = useBgMusic.getState().trackId;
  if (current && current !== trackId) {
    history.push(current);
    if (history.length > HISTORY_LIMIT) history.shift();
  }
  useBgMusic.setState({ trackId });
  save(useBgMusic.getState());
  apply(true);
}

/** The next track: by the mode when one ends, and always a different one when skipped. */
function moveTo(how: "ended" | "skip") {
  const { tracks, trackId, mode } = useBgMusic.getState();
  const current = tracks.findIndex((t) => t.id === trackId);
  const next = how === "ended" ? nextTrackIndex(mode, current, tracks.length) : skipTrackIndex(mode, current, tracks.length);
  if (next >= 0) playTrack(tracks[next].id);
}

/** Back to the start of this track, or to the one before it. */
function goBack() {
  const { tracks, trackId, mode } = useBgMusic.getState();
  if (audio && loadedId != null && loadedId === trackId && audio.currentTime > BG_MUSIC_RESTART_AFTER_SEC) {
    audio.currentTime = 0;
    return;
  }
  let target: string | undefined;
  while (mode === "shuffle" && !target && history.length) {
    const id = history.pop();
    if (tracks.some((t) => t.id === id)) target = id;
  }
  if (!target) {
    const index = previousTrackIndex(tracks.findIndex((t) => t.id === trackId), tracks.length);
    if (index < 0) return;
    target = tracks[index].id;
  }
  useBgMusic.setState({ trackId: target });
  save(useBgMusic.getState());
  apply(true);
}

/** Loop in place for Repeat one, and for a lone track (rather than reloading it and fading back in). */
const loops = (mode: BgMusicMode, count: number) => mode === "one" || count === 1;

/** Plays or pauses to match the settings and holds. [restart] reloads the current track. */
function apply(restart = false) {
  const { enabled, paused, tracks, trackId, holds, volume, mode } = useBgMusic.getState();
  const track = tracks.find((t) => t.id === trackId) ?? tracks[0];
  const shouldPlay = enabled && !paused && track != null && holds.length === 0;
  if (!shouldPlay) {
    if (audio && !audio.paused) fade(0, () => audio?.pause());
    return;
  }
  const el = element();
  el.loop = loops(mode, tracks.length);
  if (restart || loadedId !== track.id) {
    el.src = trackUrl(track.id);
    loadedId = track.id;
    el.volume = 0;
  }
  if (trackId !== track.id) {
    useBgMusic.setState({ trackId: track.id });
    save(useBgMusic.getState());
  }
  if (el.paused) void el.play().catch(() => useBgMusic.setState({ playing: false }));
  fade(volume);
}

function setHold(hold: BgHold, on: boolean) {
  const holds = useBgMusic.getState().holds;
  if (on === holds.includes(hold)) return;
  useBgMusic.setState({ holds: on ? [...holds, hold] : holds.filter((h) => h !== hold) });
  apply();
}

export const useBgMusic = create<BgMusicState>((set, get) => ({
  ...loadSaved(),
  tracks: [],
  paused: false,
  playing: false,
  holds: [],
  loaded: false,
  setEnabled: (enabled) => {
    set({ enabled, paused: false });
    save(get());
    failures = 0;
    apply();
  },
  toggle: () => get().setEnabled(!get().enabled),
  togglePlay: () => {
    const { enabled, paused } = get();
    if (enabled && !paused) {
      set({ paused: true });
      apply();
    } else {
      get().setEnabled(true);
    }
  },
  select: (trackId) => {
    set({ enabled: true, paused: false });
    failures = 0;
    playTrack(trackId);
  },
  next: () => moveTo("skip"),
  previous: () => goBack(),
  setMode: (mode) => {
    set({ mode });
    save(get());
    if (audio) audio.loop = loops(mode, get().tracks.length);
  },
  cycleMode: () => get().setMode(nextMode(get().mode)),
  setDefault: (defaultId) => {
    set({ defaultId });
    save(get());
  },
  setVolume: (volume) => {
    set({ volume });
    save(get());
    if (audio && !audio.paused) fade(volume);
  },
  refresh: async () => {
    const tracks = (await window.api.music?.list().catch(() => null)) ?? [];
    // Opening the app starts at the starred default (or where it left off).
    if (!get().loaded) set({ trackId: startTrackId(tracks, get().trackId, get().defaultId) });
    set({ tracks, loaded: true });
    apply();
  },
  importTracks: async () => {
    const result = await window.api.music?.import();
    if (!result) return { added: 0, skipped: 0 };
    set({ tracks: result.tracks, loaded: true });
    apply();
    return { added: result.added, skipped: result.skipped };
  },
  remove: async (trackId) => {
    if (loadedId === trackId && audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); loadedId = null; }
    const tracks = (await window.api.music?.remove(trackId).catch(() => null)) ?? get().tracks;
    set({
      tracks,
      trackId: get().trackId === trackId ? null : get().trackId,
      defaultId: get().defaultId === trackId ? null : get().defaultId,
    });
    save(get());
    apply();
  },
}));

/** Episodes and theme-song videos alike: any video with its sound going. */
const videoPlaying = () =>
  Array.from(document.querySelectorAll("video")).some((video) => !video.paused && !video.ended);

let started = false;

/**
 * Starts background music for the window: loads the tracks and follows what
 * else is playing. [holdForPlayerRoute] holds it while the episode player is open.
 */
export function startBgMusic(): void {
  if (started || !window.api.music) return;
  started = true;
  // A video removed mid-play never reports its pause here, so look again while one holds.
  let videoCheck: ReturnType<typeof setInterval> | null = null;
  const checkVideos = () => {
    const on = videoPlaying();
    setHold("episode", on);
    if (on && !videoCheck) videoCheck = setInterval(checkVideos, 1500);
    if (!on && videoCheck) { clearInterval(videoCheck); videoCheck = null; }
  };
  const onMedia = (event: Event) => {
    if (event.target instanceof HTMLVideoElement) checkVideos();
  };
  for (const type of ["play", "playing", "pause", "ended", "emptied"]) document.addEventListener(type, onMedia, true);
  useThemePlayer.subscribe((state) => setHold("theme", state.playing));
  const onVisibility = () => setHold("hidden", document.visibilityState === "hidden");
  document.addEventListener("visibilitychange", onVisibility);
  onVisibility();
  void useBgMusic.getState().refresh();
}

export function holdForPlayerRoute(active: boolean): void {
  setHold("player", active);
}
