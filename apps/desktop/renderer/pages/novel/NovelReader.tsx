import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, List, Minus, Plus, RefreshCw, Type, X } from "lucide-react";
import { BackgroundMusicButton } from "../../components/BackgroundMusic";
import {
  isNovelSource,
  novelSourceLabel,
  type NovelChapter,
  type NovelChapterText,
  type NovelDetail,
} from "../../../../../packages/shared/novel";
import {
  NOVEL_READER_DEFAULTS,
  novelApi,
  novelReaderPath,
  novelReaderPrefs,
  novelTitlePath,
  saveNovelReaderPrefs,
  unwrap,
  type NovelReaderPrefs,
  type NovelTheme,
} from "../../lib/novel-api";
import { novelReadingChanged } from "../../lib/novel-sync";

const THEMES: Record<NovelTheme, { label: string; bg: string; text: string; muted: string; rule: string; chrome: string }> = {
  night: { label: "Night", bg: "#0a0d16", text: "#d9deea", muted: "#7c8499", rule: "rgba(255,255,255,0.08)", chrome: "rgba(10,13,22,0.86)" },
  dusk: { label: "Dusk", bg: "#1c1e27", text: "#cdd0da", muted: "#868a99", rule: "rgba(255,255,255,0.08)", chrome: "rgba(28,30,39,0.88)" },
  sepia: { label: "Sepia", bg: "#f3ead6", text: "#4a3a2b", muted: "#8c7a63", rule: "rgba(74,58,43,0.14)", chrome: "rgba(243,234,214,0.92)" },
  paper: { label: "Paper", bg: "#fbfbf9", text: "#1e2229", muted: "#6b7280", rule: "rgba(0,0,0,0.09)", chrome: "rgba(251,251,249,0.92)" },
};

const FONTS = {
  serif: "Literata, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Noto Serif', serif",
  sans: "Outfit, 'Segoe UI', system-ui, sans-serif",
};

type Text = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; chapter: NovelChapterText };

export default function NovelReader() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const sourceId = isNovelSource(params.get("s")) ? (params.get("s") as "novelbuddy" | "novelarchive") : null;
  const titleId = params.get("t") ?? "";
  const chapterId = params.get("c") ?? "";
  const startParagraph = Math.max(0, Number(params.get("p")) || 0);
  // A place carried over from another source's copy: how far through, as its paragraphs differ.
  const startFraction = Math.min(1, Math.max(0, Number(params.get("f")) || 0));

  const [prefs, setPrefs] = useState<NovelReaderPrefs>(novelReaderPrefs);
  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [chapters, setChapters] = useState<NovelChapter[]>([]);
  const [text, setText] = useState<Text>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<"none" | "type" | "chapters">("none");
  const [progress, setProgress] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const restored = useRef<string | null>(null);
  const lastSaved = useRef<{ key: string; paragraph: number } | null>(null);

  const theme = THEMES[prefs.theme];
  const updatePrefs = (next: Partial<NovelReaderPrefs>) => {
    setPrefs((p) => {
      const merged = { ...p, ...next };
      saveNovelReaderPrefs(merged);
      return merged;
    });
  };

  // Title and chapter list, once per title.
  useEffect(() => {
    if (!sourceId) return;
    let alive = true;
    void novelApi().savedTitle(sourceId, titleId).then((saved) => {
      if (!alive || !saved) return;
      setDetail((d) => d ?? saved.detail);
      if (saved.chapters.length) setChapters((c) => (c.length ? c : saved.chapters));
    });
    unwrap(novelApi().title(sourceId, titleId)).then((d) => { if (alive) setDetail(d); }).catch(() => {});
    unwrap(novelApi().chapters(sourceId, titleId)).then((list) => { if (alive) setChapters(list); }).catch(() => {});
    return () => { alive = false; };
  }, [sourceId, titleId]);

  // The chapter's text.
  useEffect(() => {
    if (!sourceId || !chapterId) return;
    let alive = true;
    setText({ state: "loading" });
    restored.current = null;
    unwrap(novelApi().chapter(sourceId, titleId, chapterId))
      .then((chapter) => { if (alive) setText({ state: "ready", chapter }); })
      .catch((error: Error) => { if (alive) setText({ state: "failed", error: error.message }); });
    return () => { alive = false; };
  }, [sourceId, titleId, chapterId, attempt]);

  const index = useMemo(() => chapters.findIndex((c) => c.id === chapterId), [chapters, chapterId]);
  const current = index >= 0 ? chapters[index] : null;
  const previous = index > 0 ? chapters[index - 1] : null;
  const next = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null;

  // Fetch the next chapter ahead (the main process keeps it), so turning the page is instant.
  useEffect(() => {
    if (!sourceId || text.state !== "ready" || !next) return;
    const timer = setTimeout(() => { void novelApi().chapter(sourceId, titleId, next.id).catch(() => {}); }, 2500);
    return () => clearTimeout(timer);
  }, [sourceId, titleId, text.state, next]);

  const paragraphs = text.state === "ready" ? text.chapter.paragraphs : [];
  const label = current?.label ?? (text.state === "ready" ? text.chapter.label : "");

  // Back to where reading stopped, once the text is laid out (and again after a layout change).
  useLayoutEffect(() => {
    if (text.state !== "ready" || !scroller.current) return;
    const key = `${chapterId}`;
    if (restored.current === key) return;
    restored.current = key;
    const target = Math.min(startFraction > 0 ? Math.floor(startFraction * paragraphs.length) : startParagraph, paragraphs.length - 1);
    if (target > 0) {
      const el = scroller.current.querySelector<HTMLElement>(`[data-p="${target}"]`);
      if (el) scroller.current.scrollTop = el.offsetTop - 96;
    } else {
      scroller.current.scrollTop = 0;
    }
  }, [text, chapterId, startParagraph, startFraction, paragraphs.length]);

  /** The first paragraph whose bottom is below the top bar. */
  const firstVisible = useCallback((): number => {
    const root = scroller.current;
    if (!root || !paragraphs.length) return 0;
    const top = root.scrollTop + 80;
    const nodes = root.querySelectorAll<HTMLElement>("[data-p]");
    let lo = 0;
    let hi = nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nodes[mid].offsetTop + nodes[mid].offsetHeight < top) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }, [paragraphs.length]);

  const save = useCallback((paragraph: number) => {
    if (!sourceId || text.state !== "ready" || !current) return;
    const key = `${current.id}`;
    if (lastSaved.current?.key === key && lastSaved.current.paragraph === paragraph) return;
    lastSaved.current = { key, paragraph };
    void novelApi().saveReading({
      sourceId,
      titleId,
      chapterId: current.id,
      chapterOrder: current.order,
      chapterLabel: current.label,
      paragraph,
      paragraphCount: paragraphs.length,
      title: detail?.title ?? "Unknown",
      cover: detail?.cover ?? null,
    }).then(() => novelReadingChanged()).catch(() => {});
  }, [sourceId, titleId, text.state, current, paragraphs.length, detail]);

  // Opening a chapter counts as reading it (so Continue finds it), then scrolling moves the mark.
  useEffect(() => {
    if (text.state === "ready" && current) {
      const t = setTimeout(() => save(firstVisible()), 600);
      return () => clearTimeout(t);
    }
  }, [text.state, current, save, firstVisible]);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let lastTop = root.scrollTop;
    let timer: number | null = null;
    const onScroll = () => {
      const top = root.scrollTop;
      const max = root.scrollHeight - root.clientHeight;
      setProgress(max > 0 ? Math.min(1, top / max) : 0);
      if (Math.abs(top - lastTop) > 6) {
        setChrome(top < lastTop || top < 80 || top >= max - 4);
        if (top > lastTop) setPanel("none");
        lastTop = top;
      }
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // At the very end, count the last paragraph as read even if a short one never reached the top.
        save(top >= max - 4 ? Math.max(0, paragraphs.length - 1) : firstVisible());
      }, 700);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => { root.removeEventListener("scroll", onScroll); if (timer != null) window.clearTimeout(timer); };
  }, [save, firstVisible, paragraphs.length]);

  const go = useCallback((chapter: NovelChapter | null) => {
    if (!chapter || !sourceId) return;
    setPanel("none");
    navigate(novelReaderPath(sourceId, titleId, chapter.id), { replace: true });
  }, [navigate, sourceId, titleId]);

  const leave = useCallback(() => {
    if (sourceId) save(firstVisible());
    if (window.history.length > 1) navigate(-1);
    else if (sourceId) navigate(novelTitlePath(sourceId, titleId));
  }, [navigate, save, firstVisible, sourceId, titleId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === "Escape") { if (panel !== "none") setPanel("none"); else leave(); }
      else if (event.key === "ArrowRight" && !event.altKey) go(next);
      else if (event.key === "ArrowLeft" && !event.altKey) go(previous);
      else if (event.key === "+" || event.key === "=") updatePrefs({ size: Math.min(32, prefs.size + 1) });
      else if (event.key === "-") updatePrefs({ size: Math.max(14, prefs.size - 1) });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go, leave, next, previous, panel, prefs.size]);

  if (!sourceId) {
    return <div className="grid h-screen place-items-center bg-bg text-ink-3">This reader link is missing its source.</div>;
  }

  const column = { maxWidth: `${prefs.width}ch` };
  const chromeStyle = { background: theme.chrome, borderColor: theme.rule, color: theme.text };

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: theme.bg, color: theme.text }}>
      {/* Reading progress */}
      <div className="absolute inset-x-0 top-0 z-30 h-[3px]" style={{ background: theme.rule }}>
        <div className="h-full bg-accent-gradient transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>

      {/* Top bar */}
      <header
        className={`titlebar-drag absolute inset-x-0 top-[3px] z-20 flex h-14 items-center gap-2 border-b px-4 backdrop-blur-xl transition-transform duration-300 ${chrome || panel !== "none" ? "translate-y-0" : "-translate-y-[120%]"}`}
        style={chromeStyle}
      >
        <button onClick={leave} className="titlebar-no-drag grid h-9 w-9 place-items-center rounded-full transition hover:bg-black/10" title="Back (Esc)">
          <ArrowLeft size={18} />
        </button>
        <button
          onClick={() => navigate(novelTitlePath(sourceId, titleId))}
          className="titlebar-no-drag min-w-0 flex-1 text-left"
          title="Open the title page"
        >
          <div className="truncate text-sm font-bold">{detail?.title ?? novelSourceLabel(sourceId)}</div>
          <div className="truncate text-[11px]" style={{ color: theme.muted }}>
            {label}{chapters.length ? ` · ${index + 1} of ${chapters.length.toLocaleString()}` : ""}
          </div>
        </button>
        <div className="titlebar-no-drag flex items-center gap-1">
          {/* Background music keeps playing while reading; a dark pill keeps it readable on light themes. */}
          <div className="mr-1 rounded-full bg-black/60"><BackgroundMusicButton /></div>
          <button onClick={() => go(previous)} disabled={!previous} className="grid h-9 w-9 place-items-center rounded-full transition hover:bg-black/10 disabled:opacity-30" title="Previous chapter (←)">
            <ChevronLeft size={19} />
          </button>
          <button onClick={() => go(next)} disabled={!next} className="grid h-9 w-9 place-items-center rounded-full transition hover:bg-black/10 disabled:opacity-30" title="Next chapter (→)">
            <ChevronRight size={19} />
          </button>
          <button onClick={() => setPanel(panel === "chapters" ? "none" : "chapters")} className={`grid h-9 w-9 place-items-center rounded-full transition hover:bg-black/10 ${panel === "chapters" ? "bg-black/10" : ""}`} title="Chapters">
            <List size={18} />
          </button>
          <button onClick={() => setPanel(panel === "type" ? "none" : "type")} className={`grid h-9 w-9 place-items-center rounded-full transition hover:bg-black/10 ${panel === "type" ? "bg-black/10" : ""}`} title="Text settings">
            <Type size={18} />
          </button>
        </div>
      </header>

      {panel === "type" && <TypePanel prefs={prefs} onChange={updatePrefs} theme={theme} />}
      {panel === "chapters" && (
        <ChapterPanel chapters={chapters} currentId={chapterId} theme={theme} onPick={(c) => go(c)} onClose={() => setPanel("none")} />
      )}

      {/* Text */}
      <div
        ref={scroller}
        className="thin-scrollbar h-full overflow-y-auto"
        onClick={(event) => {
          // A click on the page (not a selection or a button) toggles the bars.
          if ((event.target as HTMLElement).closest("button,a")) return;
          if (window.getSelection()?.toString()) return;
          setChrome((c) => !c);
          setPanel("none");
        }}
      >
        <article className="mx-auto px-6 pb-24 pt-24" style={column}>
          {text.state === "loading" && (
            <div className="space-y-4 pt-6">
              <div className="h-8 w-1/2 animate-pulse rounded-lg" style={{ background: theme.rule }} />
              {Array.from({ length: 10 }, (_, i) => <div key={i} className="h-4 animate-pulse rounded" style={{ background: theme.rule, width: `${78 + ((i * 37) % 22)}%` }} />)}
            </div>
          )}
          {text.state === "failed" && (
            <div className="rounded-2xl border p-6 text-center" style={{ borderColor: theme.rule }}>
              <p className="mb-4 text-sm" style={{ color: theme.muted }}>{text.error}</p>
              <button onClick={() => setAttempt((n) => n + 1)} className="btn btn-primary btn-sm"><RefreshCw size={14} /> Retry</button>
            </div>
          )}
          {text.state === "ready" && (
            <>
              <h1 className="mb-10 text-center font-bold leading-tight" style={{ fontFamily: FONTS[prefs.font], fontSize: `${Math.round(prefs.size * 1.45)}px` }}>
                {label}
              </h1>
              <div
                className="select-text"
                style={{ fontFamily: FONTS[prefs.font], fontSize: `${prefs.size}px`, lineHeight: prefs.leading, textRendering: "optimizeLegibility", hyphens: "auto" }}
              >
                {paragraphs.map((p, i) => (
                  <p key={i} data-p={i} className={p === "* * *" ? "my-8 text-center tracking-[0.5em]" : "mb-[0.95em]"} style={p === "* * *" ? { color: theme.muted } : undefined}>
                    {p}
                  </p>
                ))}
              </div>
              <nav className="mt-16 flex items-center justify-between gap-4 border-t pt-8" style={{ borderColor: theme.rule }}>
                <button onClick={() => go(previous)} disabled={!previous} className="btn btn-secondary disabled:opacity-30" style={{ color: theme.text }}>
                  <ChevronLeft size={16} /> Previous
                </button>
                {next ? (
                  <button onClick={() => go(next)} className="btn btn-primary btn-lg">
                    {next.label} <ChevronRight size={18} />
                  </button>
                ) : (
                  <span className="text-sm" style={{ color: theme.muted }}>
                    {chapters.length ? "You're caught up — this is the newest chapter." : ""}
                  </span>
                )}
              </nav>
            </>
          )}
        </article>
      </div>
    </div>
  );
}

function TypePanel({ prefs, onChange, theme }: { prefs: NovelReaderPrefs; onChange: (p: Partial<NovelReaderPrefs>) => void; theme: (typeof THEMES)[NovelTheme] }) {
  const Stepper = ({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) => (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs font-semibold" style={{ color: theme.muted }}>{label}</span>
      <div className="flex items-center gap-1">
        <button onClick={onMinus} className="grid h-8 w-8 place-items-center rounded-lg border transition hover:bg-black/10" style={{ borderColor: theme.rule }}><Minus size={14} /></button>
        <span className="w-12 text-center text-sm font-bold tabular-nums">{value}</span>
        <button onClick={onPlus} className="grid h-8 w-8 place-items-center rounded-lg border transition hover:bg-black/10" style={{ borderColor: theme.rule }}><Plus size={14} /></button>
      </div>
    </div>
  );
  return (
    <div className="absolute right-4 top-[70px] z-30 w-[300px] space-y-4 rounded-2xl border p-4 shadow-pop backdrop-blur-xl" style={{ background: theme.chrome, borderColor: theme.rule, color: theme.text }}>
      <div className="grid grid-cols-4 gap-1.5">
        {(Object.keys(THEMES) as NovelTheme[]).map((key) => (
          <button
            key={key}
            onClick={() => onChange({ theme: key })}
            className={`h-10 rounded-xl border text-[11px] font-bold transition ${prefs.theme === key ? "ring-2 ring-accent" : ""}`}
            style={{ background: THEMES[key].bg, color: THEMES[key].text, borderColor: THEMES[key].rule }}
          >
            {THEMES[key].label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {(["serif", "sans"] as const).map((font) => (
          <button
            key={font}
            onClick={() => onChange({ font })}
            className={`h-9 rounded-xl border text-sm transition ${prefs.font === font ? "ring-2 ring-accent" : ""}`}
            style={{ fontFamily: FONTS[font], borderColor: theme.rule }}
          >
            {font === "serif" ? "Serif" : "Sans"}
          </button>
        ))}
      </div>
      <Stepper label="Text size" value={`${prefs.size}`} onMinus={() => onChange({ size: Math.max(14, prefs.size - 1) })} onPlus={() => onChange({ size: Math.min(32, prefs.size + 1) })} />
      <Stepper label="Line spacing" value={prefs.leading.toFixed(2)} onMinus={() => onChange({ leading: Math.max(1.3, +(prefs.leading - 0.1).toFixed(2)) })} onPlus={() => onChange({ leading: Math.min(2.4, +(prefs.leading + 0.1).toFixed(2)) })} />
      <Stepper label="Column width" value={`${prefs.width}`} onMinus={() => onChange({ width: Math.max(44, prefs.width - 6) })} onPlus={() => onChange({ width: Math.min(110, prefs.width + 6) })} />
      <button onClick={() => onChange(NOVEL_READER_DEFAULTS)} className="w-full text-center text-xs font-semibold hover:underline" style={{ color: theme.muted }}>
        Reset to defaults
      </button>
    </div>
  );
}

function ChapterPanel({
  chapters,
  currentId,
  theme,
  onPick,
  onClose,
}: {
  chapters: NovelChapter[];
  currentId: string;
  theme: (typeof THEMES)[NovelTheme];
  onPick: (c: NovelChapter) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^(chapter|ch\.?)\s*/, "");
    return q ? chapters.filter((c) => c.label.toLowerCase().includes(q)) : chapters;
  }, [chapters, query]);
  // Only a window of rows around the current chapter is drawn; long lists stay quick.
  const currentIndex = shown.findIndex((c) => c.id === currentId);
  const [start, setStart] = useState(() => Math.max(0, currentIndex - 40));
  useEffect(() => { setStart(query ? 0 : Math.max(0, currentIndex - 40)); }, [query, currentIndex]);
  const windowed = shown.slice(start, start + 200);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[data-current]")?.scrollIntoView({ block: "center" });
  }, [start]);

  return (
    <div className="absolute bottom-4 right-4 top-[70px] z-30 flex w-[340px] flex-col rounded-2xl border shadow-pop backdrop-blur-xl" style={{ background: theme.chrome, borderColor: theme.rule, color: theme.text }}>
      <div className="flex items-center gap-2 border-b p-3" style={{ borderColor: theme.rule }}>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Find among ${chapters.length.toLocaleString()} chapters`}
          className="h-9 flex-1 rounded-lg border bg-transparent px-3 text-sm outline-none"
          style={{ borderColor: theme.rule }}
        />
        <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-black/10"><X size={16} /></button>
      </div>
      <div ref={list} className="thin-scrollbar flex-1 overflow-y-auto p-1.5">
        {start > 0 && (
          <button onClick={() => setStart(Math.max(0, start - 200))} className="w-full rounded-lg px-3 py-2 text-xs font-semibold hover:bg-black/10" style={{ color: theme.muted }}>
            Show earlier chapters
          </button>
        )}
        {windowed.map((c) => (
          <button
            key={c.id}
            data-current={c.id === currentId ? "" : undefined}
            onClick={() => onPick(c)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-black/10 ${c.id === currentId ? "bg-accent/20 font-bold" : ""}`}
          >
            <span className="w-10 shrink-0 text-right text-[11px] tabular-nums" style={{ color: theme.muted }}>{c.order + 1}</span>
            <span className="truncate">{c.label}</span>
          </button>
        ))}
        {start + 200 < shown.length && (
          <button onClick={() => setStart(start + 200)} className="w-full rounded-lg px-3 py-2 text-xs font-semibold hover:bg-black/10" style={{ color: theme.muted }}>
            Show later chapters
          </button>
        )}
      </div>
    </div>
  );
}
