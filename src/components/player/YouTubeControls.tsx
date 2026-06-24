import { useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Volume1,
  VolumeX,
  Settings,
  Captions,
  Maximize,
  Minimize,
  PictureInPicture2,
  RectangleHorizontal,
} from "lucide-react";
import { secondsToTimestamp } from "../../lib/format";
import { SettingsMenuContent } from "./PlayerSettingsMenu";

export interface YouTubeControlsProps {
  showControls: boolean;
  progressPct: number;
  bufferedPct: number;
  position: number;
  duration: number;
  playing: boolean;
  muted: boolean;
  volume: number;
  autoPlay: boolean;
  autoNext: boolean;
  currentEp: any;
  links: any[];
  selectedLink: number;
  isFullscreen: boolean;
  isTheater: boolean;
  isPiP: boolean;
  playbackRate: number;
  providerId?: string;

  hlsLevels?: any[];
  currentHlsLevel?: number;
  subtitlesEnabled?: boolean;
  availableSubtitles?: any[];

  onSeekToPct: (pct: number) => void;
  onSeekStart: () => void;
  onSeekEnd: (time: number) => void;
  onPositionChange: (time: number) => void;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onVolumeChange: (vol: number) => void;
  onPlayPrev: () => void;
  onPlayNext: () => void;
  onToggleFullscreen: () => void;
  onToggleTheater: () => void;
  onTogglePiP: () => void;
  onChangeQuality: (idx: number) => void;
  onChangeHlsLevel?: (idx: number) => void;
  onToggleSubtitles?: () => void;
  onToggleAutoPlay: () => void;
  onToggleAutoNext: () => void;
  onChangePlaybackRate: (rate: number) => void;

  cueFontSize?: string;
  setCueFontSize?: (size: string) => void;
  cueFontFamily?: string;
  setCueFontFamily?: (font: string) => void;
  cueBgOpacity?: number;
  setCueBgOpacity?: (op: number) => void;
  cueColor?: string;
  setCueColor?: (color: string) => void;
}

export function YouTubeControls(props: YouTubeControlsProps) {
  const {
    showControls, progressPct, bufferedPct, position, duration, playing, muted, volume,
    autoPlay, autoNext, currentEp, links, selectedLink, isFullscreen, isTheater, isPiP, playbackRate,
    providerId = "", hlsLevels = [], currentHlsLevel = -1, subtitlesEnabled = true, availableSubtitles = [],
    onSeekToPct, onSeekStart, onSeekEnd, onPositionChange, onTogglePlay, onToggleMute, onVolumeChange,
    onPlayPrev, onPlayNext, onToggleFullscreen, onToggleTheater, onTogglePiP,
    onChangeQuality, onChangeHlsLevel, onToggleSubtitles, onToggleAutoPlay, onToggleAutoNext, onChangePlaybackRate,
    cueFontSize, setCueFontSize, cueFontFamily, setCueFontFamily,
    cueBgOpacity, setCueBgOpacity, cueColor, setCueColor,
  } = props;

  const barRef = useRef<HTMLDivElement>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  function barPct(clientX: number) {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-30 transition-opacity duration-300 ${
        showControls ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      {/* gradient scrim */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

      {/* click-catcher so the menu closes when clicking elsewhere */}
      {menuOpen && <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />}

      <div className="pointer-events-auto relative px-3 pb-1.5" onClick={(e) => e.stopPropagation()}>
        {/* ── Progress bar ───────────────────────────────────────── */}
        <div
          ref={barRef}
          className="group/bar relative mb-1 flex h-4 cursor-pointer items-center"
          onMouseMove={(e) => setHoverPct(barPct(e.clientX))}
          onMouseLeave={() => setHoverPct(null)}
          onClick={(e) => onSeekToPct(barPct(e.clientX))}
        >
          <div className="relative h-[3px] w-full rounded-full bg-white/25 transition-all group-hover/bar:h-[5px]">
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/40" style={{ width: `${bufferedPct}%` }} />
            {hoverPct != null && (
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${hoverPct * 100}%` }} />
            )}
            <div className="absolute inset-y-0 left-0 rounded-full bg-[#e50914]" style={{ width: `${progressPct}%` }} />
            <div
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#e50914] opacity-0 shadow transition-opacity group-hover/bar:opacity-100"
              style={{ left: `${progressPct}%` }}
            />
          </div>

          {hoverPct != null && duration > 0 && (
            <div
              className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-black/85 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white"
              style={{ left: `${hoverPct * 100}%` }}
            >
              {secondsToTimestamp(hoverPct * duration)}
            </div>
          )}

          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.5}
            value={position}
            disabled={!currentEp || !duration}
            onMouseDown={onSeekStart}
            onMouseUp={(e) => onSeekEnd(Number((e.target as HTMLInputElement).value))}
            onTouchStart={onSeekStart}
            onTouchEnd={(e) => onSeekEnd(Number((e.target as HTMLInputElement).value))}
            onChange={(e) => onPositionChange(Number(e.target.value))}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>

        {/* ── Control row ────────────────────────────────────────── */}
        <div className="flex items-center gap-0.5 text-white">
          <button onClick={onPlayPrev} disabled={!currentEp} className="ctl" title="Previous episode (P)">
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button onClick={onTogglePlay} disabled={!currentEp} className="ctl" title="Play / Pause (k)">
            {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
          </button>
          <button onClick={onPlayNext} disabled={!currentEp} className="ctl" title="Next episode (N)">
            <SkipForward size={18} fill="currentColor" />
          </button>

          {/* Volume */}
          <div className="group/vol ml-0.5 flex items-center">
            <button onClick={onToggleMute} className="ctl" title="Mute (m)">
              <VolumeIcon size={18} />
            </button>
            <div className="w-0 overflow-hidden transition-all duration-200 group-hover/vol:w-[72px]">
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={muted ? 0 : volume}
                onChange={(e) => onVolumeChange(Number(e.target.value))}
                className="ml-1 w-[68px] cursor-pointer accent-white"
              />
            </div>
          </div>

          {/* Time */}
          <span className="ml-2 text-[13px] font-medium tabular-nums text-white/90">
            {secondsToTimestamp(position)} <span className="text-white/50">/</span> {secondsToTimestamp(duration)}
          </span>

          <div className="flex-1" />

          {/* Subtitles quick toggle */}
          {availableSubtitles.length > 0 && (
            <button onClick={onToggleSubtitles} className={`ctl ${subtitlesEnabled ? "text-[#e50914]" : ""}`} title="Subtitles (c)">
              <Captions size={18} />
            </button>
          )}

          {/* Settings gear */}
          <div className="relative">
            <button onClick={() => setMenuOpen((o) => !o)} className="ctl" title="Settings">
              <Settings size={18} className={`transition-transform duration-300 ${menuOpen ? "rotate-45" : ""}`} />
            </button>
            {menuOpen && (
              <div className="absolute bottom-12 right-0 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
                <SettingsMenuContent
                  links={links}
                  selectedLink={selectedLink}
                  providerId={providerId}
                  hlsLevels={hlsLevels}
                  currentHlsLevel={currentHlsLevel}
                  playbackRate={playbackRate}
                  autoPlay={autoPlay}
                  autoNext={autoNext}
                  subtitlesEnabled={subtitlesEnabled}
                  availableSubtitles={availableSubtitles}
                  onChangePlaybackRate={onChangePlaybackRate}
                  onChangeQuality={onChangeQuality}
                  onChangeHlsLevel={onChangeHlsLevel}
                  onToggleAutoPlay={onToggleAutoPlay}
                  onToggleAutoNext={onToggleAutoNext}
                  onToggleSubtitles={onToggleSubtitles}
                  cueFontSize={cueFontSize}
                  setCueFontSize={setCueFontSize}
                  cueFontFamily={cueFontFamily}
                  setCueFontFamily={setCueFontFamily}
                  cueBgOpacity={cueBgOpacity}
                  setCueBgOpacity={setCueBgOpacity}
                  cueColor={cueColor}
                  setCueColor={setCueColor}
                />
              </div>
            )}
          </div>

          {/* PiP */}
          <button onClick={onTogglePiP} className={`ctl ${isPiP ? "text-[#e50914]" : ""}`} title="Picture-in-picture (i)">
            <PictureInPicture2 size={18} />
          </button>

          {/* Theater (hidden in fullscreen) */}
          {!isFullscreen && (
            <button onClick={onToggleTheater} className={`ctl ${isTheater ? "text-white" : "text-white/90"}`} title="Theater mode (t)">
              <RectangleHorizontal size={18} fill={isTheater ? "currentColor" : "none"} />
            </button>
          )}

          {/* Fullscreen */}
          <button onClick={onToggleFullscreen} className="ctl" title="Fullscreen (f)">
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>

      {/* local styles for control buttons */}
      <style>{`
        .ctl{display:flex;height:38px;width:38px;align-items:center;justify-content:center;border-radius:9999px;color:#fff;transition:all .15s}
        .ctl:hover{background:rgba(255,255,255,.15)}
        .ctl:disabled{opacity:.3}
      `}</style>
    </div>
  );
}
