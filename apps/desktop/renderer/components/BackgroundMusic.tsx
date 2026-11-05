import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  AudioLines,
  Check,
  FolderOpen,
  ListPlus,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Star,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { isMusicDownloadUrl, themeTrackFileName, type BgMusicMode, type BgTrack } from "../../../../packages/shared/bg-music";
import { useBgMusic, type BgHold } from "../store/useBgMusic";

const MODES: Record<BgMusicMode, { label: string; icon: LucideIcon }> = {
  all: { label: "Play all", icon: Repeat },
  one: { label: "Repeat one", icon: Repeat1 },
  shuffle: { label: "Shuffle", icon: Shuffle },
};
const MODE_ORDER: BgMusicMode[] = ["all", "one", "shuffle"];

const HOLD_LABELS: Record<BgHold, string> = {
  episode: "Paused while a video plays",
  player: "Paused while the player is open",
  theme: "Paused while a theme song plays",
  hidden: "Paused while AniTrack is hidden",
  "city-pop": "Paused while City Pop is open",
};

function useMusic() {
  const enabled = useBgMusic((s) => s.enabled);
  const paused = useBgMusic((s) => s.paused);
  const tracks = useBgMusic((s) => s.tracks);
  const trackId = useBgMusic((s) => s.trackId);
  const playing = useBgMusic((s) => s.playing);
  const holds = useBgMusic((s) => s.holds);
  const loaded = useBgMusic((s) => s.loaded);
  const mode = useBgMusic((s) => s.mode);
  const current: BgTrack | undefined = tracks.find((t) => t.id === trackId) ?? tracks[0];
  /** Music is meant to be playing (it may still be held by a video or theme song). */
  const on = enabled && !paused;
  let status = "Off";
  if (!tracks.length) status = "No tracks yet";
  else if (enabled && paused) status = "Paused";
  else if (enabled && holds.length) status = HOLD_LABELS[holds[holds.length - 1]];
  else if (enabled) status = playing && current ? `Playing ${current.title}` : "Starting…";
  return { enabled, on, tracks, playing, loaded, current, status, mode };
}

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      disabled={disabled}
      className="flex items-center gap-3 text-sm font-semibold text-white disabled:opacity-40"
    >
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-white/20"}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
      </span>
      {label}
    </button>
  );
}

/** Previous, Play/Pause and Next; [size] "lg" for Settings, "sm" for the top bar. */
function Transport({ size }: { size: "sm" | "lg" }) {
  const { on, tracks } = useMusic();
  const { previous, togglePlay, next } = useBgMusic.getState();
  const small = size === "sm";
  const side = small
    ? "grid h-8 w-8 place-items-center rounded-full text-ink-2 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
    : "btn btn-ghost btn-icon h-9 w-9 rounded-full";
  const icon = small ? 14 : 16;
  return (
    <div className="flex items-center gap-0.5">
      <button onClick={previous} disabled={!tracks.length} title="Previous" aria-label="Previous track" className={side}>
        <SkipBack size={icon} fill="currentColor" />
      </button>
      <button
        onClick={togglePlay}
        disabled={!tracks.length}
        title={on ? "Pause" : "Play"}
        aria-label={on ? "Pause music" : "Play music"}
        className={`grid place-items-center rounded-full bg-white text-black transition hover:bg-white/85 disabled:opacity-40 ${small ? "h-7 w-7" : "h-10 w-10"}`}
      >
        {on ? <Pause size={small ? 13 : 17} fill="currentColor" /> : <Play size={small ? 13 : 17} fill="currentColor" className="translate-x-px" />}
      </button>
      <button onClick={next} disabled={!tracks.length} title="Next" aria-label="Next track" className={side}>
        <SkipForward size={icon} fill="currentColor" />
      </button>
    </div>
  );
}

/** The Settings section: on/off, transport, order, volume, import and the track list. */
export function BackgroundMusicSettings() {
  const { enabled, on, tracks, playing, loaded, current, status, mode } = useMusic();
  const volume = useBgMusic((s) => s.volume);
  const defaultId = useBgMusic((s) => s.defaultId);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const { setEnabled, setMode, setVolume, setDefault, select, togglePlay, importTracks, remove } = useBgMusic.getState();
  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  // Files copied in through "Open music folder" show up on return to the window.
  useEffect(() => {
    const refresh = () => void useBgMusic.getState().refresh();
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  async function runImport() {
    setImporting(true);
    setMessage(null);
    try {
      const { added, skipped } = await importTracks();
      if (added || skipped) {
        const parts = [added ? `Added ${added} track${added === 1 ? "" : "s"}` : "No new tracks"];
        if (skipped) parts.push(`${skipped} skipped (already there, too large or unreadable)`);
        setMessage(parts.join(" · "));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-ink-2">
        Plays your own music while you browse. It pauses for episodes, theme songs and while AniTrack is minimized.
        Star a track to open AniTrack with it. Imported tracks stay on this computer.
      </p>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Switch on={enabled} onChange={setEnabled} label="Background music" disabled={!tracks.length && !enabled} />
        <span className="min-w-0 truncate text-sm text-ink-3">{status}</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Transport size="lg" />
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Playback order">
          {MODE_ORDER.map((id) => {
            const { label, icon: Icon } = MODES[id];
            return (
              <button
                key={id}
                role="radio"
                aria-checked={mode === id}
                onClick={() => setMode(id)}
                className={`chip ${mode === id ? "chip-active" : ""}`}
              >
                <Icon size={13} />
                {label}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2.5">
          <VolumeIcon size={16} className="text-ink-3" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            aria-label="Music volume"
            className="w-36 cursor-pointer accent-[rgb(var(--accent))]"
          />
          <span className="w-9 text-xs tabular-nums text-ink-3">{Math.round(volume * 100)}%</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={runImport} disabled={importing} className="btn btn-primary btn-sm">
          <Plus size={14} />
          {importing ? "Importing…" : "Import music…"}
        </button>
        <button onClick={() => void window.api.music?.openFolder()} className="btn btn-secondary btn-sm">
          <FolderOpen size={14} />
          Open music folder
        </button>
        {message && <span className="text-xs text-ink-3">{message}</span>}
      </div>

      {tracks.length > 0 ? (
        <ol className="max-h-[360px] overflow-y-auto rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
          {tracks.map((track) => {
            const isCurrent = track.id === current?.id;
            const isDefault = track.id === defaultId;
            return (
              <li
                key={track.id}
                className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 ${isCurrent ? "bg-accent/[0.12]" : "hover:bg-white/[0.04]"}`}
              >
                <button
                  onClick={() => (isCurrent ? togglePlay() : select(track.id))}
                  title={isCurrent && on ? "Pause" : "Play this track"}
                  className="flex min-w-0 flex-1 items-center gap-3 py-0.5 text-left"
                >
                  <span className={`grid w-7 shrink-0 place-items-center text-xs tabular-nums ${isCurrent ? "text-accent" : "text-ink-3"}`}>
                    {isCurrent && on && playing ? <AudioLines size={15} /> : track.number ?? <Music2 size={13} />}
                  </span>
                  <span className={`truncate text-[13.5px] ${isCurrent ? "font-semibold text-white" : "text-ink-2"}`}>{track.title}</span>
                  {track.bundled && <span className="shrink-0 text-[11px] text-ink-3">Built in</span>}
                </button>
                {confirming === track.id ? (
                  <>
                    <button
                      onClick={() => { setConfirming(null); void remove(track.id); }}
                      className="btn btn-danger btn-sm h-7"
                    >
                      Remove
                    </button>
                    <button onClick={() => setConfirming(null)} className="btn btn-ghost btn-sm h-7">Keep</button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setDefault(isDefault ? null : track.id)}
                      aria-pressed={isDefault}
                      title={isDefault ? "Default track: AniTrack opens with it. Click to unstar." : "Make this the default track (AniTrack opens with it)"}
                      className={`btn btn-ghost btn-icon h-7 w-7 rounded-md transition ${
                        isDefault ? "text-accent" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                      }`}
                    >
                      <Star size={14} fill={isDefault ? "currentColor" : "none"} />
                    </button>
                    {track.bundled ? (
                      <span className="h-7 w-7 shrink-0" aria-hidden />
                    ) : (
                      <button
                        onClick={() => setConfirming(track.id)}
                        title="Remove from AniTrack"
                        className="btn btn-ghost btn-icon h-7 w-7 rounded-md opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      ) : loaded ? (
        <div className="rounded-xl border border-dashed border-white/10 px-5 py-8 text-center text-sm text-ink-3">
          No tracks yet. Import MP3, M4A, OGG, FLAC or WAV files, or a .zip of them.
        </div>
      ) : null}
    </div>
  );
}

/** Press-and-hold on the music controls opens the mini panel, as right-click does. */
const HOLD_MS = 500;

/**
 * Right-click or a ~500 ms press calls [onHold]; the click that ends a hold is swallowed so a
 * plain click keeps its own meaning. A press that wanders off is no hold.
 */
function useHold(onHold: () => void) {
  const latest = useRef(onHold);
  latest.current = onHold;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swallow = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => clear, []);
  return {
    /** Swallows the next click (a press that only closed the panel). */
    swallowClick: () => { swallow.current = true; },
    handlers: {
      onPointerDown: (event: PointerEvent) => {
        if (event.button !== 0) return;
        clear();
        swallow.current = false;
        start.current = { x: event.clientX, y: event.clientY };
        timer.current = setTimeout(() => {
          timer.current = null;
          swallow.current = true;
          latest.current();
        }, HOLD_MS);
      },
      onPointerMove: (event: PointerEvent) => {
        const from = start.current;
        if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > 8) clear();
      },
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onClickCapture: (event: MouseEvent) => {
        // Only the controls' own click: the panel's clicks bubble here through its portal, and a
        // hold released over the panel leaves no click on the controls to swallow.
        if (!swallow.current || !event.currentTarget.contains(event.target as Node)) return;
        swallow.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
      onContextMenu: (event: MouseEvent) => {
        event.preventDefault();
        clear();
        latest.current();
      },
    },
  };
}

const PANEL_WIDTH = 320;

/**
 * The mini music panel: the track and its status, transport and order, the playlist and a
 * way to Settings, in a small dropdown under [anchor] over the current page. Closes on a
 * click outside or Escape.
 */
function MusicPanel({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const navigate = useNavigate();
  const { on, tracks, playing, current, status, mode } = useMusic();
  const { select, togglePlay, cycleMode } = useBgMusic.getState();
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 8));
      setPlace({ left, top: rect.bottom + 8, width: PANEL_WIDTH });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchor]);

  useEffect(() => {
    // The playing track in view when the panel opens.
    list.current?.querySelector<HTMLElement>("[data-current]")?.scrollIntoView({ block: "nearest" });
    const onDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    // Ahead of the readers' own Escape, which would leave the reader.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      event.preventDefault();
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, onClose]);

  const { label: modeLabel, icon: ModeIcon } = MODES[mode];
  return createPortal(
    // A portal still bubbles through the React tree: clicks here stop short of the page (the readers' tap zones).
    <div
      ref={panel}
      role="dialog"
      aria-label="Background music"
      style={place}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      className="titlebar-no-drag panel fixed z-[95] bg-surface-1/95 p-3 text-white backdrop-blur-xl"
    >
      <div className="min-w-0 px-1">
        <div className="truncate text-sm font-semibold">{current?.title ?? "Background music"}</div>
        <div className="truncate text-xs text-ink-3">{status}</div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <Transport size="sm" />
        <button onClick={cycleMode} title={`${modeLabel}. Click to change.`} aria-label={`Playback order: ${modeLabel}`} className="chip">
          <ModeIcon size={13} />
          {modeLabel}
        </button>
      </div>
      {/* About six rows, then it scrolls. */}
      <ol ref={list} className="mt-2.5 max-h-[226px] overflow-y-auto rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
        {tracks.map((track) => {
          const isCurrent = track.id === current?.id;
          return (
            <li key={track.id} data-current={isCurrent ? "" : undefined}>
              <button
                onClick={() => (isCurrent ? !on && togglePlay() : select(track.id))}
                title={isCurrent && on ? "Playing now" : "Play this track"}
                aria-current={isCurrent ? "true" : undefined}
                className={`flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left transition ${
                  isCurrent ? "bg-accent/[0.12]" : "hover:bg-white/[0.05]"
                }`}
              >
                <span className={`grid w-6 shrink-0 place-items-center text-xs tabular-nums ${isCurrent ? "text-accent" : "text-ink-3"}`}>
                  {isCurrent && on && playing ? <AudioLines size={14} /> : track.number ?? <Music2 size={12} />}
                </span>
                <span className={`truncate text-[13px] ${isCurrent ? "font-semibold text-white" : "text-ink-2"}`}>{track.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <button onClick={() => { onClose(); navigate("/settings#music"); }} className="btn btn-ghost btn-sm mt-2 w-full justify-start">
        <Settings2 size={14} />
        Music settings
      </button>
    </div>,
    document.body,
  );
}

/**
 * The top bar's music controls: on/off, then Previous, Play/Pause, Next, Repeat and the track
 * while it is on. Right-click or press and hold opens the mini music panel.
 */
export function BackgroundMusicButton() {
  const navigate = useNavigate();
  const { enabled, on, tracks, playing, loaded, current, status, mode } = useMusic();
  const { toggle, cycleMode } = useBgMusic.getState();
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const openSettings = () => navigate("/settings#music");
  // With no tracks there is no playlist to show: holding goes to Settings, like a click.
  const hold = useHold(() => (useBgMusic.getState().tracks.length ? setOpen(true) : openSettings()));
  if (!window.api.music || !loaded) return null;

  if (!tracks.length) {
    return (
      <div {...hold.handlers}>
        <button onClick={openSettings} title="Background music: import tracks in Settings" className="btn btn-ghost btn-icon h-9 w-9 rounded-full">
          <Music2 size={17} />
        </button>
      </div>
    );
  }

  const { label: modeLabel, icon: ModeIcon } = MODES[mode];
  return (
    <div
      ref={anchor}
      {...hold.handlers}
      onPointerDown={(event) => {
        // A press on the controls while the panel is open only closes it.
        if (open && event.button === 0) { setOpen(false); hold.swallowClick(); return; }
        hold.handlers.onPointerDown(event);
      }}
      className={`flex h-10 items-center gap-0.5 rounded-full border px-1 transition-colors ${
        enabled ? "border-accent/30 bg-accent/[0.1]" : "border-white/[0.07] bg-white/[0.04]"
      }`}
    >
      <button
        onClick={toggle}
        aria-pressed={enabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={enabled ? `Background music: ${status}. Click to turn it off; right-click or hold for the playlist.` : "Turn background music on (right-click or hold for the playlist)"}
        className="grid h-8 w-8 place-items-center rounded-full transition hover:bg-white/[0.08]"
      >
        {on && playing ? (
          <AudioLines size={16} className="text-accent" />
        ) : (
          <Music2 size={16} className={enabled ? "text-accent" : "text-ink-3"} />
        )}
      </button>
      {enabled && current && (
        <>
          <Transport size="sm" />
          <button
            onClick={cycleMode}
            title={`${modeLabel}. Click to change.`}
            aria-label={`Playback order: ${modeLabel}`}
            className="grid h-8 w-8 place-items-center rounded-full text-ink-2 transition hover:bg-white/[0.08] hover:text-white"
          >
            <ModeIcon size={14} />
          </button>
          <button
            onClick={openSettings}
            title={status}
            className="hidden max-w-[160px] truncate pl-1 pr-2 text-xs font-medium text-ink-2 transition hover:text-white xl:block"
          >
            {current.title}
          </button>
        </>
      )}
      {open && anchor.current && <MusicPanel anchor={anchor.current} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** A song from Songs or a title page, as Add to music takes it. */
export interface MusicSong {
  title: string;
  artists: string[];
  anime: string;
  /** "OP1", "ED2"; "" when it has none. */
  slug: string;
  audioUrl: string | null;
}

export type AddToMusicState = "idle" | "saving" | "failed" | "done";

/**
 * Add to music for one song: null when it can't be added (no AnimeThemes or AnisongDB audio,
 * or no music folder in this build); "done" once a track of its file name is in the music.
 */
export function useAddToMusic(song: MusicSong) {
  const name = isMusicDownloadUrl(song.audioUrl)
    ? themeTrackFileName(song.title, song.artists, song.anime, song.slug, song.audioUrl)
    : null;
  const have = useBgMusic((s) => name != null && s.tracks.some((t) => t.id === name && !t.bundled));
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  useEffect(() => {
    if (state !== "failed") return;
    const timer = setTimeout(() => setState("idle"), 3500);
    return () => clearTimeout(timer);
  }, [state]);
  if (!window.api.music || !name || !song.audioUrl) return null;
  const url = song.audioUrl;
  const shown: AddToMusicState = have ? "done" : state;
  return {
    state: shown,
    label: shown === "done" ? "In your music" : shown === "saving" ? "Adding…" : shown === "failed" ? "Couldn't add this song" : "Add to music",
    add: async () => {
      if (shown === "done" || shown === "saving") return;
      setState("saving");
      try {
        await useBgMusic.getState().addSong(url, name);
        setState("idle");
      } catch {
        setState("failed");
      }
    },
  };
}

/** The Add to music icon: a spinner while saving, a check once it is in the music. */
export function AddToMusicIcon({ state, size }: { state: AddToMusicState; size: number }) {
  if (state === "saving") {
    return <span className="pixel-round inline-block animate-spin rounded-full border-2 border-current border-t-transparent" style={{ width: size, height: size }} />;
  }
  return state === "done" ? <Check size={size} /> : <ListPlus size={size} />;
}

/**
 * A round Add to music button for song rows and players; a failure shows its short message
 * above it for a moment (over the page, so a clipped player bar can't hide it), then the
 * button returns.
 */
export function AddToMusicButton({ song, className = "" }: { song: MusicSong; className?: string }) {
  const add = useAddToMusic(song);
  const button = useRef<HTMLButtonElement>(null);
  if (!add) return null;
  const rect = add.state === "failed" ? button.current?.getBoundingClientRect() : undefined;
  return (
    <>
      <button
        ref={button}
        onClick={(event) => { event.stopPropagation(); void add.add(); }}
        disabled={add.state === "done" || add.state === "saving"}
        title={add.state === "done" ? "In your music: it plays as background music" : add.label}
        aria-label={add.label}
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition disabled:cursor-default ${
          add.state === "done" ? "text-accent" : add.state === "failed" ? "text-red-300" : "text-white/50 hover:bg-white/10 hover:text-white"
        } ${className}`}
      >
        <AddToMusicIcon state={add.state} size={15} />
      </button>
      {rect && createPortal(
        <span
          role="status"
          className="pointer-events-none fixed z-[96] whitespace-nowrap rounded-md bg-black/85 px-2 py-1 text-[11px] font-semibold text-red-200 shadow-lg"
          style={{ top: Math.max(4, rect.top - 30), right: Math.max(4, window.innerWidth - rect.right) }}
        >
          {add.label}
        </span>,
        document.body,
      )}
    </>
  );
}
