import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../store/useAppStore";
import Row from "../components/Row";
import Card from "../components/Card";
import { Link } from "react-router-dom";
import { Play, RefreshCw, Clock, Loader2, X, ChevronLeft, ChevronRight, ChevronsLeft } from "lucide-react";
import { secondsToTimestamp } from "../lib/format";
import LatestEpCard from "../components/LatestEpCard";
import ContinueWatchingCard from "../components/ContinueWatchingCard";
import DiscoverRow from "../components/DiscoverRow";
import Top10Sidebar from "../components/Top10Sidebar";
import { providerClient } from "../lib/provider-api";

export default function Home() {
  const trending = useAppStore((s) => s.trending);
  const latestEpisodes = useAppStore((s) => s.latestEpisodes);
  const latestLoading = useAppStore((s) => s.latestLoading);
  const latestPage = useAppStore((s) => s.latestPage);
  const latestHasNextPage = useAppStore((s) => s.latestHasNextPage);
  const refreshLatest = useAppStore((s) => s.refreshLatest);
  const refreshContinue = useAppStore((s) => s.refreshContinue);
  const refreshAll = useAppStore((s) => s.refreshAll);
  const cw = useAppStore((s) => s.continueWatching);
  const [cwRefreshing, setCwRefreshing] = useState(false);

  const trendingCards = useMemo(
    () => trending.map((a) => <Card key={a.id} anime={a} size="sm" />),
    [trending]
  );



  // Hero carousel state
  const [heroIndex, setHeroIndex] = useState(0);
  const heroItems = trending.slice(0, 5);

  useEffect(() => {
    if (heroItems.length <= 1) return;
    const timer = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % heroItems.length);
    }, 8000); // Rotate every 8 seconds
    return () => clearInterval(timer);
  }, [heroItems.length]);

  // Swipe/Drag gesture handlers for Hero Banner
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const lastSlideTime = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.targetTouches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.targetTouches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (!touchStartX.current || !touchEndX.current) return;
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 50;
    if (diff > threshold) {
      setHeroIndex((prev) => (prev + 1) % heroItems.length);
    } else if (diff < -threshold) {
      setHeroIndex((prev) => (prev - 1 + heroItems.length) % heroItems.length);
    }
    touchStartX.current = 0;
    touchEndX.current = 0;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    dragStartX.current = e.clientX;
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const diff = dragStartX.current - e.clientX;
    const threshold = 50;
    if (diff > threshold) {
      setHeroIndex((prev) => (prev + 1) % heroItems.length);
    } else if (diff < -threshold) {
      setHeroIndex((prev) => (prev - 1 + heroItems.length) % heroItems.length);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) < 15) return;
    const now = Date.now();
    if (now - lastSlideTime.current < 800) return;
    if (e.deltaX > 0) {
      setHeroIndex((prev) => (prev + 1) % heroItems.length);
      lastSlideTime.current = now;
    } else if (e.deltaX < 0) {
      setHeroIndex((prev) => (prev - 1 + heroItems.length) % heroItems.length);
      lastSlideTime.current = now;
    }
  };

  // Continue Watching scroll state
  const cwScrollRef = useRef<HTMLDivElement>(null);
  const [cwCanScrollLeft, setCwCanScrollLeft] = useState(false);
  const [cwCanScrollRight, setCwCanScrollRight] = useState(false);

  const updateCwScroll = useCallback(() => {
    const el = cwScrollRef.current;
    if (!el) return;
    setCwCanScrollLeft(el.scrollLeft > 4);
    setCwCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    updateCwScroll();
    
    // Recalculate after DOM layout settles
    const timer = setTimeout(updateCwScroll, 150);
    
    window.addEventListener("resize", updateCwScroll);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateCwScroll);
    };
  }, [cw, updateCwScroll]);

  const cwScroll = (dir: "left" | "right") => {
    const el = cwScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -480 : 480, behavior: "smooth" });
  };

  useEffect(() => {
    refreshContinue();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [paheEpTotals, setPaheEpTotals] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (cw.length === 0) return;

    const CACHE_KEY = "pahe-ep-totals";
    const CACHE_TTL = 60 * 60 * 1000; // 1 hour

    // Seed state from localStorage immediately so stale-but-fast data shows first.
    let stored: Record<string, { total: number; at: number }> = {};
    try { stored = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}"); } catch { /* ignore */ }
    const seedMap = new Map<string, number>();
    for (const [k, v] of Object.entries(stored)) seedMap.set(k, v.total);
    if (seedMap.size) setPaheEpTotals(new Map(seedMap));

    async function getLatestEpNumber(providerId: string, animeId: string): Promise<number> {
      const first = await providerClient.episodes(providerId, animeId, 1);
      const lastPage = first.lastPage ?? 1;
      const last = lastPage > 1
        ? await providerClient.episodes(providerId, animeId, lastPage)
        : first;
      const nums = (last.data as any[]).map((e) => e.episodeNumber ?? e.episode).filter(Number.isFinite);
      return nums.length ? Math.max(...nums) : first.total;
    }

    const now = Date.now();
    const fetches = cw.map(async (item) => {
      const key = item.animePaheSession ?? item.anime.title;
      // Skip if cached value is fresh.
      if (stored[key] && now - stored[key].at < CACHE_TTL) return null;

      if (item.animePaheSession) {
        // AnimePahe sessions are UUIDs; Anikoto IDs are slugs (both contain
        // dashes, so a full UUID test is required to tell them apart).
        const isUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(item.animePaheSession);
        const providerId = item.providerId ?? (isUuid ? "animepahe" : "anikoto");
        const total = await getLatestEpNumber(providerId, item.animePaheSession);
        return { key, total };
      }
      const title = item.anime.title;
      const results = await providerClient.search(title);
      if (!results.length) return null;
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const exact = results.find((r: any) => norm(r.title) === norm(title));
      const best = exact ?? results[0];
      const legacyBest = best as { providerId?: string; id?: string; session?: string };
      const animeId = legacyBest.id ?? legacyBest.session;
      if (!animeId) return null;
      const total = await getLatestEpNumber(legacyBest.providerId ?? "animepahe", animeId);
      return { key, total };
    });

    Promise.allSettled(fetches).then((results) => {
      const updates: Record<string, { total: number; at: number }> = { ...stored };
      let changed = false;
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          updates[r.value.key] = { total: r.value.total, at: now };
          changed = true;
        }
      }
      if (!changed) return;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(updates)); } catch { /* ignore */ }
      const map = new Map<string, number>();
      for (const [k, v] of Object.entries(updates)) map.set(k, v.total);
      setPaheEpTotals(map);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cw]);

  const cwCards = useMemo(
    () => cw.map((item) => (
      <ContinueWatchingCard 
        key={String(item.anime.id) + "-" + item.episode} 
        item={item} 
        paheEpTotals={paheEpTotals} 
        refreshContinue={refreshContinue} 
      />
    )),
    [cw, paheEpTotals, refreshContinue]
  );

  const latestCards = useMemo(
    () => latestEpisodes.map((ep: any) => (
      <LatestEpCard key={ep.id} ep={ep} />
    )),
    [latestEpisodes]
  );

  return (
    <div className="pb-16 bg-[#000000] min-h-screen">
      
      {/* Massive Hero Section (Top 10 Carousel) */}
      {heroItems.length > 0 && (
        <div 
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onDragStart={(e) => e.preventDefault()}
          className="relative w-full h-[65vh] min-h-[480px] max-h-[700px] mb-12 flex shrink-0 group overflow-hidden bg-[#000000] cursor-grab active:cursor-grabbing select-none"
        >
          {heroItems.map((anime, idx) => (
            <div 
              key={anime.id} 
              className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${idx === heroIndex ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}
            >
              <div className="absolute inset-0">
                <img draggable="false" src={anime.bannerImage || anime.coverImage || undefined} className={`w-full h-full object-cover transition-transform duration-[20s] ${idx === heroIndex ? 'scale-110' : 'scale-100'}`} />
                <div className="absolute inset-0 bg-gradient-to-t from-[#000000] via-[#000000]/60 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-[#000000] via-[#000000]/60 to-transparent" />
              </div>
              <div className="relative z-10 flex flex-col justify-end p-6 sm:p-12 pb-12 sm:pb-16 h-full max-w-4xl">
                <div className="text-white font-bold text-xs sm:text-sm tracking-[0.2em] uppercase mb-2 sm:mb-4 drop-shadow-md">
                  #{idx + 1} Trending Today
                </div>
                <h1 className="text-3xl sm:text-5xl md:text-6xl font-black text-white leading-[1.1] mb-3 sm:mb-4 drop-shadow-lg line-clamp-2">
                  {anime.title}
                </h1>
                <div className="flex items-center gap-4 text-xs sm:text-sm font-semibold text-white/90 mb-4">
                  <span className="bg-white/10 px-2 py-0.5 rounded shadow-sm border border-white/10">{anime.year || '2024'}</span>
                  <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"/> {anime.status || 'Airing'}</span>
                  <span>{anime.episodes ? anime.episodes + ' Episodes' : 'Ongoing'}</span>
                </div>
                <div className="text-white/70 line-clamp-2 sm:line-clamp-3 mb-6 text-xs sm:text-sm md:text-base max-w-2xl leading-relaxed drop-shadow-md" dangerouslySetInnerHTML={{ __html: anime.synopsis || '' }} />
                <div className="flex items-center gap-4">
                  <Link to={`/anime/${anime.id}`} state={{ anime }} className="flex items-center gap-2 bg-white text-black px-8 sm:px-10 py-3 sm:py-4 rounded-full font-bold text-base sm:text-lg hover:scale-105 hover:bg-gray-200 transition-all shadow-[0_0_40px_rgba(255,255,255,0.4)]">
                    <Play size={20} fill="currentColor" /> Play Now
                  </Link>
                </div>
              </div>
            </div>
          ))}

          {/* Carousel Indicators */}
          <div className="absolute bottom-6 left-12 z-20 flex items-center gap-2">
            {heroItems.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setHeroIndex(idx)}
                className={`h-1.5 rounded-full transition-all duration-300 ${idx === heroIndex ? 'w-8 bg-[#e50914] shadow-[0_0_10px_rgba(229, 9, 20,0.8)]' : 'w-2 bg-white/30 hover:bg-white/60'}`}
                aria-label={`Go to slide ${idx + 1}`}
              />
            ))}
          </div>

          {/* Carousel Controls */}
          <button 
            onClick={() => setHeroIndex((prev) => (prev - 1 + heroItems.length) % heroItems.length)}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-black/40 text-white/80 hover:bg-black/70 hover:text-white hover:scale-110 shadow-lg border border-white/10 transition-all backdrop-blur-md"
            aria-label="Previous slide"
          >
            <ChevronLeft size={28} />
          </button>
          <button 
            onClick={() => setHeroIndex((prev) => (prev + 1) % heroItems.length)}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-black/40 text-white/80 hover:bg-black/70 hover:text-white hover:scale-110 shadow-lg border border-white/10 transition-all backdrop-blur-md"
            aria-label="Next slide"
          >
            <ChevronRight size={28} />
          </button>
        </div>
      )}

      {/* Continue Watching */}
      {cw.length > 0 && (
        <section className="mb-14">
          <div className="mb-5 flex items-center justify-between px-12">
            <div className="flex items-center gap-3">
              <Clock size={20} className="text-white" />
              <Link
                to="/continue-watching"
                className="group flex items-center gap-2 text-2xl font-bold hover:text-white transition-colors"
              >
                Continue Watching
                <ChevronRight size={20} className="opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
              </Link>
            </div>
            <button
              onClick={async () => { setCwRefreshing(true); await refreshAll(); setCwRefreshing(false); }}
              disabled={cwRefreshing}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-40 transition"
            >
              <RefreshCw size={12} className={cwRefreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
          <div className="relative group/cwrow">
            {cwCanScrollLeft && (
              <button
                onClick={() => cwScroll("left")}
                className="absolute left-0 top-0 bottom-2 z-10 flex w-14 items-center justify-start pl-2
                           bg-gradient-to-r from-[#000000] to-transparent
                           opacity-0 group-hover/cwrow:opacity-100 transition-opacity"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition">
                  <ChevronLeft size={16} />
                </div>
              </button>
            )}
            {cwCanScrollRight && (
              <button
                onClick={() => cwScroll("right")}
                className="absolute right-0 top-0 bottom-2 z-10 flex w-14 items-center justify-end pr-2
                           bg-gradient-to-l from-[#000000] to-transparent
                           opacity-0 group-hover/cwrow:opacity-100 transition-opacity"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition">
                  <ChevronRight size={16} />
                </div>
              </button>
            )}
            <div
              ref={cwScrollRef}
              onScroll={updateCwScroll}
              className="no-scrollbar flex gap-5 overflow-x-auto scroll-smooth px-12 pb-6 pt-2"
            >
              {cwCards}
            </div>
          </div>
        </section>
      )}

      {/* Latest Episodes */}
      <section className="mb-14 px-12">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-2xl font-bold">Latest Episodes</h2>
          <button
            onClick={() => refreshLatest(latestPage)}
            disabled={latestLoading}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-40 transition"
          >
            <RefreshCw size={12} className={latestLoading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {latestLoading && latestEpisodes.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-white/30">
            <Loader2 size={24} className="animate-spin mr-2" />
            <span className="text-sm">Loading latest episodes…</span>
          </div>
        ) : latestEpisodes.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-white/30">
            No episodes loaded — click Refresh
          </div>
        ) : (
          <>
            <div className={`grid grid-cols-6 gap-3 xl:grid-cols-6 lg:grid-cols-5 md:grid-cols-4 transition-opacity ${latestLoading ? "opacity-40 pointer-events-none" : ""}`}>
              {latestCards}
            </div>

            {(latestPage > 1 || latestHasNextPage) && (
              <div className="mt-5 flex items-center justify-center gap-1">
                <button
                  onClick={() => refreshLatest(1)}
                  disabled={latestPage === 1 || latestLoading}
                  className="flex h-8 w-8 items-center justify-center rounded text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                  title="First page"
                >
                  <ChevronsLeft size={14} />
                </button>
                <button
                  onClick={() => refreshLatest(latestPage - 1)}
                  disabled={latestPage === 1 || latestLoading}
                  className="flex h-8 w-8 items-center justify-center rounded text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                  title="Previous page"
                >
                  <ChevronLeft size={14} />
                </button>

                <span className="flex h-8 min-w-[5rem] items-center justify-center rounded bg-white text-xs font-medium text-black">
                  Page {latestPage}
                </span>

                <button
                  onClick={() => refreshLatest(latestPage + 1)}
                  disabled={!latestHasNextPage || latestLoading}
                  className="flex h-8 w-8 items-center justify-center rounded text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                  title="Next page"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Discovery sections + Top 10 sidebar (Anikoto-style) */}
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          {trendingCards.length > 0 && (
            <Row title="Trending now">
              {trendingCards}
            </Row>
          )}
          <DiscoverRow title="Top Airing" filters={{ status: "RELEASING", sort: "POPULARITY_DESC" }} />
          <DiscoverRow title="Most Popular" filters={{ sort: "POPULARITY_DESC" }} />
          <DiscoverRow title="Top Movies" filters={{ format: "MOVIE", sort: "POPULARITY_DESC" }} />
          <DiscoverRow title="Highest Rated" filters={{ sort: "SCORE_DESC" }} />
        </div>
        <aside className="hidden w-[330px] shrink-0 pr-8 pt-9 md:block">
          <div className="sticky top-4">
            <Top10Sidebar />
          </div>
        </aside>
      </div>

    </div>
  );
}
