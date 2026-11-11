import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, HardDriveDownload, Link2, Maximize, RefreshCw, Settings2, X, ZoomIn, ZoomOut } from "lucide-react";
import { BackgroundMusicButton } from "../../components/BackgroundMusic";
import { chapterLabel, spreadsOf, type MangaChapter, type MangaPageImage, type SourceResult } from "../../../../../packages/shared/manga";
import {
  mangaApi,
  readerPrefs,
  saveReaderPrefs,
  type ReaderBackground,
  type ReaderMode,
  type ReaderPrefs,
  type ReaderSpread,
  type ReaderWidth,
} from "../../lib/manga-api";
import { useMangaReader, type ReaderSession } from "../../store/useMangaReader";
import { mangaReadingChanged } from "../../lib/manga-sync";

type PagesLoad =
  | { state: "loading" }
  | { state: "error"; text: string; verify: boolean }
  | { state: "ready"; pages: MangaPageImage[] };

// Page lists by chapter for a few minutes: the next chapter's list loads near the
// end of this one, so moving on opens at once.
const PAGE_LIST_TTL_MS = 10 * 60 * 1000;
const pageLists = new Map<string, { at: number; pending: Promise<SourceResult<MangaPageImage[]>> }>();

function pagesFor(session: ReaderSession, chapter: MangaChapter): Promise<SourceResult<MangaPageImage[]>> {
  const key = `${session.manga.id}:${session.title.sourceId}:${chapter.id}`;
  const hit = pageLists.get(key);
  if (hit && Date.now() - hit.at < PAGE_LIST_TTL_MS) return hit.pending;
  const pending = mangaApi().pages(session.title, chapter.id, session.manga.id);
  pageLists.set(key, { at: Date.now(), pending });
  // A failed answer isn't kept, so Retry asks again.
  const forget = () => { if (pageLists.get(key)?.pending === pending) pageLists.delete(key); };
  pending.then((result) => { if (!result.ok) forget(); }, forget);
  while (pageLists.size > 12) pageLists.delete(pageLists.keys().next().value!);
  return pending;
}

/** Controls fade after this long without the mouse moving. */
const CHROME_IDLE_MS = 3000;

const BACKGROUNDS: Record<ReaderBackground, string> = { black: "#000000", gray: "#1c1c1f", white: "#f2f2f2" };
const WIDTHS: Record<ReaderWidth, string> = { narrow: "720px", medium: "960px", full: "100%" };

/** Zoom: 100% is the page as the layout fits it; closer steps by keys and buttons, any value by wheel or slider. */
const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 1.25;
const clampZoom = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
/** A press that moves further than this is a drag (it pans), not a click. */
const DRAG_SLOP = 4;

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-3">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([key, text]) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`h-8 rounded-lg px-3 text-xs font-semibold transition ${value === key ? "bg-accent-gradient text-white shadow-glow" : "border border-white/[0.08] bg-white/[0.05] text-ink-2 hover:bg-white/[0.1] hover:text-white"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function MangaReader() {
  const navigate = useNavigate();
  const session = useMangaReader((s) => s.session);
  const go = useMangaReader((s) => s.go);
  const [load, setLoad] = useState<PagesLoad>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [prefs, setPrefs] = useState<ReaderPrefs>(readerPrefs);
  const [page, setPage] = useState(0);
  const [wide, setWide] = useState<Set<number>>(new Set());
  const [chrome, setChrome] = useState(true);
  const [settings, setSettings] = useState(false);
  const [landscape, setLandscape] = useState(() => window.innerWidth > window.innerHeight);
  const scroller = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const restored = useRef(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const settingsOpen = useRef(false);
  const lastWheel = useRef(0);
  settingsOpen.current = settings;
  // Zoom, and (in page modes) how far the zoomed page is moved from the middle.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const view = useRef({ zoom: 1, pan: { x: 0, y: 0 }, paged: false });
  /** Vertical: the point of the strip to keep under the pointer once the new zoom is laid out. */
  const anchor = useRef<{ fx: number; fy: number; x: number; y: number } | null>(null);
  /** The click that ends a drag isn't a click. */
  const dragged = useRef(false);

  const chapter = session ? session.chapters[session.index] : null;
  const hasPrev = !!session && session.index > 0;
  const hasNext = !!session && session.index < session.chapters.length - 1;

  // Opened without a session (e.g. after a reload): back to manga home. Leaving keeps
  // the session (the next title opened replaces it), so Back returns to the page.
  useEffect(() => {
    if (!useMangaReader.getState().session) navigate("/manga", { replace: true });
  }, [navigate]);

  useEffect(() => {
    const onResize = () => setLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Load the chapter's pages.
  useEffect(() => {
    if (!session || !chapter) return;
    let alive = true;
    setLoad({ state: "loading" });
    setWide(new Set());
    restored.current = false;
    pagesFor(session, chapter).then((result) => {
      if (!alive) return;
      if (result.ok) {
        setLoad({ state: "ready", pages: result.value });
        setPage(Math.min(session.startPage, Math.max(0, result.value.length - 1)));
      } else {
        setLoad({ state: "error", text: result.error, verify: !!result.verify });
      }
    }).catch(() => { if (alive) setLoad({ state: "error", text: "Couldn't load this chapter. Try again.", verify: false }); });
    return () => { alive = false; };
  }, [session?.title.id, chapter?.id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = load.state === "ready" ? load.pages : [];
  const count = pages.length;

  // Auto reads Japanese manga as right-to-left pages; strips and everything else scroll vertically.
  const effective: Exclude<ReaderMode, "auto"> = useMemo(() => {
    if (prefs.mode !== "auto") return prefs.mode;
    const strips = pages.some((p) => p.width && p.height && p.height > p.width * 2);
    if (strips) return "vertical";
    return session?.manga.country?.toUpperCase() === "JP" ? "rtl" : "vertical";
  }, [prefs.mode, pages, session?.manga.country]);
  const paged = effective !== "vertical";
  const rtl = effective === "rtl";
  const double = paged && (prefs.spread === "double" || (prefs.spread === "auto" && landscape));
  const isWide = useCallback((i: number) => {
    const p = pages[i];
    return wide.has(i) || (!!p?.width && !!p?.height && p.width > p.height);
  }, [pages, wide]);
  const spreads = useMemo(
    () => (double ? spreadsOf(count, prefs.shift, isWide) : Array.from({ length: count }, (_, i) => [i])),
    [double, count, prefs.shift, isWide],
  );
  const spreadIndex = Math.max(0, spreads.findIndex((s) => s.includes(page)));

  // ── Zoom ──
  view.current = { zoom, pan, paged };
  /** Keeps a zoomed page from being dragged off the screen: it moves by at most its overhang. */
  const clampPan = useCallback((p: { x: number; y: number }, z: number) => {
    const el = stage.current;
    if (!el || z <= 1) return { x: 0, y: 0 };
    const maxX = (el.clientWidth * (z - 1)) / 2;
    const maxY = (el.clientHeight * (z - 1)) / 2;
    return { x: Math.min(maxX, Math.max(-maxX, p.x)), y: Math.min(maxY, Math.max(-maxY, p.y)) };
  }, []);
  /** Zooms to [value], keeping the point at [at] (window coordinates; the middle when absent) where it is. */
  const zoomTo = useCallback((value: number, at?: { x: number; y: number }) => {
    const now = view.current;
    const next = clampZoom(value);
    if (next === now.zoom) return;
    if (now.paged) {
      const el = stage.current;
      if (el) {
        const box = el.getBoundingClientRect();
        // The page is scaled about the middle: a point at d from it sits over (d - pan) / zoom of the page.
        const d = at ? { x: at.x - (box.left + box.width / 2), y: at.y - (box.top + box.height / 2) } : { x: 0, y: 0 };
        const k = next / now.zoom;
        setPan(clampPan({ x: d.x - (d.x - now.pan.x) * k, y: d.y - (d.y - now.pan.y) * k }, next));
      }
    } else {
      const el = scroller.current;
      if (el && el.scrollWidth && el.scrollHeight) {
        const box = el.getBoundingClientRect();
        const x = at ? at.x - box.left : el.clientWidth / 2;
        const y = at ? at.y - box.top : el.clientHeight / 2;
        anchor.current = { fx: (el.scrollLeft + x) / el.scrollWidth, fy: (el.scrollTop + y) / el.scrollHeight, x, y };
      }
    }
    setZoom(next);
  }, [clampPan]);
  const zoomBy = useCallback((factor: number, at?: { x: number; y: number }) => zoomTo(view.current.zoom * factor, at), [zoomTo]);
  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);
  // Vertical: once the wider (or narrower) strip is laid out, scroll the kept point back under the pointer.
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    anchor.current = null;
    if (!el || !a) return;
    el.scrollLeft = a.fx * el.scrollWidth - a.x;
    el.scrollTop = a.fy * el.scrollHeight - a.y;
  }, [zoom]);
  // A page turn, another chapter or another layout starts from the whole page again.
  useEffect(() => { if (paged) resetZoom(); }, [paged, spreadIndex, chapter?.id, resetZoom]);
  useEffect(() => { resetZoom(); }, [paged, resetZoom]);
  // Ctrl + wheel (and a touchpad pinch, which arrives as one) zooms at the pointer. Registered
  // by hand: React's wheel listener is passive and couldn't stop the page from scrolling too.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * 0.0015), { x: event.clientX, y: event.clientY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);
  /** Dragging with the mouse moves a zoomed page, or scrolls the vertical strip. */
  const startDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const el = paged ? stage.current : scroller.current;
    if (!el || (paged && zoom <= 1)) return;
    const box = el.getBoundingClientRect();
    // A press on the strip's own scrollbar is the scrollbar's.
    if (!paged && (event.clientX - box.left >= el.clientWidth || event.clientY - box.top >= el.clientHeight)) return;
    const from = { x: event.clientX, y: event.clientY, pan, left: el.scrollLeft, top: el.scrollTop, cursor: el.style.cursor };
    let moved = false;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (!moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      if (!moved) { moved = true; el.style.cursor = "grabbing"; }
      if (paged) setPan(clampPan({ x: from.pan.x + dx, y: from.pan.y + dy }, view.current.zoom));
      else { el.scrollLeft = from.left - dx; el.scrollTop = from.top - dy; }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      el.style.cursor = from.cursor;
      dragged.current = moved;
      // The click that follows a drag reads the flag; a drag that ended outside the window leaves none.
      if (moved) window.setTimeout(() => { dragged.current = false; }, 0);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  /** Whether this click ended a drag (and so isn't one). */
  const wasDrag = () => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  };

  // Save where you are (debounced), and once more when leaving.
  const latest = useRef({ page, count });
  latest.current = { page, count };
  const save = useCallback(() => {
    if (!session || !chapter || !latest.current.count) return;
    void mangaApi().saveReading({
      mangaId: session.manga.id,
      chapter: chapter.number,
      chapterId: chapter.id,
      page: Math.min(latest.current.page, latest.current.count - 1),
      pageCount: latest.current.count,
      title: session.manga.title,
      cover: session.manga.cover,
      sourceId: session.title.sourceId,
    }).then(() => mangaReadingChanged()).catch(() => {});
  }, [session, chapter]);
  useEffect(() => {
    if (!count) return;
    const timer = setTimeout(save, 800);
    return () => clearTimeout(timer);
  }, [page, count, save]);
  useEffect(() => () => save(), [save]);

  // Vertical: restore the saved page once, then follow the page in view.
  useEffect(() => {
    if (paged || !count || restored.current) return;
    restored.current = true;
    const target = pageRefs.current[page];
    if (target && page > 0) requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
  }, [paged, count, page]);
  useEffect(() => {
    if (paged || !count) return;
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.page));
      if (visible.length && restored.current) setPage(Math.min(...visible));
    }, { root, rootMargin: "-45% 0px -45% 0px" });
    pageRefs.current.slice(0, count).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [paged, count]);

  // Near the end of a chapter, load the next one's page list and first pages.
  const nextChapter = session && hasNext ? session.chapters[session.index + 1] : null;
  const nearEnd = count > 0 && page >= count - 3;
  useEffect(() => {
    if (!nearEnd || !session || !nextChapter) return;
    pagesFor(session, nextChapter).then((result) => {
      if (result.ok) for (const p of result.value.slice(0, 2)) { const img = new Image(); img.src = p.url; }
    }).catch(() => {});
  }, [nearEnd, session, nextChapter]);

  // Controls fade while reading and come back when the mouse moves (never while the settings are open).
  const poke = useCallback(() => {
    setChrome(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => { if (!settingsOpen.current) setChrome(false); }, CHROME_IDLE_MS);
  }, []);
  const holdChrome = () => window.clearTimeout(hideTimer.current);
  const toggleChrome = () => {
    if (chrome) { holdChrome(); setChrome(false); } else poke();
  };
  useEffect(() => {
    poke();
    return () => window.clearTimeout(hideTimer.current);
  }, [poke]);

  // Paged: keep the next pages warm.
  useEffect(() => {
    if (!paged) return;
    for (let i = page + 1; i <= page + 4 && i < count; i++) {
      const img = new Image();
      img.src = pages[i].url;
    }
  }, [paged, page, count, pages]);

  const turn = useCallback((forward: boolean) => {
    if (!count) return;
    const target = spreads[spreadIndex + (forward ? 1 : -1)];
    if (target) {
      setPage(target[0]);
    } else if (forward && hasNext && session) {
      save();
      go(session.index + 1);
    } else if (!forward && hasPrev && session) {
      save();
      go(session.index - 1);
    }
  }, [count, spreads, spreadIndex, hasNext, hasPrev, session, go, save]);

  const leave = useCallback(() => {
    save();
    navigate(session ? session.back ?? `/manga/${session.manga.id}` : "/manga");
  }, [save, navigate, session]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "Escape") { if (settings) setSettings(false); else leave(); }
      else if (event.key === "f" || event.key === "F") {
        if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => {});
      } else if ((event.key === "n" || event.key === "N") && hasNext && session) { save(); go(session.index + 1); }
      else if ((event.key === "p" || event.key === "P") && hasPrev && session) { save(); go(session.index - 1); }
      else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomBy(ZOOM_STEP); }
      else if (event.key === "-" || event.key === "_") { event.preventDefault(); zoomBy(1 / ZOOM_STEP); }
      else if (event.key === "0") { event.preventDefault(); resetZoom(); }
      else if (paged && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
        event.preventDefault();
        turn((event.key === "ArrowRight") !== rtl);
      } else if (paged && (event.key === " " || event.key === "PageDown")) { event.preventDefault(); turn(true); }
      else if (paged && event.key === "PageUp") { event.preventDefault(); turn(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paged, rtl, turn, leave, settings, hasNext, hasPrev, session, go, save, zoomBy, resetZoom]);

  const update = (patch: Partial<ReaderPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveReaderPrefs(next);
  };

  if (!session || !chapter) return <div className="fixed inset-0 bg-black" />;
  const background = BACKGROUNDS[prefs.background];
  const ink = prefs.background === "white" ? "#1c1c1f" : "#ffffff";
  const onImage = (i: number) => (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    if (img.naturalWidth > img.naturalHeight && !wide.has(i)) setWide((set) => new Set(set).add(i));
  };

  const shown = spreads[spreadIndex] ?? [];
  const ordered = rtl ? [...shown].reverse() : shown;
  const atEnd = paged ? spreadIndex >= spreads.length - 1 : page >= count - 1;
  const local = count > 0 && pages[0].url.startsWith("anitrack-manga://local/");
  const jumpTo = (index: number) => {
    if (paged) setPage(index);
    else pageRefs.current[index]?.scrollIntoView({ block: "start" });
  };
  const toNext = () => { save(); go(session.index + 1); };

  return (
    <div
      ref={root}
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ backgroundColor: background, color: ink, cursor: chrome ? undefined : "none" }}
      onMouseMove={poke}
    >
      {/* Top bar */}
      <div
        className={`absolute inset-x-0 top-0 z-20 flex items-center gap-2.5 bg-gradient-to-b from-black/85 via-black/40 to-transparent px-5 pb-8 pt-4 text-white transition-opacity ${chrome ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onMouseEnter={holdChrome}
      >
        <button onClick={leave} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/50 text-white backdrop-blur-md transition hover:bg-black/75" title="Back (Esc)"><ArrowLeft size={18} /></button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold drop-shadow">{session.manga.title}</div>
          <div className="flex items-center gap-2 text-xs text-white/65">
            <span className="truncate">Chapter {chapterLabel(chapter.number)}{chapter.title ? ` — ${chapter.title}` : ""}{chapter.group ? ` · ${chapter.group}` : ""}</span>
            {local && (
              <span className="flex flex-shrink-0 items-center gap-1 rounded-md border border-emerald-400/20 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300" title="Reading the downloaded copy">
                <HardDriveDownload size={11} /> Downloaded
              </span>
            )}
          </div>
        </div>
        {/* Background music keeps playing while reading; its controls ride along here. */}
        <div className="rounded-full bg-black/50 backdrop-blur-md"><BackgroundMusicButton /></div>
        {count > 0 && <span className="rounded-full border border-white/10 bg-black/50 text-white backdrop-blur-md px-3 py-1.5 text-xs font-semibold tabular-nums">{Math.min(page + 1, count)} / {count}</span>}
        {count > 0 && (
          <div className="flex h-10 items-center rounded-xl border border-white/10 bg-black/50 text-white backdrop-blur-md">
            <button onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} className="grid h-10 w-9 place-items-center rounded-l-xl transition hover:bg-black/75 disabled:opacity-30" title="Zoom out (-)" aria-label="Zoom out"><ZoomOut size={15} /></button>
            <button onClick={resetZoom} className="h-10 min-w-[3.25rem] px-1 text-xs font-semibold tabular-nums transition hover:bg-black/75" title="Back to 100% (0)">{Math.round(zoom * 100)}%</button>
            <button onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} className="grid h-10 w-9 place-items-center rounded-r-xl transition hover:bg-black/75 disabled:opacity-30" title="Zoom in (+)" aria-label="Zoom in"><ZoomIn size={15} /></button>
          </div>
        )}
        <button onClick={() => hasPrev && (save(), go(session.index - 1))} disabled={!hasPrev} className="flex h-10 items-center gap-1 rounded-xl border border-white/10 bg-black/50 text-white backdrop-blur-md transition hover:bg-black/75 px-3.5 text-xs font-semibold disabled:opacity-30" title="Previous chapter (P)">
          <ChevronLeft size={15} /> Prev
        </button>
        <button onClick={() => hasNext && (save(), go(session.index + 1))} disabled={!hasNext} className="flex h-10 items-center gap-1 rounded-xl border border-white/10 bg-black/50 text-white backdrop-blur-md transition hover:bg-black/75 px-3.5 text-xs font-semibold disabled:opacity-30" title="Next chapter (N)">
          Next <ChevronRight size={15} />
        </button>
        <button onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen().catch(() => {}))} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/50 text-white backdrop-blur-md transition hover:bg-black/75" title="Full screen (F)">
          <Maximize size={16} />
        </button>
        <button onClick={() => setSettings(!settings)} className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${settings ? "bg-accent-gradient text-white shadow-glow" : "border border-white/10 bg-black/50 text-white backdrop-blur-md transition hover:bg-black/75"}`} title="Reader settings">
          <Settings2 size={16} />
        </button>
      </div>

      {settings && (
        <div className="glass absolute right-5 top-[4.5rem] z-30 w-80 space-y-4 rounded-2xl p-4 text-white shadow-pop">
          <div className="flex items-center gap-3">
            <span className="icon-tile h-8 w-8 rounded-lg"><Settings2 size={15} /></span>
            <span className="flex-1 text-sm font-bold">Reader</span>
            <button onClick={() => setSettings(false)} className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 transition hover:bg-white/[0.07] hover:text-white" aria-label="Close"><X size={16} /></button>
          </div>
          <Choice<ReaderMode> label="Layout" value={prefs.mode} onChange={(mode) => update({ mode })}
            options={[["auto", `Auto (${effective === "vertical" ? "vertical" : effective === "rtl" ? "right to left" : "left to right"})`], ["vertical", "Vertical"], ["rtl", "Pages ←"], ["ltr", "Pages →"]]} />
          {paged && (
            <Choice<ReaderSpread> label="Pages shown" value={prefs.spread} onChange={(spread) => update({ spread })}
              options={[["auto", "Auto"], ["single", "One"], ["double", "Two"]]} />
          )}
          {paged && double && (
            <Choice<"on" | "off"> label="Spread alignment" value={prefs.shift ? "on" : "off"} onChange={(v) => update({ shift: v === "on" })}
              options={[["off", "Cover alone"], ["on", "Shifted"]]} />
          )}
          {!paged && (
            <Choice<ReaderWidth> label="Page width" value={prefs.width} onChange={(width) => update({ width })}
              options={[["narrow", "Narrow"], ["medium", "Medium"], ["full", "Full"]]} />
          )}
          <Choice<ReaderBackground> label="Background" value={prefs.background} onChange={(bg) => update({ background: bg })}
            options={[["black", "Black"], ["gray", "Dark gray"], ["white", "White"]]} />
          <div>
            <div className="mb-2 flex items-center text-[10px] font-bold uppercase tracking-[0.18em] text-ink-3">
              <span className="flex-1">Zoom</span>
              <span className="tabular-nums text-ink-2">{Math.round(zoom * 100)}%</span>
            </div>
            <input
              type="range"
              min={ZOOM_MIN * 100}
              max={ZOOM_MAX * 100}
              step={5}
              value={Math.round(zoom * 100)}
              onChange={(event) => zoomTo(Number(event.target.value) / 100)}
              className="h-1 w-full cursor-pointer accent-accent"
              aria-label="Zoom"
            />
          </div>
          <p className="border-t border-white/[0.07] pt-3 text-[11px] leading-relaxed text-ink-3">Keys: ← → or the mouse wheel turn pages · N / P chapters · F full screen · Esc back. Zoom: Ctrl + wheel, + and −, or double-click; drag to move around; 0 goes back to 100%. Move the mouse to show the controls.</p>
        </div>
      )}

      {load.state === "loading" && <div className="flex flex-1 items-center justify-center"><span className="h-9 w-9 animate-spin rounded-full border-[3px] border-accent/25 border-t-accent" /></div>}
      {load.state === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <p className="max-w-md text-sm opacity-70">{load.text}</p>
          <div className="flex gap-3">
            {load.verify && (
              <button
                onClick={async () => { if (await mangaApi().connect(session.title.sourceId).catch(() => false)) setAttempt((n) => n + 1); }}
                className="btn btn-primary"
              >
                <Link2 size={15} /> Connect source
              </button>
            )}
            <button onClick={() => setAttempt((n) => n + 1)} className="btn border border-white/10 bg-black/50 text-white backdrop-blur-md transition hover:bg-black/75"><RefreshCw size={15} /> Retry</button>
            {hasNext && (
              <button onClick={() => go(session.index + 1)} className="btn border border-white/10 bg-black/50 text-white backdrop-blur-md transition hover:bg-black/75">
                Next chapter <ChevronRight size={15} />
              </button>
            )}
          </div>
        </div>
      )}

      {load.state === "ready" && !paged && (
        <div
          ref={scroller}
          className="thin-scrollbar flex-1 select-none overflow-auto"
          style={{ cursor: chrome ? "grab" : undefined }}
          onMouseDown={startDrag}
          onClick={() => { if (!wasDrag()) toggleChrome(); }}
          onDoubleClick={(event) => zoomTo(zoom > 1 ? 1 : 2, { x: event.clientX, y: event.clientY })}
        >
          {/* Zoomed, the strip is wider than the window and scrolls (or drags) sideways too. */}
          <div className="mx-auto" style={{ width: `calc(min(100%, ${WIDTHS[prefs.width]}) * ${zoom})` }}>
            {pages.map((p, i) => (
              <div key={p.url} ref={(el) => { pageRefs.current[i] = el; }} data-page={i} style={{ minHeight: p.width && p.height ? undefined : "60vh" }}>
                <img
                  src={p.url}
                  alt={`Page ${i + 1}`}
                  loading={i < 3 ? "eager" : "lazy"}
                  decoding="async"
                  onLoad={onImage(i)}
                  className="block w-full select-none"
                  style={p.width && p.height ? { aspectRatio: `${p.width} / ${p.height}` } : undefined}
                  draggable={false}
                />
              </div>
            ))}
            <EndCard next={nextChapter} onNext={toNext} onBack={leave} />
          </div>
        </div>
      )}

      {load.state === "ready" && paged && (
        <div
          ref={stage}
          className="relative flex flex-1 select-none items-center justify-center overflow-hidden"
          style={{ cursor: zoom > 1 && chrome ? "grab" : undefined }}
          onMouseDown={startDrag}
          onClick={(event) => {
            if (wasDrag()) return;
            const x = event.clientX / window.innerWidth;
            // Zoomed in, the sides don't turn pages: a click there is usually a missed drag.
            if (zoom > 1) toggleChrome();
            else if (x < 0.3) turn(rtl);
            else if (x > 0.7) turn(!rtl);
            else toggleChrome();
          }}
          onDoubleClick={(event) => {
            const x = event.clientX / window.innerWidth;
            if (zoom > 1) resetZoom();
            // At 100% only the middle zooms: the sides turn pages on each click.
            else if (x >= 0.3 && x <= 0.7) zoomTo(2, { x: event.clientX, y: event.clientY });
          }}
          onWheel={(event) => {
            if (event.ctrlKey) return;
            if (zoom > 1) {
              // Zoomed in, the wheel moves the page instead of turning it.
              setPan((p) => clampPan(event.shiftKey ? { x: p.x - event.deltaY, y: p.y } : { x: p.x - event.deltaX, y: p.y - event.deltaY }, zoom));
              return;
            }
            if (Math.abs(event.deltaY) < 25 || performance.now() - lastWheel.current < 250) return;
            lastWheel.current = performance.now();
            turn(event.deltaY > 0);
          }}
        >
          <div className="flex h-full max-h-full items-center justify-center" style={zoom > 1 ? { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` } : undefined}>
            {ordered.map((i) => (
              <img
                key={pages[i].url}
                src={pages[i].url}
                alt={`Page ${i + 1}`}
                onLoad={onImage(i)}
                className="max-h-full object-contain"
                style={{ maxWidth: ordered.length > 1 ? "50vw" : "100vw", height: "100%" }}
                draggable={false}
              />
            ))}
          </div>
          {atEnd && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2" onClick={(event) => event.stopPropagation()}>
              <EndCard compact next={nextChapter} onNext={toNext} onBack={leave} />
            </div>
          )}
        </div>
      )}

      {count > 1 && (
        <div
          className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-6 pb-5 pt-12 text-white transition-opacity ${chrome ? "opacity-100" : "pointer-events-none opacity-0"}`}
          onMouseEnter={holdChrome}
        >
          <div className={`mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-white/10 bg-black/55 px-4 py-2.5 shadow-pop backdrop-blur-md ${rtl ? "flex-row-reverse" : ""}`}>
            <span className="w-8 text-center text-xs font-semibold tabular-nums text-white/80">{Math.min(page + 1, count)}</span>
            <input
              type="range"
              min={0}
              max={count - 1}
              step={1}
              value={Math.min(page, count - 1)}
              onChange={(event) => jumpTo(Number(event.target.value))}
              style={{ direction: rtl ? "rtl" : "ltr" }}
              className="h-1 flex-1 cursor-pointer accent-accent"
              aria-label="Page"
            />
            <span className="w-8 text-center text-xs tabular-nums text-white/45">{count}</span>
          </div>
        </div>
      )}
      {count > 0 && (
        <div className={`absolute inset-x-0 bottom-0 h-0.5 bg-white/10 transition-opacity ${chrome ? "opacity-0" : "opacity-70"}`}>
          <div className="h-full bg-accent-gradient" style={{ width: `${((Math.min(page + 1, count)) / count) * 100}%`, marginLeft: rtl ? "auto" : undefined }} />
        </div>
      )}
    </div>
  );
}

function EndCard({ next, onNext, onBack, compact }: { next: MangaChapter | null; onNext: () => void; onBack: () => void; compact?: boolean }) {
  return (
    <div className={`flex items-center justify-center gap-3 ${compact ? "rounded-2xl border border-white/10 bg-black/70 p-2 shadow-pop backdrop-blur-md" : "py-16"}`}>
      {next ? (
        <button onClick={(event) => { event.stopPropagation(); onNext(); }} className="btn btn-primary btn-lg">
          Next · Ch {chapterLabel(next.number)} <ChevronRight size={16} />
        </button>
      ) : (
        <span className={`px-4 text-sm font-semibold ${compact ? "text-white/70" : "opacity-70"}`}>You're caught up.</span>
      )}
      <button onClick={(event) => { event.stopPropagation(); onBack(); }} className="btn btn-lg border border-white/10 bg-black/50 text-white backdrop-blur-md transition hover:bg-black/75">
        Back to chapters
      </button>
    </div>
  );
}
