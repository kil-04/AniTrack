import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, SearchX, TriangleAlert } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import SelectField from "../../components/SelectField";
import EmptyState from "../../components/EmptyState";
import type { MangaMeta, MangaSearchFilters } from "../../../../../packages/shared/manga";
import { MangaCard } from "../../components/manga/MangaCards";
import { mangaApi } from "../../lib/manga-api";

const GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror", "Mahou Shoujo", "Mecha", "Music",
  "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller",
];
const KINDS: [string, string][] = [["", "All"], ["JP", "Manga"], ["KR", "Manhwa"], ["CN", "Manhua"]];
const FORMATS: [string, string][] = [["", "Any format"], ["MANGA", "Series"], ["ONE_SHOT", "One-shot"], ["NOVEL", "Light novel"]];
const STATUSES: [string, string][] = [["", "Any status"], ["RELEASING", "Publishing"], ["FINISHED", "Completed"], ["HIATUS", "On hiatus"], ["NOT_YET_RELEASED", "Upcoming"]];
const SORTS: [string, string][] = [["", "Best match / Popular"], ["TRENDING_DESC", "Trending"], ["SCORE_DESC", "Top rated"], ["START_DATE_DESC", "Newest"], ["FAVOURITES_DESC", "Most favourited"]];

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <SelectField value={value} onChange={onChange} className="w-[170px]">
      {options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </SelectField>
  );
}

export default function MangaSearch() {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(params.get("q") ?? "");
  const [results, setResults] = useState<MangaMeta[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const filters = useMemo<MangaSearchFilters>(() => ({
    query: params.get("q") || undefined,
    genre: params.get("genre") || undefined,
    country: params.get("country") || undefined,
    format: params.get("format") || undefined,
    status: params.get("status") || undefined,
    sort: params.get("sort") || undefined,
    year: Number(params.get("year")) || undefined,
  }), [params]);

  useEffect(() => { setDraft(params.get("q") ?? ""); }, [params]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    setPage(1);
    mangaApi().search({ ...filters, page: 1 })
      .then((result) => { if (alive) { setResults(result.items); setHasMore(result.hasNextPage); } })
      .catch(() => { if (alive) { setResults([]); setFailed(true); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [filters]);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const loadMore = () => {
    const next = page + 1;
    setLoading(true);
    mangaApi().search({ ...filters, page: next })
      .then((result) => {
        setResults((items) => [...items, ...result.items.filter((m) => !items.some((i) => i.id === m.id))]);
        setHasMore(result.hasNextPage);
        setPage(next);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  };

  const thisYear = new Date().getFullYear();
  return (
    <div className="mx-auto max-w-[1680px] px-8 pb-16 pt-8">
      <PageHeader scene="green-shop" icon={Search} title="Search Manga" subtitle="Manga, manhwa and manhua from AniList" />
      <div className="panel relative z-20 mb-10 p-4">
        <form
          onSubmit={(event) => { event.preventDefault(); set("q", draft.trim()); }}
          className="flex gap-3"
        >
          <div className="relative flex-1">
            <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Title, in English or romaji"
              className="input h-12 rounded-2xl pl-11 text-[15px]"
            />
          </div>
          <button type="submit" className="btn btn-primary h-12 rounded-2xl px-6">
            <Search size={17} /> Search
          </button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <div className="mr-1 flex rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
            {KINDS.map(([key, label]) => {
              const on = (params.get("country") ?? "") === key;
              return (
                <button
                  key={key}
                  onClick={() => set("country", key)}
                  className={`relative h-8 rounded-lg px-4 text-sm font-semibold transition-colors ${on ? "text-white" : "text-ink-3 hover:text-white"}`}
                >
                  {on && (
                    <motion.span
                      layoutId="manga-kind"
                      className="absolute inset-0 rounded-lg bg-accent-gradient shadow-glow"
                      transition={{ type: "spring", stiffness: 500, damping: 38 }}
                    />
                  )}
                  <span className="relative">{label}</span>
                </button>
              );
            })}
          </div>
          <Select value={params.get("genre") ?? ""} onChange={(v) => set("genre", v)} options={[["", "Any genre"], ...GENRES.map((g) => [g, g] as [string, string])]} />
          <Select value={params.get("format") ?? ""} onChange={(v) => set("format", v)} options={FORMATS} />
          <Select value={params.get("status") ?? ""} onChange={(v) => set("status", v)} options={STATUSES} />
          <Select
            value={params.get("year") ?? ""}
            onChange={(v) => set("year", v)}
            options={[["", "Any year"], ...Array.from({ length: thisYear - 1969 }, (_, i) => String(thisYear - i)).map((y) => [y, y] as [string, string])]}
          />
          <Select value={params.get("sort") ?? ""} onChange={(v) => set("sort", v)} options={SORTS} />
        </div>
      </div>

      {failed && !results.length ? (
        <EmptyState icon={TriangleAlert} tone="danger" title="AniList didn't answer">
          Check your connection and try again.
        </EmptyState>
      ) : !loading && !results.length ? (
        <EmptyState icon={SearchX} title="Nothing matches">
          No manga match these filters. Try fewer filters or a different spelling.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
          {results.map((manga) => <MangaCard key={manga.id} manga={manga} />)}
          {loading && Array.from({ length: results.length ? 7 : 14 }, (_, i) => (
            <div key={`s${i}`} className="skeleton aspect-[2/3] rounded-2xl" />
          ))}
        </div>
      )}
      {hasMore && !loading && (
        <div className="mt-10 flex justify-center">
          <button onClick={loadMore} className="btn btn-secondary px-6">
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
