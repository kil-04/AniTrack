import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../store/useAppStore";
import Row from "../components/Row";
import Card from "../components/Card";
import { Link } from "react-router-dom";
import { Play, RefreshCw, Clock, X, ChevronLeft, ChevronRight, Flame, Info, Star, Sparkles } from "lucide-react";
import SectionHeader from "../components/SectionHeader";
import { animeStatusLabel, secondsToTimestamp } from "../lib/format";
import LatestEpCard from "../components/LatestEpCard";
import ContinueWatchingCard from "../components/ContinueWatchingCard";
import DiscoverRow from "../components/DiscoverRow";
import Top10Sidebar from "../components/Top10Sidebar";
import RecommendationCard from "../components/RecommendationCard";
import { ThemeRadioButton } from "../components/ThemeSongs";
import { providerClient } from "../lib/provider-api";
import { rejectOversizedImage, safeImageSrc } from "../lib/image-guard";
import { useSkin } from "../lib/skin";
import { PixelSprite } from "../components/PixelSprite";
import { PixelInterlude } from "../components/PixelScene";

export default function Home() {
  const pixel = useSkin() === "pixel";
  const trending = useAppStore((s) => s.trending);
  const recommendations = useAppStore((s) => s.recommendations);
  const latestEpisodes = useAppStore((s) => s.latestEpisodes);
  const latestLoading = useAppStore((s) => s.latestLoading);
  const refreshLatest = useAppStore((s) => s.refreshLatest);
  const refreshContinue = useAppStore((s) => s.refreshContinue);
  const refreshAll = useAppStore((s) => s.refreshAll);
  const cw = useAppStore((s) => s.continueWatching);
  const [cwRefreshing, setCwRefreshing] = useState(false);

  const trendingCards = useMemo(
    () => trending.map((a) => <Card key={a.id} anime={a} size="sm" />),
    [trending]
  );

  const recommendationCards = useMemo(
    () => recommendations.map((recommendation) => (
      <RecommendationCard key={recommendation.anime.id} recommendation={recommendation} />
    )),
    [recommendations],
  );



  // Hero carousel state
  const [heroIndex, setHeroIndex] = useState(0);
  const heroItems = trending.slice(0, 5);

  useEffect(() => {
    if (heroItems.length <= 1) return;
    // Each slide gets its full 8 s, also after a manual change.
    const timer = setTimeout(() => {
      setHeroIndex((prev) => (prev + 1) % heroItems.length);
    }, 8000);
    return () => clearTimeout(timer);
  }, [heroItems.length, heroIndex]);

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
    () => latestEpisodes.map((ep) => (
      <LatestEpCard key={`${ep.anime.id}:${ep.episode}`} ep={ep} className="w-[264px] shrink-0" />
    )),
    [latestEpisodes]
  );

  return (
    <div className="min-h-screen pb-16">

      {/* Hero: the day's top 5, as an inset cinematic card */}
      {heroItems.length > 0 && (
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onDragStart={(e) => e.preventDefault()}
          className="group relative mx-8 mb-12 mt-6 h-[min(64vh,600px)] min-h-[440px] shrink-0 cursor-grab select-none overflow-hidden rounded-[28px] bg-surface-1 shadow-pop ring-1 ring-white/[0.07] active:cursor-grabbing"
        >
          {heroItems.map((anime, idx) => (
            <div
              key={anime.id}
              className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${idx === heroIndex ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}
            >
              <img
                draggable="false"
                alt=""
                src={
                  idx === heroIndex ||
                  idx === (heroIndex + 1) % heroItems.length ||
                  idx === (heroIndex - 1 + heroItems.length) % heroItems.length
                    ? safeImageSrc(anime.bannerImage, anime.coverImage)
                    : undefined
                }
                loading={idx === heroIndex ? "eager" : "lazy"}
                decoding="async"
                fetchPriority={idx === heroIndex ? "high" : "low"}
                onLoad={(event) => rejectOversizedImage(event, anime.coverImage)}
                className={`hero-art absolute inset-0 h-full w-full object-cover transition-transform duration-[9000ms] ease-out ${idx === heroIndex ? 'scale-[1.06]' : 'scale-100'}`}
              />
              {/* Pixel mode: the art turns to pixels (index.css) under a CRT screen. */}
              <div className="pixel-screen absolute inset-0" aria-hidden="true"><span className="pixel-roll" /></div>
              <div className="absolute inset-0 bg-scrim-l" />
              <div className="absolute inset-0 bg-scrim-b" />
              <div className="absolute inset-0 bg-[radial-gradient(70%_65%_at_0%_100%,rgb(var(--accent)/0.24),transparent_70%)]" />
              <div className="relative z-10 flex h-full max-w-[700px] flex-col justify-end p-10 pb-12 xl:p-14">
                <div className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/30 bg-accent/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-accent backdrop-blur-md">
                  <Flame size={13} strokeWidth={2.4} /> #{idx + 1} Trending today
                </div>
                <h1 className="mb-4 line-clamp-2 text-[40px] font-extrabold leading-[1.04] tracking-tight text-white drop-shadow-[0_4px_24px_rgb(0_0_0/0.6)] xl:text-[52px]">
                  {anime.title}
                </h1>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  {anime.averageScore != null && (
                    <span className="chip border-amber-300/25 bg-amber-300/10 text-amber-200">
                      <Star size={12} fill="currentColor" /> {(anime.averageScore / 10).toFixed(1)}
                    </span>
                  )}
                  {anime.year && <span className="chip">{anime.year}</span>}
                  {anime.format && <span className="chip">{anime.format.replace("_", " ")}</span>}
                  {!!anime.episodes && <span className="chip">{anime.episodes} episodes</span>}
                  <span className="chip">
                    <span className={`h-1.5 w-1.5 rounded-full ${anime.status === "RELEASING" ? "bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153)]" : "bg-white/40"}`} />
                    {animeStatusLabel(anime.status)}
                  </span>
                </div>
                {!!anime.genres?.length && (
                  <div className="mb-3 text-sm font-medium text-ink-2">{anime.genres.slice(0, 4).join("  ·  ")}</div>
                )}
                <div className="mb-7 line-clamp-3 max-w-[600px] text-[15px] leading-relaxed text-white/70" dangerouslySetInnerHTML={{ __html: anime.synopsis || '' }} />
                <div className="flex items-center gap-3">
                  <Link to={`/anime/${anime.id}`} state={{ anime }} className="btn btn-primary btn-lg">
                    <Play size={18} fill="currentColor" /> Watch now
                  </Link>
                  <Link to={`/anime/${anime.id}`} state={{ anime }} className="btn btn-secondary btn-lg">
                    <Info size={18} /> Details
                  </Link>
                </div>
              </div>
            </div>
          ))}

          {/* Slide rail: the thumbnails double as indicators; the active one shows the countdown */}
          <div className="absolute bottom-8 right-8 z-20 hidden items-center gap-2.5 lg:flex">
            <button
              onClick={() => setHeroIndex((prev) => (prev - 1 + heroItems.length) % heroItems.length)}
              className="btn btn-secondary btn-icon h-10 w-10 rounded-full"
              aria-label="Previous slide"
            >
              <ChevronLeft size={18} />
            </button>
            {heroItems.map((anime, idx) => (
              <button
                key={anime.id}
                onClick={() => setHeroIndex(idx)}
                aria-label={`Show ${anime.title}`}
                className={`relative h-[58px] shrink-0 overflow-hidden rounded-xl transition-all duration-500 ${idx === heroIndex ? 'w-[124px] ring-2 ring-accent shadow-glow' : 'w-[72px] opacity-55 ring-1 ring-white/15 hover:opacity-100'}`}
              >
                <img
                  draggable="false"
                  alt=""
                  src={safeImageSrc(anime.bannerImage, anime.coverImage)}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                {idx === heroIndex && (
                  <span key={heroIndex} className="absolute bottom-0 left-0 h-[3px] bg-accent-gradient animate-[heroProgress_8s_linear_forwards]" />
                )}
              </button>
            ))}
            <button
              onClick={() => setHeroIndex((prev) => (prev + 1) % heroItems.length)}
              className="btn btn-secondary btn-icon h-10 w-10 rounded-full"
              aria-label="Next slide"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          {/* Narrow windows: compact bars */}
          <div className="absolute right-6 top-6 z-20 flex items-center gap-1.5 lg:hidden">
            {heroItems.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setHeroIndex(idx)}
                className={`h-1.5 rounded-full transition-all duration-300 ${idx === heroIndex ? 'w-7 bg-accent shadow-glow' : 'w-2 bg-white/35 hover:bg-white/70'}`}
                aria-label={`Go to slide ${idx + 1}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Continue Watching */}
      {cw.length > 0 && (
        <section className="mb-12">
          <SectionHeader icon={Clock} title="Continue Watching" to="/continue-watching" className="px-8">
            <ThemeRadioButton />
            <button
              onClick={async () => { setCwRefreshing(true); await refreshAll(); setCwRefreshing(false); }}
              disabled={cwRefreshing}
              className="btn btn-ghost btn-sm"
            >
              <RefreshCw size={13} className={cwRefreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </SectionHeader>
          <div className="relative group/cwrow">
            {cwCanScrollLeft && (
              <button
                onClick={() => cwScroll("left")}
                className="absolute left-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full glass shadow-pop opacity-0 transition hover:scale-105 group-hover/cwrow:opacity-100"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            {cwCanScrollRight && (
              <button
                onClick={() => cwScroll("right")}
                className="absolute right-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full glass shadow-pop opacity-0 transition hover:scale-105 group-hover/cwrow:opacity-100"
              >
                <ChevronRight size={18} />
              </button>
            )}
            <div
              ref={cwScrollRef}
              onScroll={updateCwScroll}
              className="no-scrollbar flex gap-5 overflow-x-auto scroll-smooth px-8 pb-6 pt-2"
            >
              {cwCards}
            </div>
          </div>
        </section>
      )}

      {/* Latest Episodes: one row, as on the tablet; the full list is on /latest. */}
      <section>
        <SectionHeader icon={Sparkles} title="Latest Episodes" subtitle="Fresh from the last few days" to="/latest" className="px-8">
          <button
            onClick={() => refreshLatest(1)}
            disabled={latestLoading}
            className="btn btn-ghost btn-sm"
          >
            <RefreshCw size={13} className={latestLoading ? "animate-spin" : ""} />
            Refresh
          </button>
          <Link to="/latest" className="btn btn-ghost btn-sm">
            View all
            <ChevronRight size={13} />
          </Link>
        </SectionHeader>

        {latestLoading && latestEpisodes.length === 0 ? (
          <div className="mb-10 flex gap-4 overflow-hidden px-8 pb-4 pt-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="skeleton aspect-video w-[264px] shrink-0 rounded-2xl" />
            ))}
          </div>
        ) : latestEpisodes.length === 0 ? (
          <div className="panel mx-8 mb-10 flex h-32 items-center justify-center gap-2 text-sm text-ink-3">
            No episodes loaded. Try Refresh.
          </div>
        ) : (
          <div className={`transition-opacity ${latestLoading ? "opacity-60" : ""}`}>
            <Row>{latestCards}</Row>
          </div>
        )}
      </section>

      {/* Pixel mode's interludes: scenes between the rows that open other parts of the app. */}
      {pixel && <PixelInterlude scene="station" title="Tonight's line-up" subtitle="Episodes airing this week, in your time zone" to="/schedule" />}

      {/* Discovery sections + Top 10 sidebar (Anikoto-style) */}
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          {recommendationCards.length > 0 && (
            <Row title="For You">
              {recommendationCards}
            </Row>
          )}
          {trendingCards.length > 0 && (
            <Row title="Trending now">
              {trendingCards}
            </Row>
          )}
          {pixel && <PixelInterlude scene="jukebox" title="On the jukebox" subtitle="Openings and endings, chart by chart" to="/songs" />}
          <DiscoverRow title="Top Airing" filters={{ status: "RELEASING", sort: "POPULARITY_DESC" }} />
          {pixel && <PixelInterlude scene="starlight" title="Explore every era" subtitle="The Time Machine, 1960 to today" to="/time-machine" />}
          <DiscoverRow title="Most Popular" filters={{ sort: "POPULARITY_DESC" }} />
          <DiscoverRow title="Top Movies" filters={{ format: "MOVIE", sort: "POPULARITY_DESC" }} />
          <DiscoverRow title="Highest Rated" filters={{ sort: "SCORE_DESC" }} />
        </div>
        <aside className="hidden w-[330px] shrink-0 pr-8 pt-1 md:block">
          <div className="sticky top-4">
            <Top10Sidebar />
          </div>
        </aside>
      </div>
      {/* Pixel mode ends Home on a little scene, as the Android app does. */}
      {pixel && (
        <footer className="pixel-footer" aria-hidden="true">
          <div className="flex items-end justify-center gap-6">
            <span className="pixel-bob"><PixelSprite id="tv" scale={3} /></span>
            <span className="pixel-bob pixel-bob-late"><PixelSprite id="cat" scale={3} /></span>
            <span className="pixel-bob"><PixelSprite id="ramen" scale={3} /></span>
          </div>
          <p>Save point ✦ See you next episode</p>
        </footer>
      )}

    </div>
  );
}
