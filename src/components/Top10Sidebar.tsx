import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import type { AnimeMeta, AdvancedSearchFilters } from "../../shared/types";

type Tab = "day" | "week" | "month";

const TABS: { id: Tab; label: string }[] = [
  { id: "day", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

// AniList has no time-windowed view counts, so we approximate Anikoto's
// Today / Week / Month tabs with trending, current-season popularity, and
// all-time popularity respectively.
function currentSeason(): { season: string; year: number } {
  const now = new Date();
  const m = now.getMonth(); // 0-11
  const year = now.getFullYear();
  if (m <= 1) return { season: "WINTER", year };
  if (m <= 4) return { season: "SPRING", year };
  if (m <= 7) return { season: "SUMMER", year };
  if (m <= 10) return { season: "FALL", year };
  return { season: "WINTER", year: year + 1 };
}

function filtersFor(tab: Tab): AdvancedSearchFilters {
  if (tab === "day") return { sort: "TRENDING_DESC" };
  if (tab === "week") {
    const { season, year } = currentSeason();
    return { sort: "POPULARITY_DESC", season, year };
  }
  return { sort: "POPULARITY_DESC" };
}

export default function Top10Sidebar() {
  const [tab, setTab] = useState<Tab>("day");
  const [cache, setCache] = useState<Record<Tab, AnimeMeta[] | undefined>>({
    day: undefined,
    week: undefined,
    month: undefined,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (cache[tab]) return;
    let cancelled = false;
    setLoading(true);
    window.api.anilist
      .advancedSearch({ ...filtersFor(tab), page: 1 })
      .then((res) => {
        if (cancelled) return;
        setCache((c) => ({ ...c, [tab]: res.results.slice(0, 10) }));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, cache]);

  const items = cache[tab] ?? [];

  return (
    <div className="rounded-xl border border-white/5 bg-[#1b1b1b] p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">Top 10</h2>
        <div className="flex overflow-hidden rounded-md border border-white/10 text-[11px] font-semibold">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-2.5 py-1 transition-colors ${
                tab === t.id ? "bg-white text-black" : "text-white/60 hover:bg-white/5"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="py-8 text-center text-sm text-white/30">Loading…</div>
      ) : (
        <div className="flex flex-col">
          {items.map((a, i) => (
            <Link
              key={a.id}
              to={`/anime/${a.id}`}
              state={{ anime: a }}
              className="flex items-center gap-3 border-b border-white/5 py-2.5 last:border-0 hover:bg-white/[0.03] transition-colors"
            >
              <span
                className={`w-6 shrink-0 text-center text-lg font-black tabular-nums ${
                  i < 3 ? "text-white" : "text-white/25"
                }`}
              >
                {i + 1}
              </span>
              {a.coverImage ? (
                <img src={a.coverImage} alt="" className="h-14 w-10 shrink-0 rounded object-cover" loading="lazy" />
              ) : (
                <div className="h-14 w-10 shrink-0 rounded bg-white/5" />
              )}
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-semibold leading-tight text-white/90">{a.title}</div>
                <div className="mt-1 flex items-center gap-2 text-[10px] font-bold text-white/40">
                  {a.averageScore != null && (
                    <span className="flex items-center gap-0.5 text-amber-300">
                      <Star size={9} fill="currentColor" />
                      {(a.averageScore / 10).toFixed(1)}
                    </span>
                  )}
                  {a.episodes != null && a.episodes > 0 && <span>{a.episodes} eps</span>}
                  {a.format && <span className="uppercase">{a.format.replace("_", " ")}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
