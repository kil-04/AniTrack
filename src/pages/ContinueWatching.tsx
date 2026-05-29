import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Clock, Play, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { secondsToTimestamp } from "../lib/format";

const PAGE_SIZE = 24;

function cwStreamUrl(session: string, title: string, episode: number, coverUrl?: string | null, animeId?: number): string {
  const p: Record<string, string> = { 
    session, 
    title, 
    episode: String(episode),
    ep: String(episode) 
  };
  if (coverUrl) {
    p.coverUrl = coverUrl;
    p.img = coverUrl;
  }
  if (animeId && animeId > 0) {
    p.animeId = String(animeId);
    p.anilistId = String(animeId);
  }
  return "/stream-player?" + new URLSearchParams(p).toString();
}

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
      .then(() => load(page))
      .catch(() => {});
  }

  return (
    <div className="pb-16 px-8 pt-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-2">
        <Clock size={18} className="text-[#4a9eff]" />
        <h1 className="text-xl font-bold">Continue Watching</h1>
        {total > 0 && (
          <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/50">{total}</span>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm text-white/30">Loading…</div>
      ) : items.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm text-white/30">
          Nothing here yet — start watching something!
        </div>
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
            <div className="mt-8 flex items-center justify-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1 || loading}
                className="flex h-8 w-8 items-center justify-center rounded text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                title="First page"
              >
                <ChevronsLeft size={14} />
              </button>
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 1 || loading}
                className="flex h-8 w-8 items-center justify-center rounded text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
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
                    <span key={`e-${i}`} className="px-1 text-xs text-white/30">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p as number)}
                      disabled={loading}
                      className={`flex h-8 min-w-[2rem] items-center justify-center rounded px-2 text-xs font-medium transition
                        ${page === p
                          ? "bg-[#4a9eff] text-white"
                          : "text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-40"}`}
                    >
                      {p}
                    </button>
                  ),
                )}

              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page === lastPage || loading}
                className="flex h-8 w-8 items-center justify-center rounded text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                title="Next page"
              >
                <ChevronRight size={14} />
              </button>
              <button
                onClick={() => setPage(lastPage)}
                disabled={page === lastPage || loading}
                className="flex h-8 w-8 items-center justify-center rounded text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
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

  const cwTo = item.animePaheSession
    ? cwStreamUrl(item.animePaheSession, item.anime.title, item.episode, item.anime.coverImage, item.anime.id)
    : item.filePath
    ? `/player/${item.anime.id}/${item.episode}`
    : { pathname: "/anime/" + item.anime.id, state: { anime: displayAnime } };

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
      className="fixed z-[9999] w-72 bg-[#15151f] rounded-xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.8)] p-5 flex flex-col pointer-events-none animate-in fade-in zoom-in-95 duration-200"
      style={{
        left: rect.right + 15 + 288 > window.innerWidth ? rect.left - 288 - 15 : rect.right + 15,
        top: Math.max(10, Math.min(window.innerHeight - 320, rect.top + rect.height / 2 - 160)),
      }}
    >
      <h3 className="font-bold text-[#4a9eff] text-lg leading-tight mb-2">{displayAnime.title}</h3>
      {displayAnime.averageScore && (
        <div className="text-sm font-bold text-green-400 mb-3">★ {(displayAnime.averageScore / 10).toFixed(1)} / 10</div>
      )}
      {(displayAnime.year || displayAnime.status || displayAnime.episodes || displayAnime.duration) && (
        <div className="flex flex-wrap gap-2 mb-3">
          {displayAnime.year && <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-bold">{displayAnime.year}</span>}
          {displayAnime.status && <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-bold">{displayAnime.status}</span>}
          {displayAnime.episodes && <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-bold">{displayAnime.episodes} EPS</span>}
          {displayAnime.duration && <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-bold">{displayAnime.duration}m</span>}
        </div>
      )}
      {displayAnime.genres && displayAnime.genres.length > 0 && (
        <div className="text-xs text-white/50 mb-3">{displayAnime.genres.join(", ")}</div>
      )}
      {displayAnime.synopsis ? (
        <p className="text-xs text-white/80 line-clamp-5 leading-relaxed" dangerouslySetInnerHTML={{ __html: displayAnime.synopsis }} />
      ) : isFetching ? (
        <p className="text-xs text-[#4a9eff] animate-pulse italic">Loading details from network...</p>
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
        className="absolute right-1.5 top-1.5 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition hover:bg-black/90 group-hover:opacity-100"
        title="Remove from Continue Watching"
      >
        <X size={12} />
      </button>

      <Link 
        to={cwTo} 
        ref={cardRef}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="block"
      >
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-white/5 transition duration-200 group-hover:scale-105 group-hover:ring-2 group-hover:ring-white/50">
          {displayAnime.coverImage ? (
            <img
              src={displayAnime.coverImage}
              alt={displayAnime.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-2xl font-bold text-white/20">
              {displayAnime.title.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

          <div className="absolute left-2 top-2 rounded bg-[#4a9eff] px-1.5 py-0.5 text-xs font-semibold text-white">
            EP {item.episode}
          </div>

          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
            <div className="rounded-full bg-white/90 p-3 text-black shadow-lg">
              <Play size={20} fill="currentColor" />
            </div>
          </div>

          <div className="absolute bottom-4 left-0 right-0 px-2 text-xs text-white/80">
            <div className="tabular-nums">
              {secondsToTimestamp(item.positionSec)} / {secondsToTimestamp(item.durationSec)}
            </div>
          </div>

          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
            <div
              className="h-full bg-[#4a9eff]"
              style={{ width: `${Math.min(100, item.percent)}%` }}
            />
          </div>
        </div>

        <div className="mt-2 line-clamp-2 text-xs font-medium leading-snug text-white/80">
          {item.anime.title}
        </div>
      </Link>
      {tooltipPortal}
    </div>
  );
}
