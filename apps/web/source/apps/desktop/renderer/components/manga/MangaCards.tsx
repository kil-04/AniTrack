import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Search, Star, X } from "lucide-react";
import { mangaKind, type MangaMeta } from "../../../../../packages/shared/manga";
import { mangaApi } from "../../lib/manga-api";

/** A manga cover card: art, kind and year, score, and an optional badge (e.g. "Ch 12"). */
export function MangaCard({ manga, badge, size }: { manga: Pick<MangaMeta, "id" | "title" | "cover" | "format" | "country" | "year" | "score">; badge?: string | null; size?: "row" }) {
  const kind = mangaKind(manga);
  return (
    <Link
      to={`/manga/${manga.id}`}
      className={`group block ${size === "row" ? "w-40 flex-shrink-0" : ""}`}
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-surface-1 shadow-card ring-1 ring-white/[0.06] transition-all duration-300 ease-out group-hover:-translate-y-1.5 group-hover:shadow-glow-lg group-hover:ring-2 group-hover:ring-accent/70">
        {manga.cover && (
          <img src={manga.cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.07]" />
        )}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 to-transparent" />
        {kind && <span className="badge badge-glass absolute left-2 top-2">{kind}</span>}
        {manga.score ? (
          <span className="badge badge-glass absolute right-2 top-2 gap-0.5">
            <Star size={10} className="fill-amber-300 text-amber-300" /> {(manga.score / 10).toFixed(1)}
          </span>
        ) : null}
        {badge && <span className="badge badge-accent absolute bottom-2 left-2">{badge}</span>}
      </div>
      <div className="mt-2.5 line-clamp-2 text-sm font-semibold leading-tight text-white/90 transition-colors group-hover:text-white">{manga.title}</div>
      {manga.year && <div className="mt-0.5 text-xs text-ink-3">{manga.year}</div>}
    </Link>
  );
}

/** A titled horizontal row of manga cards with scroll buttons. */
export function MangaRow({ title, items, action }: { title: string; items: MangaMeta[]; action?: React.ReactNode }) {
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
        <button onClick={() => scroll(-1)} className="absolute left-2 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full glass shadow-pop transition hover:scale-105 group-hover/row:flex" aria-label="Scroll left">
          <ChevronLeft size={26} />
        </button>
        <div ref={scroller} className="no-scrollbar flex gap-4 overflow-x-auto px-8 pb-4 pt-2">
          {items.map((manga) => <MangaCard key={manga.id} manga={manga} size="row" />)}
        </div>
        <button onClick={() => scroll(1)} className="absolute right-2 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full glass shadow-pop transition hover:scale-105 group-hover/row:flex" aria-label="Scroll right">
          <ChevronRight size={26} />
        </button>
      </div>
    </section>
  );
}

/** The top bar's search box in manga mode: live results, Enter for the full search page. */
export function MangaSearchBox() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MangaMeta[]>([]);
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
    const timer = setTimeout(() => {
      setLoading(true);
      mangaApi().search({ query }).then((page) => setResults(page.items.slice(0, 8))).catch(() => {}).finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const viewAll = () => {
    navigate(`/manga/search?q=${encodeURIComponent(q.trim())}`);
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
        placeholder="Search manga, manhwa, manhua"
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
              {results.map((manga) => (
                <Link key={manga.id} to={`/manga/${manga.id}`} onClick={() => setFocused(false)} className="flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/[0.06]">
                  {manga.cover ? <img src={manga.cover} alt="" className="h-14 w-10 rounded-lg object-cover shadow-md ring-1 ring-white/10" /> : <div className="h-14 w-10 rounded-lg bg-white/5" />}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{manga.title}</div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                      {[mangaKind(manga), manga.year].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </Link>
              ))}
              <button onClick={viewAll} className="mt-1 flex w-full justify-between rounded-xl border-t border-white/[0.06] px-3 py-2 text-left text-xs font-semibold text-accent transition-colors hover:bg-accent/10">
                <span>View all results for "{q.trim()}"</span><span>→</span>
              </button>
            </>
          ) : (
            <div className="p-4 text-center text-sm text-muted">No manga found for "{q.trim()}"</div>
          )}
        </div>
      )}
    </div>
  );
}
