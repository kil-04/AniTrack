import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, RefreshCw, Sparkles } from "lucide-react";
import PageHeader from "../components/PageHeader";
import LatestEpCard from "../components/LatestEpCard";
import { useAppStore } from "../store/useAppStore";
import type { RecentEpisode } from "../../../../packages/shared/types";

interface LoadedPage {
  page: number;
  items: RecentEpisode[];
  hasNext: boolean;
}

const pagerButton =
  "flex h-9 w-9 items-center justify-center rounded-xl text-ink-3 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-30";

/**
 * Every recently aired episode, a page at a time (Home shows the first page as a
 * row). Page 1 is Home's own copy, so it paints at once; the main process keeps
 * the next page warm, so paging on rarely waits on AniList.
 */
export default function LatestEpisodes() {
  const firstPage = useAppStore((s) => s.latestEpisodes);
  const firstHasNext = useAppStore((s) => s.latestHasNextPage);
  const firstLoading = useAppStore((s) => s.latestLoading);
  const refreshLatest = useAppStore((s) => s.refreshLatest);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState<LoadedPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (page === 1) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    window.api.anilist
      .recent(page)
      .then((res) => {
        if (!cancelled) setLoaded({ page, items: res.data, hasNext: res.hasNextPage });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, attempt]);

  const onFirst = page === 1;
  const items = onFirst ? firstPage : loaded?.page === page ? loaded.items : [];
  const hasNext = onFirst ? firstHasNext : loaded?.page === page ? loaded.hasNext : false;
  const busy = onFirst ? firstLoading : loading;

  const goTo = (next: number) => {
    setPage(Math.max(1, next));
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const refresh = () => (onFirst ? void refreshLatest(1) : setAttempt((n) => n + 1));

  return (
    <div ref={top} className="mx-auto max-w-[1500px] scroll-mt-6 px-8 py-8">
      <PageHeader scene="tower" icon={Sparkles} title="Latest Episodes" subtitle="Recently aired episodes across AniList, newest first">
        <button onClick={refresh} disabled={busy} className="btn btn-ghost btn-sm">
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          Refresh
        </button>
      </PageHeader>

      {items.length === 0 && busy ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: 18 }, (_, i) => (
            <div key={i} className="skeleton aspect-video rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="panel flex h-40 flex-col items-center justify-center gap-3 text-sm text-ink-3">
          {failed ? "Couldn't load this page." : "No episodes loaded."}
          <button onClick={refresh} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} />
            Try again
          </button>
        </div>
      ) : (
        <div
          className={`grid grid-cols-2 gap-4 transition-opacity md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 ${
            busy ? "pointer-events-none opacity-40" : ""
          }`}
        >
          {items.map((ep) => (
            <LatestEpCard key={`${ep.anime.id}:${ep.episode}`} ep={ep} />
          ))}
        </div>
      )}

      {(page > 1 || hasNext) && (
        <div className="mt-8 flex items-center justify-center gap-1.5">
          <button onClick={() => goTo(1)} disabled={page === 1 || busy} className={pagerButton} title="First page">
            <ChevronsLeft size={14} />
          </button>
          <button onClick={() => goTo(page - 1)} disabled={page === 1 || busy} className={pagerButton} title="Previous page">
            <ChevronLeft size={14} />
          </button>
          <span className="flex h-9 min-w-[5.5rem] items-center justify-center rounded-xl bg-accent-gradient px-3 text-xs font-semibold text-white shadow-glow">
            Page {page}
          </span>
          <button onClick={() => goTo(page + 1)} disabled={!hasNext || busy} className={pagerButton} title="Next page">
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
