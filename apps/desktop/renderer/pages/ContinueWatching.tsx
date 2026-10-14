import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { History, Play, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { secondsToTimestamp } from "../lib/format";
import { deleteAnimeProgress } from "../lib/supabase-sync";
import { cwResumeUrl } from "../components/ContinueWatchingCard";

const PAGE_SIZE = 24;

export default function ContinueWatching() {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const result = await window.api.list.continueWatchingPaged(p, PAGE_SIZE);
      setItems(result.items);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(page); }, [page, load]);

  function dismiss(animeId: number) {
    window.api.list.dismissContinueWatching(animeId)
      .then(() => { deleteAnimeProgress(animeId); load(page); })
      .catch(() => {});
  }

  return (
    <div className="mx-auto max-w-[1680px] px-8 pb-16 pt-8">
      <PageHeader
        icon={History}
        title="Continue Watching"
        subtitle={total > 0 ? `${total} show${total === 1 ? "" : "s"} in progress` : "Pick up right where you left off"}
      />

      {loading && items.length === 0 ? (
        <div className="grid grid-cols-4 gap-5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8">
          {Array.from({ length: 16 }, (_, i) => (
            <div key={i} className="skeleton aspect-[2/3] rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Play}
          title="Nothing to resume"
          action={<Link to="/" className="btn btn-primary">Browse anime</Link>}
        >
          Start an episode and it shows up here, on this device and your others.
        </EmptyState>
      ) : (
        <>
          <div className={`grid grid-cols-4 gap-5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 transition-opacity ${loading ? "opacity-40 pointer-events-none" : ""}`}>
            {items.map((item) => (
              <ContinueWatchingPageCard 
                key={String(item.anime.id) + "-" + item.episode} 
                item={item} 
                dismiss={dismiss} 
              />
            ))}
          </div>

          {/* Pagination */}
          {lastPage > 1 && (
            <div className="mt-10 flex items-center justify-center gap-1.5">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1 || loading}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-3 transition hover:bg-white/[0.07] hover:text-white disabled:pointer-events-none disabled:opacity-30"
                title="First page"
              >
                <ChevronsLeft size={14} />
              </button>
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 1 || loading}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-3 transition hover:bg-white/[0.07] hover:text-white disabled:pointer-events-none disabled:opacity-30"
                title="Previous page"
              >
                <ChevronLeft size={14} />
              </button>

              {Array.from({ length: lastPage }, (_, i) => i + 1)
                .filter((p) => Math.abs(p - page) <= 2 || p === 1 || p === lastPage)
                .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === "…" ? (
                    <span key={`e-${i}`} className="px-1 text-xs text-ink-3">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p as number)}
                      disabled={loading}
                      className={`flex h-9 min-w-[2.25rem] items-center justify-center rounded-xl px-2 text-xs font-semibold tabular-nums transition
                        ${page === p
                          ? "bg-accent-gradient text-white shadow-glow"
                          : "text-ink-2 hover:bg-white/[0.07] hover:text-white disabled:opacity-40"}`}
                    >
                      {p}
                    </button>
                  ),
                )}

              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page === lastPage || loading}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-3 transition hover:bg-white/[0.07] hover:text-white disabled:pointer-events-none disabled:opacity-30"
                title="Next page"
              >
                <ChevronRight size={14} />
              </button>
              <button
                onClick={() => setPage(lastPage)}
                disabled={page === lastPage || loading}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-3 transition hover:bg-white/[0.07] hover:text-white disabled:pointer-events-none disabled:opacity-30"
                title="Last page"
              >
                <ChevronsRight size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ContinueWatchingPageCard({ item, dismiss }: { item: any, dismiss: (id: number) => void }) {
  const [isHovered, setIsHovered] = useState(false);
  const [fetchedMeta, setFetchedMeta] = useState<any>(null);
  const [isFetching, setIsFetching] = useState(false);
  const displayAnime = fetchedMeta || item.anime;

  // Continue Watching always resumes playback (download or stream) — never the
  // title page; the player resolves the provider if we don't have a session.
  const goesToDetail = false;
  const cwTo = cwResumeUrl(item);

  const cardRef = useRef<HTMLAnchorElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (isHovered && cardRef.current) {
      setRect(cardRef.current.getBoundingClientRect());
    }
  }, [isHovered]);

  useEffect(() => {
    const missingData = !item.anime.synopsis || !item.anime.coverImage;
    if ((missingData || isHovered) && !fetchedMeta && !isFetching) {
      setIsFetching(true);
      if (item.anime.id > 0 && item.anime.id < 1000000000) {
        window.api.anilist.get(item.anime.id).then((meta: any) => {
          if (meta) setFetchedMeta(meta);
          setIsFetching(false);
        }).catch(() => setIsFetching(false));
      } else if (item.anime.title) {
        window.api.anilist.search(item.anime.title).then((results: any) => {
           if (results && results.length > 0) {
             return window.api.anilist.get(results[0].id);
           }
           throw new Error("Not found");
        }).then((meta: any) => {
           if (meta) setFetchedMeta(meta);
           setIsFetching(false);
        }).catch(() => setIsFetching(false));
      } else {
        setIsFetching(false);
      }
    }
  }, [isHovered, item.anime.id, item.anime.title, item.anime.synopsis, item.anime.coverImage, fetchedMeta, isFetching]);

  const tooltipPortal = isHovered && rect ? createPortal(
    <div 
      className="pointer-events-none fixed z-[9999] flex w-72 flex-col rounded-2xl border border-white/10 bg-surface-1/95 p-5 shadow-pop backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200"
      style={{
        left: rect.right + 15 + 288 > window.innerWidth ? rect.left - 288 - 15 : rect.right + 15,
        top: Math.max(10, Math.min(window.innerHeight - 320, rect.top + rect.height / 2 - 160)),
      }}
    >
      <h3 className="font-bold text-white text-lg leading-tight mb-2">{displayAnime.title}</h3>
      {displayAnime.averageScore && (
        <div className="mb-3 text-sm font-bold text-amber-300">★ {(displayAnime.averageScore / 10).toFixed(1)} / 10</div>
      )}
      {(displayAnime.year || displayAnime.status || displayAnime.episodes || displayAnime.duration) && (
        <div className="flex flex-wrap gap-2 mb-3">
          {displayAnime.year && <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-bold text-ink-2">{displayAnime.year}</span>}
          {displayAnime.status && <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-bold text-ink-2">{displayAnime.status}</span>}
          {displayAnime.episodes && <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-bold text-ink-2">{displayAnime.episodes} EPS</span>}
          {displayAnime.duration && <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-bold text-ink-2">{displayAnime.duration}m</span>}
        </div>
      )}
      {displayAnime.genres && displayAnime.genres.length > 0 && (
        <div className="text-xs text-white/50 mb-3">{displayAnime.genres.join(", ")}</div>
      )}
      {displayAnime.synopsis ? (
        <p className="text-xs text-white/80 line-clamp-5 leading-relaxed" dangerouslySetInnerHTML={{ __html: displayAnime.synopsis }} />
      ) : isFetching ? (
        <p className="text-xs text-white animate-pulse italic">Loading details from network...</p>
      ) : (
        <p className="text-xs text-white/40 italic">No synopsis available.</p>
      )}
    </div>,
    document.body
  ) : null;

  return (
    <div className="group relative w-full">
      <button
        onClick={() => dismiss(item.anime.id)}
        className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white/80 opacity-0 backdrop-blur-md transition hover:scale-110 hover:bg-red-500 hover:text-white group-hover:opacity-100"
        title="Remove from Continue Watching"
      >
        <X size={12} />
      </button>

      <Link
        to={cwTo}
        state={goesToDetail ? { anime: displayAnime } : undefined}
        ref={cardRef}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="block"
      >
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl bg-surface-1 shadow-card ring-1 ring-white/[0.06] transition-all duration-300 ease-out group-hover:-translate-y-1.5 group-hover:shadow-glow-lg group-hover:ring-2 group-hover:ring-accent/70">
          {displayAnime.coverImage ? (
            <img
              src={displayAnime.coverImage}
              alt={displayAnime.title}
              className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.07]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-2xl font-bold text-white/20">
              {displayAnime.title.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/25 to-transparent" />

          <div className="badge badge-accent absolute left-2 top-2">
            EP {item.episode}
          </div>

          <div className="absolute inset-0 flex scale-90 items-center justify-center opacity-0 transition-all duration-300 group-hover:scale-100 group-hover:opacity-100">
            <div className="rounded-full bg-accent-gradient p-3 text-white shadow-glow-lg ring-1 ring-white/30">
              <Play size={20} fill="currentColor" className="ml-0.5" />
            </div>
          </div>

          <div className="absolute bottom-3 left-0 right-0 px-2.5 text-[11px] font-medium text-white/80">
            <div className="tabular-nums">
              {secondsToTimestamp(item.positionSec)} / {secondsToTimestamp(item.durationSec)}
            </div>
          </div>

          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/15">
            <div
              className="h-full rounded-r-full bg-accent-gradient shadow-[0_0_12px_rgb(var(--accent)/0.85)]"
              style={{ width: `${Math.min(100, item.percent)}%` }}
            />
          </div>
        </div>

        <div className="mt-2.5 line-clamp-2 text-[13px] font-semibold leading-snug text-white/85 transition-colors group-hover:text-white">
          {item.anime.title}
        </div>
      </Link>
      {tooltipPortal}
    </div>
  );
}
