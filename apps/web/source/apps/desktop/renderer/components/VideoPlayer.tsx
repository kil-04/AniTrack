import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Disc3, Maximize2, Minimize2, Play, X } from "lucide-react";
import { useThemePlayer } from "../store/useThemePlayer";
import { safeImageSrc } from "../lib/image-guard";

/** One video in the player's queue. */
export interface VideoItem {
  key: string;
  title: string;
  /** "Artist — Show · OP1 · 1998" */
  byline: string;
  cover?: string | null;
  src: string;
}

const KEYFRAMES = `
  @keyframes songs-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  @keyframes songs-from-right { from { opacity: 0; transform: translateX(32px); } to { opacity: 1; transform: none; } }
  @keyframes songs-from-left { from { opacity: 0; transform: translateX(-32px); } to { opacity: 1; transform: none; } }
  @keyframes songs-dock { from { opacity: 0; transform: translateX(48px) scale(.96); } to { opacity: 1; transform: none; } }
  @keyframes songs-zoom { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
  .songs-rise { animation: songs-rise .35s ease-out both; }
`;

/**
 * Plays songs' videos one after another. It sits docked at the right of the page, or
 * full screen; one <video> serves both, so switching doesn't restart the song. Next and
 * previous: drag the video sideways, the arrows on it, ← →, or a song in Up next.
 * F switches full screen; Esc leaves full screen, then closes.
 */
export function VideoPlayer({ items: songs, index, label, full, onIndex, onFull, onClose, onSongStart }: {
  items: VideoItem[]; index: number; label: string; full: boolean;
  onIndex: (index: number) => void; onFull: (full: boolean) => void; onClose: () => void;
  /** Called as each video starts (the Songs page stops its hover preview). */
  onSongStart?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [drag, setDrag] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const dragStart = useRef<number | null>(null);
  const song = songs[index];
  const jump = (to: number, step: 1 | -1) => { setFailed(false); setDirection(step); onIndex(to); };
  const go = (step: 1 | -1) => jump(index + step, step);
  useEffect(() => { useThemePlayer.getState().pause(); onSongStart?.(); }, [index]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable || target.getAttribute("role") === "slider")) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        // Capture phase, so the video's own arrow-key seeking doesn't run too.
        e.preventDefault();
        e.stopPropagation();
        go(e.key === "ArrowRight" ? 1 : -1);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        onFull(!full);
      } else if (e.key === "Escape") {
        if (full) onFull(false); else onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  if (!song) return null;

  const swipe = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
      // Leave the bottom strip to the video's own controls (seek bar, volume).
      if (e.clientY > e.currentTarget.getBoundingClientRect().bottom - 56) return;
      dragStart.current = e.clientX;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragStart.current != null) setDrag(e.clientX - dragStart.current);
    },
    onPointerUp: () => {
      if (dragStart.current != null && Math.abs(drag) > 80) go(drag < 0 ? 1 : -1);
      dragStart.current = null;
      setDrag(0);
    },
    onPointerCancel: () => { dragStart.current = null; setDrag(0); },
  };
  const count = Math.min(full ? 6 : 12, songs.length - 1);
  const upNext = Array.from({ length: Math.max(0, count) }, (_, i) => (index + 1 + i) % songs.length);
  const slide = `${direction > 0 ? "songs-from-right" : "songs-from-left"} .32s ease-out both`;

  return createPortal(
    <>
    <style>{KEYFRAMES}</style>
    <div
      className={full
        ? "fixed inset-0 z-[80] flex flex-col items-center justify-center overflow-y-auto bg-black/95 p-6"
        : "fixed bottom-5 right-5 top-[72px] z-[60] flex w-[380px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface-1/95 shadow-[0_20px_60px_rgb(0_0_0/0.6)] backdrop-blur-xl"}
      style={{ animation: full ? "songs-zoom .25s ease-out both" : "songs-dock .35s cubic-bezier(.2,.8,.2,1) both" }}
    >
      <div className={full ? "w-full max-w-6xl" : ""}>
        {/* What's playing, sliding in from the side it came from. */}
        <div className={`flex items-start justify-between gap-3 ${full ? "mb-3" : "p-4 pb-3"}`}>
          <div key={song.key} className="min-w-0" style={{ animation: slide }}>
            <div className="truncate text-[11px] font-semibold uppercase tracking-wider text-accent">{label} · {index + 1} of {songs.length}</div>
            <div className={`truncate font-black ${full ? "text-2xl" : "text-lg"}`}>{song.title}</div>
            <div className="truncate text-sm text-white/60">{song.byline}</div>
          </div>
          <div className="flex flex-shrink-0 gap-1.5">
            <button onClick={() => onFull(!full)} title={full ? "Side player (F)" : "Full screen (F)"} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 transition hover:scale-110 hover:bg-white/20">
              {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button onClick={onClose} title="Close (Esc)" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 transition hover:scale-110 hover:bg-white/20"><X size={18} /></button>
          </div>
        </div>
        {/* Drag the video sideways for the next or previous song. */}
        <div {...swipe} className={`group relative select-none overflow-hidden bg-black ${full ? "rounded-xl" : ""}`} style={{ touchAction: "pan-y" }}>
          <div style={{
            transform: drag ? `translateX(${drag * 0.6}px) rotate(${drag * 0.004}deg)` : undefined,
            opacity: drag ? Math.max(0.35, 1 - Math.abs(drag) / 380) : 1,
            transition: drag ? "none" : "transform .25s ease-out, opacity .25s",
          }}>
            <video
              key={song.key}
              data-theme-video="true"
              src={song.src}
              controls
              autoPlay
              onEnded={() => go(1)}
              onError={() => setFailed(true)}
              className={`aspect-video w-full bg-black ${full ? "max-h-[calc(100vh-300px)]" : ""}`}
              style={{ animation: slide }}
            />
          </div>
          <button onClick={() => go(-1)} title="Previous (←)" className="absolute left-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 opacity-0 backdrop-blur transition hover:scale-110 hover:bg-black/75 group-hover:opacity-100"><ChevronLeft size={26} /></button>
          <button onClick={() => go(1)} title="Next (→)" className="absolute right-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 opacity-0 backdrop-blur transition hover:scale-110 hover:bg-black/75 group-hover:opacity-100"><ChevronRight size={26} /></button>
          {Math.abs(drag) > 30 && (
            <div className={`pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-accent px-3 py-1 text-xs font-black shadow-lg ${drag < 0 ? "right-4" : "left-4"}`}>
              {drag < 0 ? "Next ›" : "‹ Previous"}
            </div>
          )}
        </div>
        {failed && <p className={`text-sm text-red-300 ${full ? "mt-2" : "px-4 pt-2"}`}>This video didn't load. <button onClick={() => go(1)} className="underline">Skip to the next one</button></p>}
      </div>
      {upNext.length > 0 && (
        <div className={full ? "mt-5 w-full max-w-6xl" : "min-h-0 flex-1 overflow-y-auto px-3 pb-2 pt-3"}>
          <div className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-white/40">Up next</div>
          <div className={full ? "grid grid-cols-6 gap-3" : "flex flex-col gap-0.5"}>
            {upNext.map((at, i) => {
              const next = songs[at];
              const cover = safeImageSrc(next.cover ?? undefined);
              return (
                <button key={`${song.key}:${next.key}`} onClick={() => jump(at, 1)}
                  className={`songs-rise group flex rounded-xl text-left transition hover:bg-white/10 ${full ? "flex-col gap-2 p-2" : "items-center gap-3 p-1.5"}`}
                  style={{ animationDelay: `${i * 40}ms` }}>
                  <div className={`relative flex-shrink-0 overflow-hidden rounded-lg bg-white/5 ${full ? "aspect-video w-full" : "h-11 w-11"}`}>
                    {cover ? <img src={cover} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-110" /> : <Disc3 className="m-auto h-full text-white/20" size={18} />}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100"><Play size={14} fill="white" /></span>
                  </div>
                  <div className="w-full min-w-0">
                    <div className="truncate text-sm font-bold">{next.title}</div>
                    <div className="truncate text-[11px] text-white/45">{next.byline}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {!full && <div className="border-t border-white/5 px-4 py-2 text-[10px] text-white/35">Drag the video sideways or press ← → for the next song · F for full screen</div>}
    </div>
    </>,
    document.body,
  );
}
