import { useRef, useState } from "react";
import { Rewind, FastForward, Volume2, VolumeX, Volume1, Gauge, Maximize, Minimize } from "lucide-react";
import { secondsToTimestamp } from "../../lib/format";

// YouTube-style touch gestures for the video player (Android / tablet).
// - single tap        → toggle controls
// - double-tap L / R  → seek -10s / +10s (taps stack: 20s, 30s…)
// - double-tap center → play / pause
// - long-press        → 2× speed while held
// - vertical drag     → volume (brightness intentionally omitted)
// - horizontal drag   → scrub with a time bubble
// - pinch             → fill / fit (object-cover / object-contain)

export type GestureFeedback =
  | null
  | { kind: "seek"; side: "left" | "right"; seconds: number }
  | { kind: "volume"; value: number }
  | { kind: "scrub"; time: number; duration: number; delta: number }
  | { kind: "speed"; rate: number }
  | { kind: "zoom"; mode: "contain" | "cover" };

interface GestureOpts {
  enabled: boolean;
  videoRef: { current: HTMLVideoElement | null };
  wrapRef: { current: HTMLElement | null };
  onToggleControls: () => void;
  onShowControls: () => void;
  setUiVolume: (v: number) => void;
  setUiPosition: (t: number) => void;
}

const MOVE_THRESHOLD = 12; // px before a touch counts as a drag
const TAP_MAX_MS = 250; // longer press is not a tap
const DOUBLE_TAP_MS = 300; // window to chain taps
const LONG_PRESS_MS = 450; // hold to engage 2×
const SEEK_STEP = 10; // seconds per double-tap

function dist(a: React.Touch, b: React.Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function useVideoGestures(opts: GestureOpts) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [feedback, setFeedback] = useState<GestureFeedback>(null);
  const [fitMode, setFitMode] = useState<"contain" | "cover">("contain");
  const fitModeRef = useRef(fitMode);
  fitModeRef.current = fitMode;

  const fbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (fb: GestureFeedback, ms = 700) => {
    if (fbTimer.current) clearTimeout(fbTimer.current);
    setFeedback(fb);
    if (ms > 0) fbTimer.current = setTimeout(() => setFeedback(null), ms);
  };

  const s = useRef({
    startX: 0,
    startY: 0,
    startT: 0,
    startCurrentTime: 0,
    startVolume: 1,
    moved: false,
    axis: "" as "" | "x" | "y",
    ignore: false,
    pinching: false,
    pinchDist: 0,
    longPressTimer: null as ReturnType<typeof setTimeout> | null,
    longPressing: false,
    prevRate: 1,
    lastTapT: 0,
    singleTapTimer: null as ReturnType<typeof setTimeout> | null,
    seekChainSide: "" as "" | "left" | "right",
    seekChainSec: 0,
    seekChainTimer: null as ReturnType<typeof setTimeout> | null,
    scrubTime: 0,
  }).current;

  const cancelLongPress = () => {
    if (s.longPressTimer) {
      clearTimeout(s.longPressTimer);
      s.longPressTimer = null;
    }
  };

  function onTouchStart(e: React.TouchEvent) {
    const o = optsRef.current;
    if (!o.enabled) return;
    const target = e.target as HTMLElement;
    if (target.closest("button,input,select,a,[data-no-gesture]")) {
      s.ignore = true;
      return;
    }
    s.ignore = false;

    if (e.touches.length === 2) {
      s.pinching = true;
      s.pinchDist = dist(e.touches[0], e.touches[1]);
      cancelLongPress();
      return;
    }

    const t = e.touches[0];
    const v = o.videoRef.current;
    s.startX = t.clientX;
    s.startY = t.clientY;
    s.startT = Date.now();
    s.startCurrentTime = v?.currentTime ?? 0;
    s.startVolume = v?.volume ?? 1;
    s.moved = false;
    s.axis = "";
    s.pinching = false;

    cancelLongPress();
    s.longPressTimer = setTimeout(() => {
      if (s.moved || s.ignore) return;
      const vid = optsRef.current.videoRef.current;
      if (!vid) return;
      s.longPressing = true;
      s.prevRate = vid.playbackRate || 1;
      vid.playbackRate = 2;
      if (vid.paused) vid.play().catch(() => {});
      flash({ kind: "speed", rate: 2 }, 0);
    }, LONG_PRESS_MS);
  }

  function onTouchMove(e: React.TouchEvent) {
    const o = optsRef.current;
    if (!o.enabled || s.ignore) return;
    const v = o.videoRef.current;
    const wrap = o.wrapRef.current;

    if (s.pinching && e.touches.length === 2) {
      const d = dist(e.touches[0], e.touches[1]);
      if (s.pinchDist > 0) {
        const ratio = d / s.pinchDist;
        if (ratio > 1.15 && fitModeRef.current !== "cover") {
          setFitMode("cover");
          flash({ kind: "zoom", mode: "cover" }, 900);
        } else if (ratio < 0.87 && fitModeRef.current !== "contain") {
          setFitMode("contain");
          flash({ kind: "zoom", mode: "contain" }, 900);
        }
      }
      return;
    }

    if (s.longPressing || e.touches.length !== 1) return;

    const t = e.touches[0];
    const dx = t.clientX - s.startX;
    const dy = t.clientY - s.startY;

    if (!s.moved) {
      if (Math.hypot(dx, dy) < MOVE_THRESHOLD) return;
      s.moved = true;
      cancelLongPress();
      s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }

    if (!v || !wrap) return;
    const rect = wrap.getBoundingClientRect();

    if (s.axis === "x") {
      const dur = v.duration && isFinite(v.duration) ? v.duration : 0;
      if (!dur) return;
      const deltaSec = (dx / rect.width) * dur;
      const nt = Math.max(0, Math.min(dur, s.startCurrentTime + deltaSec));
      s.scrubTime = nt;
      setFeedback({ kind: "scrub", time: nt, duration: dur, delta: nt - s.startCurrentTime });
    } else {
      const dvol = -(dy / rect.height) * 1.4;
      const nv = Math.max(0, Math.min(1, s.startVolume + dvol));
      o.setUiVolume(nv);
      setFeedback({ kind: "volume", value: nv });
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    const o = optsRef.current;
    if (!o.enabled) return;
    cancelLongPress();

    if (s.ignore) {
      s.ignore = false;
      return;
    }

    const v = o.videoRef.current;

    if (s.longPressing) {
      s.longPressing = false;
      if (v) v.playbackRate = s.prevRate || 1;
      setFeedback(null);
      e.preventDefault();
      return;
    }

    if (s.pinching) {
      // A finger lifted after a pinch: ignore the remaining finger until all are up,
      // so a leftover single touch doesn't start an accidental scrub/volume drag.
      if (e.touches.length === 0) { s.pinching = false; s.ignore = false; }
      else s.ignore = true;
      e.preventDefault();
      return;
    }

    if (s.moved) {
      if (s.axis === "x" && v) {
        v.currentTime = s.scrubTime;
        o.setUiPosition(s.scrubTime);
        o.onShowControls();
        if (fbTimer.current) clearTimeout(fbTimer.current);
        setFeedback(null);
      } else {
        if (fbTimer.current) clearTimeout(fbTimer.current);
        fbTimer.current = setTimeout(() => setFeedback(null), 500);
      }
      s.moved = false;
      s.axis = "";
      e.preventDefault();
      return;
    }

    // No movement → a tap. Ignore over-long holds.
    if (Date.now() - s.startT > TAP_MAX_MS) return;
    const wrap = o.wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const frac = (s.startX - rect.left) / rect.width;
    const side: "left" | "right" | "center" = frac < 0.35 ? "left" : frac > 0.65 ? "right" : "center";
    const now = Date.now();
    const isDouble = now - s.lastTapT < DOUBLE_TAP_MS;

    if (isDouble) {
      if (s.singleTapTimer) {
        clearTimeout(s.singleTapTimer);
        s.singleTapTimer = null;
      }
      if (side === "center") {
        if (v) v.paused ? v.play().catch(() => {}) : v.pause();
        o.onShowControls();
        s.lastTapT = 0;
        s.seekChainSide = "";
        s.seekChainSec = 0;
      } else {
        const step = side === "left" ? -SEEK_STEP : SEEK_STEP;
        if (s.seekChainSide === side) s.seekChainSec += SEEK_STEP;
        else {
          s.seekChainSide = side;
          s.seekChainSec = SEEK_STEP;
        }
        if (v && v.duration) {
          v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + step));
          o.setUiPosition(v.currentTime);
        }
        flash({ kind: "seek", side, seconds: s.seekChainSec }, 600);
        s.lastTapT = now;
        if (s.seekChainTimer) clearTimeout(s.seekChainTimer);
        s.seekChainTimer = setTimeout(() => {
          s.seekChainSide = "";
          s.seekChainSec = 0;
        }, 700);
      }
      e.preventDefault();
    } else {
      s.lastTapT = now;
      if (s.singleTapTimer) clearTimeout(s.singleTapTimer);
      s.singleTapTimer = setTimeout(() => {
        s.singleTapTimer = null;
        o.onToggleControls();
      }, DOUBLE_TAP_MS);
      e.preventDefault();
    }
  }

  // The system can cancel a touch (incoming call, notification, edge gesture)
  // without firing touchend — restore any transient state so we don't get stuck
  // at 2× speed with a frozen overlay.
  function onTouchCancel() {
    cancelLongPress();
    const v = optsRef.current.videoRef.current;
    if (s.longPressing && v) v.playbackRate = s.prevRate || 1;
    s.longPressing = false;
    s.moved = false;
    s.axis = "";
    s.pinching = false;
    s.ignore = false;
    setFeedback(null);
  }

  return {
    touchHandlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
    feedback,
    fitMode,
    setFitMode,
  };
}

export function GestureFeedback({ fb }: { fb: GestureFeedback }) {
  if (!fb) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[25] select-none overflow-hidden">
      {fb.kind === "seek" && (
        <div
          className={`absolute inset-y-0 flex w-2/5 items-center justify-center ${
            fb.side === "left" ? "left-0" : "right-0"
          }`}
        >
          <div className="flex flex-col items-center gap-1.5 rounded-3xl bg-black/60 px-7 py-5 text-white animate-in fade-in zoom-in-90 duration-150">
            {fb.side === "left" ? <Rewind size={30} fill="currentColor" /> : <FastForward size={30} fill="currentColor" />}
            <span className="text-sm font-semibold tabular-nums">{fb.seconds}s</span>
          </div>
        </div>
      )}

      {fb.kind === "volume" && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="flex items-center gap-3 rounded-2xl bg-black/60 px-5 py-3 text-white animate-in fade-in duration-100">
            {fb.value === 0 ? <VolumeX size={20} /> : fb.value < 0.5 ? <Volume1 size={20} /> : <Volume2 size={20} />}
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-[#e50914]" style={{ width: `${Math.round(fb.value * 100)}%` }} />
            </div>
            <span className="w-9 text-right text-xs font-semibold tabular-nums">{Math.round(fb.value * 100)}%</span>
          </div>
        </div>
      )}

      {fb.kind === "scrub" && (
        <div className="absolute left-1/2 top-[18%] -translate-x-1/2">
          <div className="flex flex-col items-center gap-1 rounded-2xl bg-black/55 px-5 py-3 text-white animate-in fade-in duration-100">
            <div className="text-base font-semibold tabular-nums">
              {secondsToTimestamp(fb.time)} <span className="text-white/40">/</span>{" "}
              <span className="text-white/60">{secondsToTimestamp(fb.duration)}</span>
            </div>
            <div className={`text-xs font-medium tabular-nums ${fb.delta < 0 ? "text-[#5eb0ff]" : "text-[#e50914]"}`}>
              {fb.delta >= 0 ? "+" : "−"}
              {secondsToTimestamp(Math.abs(fb.delta))}
            </div>
          </div>
        </div>
      )}

      {fb.kind === "speed" && (
        <div className="absolute left-1/2 top-[12%] -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-white animate-in fade-in slide-in-from-top-2 duration-150">
            <Gauge size={16} />
            <span className="text-sm font-bold tabular-nums">{fb.rate}×</span>
            <FastForward size={14} fill="currentColor" />
          </div>
        </div>
      )}

      {fb.kind === "zoom" && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="flex items-center gap-2 rounded-2xl bg-black/60 px-5 py-3 text-white animate-in fade-in zoom-in-95 duration-150">
            {fb.mode === "cover" ? <Maximize size={18} /> : <Minimize size={18} />}
            <span className="text-sm font-semibold">{fb.mode === "cover" ? "Fill" : "Fit"}</span>
          </div>
        </div>
      )}
    </div>
  );
}
