import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AudioLines,
  FolderOpen,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
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
import type { BgMusicMode, BgTrack } from "../../../../packages/shared/bg-music";
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
                    <button
                      onClick={() => setConfirming(track.id)}
                      title="Remove from AniTrack"
                      className="btn btn-ghost btn-icon h-7 w-7 rounded-md opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                    >
                      <Trash2 size={14} />
                    </button>
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

/** The top bar's music controls: on/off, then Previous, Play/Pause, Next, Repeat and the track while it is on. */
export function BackgroundMusicButton() {
  const navigate = useNavigate();
  const { enabled, on, tracks, playing, loaded, current, status, mode } = useMusic();
  const { toggle, cycleMode } = useBgMusic.getState();
  if (!window.api.music || !loaded) return null;
  const openSettings = () => navigate("/settings#music");

  if (!tracks.length) {
    return (
      <button onClick={openSettings} title="Background music: import tracks in Settings" className="btn btn-ghost btn-icon h-9 w-9 rounded-full">
        <Music2 size={17} />
      </button>
    );
  }

  const { label: modeLabel, icon: ModeIcon } = MODES[mode];
  return (
    <div
      className={`flex h-10 items-center gap-0.5 rounded-full border px-1 transition-colors ${
        enabled ? "border-accent/30 bg-accent/[0.1]" : "border-white/[0.07] bg-white/[0.04]"
      }`}
    >
      <button
        onClick={toggle}
        aria-pressed={enabled}
        title={enabled ? `Background music: ${status}. Click to turn it off.` : "Turn background music on"}
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
    </div>
  );
}
