import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Disc3, Play } from "lucide-react";

/*
 * The Songs page's moving parts: a record you can spin by hand, cards that tilt toward the
 * pointer, a roulette for Surprise me, toggles whose highlight slides between options, and
 * titles that flip like a departure board.
 */

export const FX_KEYFRAMES = `
  @keyframes fx-flip { from { opacity: 0; transform: rotateX(-90deg); } to { opacity: 1; transform: none; } }
  @keyframes fx-beat { from { opacity: .25; transform: scale(.96); } to { opacity: .65; transform: scale(1.05); } }
  @keyframes fx-land { 0% { transform: scale(1); } 40% { transform: scale(1.18); } 100% { transform: scale(1.1); } }
  @keyframes fx-shine { from { transform: translateX(-120%) skewX(-20deg); } to { transform: translateX(220%) skewX(-20deg); } }
`;

// ── Record ──────────────────────────────────────────────────────────────────

/**
 * A record that turns while music plays. Drag it round to spin it by hand (with a scratch
 * sound); let go and it coasts back to its playing speed. A click without a drag plays it.
 */
export function Vinyl({ cover, spinning, onClick, onScratch, title }: {
  cover?: string; spinning: boolean; onClick: () => void; onScratch?: () => void; title?: string;
}) {
  const disc = useRef<HTMLDivElement>(null);
  const motion = useRef({ angle: 0, speed: 0, drag: null as null | { last: number; moved: number; at: number; scratched: number } });
  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      const m = motion.current;
      if (!m.drag) {
        // Coast toward 72°/s (one turn every 5 s) while playing, else to a stop.
        m.speed += ((spinning ? 72 : 0) - m.speed) * Math.min(1, dt * 1.6);
        m.angle += m.speed * dt;
      }
      if (disc.current) disc.current.style.transform = `rotate(${m.angle}deg)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [spinning]);

  const angleAt = (e: React.PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return (Math.atan2(e.clientY - (box.top + box.height / 2), e.clientX - (box.left + box.width / 2)) * 180) / Math.PI;
  };
  return (
    <button
      title={title}
      className="pixel-round group relative h-52 w-52 flex-shrink-0 cursor-grab touch-none rounded-full shadow-[0_20px_60px_rgba(0,0,0,.6)] active:cursor-grabbing"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        motion.current.drag = { last: angleAt(e), moved: 0, at: performance.now(), scratched: 0 };
      }}
      onPointerMove={(e) => {
        const m = motion.current;
        if (!m.drag) return;
        const angle = angleAt(e);
        let delta = angle - m.drag.last;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        const now = performance.now();
        m.angle += delta;
        m.speed = m.speed * 0.6 + (delta / Math.max(0.008, (now - m.drag.at) / 1000)) * 0.4;
        m.drag.last = angle;
        m.drag.at = now;
        m.drag.moved += Math.abs(delta);
        if (Math.abs(delta) > 3 && now - m.drag.scratched > 70) { m.drag.scratched = now; onScratch?.(); }
      }}
      onPointerUp={() => {
        const moved = motion.current.drag?.moved ?? 0;
        motion.current.drag = null;
        if (moved < 6) onClick();
      }}
      onPointerCancel={() => { motion.current.drag = null; }}
    >
      <div ref={disc} className="pixel-round absolute inset-0 rounded-full" style={{ background: "repeating-radial-gradient(circle at center, #111 0 2px, #1c1c1c 2px 4px)" }}>
        <div className="pixel-round absolute inset-[30%] overflow-hidden rounded-full border-4 border-black/60 bg-accent">
          {cover && <img src={cover} alt="" draggable={false} className="h-full w-full object-cover" />}
        </div>
        <div className="pixel-round absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black" />
      </div>
      {/* The light stays put while the grooves turn under it. */}
      <div className="pixel-round pointer-events-none absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,rgba(255,255,255,.09)_40deg,transparent_80deg,transparent_180deg,rgba(255,255,255,.07)_220deg,transparent_260deg)]" />
      {/* Tonearm: swings onto the record while it plays. */}
      <div className="pointer-events-none absolute -right-3 -top-2 h-40 w-10 origin-[50%_12px] transition-transform duration-700 ease-[cubic-bezier(.3,1.4,.5,1)]"
        style={{ transform: `rotate(${spinning ? 24 : -6}deg)` }}>
        <div className="pixel-round absolute left-1/2 top-0 h-6 w-6 -translate-x-1/2 rounded-full border-2 border-white/40 bg-zinc-700 shadow-lg" />
        <div className="absolute left-1/2 top-3 h-32 w-1.5 -translate-x-1/2 rounded-full bg-gradient-to-b from-zinc-300 to-zinc-500" />
        <div className="absolute bottom-0 left-1/2 h-5 w-3.5 -translate-x-1/2 rounded-sm bg-zinc-200" />
      </div>
      <span className="pixel-round pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition group-hover:opacity-100"><Play size={40} fill="white" /></span>
    </button>
  );
}

// ── Tilt ────────────────────────────────────────────────────────────────────

/** Leans toward the pointer in 3D, with a glare that follows it. */
export function Tilt({ children, className = "", max = 10 }: { children: ReactNode; className?: string; max?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const set = (rx: number, ry: number, gx: number, gy: number, glare: number) => {
    const el = box.current;
    if (!el) return;
    el.style.setProperty("--rx", `${rx}deg`);
    el.style.setProperty("--ry", `${ry}deg`);
    el.style.setProperty("--gx", `${gx}%`);
    el.style.setProperty("--gy", `${gy}%`);
    el.style.setProperty("--glare", String(glare));
  };
  return (
    <div
      ref={box}
      className={`relative [transform-style:preserve-3d] ${className}`}
      style={{ transform: "perspective(900px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg))", transition: "transform .18s ease-out" }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        set((0.5 - y) * max * 2, (x - 0.5) * max * 2, x * 100, y * 100, 1);
      }}
      onMouseLeave={() => set(0, 0, 50, 50, 0)}
    >
      {children}
      <div className="pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-300"
        style={{ opacity: "var(--glare,0)", background: "radial-gradient(circle at var(--gx,50%) var(--gy,50%), rgba(255,255,255,.22), transparent 55%)" }} />
    </div>
  );
}

// ── Sliding toggle ──────────────────────────────────────────────────────────

/** Options in a row whose highlight glides to the chosen one. */
export function Slider<T extends string>({ value, onChange, options, pill, idle, active, className = "" }: {
  value: T; onChange: (v: T) => void;
  options: readonly { key: T; label: ReactNode; hint?: string }[];
  /** Classes for the moving highlight, the idle and the chosen option. */
  pill: string; idle: string; active: string; className?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = row.current?.querySelector<HTMLElement>(`[data-key="${value}"]`);
    if (el) setBox({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div ref={row} className={`relative flex ${className}`} role="radiogroup">
      {box && <span className={`absolute bottom-1 top-1 rounded-full transition-all duration-300 ease-[cubic-bezier(.3,1.3,.5,1)] ${pill}`} style={{ left: box.left, width: box.width }} />}
      {options.map((option) => (
        <button key={option.key} data-key={option.key} role="radio" aria-checked={value === option.key} title={option.hint}
          onClick={() => onChange(option.key)}
          className={`relative z-10 flex items-center gap-2 rounded-full transition-colors duration-200 ${value === option.key ? active : idle}`}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ── Flip text ───────────────────────────────────────────────────────────────

/** Each letter flips in, one after another, whenever the text changes. */
export function FlipText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`inline-block [perspective:600px] ${className}`} aria-label={text}>
      {[...text].map((ch, i) => (
        <span key={`${text}:${i}`} aria-hidden className="inline-block whitespace-pre"
          style={{ animation: `fx-flip .45s cubic-bezier(.2,1.2,.4,1) ${i * 40}ms both`, transformOrigin: "50% 60%" }}>
          {ch}
        </span>
      ))}
    </span>
  );
}

// ── Roulette ────────────────────────────────────────────────────────────────

export interface RouletteItem { key: string; title: string; cover?: string | null }

const CARD = 168;
const GAP = 16;

/**
 * Surprise me: covers whirl past, slow down and stop on the chosen song, ticking as each
 * one passes the marker; then [onDone] plays it.
 */
export function Roulette({ items, target, onDone, onTick, onClose }: {
  items: RouletteItem[]; target: number; onDone: () => void; onTick?: () => void; onClose: () => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [go, setGo] = useState(false);
  const [landed, setLanded] = useState(false);
  // A long reel of random covers with the winner near the end.
  const [reel] = useState(() => {
    const out: RouletteItem[] = [];
    for (let i = 0; i < 34; i++) out.push(items[Math.floor(Math.random() * items.length)]);
    out.push(items[target]);
    for (let i = 0; i < 5; i++) out.push(items[Math.floor(Math.random() * items.length)]);
    return out;
  });
  const stop = 34;
  useEffect(() => {
    const start = requestAnimationFrame(() => setGo(true));
    return () => cancelAnimationFrame(start);
  }, []);
  // Tick as each card crosses the marker.
  useEffect(() => {
    if (!go) return;
    let frame = 0;
    let last = -1;
    const watch = () => {
      const el = strip.current;
      if (el) {
        const x = new DOMMatrixReadOnly(getComputedStyle(el).transform).m41;
        const passed = Math.floor(-x / (CARD + GAP));
        if (passed !== last) { last = passed; onTick?.(); }
      }
      frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(frame);
  }, [go, onTick]);
  useEffect(() => {
    if (!landed) return;
    const done = window.setTimeout(onDone, 750);
    return () => window.clearTimeout(done);
  }, [landed, onDone]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const winner = reel[stop];
  return createPortal(
    <div className="fixed inset-0 z-[85] flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm" onClick={onClose}>
      <style>{FX_KEYFRAMES}</style>
      <div className="mb-6 text-xs font-black uppercase tracking-[0.3em] text-accent">Spinning the jukebox…</div>
      <div className="relative h-[260px] w-[min(1100px,92vw)] overflow-hidden" onClick={(e) => e.stopPropagation()}
        style={{ maskImage: "linear-gradient(90deg, transparent, black 18%, black 82%, transparent)" }}>
        {/* Marker */}
        <div className="absolute left-1/2 top-0 z-10 h-full w-1 -translate-x-1/2 rounded-full bg-amber-300 shadow-[0_0_24px_#fcd34d]" />
        <div
          ref={strip}
          className="absolute left-1/2 top-4 flex"
          style={{
            gap: GAP,
            transform: `translateX(${go ? -(stop * (CARD + GAP) + CARD / 2) : -CARD / 2}px)`,
            transition: go ? "transform 3.2s cubic-bezier(.12,.72,.12,1)" : "none",
          }}
          onTransitionEnd={() => setLanded(true)}
        >
          {reel.map((item, i) => (
            <div key={i} className="relative flex-shrink-0 overflow-hidden rounded-2xl bg-white/5"
              style={{ width: CARD, height: 228, animation: landed && i === stop ? "fx-land .5s ease-out both" : undefined, boxShadow: landed && i === stop ? "0 0 50px #fcd34d88" : undefined }}>
              {item.cover ? <img src={item.cover} alt="" className="h-full w-full object-cover" /> : <Disc3 className="m-auto mt-20 text-white/20" size={48} />}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black to-transparent p-3 pt-10 text-sm font-bold leading-tight">{item.title}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-6 h-8 text-xl font-black" style={{ opacity: landed ? 1 : 0, transition: "opacity .3s" }}>{winner.title}</div>
    </div>,
    document.body,
  );
}
