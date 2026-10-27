import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { CloudOff, Search, SearchX, TriangleAlert } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import SelectField from "../../components/SelectField";
import EmptyState from "../../components/EmptyState";
import {
  isNovelSource,
  NOVEL_GENRES,
  NOVEL_SORTS,
  NOVEL_SOURCES,
  type NovelCard as Card,
  type NovelSearchFilters,
} from "../../../../../packages/shared/novel";
import { NovelCard } from "../../components/novel/NovelCards";
import { novelApi, preferredNovelSource, searchNovels, setPreferredNovelSource, unwrap } from "../../lib/novel-api";

const STATUSES: [string, string][] = [["", "Any status"], ["ongoing", "Ongoing"], ["completed", "Completed"]];

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <SelectField value={value} onChange={onChange} className="w-[170px]">
      {options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </SelectField>
  );
}

export default function NovelSearch() {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(params.get("q") ?? "");
  const [results, setResults] = useState<Card[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [showMtl, setShowMtl] = useState(false);
  // The source that answered (the other one while the chosen one is down), and why.
  const [answered, setAnswered] = useState<{ sourceId: NovelSearchFilters["sourceId"]; notice: string | null } | null>(null);

  const sourceParam = params.get("source");
  const sourceId = isNovelSource(sourceParam) ? sourceParam : preferredNovelSource();

  const filters = useMemo<NovelSearchFilters>(() => ({
    sourceId,
    query: params.get("q") || undefined,
    genre: params.get("genre") || undefined,
    status: (params.get("status") as NovelSearchFilters["status"]) || undefined,
    sort: (params.get("sort") as NovelSearchFilters["sort"]) || undefined,
  }), [params, sourceId]);

  useEffect(() => { setDraft(params.get("q") ?? ""); }, [params]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(null);
    setPage(1);
    setAnswered(null);
    searchNovels({ ...filters, page: 1 })
      .then((result) => {
        if (!alive) return;
        setResults(result.page.items);
        setHasMore(result.page.hasNextPage);
        setAnswered({ sourceId: result.sourceId, notice: result.notice });
      })
      .catch((error: Error) => { if (alive) { setResults([]); setFailed(error.message); } })
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
    unwrap(novelApi().search({ ...filters, sourceId: answered?.sourceId ?? filters.sourceId, page: next }))
      .then((result) => {
        setResults((items) => [...items, ...result.items.filter((m) => !items.some((i) => i.id === m.id))]);
        setHasMore(result.hasNextPage);
        setPage(next);
      })
      .catch((error: Error) => setFailed(error.message))
      .finally(() => setLoading(false));
  };

  const mtlCount = results.filter((c) => c.mtl).length;
  const shown = showMtl ? results : results.filter((c) => !c.mtl);
  const source = NOVEL_SOURCES.find((s) => s.id === sourceId)!;

  return (
    <div className="mx-auto max-w-[1680px] px-8 pb-16 pt-8">
      <PageHeader scene="observatory" icon={Search} title="Search Novels" subtitle={`${source.label}: ${source.blurb}`} />
      <div className="panel relative z-20 mb-10 p-4">
        <form onSubmit={(event) => { event.preventDefault(); set("q", draft.trim()); }} className="flex gap-3">
          <div className="relative flex-1">
            <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Title or alternative name"
              className="input h-12 rounded-2xl pl-11 text-[15px]"
            />
          </div>
          <button type="submit" className="btn btn-primary h-12 rounded-2xl px-6">
            <Search size={17} /> Search
          </button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <div className="mr-1 flex rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
            {NOVEL_SOURCES.map((s) => {
              const on = s.id === sourceId;
              return (
                <button
                  key={s.id}
                  title={s.blurb}
                  onClick={() => { setPreferredNovelSource(s.id); set("source", s.id); }}
                  className={`relative h-8 rounded-lg px-4 text-sm font-semibold transition-colors ${on ? "text-white" : "text-ink-3 hover:text-white"}`}
                >
                  {on && (
                    <motion.span layoutId="novel-source" className="absolute inset-0 rounded-lg bg-accent-gradient shadow-glow" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
                  )}
                  <span className="relative">{s.label}</span>
                </button>
              );
            })}
          </div>
          <Select value={params.get("genre") ?? ""} onChange={(v) => set("genre", v)} options={[["", "Any genre"], ...NOVEL_GENRES.map((g) => [g, g] as [string, string])]} />
          <Select value={params.get("status") ?? ""} onChange={(v) => set("status", v)} options={STATUSES} />
          <Select
            value={params.get("sort") ?? ""}
            onChange={(v) => set("sort", v)}
            options={NOVEL_SORTS.map((s) => [s.id === "popular" ? "" : s.id, s.label] as [string, string])}
          />
          {params.get("q") && <span className="text-xs text-ink-3">Sorting applies when browsing without a search.</span>}
          {mtlCount > 0 && (
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink-2">
              <input type="checkbox" checked={showMtl} onChange={(e) => setShowMtl(e.target.checked)} className="accent-[rgb(var(--accent))]" />
              Show machine translations ({mtlCount})
            </label>
          )}
        </div>
      </div>

      {answered?.notice && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100">
          <CloudOff size={17} className="shrink-0 text-amber-300" /> {answered.notice}
        </div>
      )}
      {failed && !results.length ? (
        <EmptyState icon={TriangleAlert} tone="danger" title={`${source.label} didn't answer`}>
          {failed} NovelBuddy and NovelArchive both failed to answer. Check your connection, then try again.
        </EmptyState>
      ) : !loading && !shown.length ? (
        <EmptyState icon={SearchX} title="Nothing matches">
          No novels match on {NOVEL_SOURCES.find((s) => s.id === (answered?.sourceId ?? sourceId))!.label}. Try fewer filters, another spelling, or the other source.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
          {shown.map((novel) => <NovelCard key={novel.id} novel={novel} />)}
          {loading && Array.from({ length: shown.length ? 7 : 14 }, (_, i) => (
            <div key={`s${i}`} className="skeleton aspect-[2/3] rounded-2xl" />
          ))}
        </div>
      )}
      {hasMore && !loading && (
        <div className="mt-10 flex justify-center">
          <button onClick={loadMore} className="btn btn-secondary px-6">Load more</button>
        </div>
      )}
    </div>
  );
}
