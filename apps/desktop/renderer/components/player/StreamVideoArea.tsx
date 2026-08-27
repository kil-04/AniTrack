import type { MouseEventHandler, ReactNode, RefObject } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import type { SkipTimes } from "../../lib/skip-times";
import { SkipOverlay } from "./SkipOverlay";
import { GestureFeedback } from "./useVideoGestures";

interface UpNextState {
  episode: number;
  count: number;
}

interface StreamVideoAreaProps {
  fullHeight?: boolean;
  wrapRef: RefObject<HTMLDivElement>;
  videoRef: RefObject<HTMLVideoElement>;
  mobile: boolean;
  capacitor: boolean;
  minimized: boolean;
  showControls: boolean;
  mouseNearTop: boolean;
  onMouseMove: MouseEventHandler<HTMLDivElement>;
  onMouseLeave: MouseEventHandler<HTMLDivElement>;
  onSurfaceClick: MouseEventHandler<HTMLDivElement>;
  cueBackgroundOpacity: number;
  cueColor: string;
  cueFontFamily: string;
  cueFontSize: string;
  fitMode: "contain" | "cover";
  touchHandlers: any;
  gestureFeedback: any;
  currentEpisode: any | null;
  loadingStream: boolean;
  fallbackNotice: string | null;
  buffering: boolean;
  streamError: string | null;
  playing: boolean;
  fullscreen: boolean;
  onTogglePlay: () => void;
  onRetry: () => void;
  alternativeProviderLabel?: string;
  onTryAlternative?: () => void;
  onExitFullscreen: () => void;
  duration: number;
  skipTimes: SkipTimes;
  controls: ReactNode;
  upNext: UpNextState | null;
  onPlayUpNext: () => void;
  onCancelUpNext: () => void;
}

export function StreamVideoArea({
  fullHeight = false,
  wrapRef,
  videoRef,
  mobile,
  capacitor,
  minimized,
  showControls,
  mouseNearTop,
  onMouseMove,
  onMouseLeave,
  onSurfaceClick,
  cueBackgroundOpacity,
  cueColor,
  cueFontFamily,
  cueFontSize,
  fitMode,
  touchHandlers,
  gestureFeedback,
  currentEpisode,
  loadingStream,
  fallbackNotice,
  buffering,
  streamError,
  playing,
  fullscreen,
  onTogglePlay,
  onRetry,
  alternativeProviderLabel,
  onTryAlternative,
  onExitFullscreen,
  duration,
  skipTimes,
  controls,
  upNext,
  onPlayUpNext,
  onCancelUpNext,
}: StreamVideoAreaProps) {
  return (
    <div
      ref={wrapRef}
      className={`relative flex ${fullHeight ? "flex-1" : ""} flex-col overflow-hidden bg-black`}
      style={{ cursor: mobile ? "default" : (showControls ? "default" : "none") }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={onSurfaceClick}
    >
      <style>{`
        video::cue {
          background-color: rgba(11, 11, 15, ${cueBackgroundOpacity}) !important;
          color: ${cueColor} !important;
          font-family: ${cueFontFamily} !important;
          font-size: ${cueFontSize} !important;
        }
      `}</style>
      <video
        ref={videoRef}
        className={`h-full w-full ${fitMode === "cover" ? "object-cover" : "object-contain"}`}
        playsInline
        crossOrigin="anonymous"
      />
      {capacitor && !minimized && (
        <div
          className="absolute inset-0"
          style={{ touchAction: "none" }}
          onClick={(event) => event.stopPropagation()}
          onTouchStart={touchHandlers.onTouchStart}
          onTouchMove={touchHandlers.onTouchMove}
          onTouchEnd={touchHandlers.onTouchEnd}
          onTouchCancel={touchHandlers.onTouchCancel}
        />
      )}
      <GestureFeedback fb={gestureFeedback} />
      {capacitor && !minimized && currentEpisode && !loadingStream && (
        <button
          onClick={(event) => { event.stopPropagation(); onTogglePlay(); }}
          className={`absolute left-1/2 top-1/2 z-30 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition-all duration-300 ${showControls ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0"}`}
          title="Play / Pause"
        >
          {playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" className="ml-0.5" />}
        </button>
      )}
      {!currentEpisode && !loadingStream && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-white/30">Select an episode to start watching</p>
        </div>
      )}
      {loadingStream && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/40">
          <Loader2 size={36} className="animate-spin" />
          <span className="text-sm">{fallbackNotice ?? "Resolving stream…"}</span>
        </div>
      )}
      {buffering && !loadingStream && !streamError && currentEpisode && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 size={44} className="animate-spin text-white/70 drop-shadow-lg" />
        </div>
      )}
      {streamError && !loadingStream && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg bg-red-500/10 p-5 text-center">
            <div className="text-sm text-red-400">{streamError}</div>
            <div className="flex gap-2">
              <button onClick={onRetry} className="rounded bg-white/10 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20">
                Retry
              </button>
              {alternativeProviderLabel && onTryAlternative && (
                <button onClick={onTryAlternative} className="rounded bg-[#e50914] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#f6121d]">
                  Try {alternativeProviderLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {fullscreen && (
        <div className={`absolute left-1/2 top-4 z-30 -translate-x-1/2 transition-opacity duration-300 ${(mobile || mouseNearTop) ? "opacity-100" : "pointer-events-none opacity-0"}`}>
          <button onClick={(event) => { event.stopPropagation(); onExitFullscreen(); }} className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition hover:bg-black/80" title="Exit fullscreen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="h-4 w-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
      <SkipOverlay
        duration={duration}
        videoRef={videoRef}
        skipTimes={skipTimes}
        showControls={showControls}
        onSkip={(endTime) => { if (videoRef.current) videoRef.current.currentTime = endTime; }}
      />
      {controls}
      {upNext && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70">
          <div className={`flex flex-col items-center text-center ${minimized ? "gap-1" : "gap-3"}`}>
            <div className={`uppercase tracking-widest text-white/50 ${minimized ? "text-[9px]" : "text-xs"}`}>Up next</div>
            <div className={`font-bold ${minimized ? "text-sm" : "text-xl"}`}>Episode {upNext.episode}</div>
            <button onClick={(event) => { event.stopPropagation(); onPlayUpNext(); }} className={`relative flex items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 ${minimized ? "h-10 w-10" : "h-16 w-16"}`} title="Play now">
              <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full -rotate-90">
                <circle cx="32" cy="32" r="29" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
                <circle cx="32" cy="32" r="29" fill="none" stroke="#e50914" strokeWidth="3" strokeLinecap="round" strokeDasharray={2 * Math.PI * 29} strokeDashoffset={2 * Math.PI * 29 * (1 - upNext.count / 5)} style={{ transition: "stroke-dashoffset 1s linear" }} />
              </svg>
              <Play size={minimized ? 16 : 26} fill="currentColor" className="ml-0.5" />
            </button>
            {!minimized && (
              <button onClick={(event) => { event.stopPropagation(); onCancelUpNext(); }} className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/20">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
