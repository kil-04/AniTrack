import { useEffect, useRef, useState } from "react";
import { secondsToTimestamp } from "../../lib/format";

/**
 * Self-contained seek bar. It mirrors the <video>'s currentTime straight into
 * the DOM via requestAnimationFrame (no React state), so playback progress no
 * longer re-renders the whole player ~4×/sec. Only the rare drag/hover states
 * use React state.
 */
interface SeekbarProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  duration: number;
  bufferedPct?: number;
  disabled?: boolean;
  hoverPreview?: boolean; // youtube-style time tooltip on hover
  thick?: boolean; // mobile pill style
  onSeekStart: () => void;
  onSeekEnd: (time: number) => void;
  onSeekToPct: (pct: number) => void;
}

export function Seekbar({
  videoRef,
  duration,
  bufferedPct = 0,
  disabled,
  hoverPreview,
  thick,
  onSeekStart,
  onSeekEnd,
  onSeekToPct,
}: SeekbarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const [hoverPct, setHoverPct] = useState<number | null>(null);

  function paint(pct: number) {
    if (fillRef.current) fillRef.current.style.width = `${pct}%`;
    if (thumbRef.current) thumbRef.current.style.left = `${pct}%`;
  }

  // rAF: reflect the video's playhead without re-rendering React. Throttled to
  // ~15 Hz which is smooth enough for a progress bar while staying cheap.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      if (ts - last < 66) return;
      last = ts;
      const v = videoRef.current;
      if (v && !draggingRef.current) {
        const pct = duration > 0 ? Math.min(100, (v.currentTime / duration) * 100) : 0;
        paint(pct);
        if (inputRef.current) inputRef.current.value = String(v.currentTime);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, duration]);

  function barPct(clientX: number) {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  const trackH = thick ? "h-1.5 group-hover/bar:h-2" : "h-[3px] group-hover/bar:h-[5px]";
  const thumbCls = thick
    ? "h-4 w-4 bg-white"
    : "h-3.5 w-3.5 bg-[#e50914]";

  return (
    <div
      ref={barRef}
      className="group/bar relative flex h-4 flex-1 cursor-pointer items-center"
      onMouseMove={hoverPreview ? (e) => setHoverPct(barPct(e.clientX)) : undefined}
      onMouseLeave={hoverPreview ? () => setHoverPct(null) : undefined}
      onClick={(e) => onSeekToPct(barPct(e.clientX))}
    >
      <div className={`relative w-full rounded-full bg-white/25 transition-all ${trackH}`}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/40" style={{ width: `${bufferedPct}%` }} />
        {hoverPreview && hoverPct != null && (
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${hoverPct * 100}%` }} />
        )}
        <div ref={fillRef} className="absolute inset-y-0 left-0 rounded-full bg-[#e50914]" style={{ width: "0%" }} />
        <div
          ref={thumbRef}
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 shadow transition-opacity group-hover/bar:opacity-100 ${thumbCls}`}
          style={{ left: "0%" }}
        />
      </div>

      {hoverPreview && hoverPct != null && duration > 0 && (
        <div
          className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-black/85 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white"
          style={{ left: `${hoverPct * 100}%` }}
        >
          {secondsToTimestamp(hoverPct * duration)}
        </div>
      )}

      <input
        ref={inputRef}
        type="range"
        min={0}
        max={duration || 1}
        step={0.5}
        defaultValue={0}
        disabled={disabled}
        onMouseDown={() => { draggingRef.current = true; onSeekStart(); }}
        onTouchStart={() => { draggingRef.current = true; onSeekStart(); }}
        onChange={(e) => paint(duration > 0 ? (Number(e.target.value) / duration) * 100 : 0)}
        onMouseUp={(e) => { draggingRef.current = false; onSeekEnd(Number((e.target as HTMLInputElement).value)); }}
        onTouchEnd={(e) => { draggingRef.current = false; onSeekEnd(Number((e.target as HTMLInputElement).value)); }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}

/** Self-updating "current / total" timecode — also rAF-driven, no re-renders. */
export function TimeDisplay({
  videoRef,
  duration,
  className,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  duration: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let lastSec = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      if (!v || !ref.current) return;
      const sec = Math.floor(v.currentTime);
      if (sec !== lastSec) {
        lastSec = sec;
        ref.current.textContent = secondsToTimestamp(v.currentTime);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);
  return (
    <span className={className}>
      <span ref={ref}>0:00</span> <span className="text-white/50 mx-0.5">/</span> {secondsToTimestamp(duration)}
    </span>
  );
}
