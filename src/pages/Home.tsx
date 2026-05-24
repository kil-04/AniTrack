import { useEffect, useRef, useState, useCallback } from "react";
import { useAppStore } from "../store/useAppStore";
import Row from "../components/Row";
import Card from "../components/Card";
import { Link } from "react-router-dom";
import { Play, RefreshCw, Clock, Loader2, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { secondsToTimestamp } from "../lib/format";
import { deleteAnimeProgress } from "../lib/supabase-sync";

function cwStreamUrl(session: string, title: string, episode: number, coverUrl?: string | null, animeId?: number): string {
  const p: Record<string, string> = { session, title, episode: String(episode) };
  if (coverUrl) p.coverUrl = coverUrl;
  if (animeId && animeId > 0) p.animeId = String(animeId);
  return "/stream-player?" + new URLSearchParams(p).toString();
}

export default function Home() {
  const trending = useAppStore((s) => s.trending);
  const latestEpisodes = useAppStore((s) => s.latestEpisodes);
  const latestLoading = useAppStore((s) => s.latestLoading);
  const latestPage = useAppStore((s) => s.latestPage);
  const latestLastPage = useAppStore((s) => s.latestLastPage);
  const refreshLatest = useAppStore((s) => s.refreshLatest);
  const refreshContinue = useAppStore((s) => s.refreshContinue);
  const refreshAll = useAppStore((s) => s.refreshAll);
  const cw = useAppStore((s) => s.continueWatching);
  const [cwRefreshing, setCwRefreshing] = useState(false);

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

    async function getLatestEpNumber(session: string): Promise<number> {
      const first = await window.api.pahe.episodes(session, 1);
      const lastPage = first.lastPage ?? 1;
      const last = lastPage > 1
        ? await window.api.pahe.episodes(session, lastPage)
        : first;
      const nums = (last.data as any[]).map((e) => e.episode).filter(Number.isFinite);
      return nums.length ? Math.max(...nums) : first.total;
    }

    const now = Date.now();
    const fetches = cw.map(async (item) => {
      const key = item.animePaheSession ?? item.anime.title;
      // Skip if cached value is fresh.
      if (stored[key] && now - stored[key].at < CACHE_TTL) return null;

      if (item.animePaheSession) {
        const total = await getLatestEpNumber(item.animePaheSession);
        return { key, total };
      }
      const title = item.anime.title;
      const results = await window.api.pahe.search(title);
      if (!results.length) return null;
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const exact = results.find((r: any) => norm(r.title) === norm(title));
      const best = exact ?? results[0];
      const total = await getLatestEpNumber(best.session);
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

  return (
    <div className="pb-16">

      {/* Continue Watching */}
      {cw.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between px-8">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-[#4a9eff]" />
              <Link
                to="/continue-watching"
                className="group flex items-center gap-1 text-lg font-semibold hover:text-[#4a9eff] transition-colors"
              >
                Continue Watching
                <ChevronRight size={16} className="opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
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
                           bg-gradient-to-r from-[#0b0b0f] to-transparent
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
                           bg-gradient-to-l from-[#0b0b0f] to-transparent
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
              className="no-scrollbar flex gap-4 overflow-x-auto scroll-smooth px-8 pb-2"
            >
              {cw.map((item) => {
                const cwTo = item.animePaheSession
                  ? cwStreamUrl(item.animePaheSession, item.anime.title, item.episode, item.anime.coverImage, item.anime.id)
                  : "/anime/" + item.anime.id;
                return (
                <div key={String(item.anime.id) + "-" + item.episode} className="group relative w-44 shrink-0">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      window.api.list.dismissContinueWatching(item.anime.id)
                        .then(() => { deleteAnimeProgress(item.anime.id); refreshContinue(); })
                        .catch(() => {});
                    }}
                    className="absolute right-1.5 top-1.5 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition hover:bg-black/90 group-hover:opacity-100"
                    title="Remove from Continue Watching"
                  >
                    <X size={12} />
                  </button>
                <Link to={cwTo} className="block">
                  <div className="relative h-64 w-44 overflow-hidden rounded-lg bg-white/5 transition duration-200 group-hover:scale-105 group-hover:ring-2 group-hover:ring-white/50">
                    {(item.anime.coverImage) ? (
                      <img
                        src={item.anime.coverImage}
                        alt={item.anime.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-3xl font-bold text-white/20">
                        {item.anime.title.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                    <div className="absolute left-2 top-2 rounded bg-[#4a9eff] px-1.5 py-0.5 text-xs font-semibold text-white">
                      EP {item.episode}
                    </div>
                    {(() => {
                      const key = item.animePaheSession ?? item.anime.title;
                      const total = paheEpTotals.get(key);
                      if (!total) return null;
                      const hasNew = total > item.episode;
                      return (
                        <div className={`absolute right-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-bold backdrop-blur-sm
                          ${hasNew ? "bg-green-500/90 text-white" : "bg-black/60 text-white/50"}`}>
                          {hasNew ? `EP ${total} ▲` : `EP ${total} ✓`}
                        </div>
                      );
                    })()}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                      <div className="rounded-full bg-white/90 p-3 text-black shadow-lg">
                        <Play size={20} fill="currentColor" />
                      </div>
                    </div>
                    <div className="absolute bottom-4 left-0 right-0 px-3 text-xs text-white/80">
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
                </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Latest Episodes */}
      <section className="mb-10 px-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Latest Episodes</h2>
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
              {latestEpisodes.map((ep: any) => (
                <LatestEpCard key={ep.id} ep={ep} />
              ))}
            </div>

            {latestLastPage > 1 && (
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

                {Array.from({ length: latestLastPage }, (_, i) => i + 1)
                  .filter((p) => Math.abs(p - latestPage) <= 2 || p === 1 || p === latestLastPage)
                  .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === "…" ? (
                      <span key={`ellipsis-${i}`} className="px-1 text-xs text-white/30">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => refreshLatest(p as number)}
                        disabled={latestLoading}
                        className={`flex h-8 min-w-[2rem] items-center justify-center rounded px-2 text-xs font-medium transition
                          ${latestPage === p
                            ? "bg-[#4a9eff] text-white"
                            : "text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-40"
                          }`}
                      >
                        {p}
                      </button>
                    ),
                  )}

                <button
                  onClick={() => refreshLatest(latestPage + 1)}
                  disabled={latestPage === latestLastPage || latestLoading}
                  className="flex h-8 w-8 items-center justify-center rounded text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                  title="Next page"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => refreshLatest(latestLastPage)}
                  disabled={latestPage === latestLastPage || latestLoading}
                  className="flex h-8 w-8 items-center justify-center rounded text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                  title="Last page"
                >
                  <ChevronsRight size={14} />
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {trending.length > 0 && (
        <Row title="Trending now">
          {trending.map((a) => (
            <Card key={a.id} anime={a} />
          ))}
        </Row>
      )}

    </div>
  );
}

function LatestEpCard({ ep }: { ep: any }) {
  const streamParams = new URLSearchParams({
    session: ep.anime_session,
    title: ep.anime_title,
    episode: String(ep.episode),
    ...(ep.snapshot ? { coverUrl: ep.snapshot } : {}),
  });
  const streamUrl = "/stream-player?" + streamParams.toString();

  return (
    <Link to={streamUrl} className="group block">
      <div className="relative aspect-video overflow-hidden rounded-lg bg-white/5">
        {ep.snapshot ? (
          <img
            src={ep.snapshot}
            alt={ep.anime_title}
            className="h-full w-full object-cover transition duration-200 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-white/20 text-xs">
            No preview
          </div>
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 transition group-hover:opacity-100" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <div className="rounded-full bg-white/90 p-2 text-black shadow-lg">
            <Play size={16} fill="currentColor" />
          </div>
        </div>
        <div className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
          EP {ep.episode}
        </div>
        {ep.filler === 1 && (
          <div className="absolute right-1.5 top-1.5 rounded bg-yellow-500/80 px-1 py-0.5 text-[9px] font-bold text-black">
            FILLER
          </div>
        )}
      </div>
      <div className="mt-1.5 line-clamp-2 text-xs leading-snug text-white/80 group-hover:text-white transition">
        {ep.anime_title}
      </div>
    </Link>
  );
}
