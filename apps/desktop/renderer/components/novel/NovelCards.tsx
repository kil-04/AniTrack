import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookText, ChevronLeft, ChevronRight, Search, Star, X } from "lucide-react";
import { novelSourceLabel, type NovelCard as Card } from "../../../../../packages/shared/novel";
import { novelTitlePath, preferredNovelSource, searchNovels } from "../../lib/novel-api";

/** A novel's cover, or a typeset stand-in when the source has none (or it fails to load). */
export function NovelCover({ cover, title, className = "" }: { cover: string | null; title: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (cover && !broken) {
    return (
      <img
        src={cover}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={`h-full w-full object-cover ${className}`}
      />
    );
  }
  return (
    <div className="flex h-full w-full flex-col justify-between bg-[linear-gradient(160deg,rgb(var(--accent)/0.35),rgb(var(--surface-2))_60%)] p-3 pb-9">
      <BookText size={20} className="text-white/60" />
      <span className="line-clamp-4 font-serif text-[13px] font-semibold leading-snug text-white/85">{title}</span>
    </div>
  );
}

/** A novel cover card: art, status, rating, and an optional badge (e.g. "Ch 12"). */
export function NovelCard({ novel, badge, size, showSource }: { novel: Card; badge?: string | null; size?: "row"; showSource?: boolean }) {
  return (
    <Link to={novelTitlePath(novel.sourceId, novel.id)} className={`group block ${size === "row" ? "w-40 flex-shrink-0" : ""}`}>
      <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-surface-1 shadow-card ring-1 ring-white/[0.06] transition-all duration-300 ease-out group-hover:-translate-y-1.5 group-hover:shadow-glow-lg group-hover:ring-2 group-hover:ring-accent/70">
        <NovelCover cover={novel.cover} title={novel.title} className="transition duration-700 ease-out group-hover:scale-[1.07]" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 to-transparent" />
        {novel.status === "completed" && <span className="badge badge-glass absolute left-2 top-2">Complete</span>}
        {novel.mtl && <span className="badge badge-glass absolute left-2 top-2">MTL</span>}
        {novel.rating ? (
          <span className="badge badge-glass absolute right-2 top-2 gap-0.5">
            <Star size={10} className="fill-amber-300 text-amber-300" /> {novel.rating.toFixed(1)}
          </span>
        ) : null}
        {badge ? (
          <span className="badge badge-accent absolute bottom-2 left-2 normal-case tracking-normal">{badge}</span>
        ) : novel.chapters ? (
          <span className="badge badge-glass absolute bottom-2 left-2 normal-case tracking-normal">{novel.chapters.toLocaleString()} ch</span>
        ) : null}
      </div>
      <div className="mt-2.5 line-clamp-2 text-sm font-semibold leading-tight text-white/90 transition-colors group-hover:text-white">{novel.title}</div>
      <div className="mt-0.5 truncate text-xs text-ink-3">
        {showSource ? novelSourceLabel(novel.sourceId) : novel.genres.slice(0, 2).join(" · ")}
      </div>
    </Link>
  );
}

/** A titled horizontal row of novel cards with scroll buttons. */
export function NovelRow({ title, items, action }: { title: string; items: Card[]; action?: React.ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  if (!items.length) return null;
  const scroll = (direction: number) => scroller.current?.scrollBy({ left: direction * scroller.current.clientWidth * 0.85, behavior: "smooth" });
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between px-8">
        <h2 className="section-title">{title}</h2>
        {action}
      </div>
      <div className="group/row relative">
        <button onClick={() => scroll(-1)} aria-label="Scroll left" className="absolute left-2 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full glass shadow-pop transition hover:scale-105 group-hover/row:flex" aria-label="Scroll left">
          <ChevronLeft size={26} />
        </button>
        <div ref={scroller} className="no-scrollbar flex gap-4 overflow-x-auto px-8 pb-4 pt-2">
          {items.map((novel) => <NovelCard key={`${novel.sourceId}:${novel.id}`} novel={novel} size="row" />)}
        </div>
        <button onClick={() => scroll(1)} aria-label="Scroll right" className="absolute right-2 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full glass shadow-pop transition hover:scale-105 group-hover/row:flex" aria-label="Scroll right">
          <ChevronRight size={26} />
        </button>
      </div>
    </section>
  );
}

/** The top bar's search box in novels mode: live results from the preferred source, Enter for the full page. */
export function NovelSearchBox() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Card[]>([]);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    const onDown = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setFocused(false); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, []);

  useEffect(() => {
    const query = q.trim();
    if (!query) { setResults([]); return; }
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      searchNovels({ sourceId: preferredNovelSource(), query })
        .then((r) => { if (alive) setResults(r.page.items.filter((c) => !c.mtl).slice(0, 8)); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setLoading(false); });
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [q]);

  const viewAll = () => {
    navigate(`/novels/search?q=${encodeURIComponent(q.trim())}`);
    setFocused(false);
  };

  return (
    <div ref={box} className="titlebar-no-drag relative w-full">
      <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
      <input
        ref={input}
        value={q}
        onChange={(event) => setQ(event.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && q.trim()) viewAll();
          if (event.key === "Escape") { setFocused(false); input.current?.blur(); }
        }}
        placeholder="Search light novels and web novels"
        className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.05] pl-10 pr-20 text-sm text-white outline-none transition placeholder:text-ink-3 hover:bg-white/[0.07] focus:border-accent/50 focus:bg-surface-2 focus:ring-4 focus:ring-accent/15"
      />
      {!q && <span className="kbd pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">Ctrl K</span>}
      {q && (
        <button onClick={() => setQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-3 hover:text-white" aria-label="Clear">
          <X size={14} />
        </button>
      )}
      {focused && q.trim() && (
        <div className="absolute left-0 top-full z-[9999] mt-2 w-full overflow-hidden rounded-2xl border border-white/10 bg-surface-1/95 p-1.5 shadow-pop backdrop-blur-xl">
          {loading && !results.length ? (
            <div className="p-4 text-center text-sm text-muted">Searching…</div>
          ) : results.length ? (
            <>
              {results.map((novel) => (
                <Link
                  key={novel.id}
                  to={novelTitlePath(novel.sourceId, novel.id)}
                  onClick={() => setFocused(false)}
                  className="flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/[0.06]"
                >
                  <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg shadow-md ring-1 ring-white/10">
                    <NovelCover cover={novel.cover} title="" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{novel.title}</div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                      {[novel.status === "completed" ? "Complete" : novel.status === "ongoing" ? "Ongoing" : null, novel.chapters ? `${novel.chapters} ch` : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </Link>
              ))}
              <button onClick={viewAll} className="mt-1 flex w-full justify-between rounded-xl border-t border-white/[0.06] px-3 py-2 text-left text-xs font-semibold text-accent transition-colors hover:bg-accent/10">
                <span>View all results for "{q.trim()}"</span><span>→</span>
              </button>
            </>
          ) : (
            <div className="p-4 text-center text-sm text-muted">No novels found for "{q.trim()}"</div>
          )}
        </div>
      )}
    </div>
  );
}
