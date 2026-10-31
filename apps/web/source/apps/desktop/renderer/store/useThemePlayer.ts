import { create } from "zustand";
import type { ThemeSong } from "../../../../packages/shared/anime-themes";

/**
 * Theme songs (AnimeThemes audio) as a queue: a show's openings and endings, or
 * the theme radio. One shared <audio> element, separate from the episode player,
 * and never playing alongside it.
 */
interface ThemePlayerState {
  queue: ThemeSong[];
  index: number;
  playing: boolean;
  buffering: boolean;
  progress: number;
  /** What the queue is ("Frieren", "Theme radio"). */
  label: string | null;
  problem: string | null;
  play: (songs: ThemeSong[], start?: number, label?: string | null) => void;
  toggle: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  stop: () => void;
}

export const RADIO_LABEL = "Theme radio";

let audio: HTMLAudioElement | null = null;

/** Episodes (any <video> not marked as a theme video) pause the theme songs, and vice versa. */
function pauseEpisodes() {
  document.querySelectorAll("video").forEach((video) => {
    if (!video.dataset.themeVideo && !video.paused) video.pause();
  });
}

function element(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "auto";
  const store = () => useThemePlayer.getState();
  audio.addEventListener("play", () => useThemePlayer.setState({ playing: true }));
  audio.addEventListener("pause", () => useThemePlayer.setState({ playing: false }));
  audio.addEventListener("waiting", () => useThemePlayer.setState({ buffering: true }));
  audio.addEventListener("playing", () => useThemePlayer.setState({ buffering: false, problem: null }));
  audio.addEventListener("timeupdate", () => {
    const el = audio!;
    useThemePlayer.setState({ progress: el.duration > 0 ? el.currentTime / el.duration : 0 });
  });
  audio.addEventListener("ended", () => {
    const { index, queue } = store();
    if (index + 1 < queue.length) load(index + 1);
    else useThemePlayer.setState({ playing: false });
  });
  audio.addEventListener("error", () => {
    // A missing file shouldn't end the queue: note it and move on.
    const { index, queue } = store();
    useThemePlayer.setState({ problem: `Couldn't play ${queue[index]?.title ?? "that theme"}.`, buffering: false });
    if (index + 1 < queue.length) load(index + 1);
  });
  // Starting an episode pauses the theme songs.
  document.addEventListener("play", (event) => {
    const target = event.target;
    if (target instanceof HTMLVideoElement && !target.dataset.themeVideo) audio?.pause();
  }, true);
  return audio;
}

function load(index: number) {
  const song = useThemePlayer.getState().queue[index];
  if (!song?.audioUrl) return;
  const el = element();
  useThemePlayer.setState({ index, progress: 0, buffering: true });
  el.src = song.audioUrl;
  pauseEpisodes();
  void el.play().catch(() => useThemePlayer.setState({ playing: false, buffering: false }));
}

export const useThemePlayer = create<ThemePlayerState>((set, get) => ({
  queue: [],
  index: -1,
  playing: false,
  buffering: false,
  progress: 0,
  label: null,
  problem: null,
  play: (songs, start = 0, label = null) => {
    const playable = songs.filter((song) => song.audioUrl);
    if (!playable.length) return;
    const wanted = songs[start];
    const at = Math.max(0, playable.findIndex((song) => song === wanted));
    set({ queue: playable, label, problem: null });
    load(at);
  },
  toggle: () => {
    const el = audio;
    if (!el || get().index < 0) return;
    if (el.paused) {
      pauseEpisodes();
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  },
  pause: () => audio?.pause(),
  next: () => {
    const { index, queue } = get();
    if (index + 1 < queue.length) load(index + 1);
  },
  previous: () => {
    const { index } = get();
    if (audio && (audio.currentTime > 3 || index === 0)) audio.currentTime = 0;
    else if (index > 0) load(index - 1);
  },
  stop: () => {
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    set({ queue: [], index: -1, playing: false, buffering: false, progress: 0, label: null, problem: null });
  },
}));

export const currentTheme = (state: ThemePlayerState): ThemeSong | null => state.queue[state.index] ?? null;
