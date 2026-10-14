import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Dices, Landmark, Radio, Sparkles, Stamp } from "lucide-react";
import Card from "../components/Card";
import type { AnimeMeta, PremieredAnime } from "../../../../packages/shared/types";
import { ANIME_ERAS, animeEraForYear, clampTimeMachineYear, yearTransmission } from "../../../../packages/shared/time-machine";
import { rejectOversizedImage, safeImageSrc } from "../lib/image-guard";

const VISITED_KEY = "anitrack.timeMachine.visited";
const SEASONS = [["ALL", "All year"], ["WINTER", "Winter"], ["SPRING", "Spring"], ["SUMMER", "Summer"], ["FALL", "Fall"]] as const;
const SORTS = [["SCORE_DESC", "Top rated"], ["POPULARITY_DESC", "Most popular"]] as const;
const LAST_YEAR = Math.min(2029, new Date().getFullYear());

function countLabel(value: number, singular: string): string {
  return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

// The passport lives in this window's storage; unreadable storage just starts it empty.
function readVisited(): Set<number> {
  try {
    const raw = window.localStorage.getItem(VISITED_KEY);
    return new Set((raw ? JSON.parse(raw) : []).filter((year: unknown) => typeof year === "number"));
  } catch {
    return new Set();
  }
}

function saveVisited(years: Set<number>) {
  try {
    window.localStorage.setItem(VISITED_KEY, JSON.stringify([...years].sort()));
  } catch {
    // Private or full storage: the passport just isn't remembered.
  }
}

function Pill({ selected, accent, onClick, children }: { selected: boolean; accent: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`h-8 rounded-full border px-3.5 text-xs font-semibold transition ${selected ? "border-white/30 text-black shadow-[0_6px_20px_-8px_rgb(255_255_255/0.4)]" : "border-white/[0.08] bg-white/[0.05] text-ink-2 hover:border-white/15 hover:bg-white/[0.09] hover:text-white"}`}
      style={selected ? { backgroundColor: accent } : undefined}
    >
      {children}
    </button>
  );
}

export default function TimeMachine() {
  const navigate = useNavigate();
  const [year, setYear] = useState(1988);
  const [season, setSeason] = useState<string>("ALL");
  const [sort, setSort] = useState<string>("SCORE_DESC");
  const [anime, setAnime] = useState<AnimeMeta[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visited, setVisited] = useState<Set<number>>(() => readVisited());
  const [history, setHistory] = useState<AnimeMeta[]>([]);
  const [onThisDay, setOnThisDay] = useState<PremieredAnime[]>([]);
  const era = animeEraForYear(year);
  const today = useMemo(() => new Date(), []);

  const filtersFor = (pageNumber: number) => season === "ALL"
    ? { startYear: year, sort, page: pageNumber }
    : { year, season, sort, page: pageNumber };

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      setSelectedGenre(null);
      setPage(1);
      window.api.anilist.advancedSearch(filtersFor(1))
        .then((result) => {
          if (!active) return;
          setAnime(result.results);
          setHasMore(result.hasNextPage);
          setVisited((previous) => {
            if (previous.has(year)) return previous;
            const next = new Set(previous).add(year);
            saveVisited(next);
            return next;
          });
        })
        .catch(() => { if (active) setError(`The ${year} archive did not answer. Try the transmission again.`); })
        .finally(() => { if (active) setLoading(false); });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, season, sort]);

  // Your own titles (list and Continue Watching), for "From your history" and the passport dots.
  useEffect(() => {
    let active = true;
    Promise.all([
      window.api.list.getAll().catch(() => []),
      window.api.list.continueWatching().catch(() => []),
    ]).then(([list, watching]) => {
      if (!active) return;
      const byId = new Map<number, AnimeMeta>();
      list.forEach(({ anime: item }) => { if (item) byId.set(item.id, item); });
      watching.forEach(({ anime: item }) => { if (item?.id) byId.set(item.id, item); });
      setHistory([...byId.values()]);
    });
    window.api.anilist.premieredOn(today.getMonth() + 1, today.getDate())
      .then((items) => { if (active) setOnThisDay(items); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [today]);

  const travel = (to: number) => setYear(clampTimeMachineYear(to));
  const loadMore = () => {
    setLoadingMore(true);
    window.api.anilist.advancedSearch(filtersFor(page + 1))
      .then((result) => {
        setPage((value) => value + 1);
        setAnime((current) => [...current, ...result.results.filter((item) => !current.some((known) => known.id === item.id))]);
        setHasMore(result.hasNextPage);
      })
      .catch(() => undefined)
      .finally(() => setLoadingMore(false));
  };

  const hero = anime[0];
  const formats = useMemo(() => ({
    television: anime.filter((item) => item.format === "TV" || item.format === "TV_SHORT").length,
    cinema: anime.filter((item) => item.format === "MOVIE").length,
    ova: anime.filter((item) => item.format === "OVA" || item.format === "ONA").length,
  }), [anime]);
  const studios = useMemo(() => {
    const counts = new Map<string, number>();
    anime.forEach((item) => { const main = item.studios?.[0]; if (main) counts.set(main, (counts.get(main) ?? 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [anime]);
  const genreSignal = useMemo(() => {
    const counts = new Map<string, number>();
    anime.flatMap((item) => item.genres ?? []).forEach((genre) => counts.set(genre, (counts.get(genre) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [anime]);
  const visibleAnime = useMemo(
    () => selectedGenre ? anime.filter((item) => item.genres?.includes(selectedGenre)) : anime,
    [anime, selectedGenre],
  );
  const historyYears = useMemo(() => new Set(history.map((item) => item.year).filter((value): value is number => !!value)), [history]);
  const yours = useMemo(() => history.filter((item) => item.year === year), [history, year]);
  const explored = [...visited].filter((value) => value >= 1960 && value <= LAST_YEAR).length;
  const totalYears = LAST_YEAR - 1960 + 1;
  const seasonLabel = SEASONS.find(([key]) => key === season)?.[1] ?? "All year";

  const surprise = () => {
    const pool = visibleAnime.slice(0, 15);
    if (pool.length === 0) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    navigate(`/anime/${pick.id}`, { state: { anime: pick } });
  };

  return (
    <div className="min-h-full pb-16">
      <section className="relative mx-8 mt-6 min-h-[390px] overflow-hidden rounded-[28px] bg-surface-1 shadow-pop ring-1 ring-white/[0.07]">
        {safeImageSrc(hero?.bannerImage) && (
          <img src={safeImageSrc(hero?.bannerImage)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" onLoad={(event) => rejectOversizedImage(event)} />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/85 to-bg/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-bg/20" />
        <div className="relative flex flex-col justify-center px-10 py-12 xl:px-14">
          <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.3em]" style={{ color: era.accent }}>
            <Radio size={15} className="animate-pulse" /> {yearTransmission(year)}
          </div>
          <div className="flex flex-wrap items-end gap-5">
            <div className="flex items-center gap-3">
              <button aria-label="Previous year" onClick={() => travel(year - 1)} disabled={year <= 1960} className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.07] text-white backdrop-blur-md transition hover:border-white/20 hover:bg-white/[0.14] disabled:opacity-25"><ChevronLeft size={26} /></button>
              <span className="text-[clamp(5rem,13vw,11rem)] font-black leading-[0.72] tracking-[-0.08em] text-white">{year}</span>
              <button aria-label="Next year" onClick={() => travel(year + 1)} disabled={year >= LAST_YEAR} className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.07] text-white backdrop-blur-md transition hover:border-white/20 hover:bg-white/[0.14] disabled:opacity-25"><ChevronRight size={26} /></button>
            </div>
            <div className="max-w-xl pb-1">
              <h1 className="text-3xl font-extrabold md:text-5xl">{era.headline}</h1>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/65 md:text-base">{era.atmosphere}</p>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={surprise} disabled={visibleAnime.length === 0} className="btn btn-primary btn-lg">
              <Sparkles size={17} /> Mystery screening
            </button>
            <button onClick={() => travel(1960 + Math.floor(Math.random() * totalYears))} className="btn btn-secondary btn-lg">
              <Dices size={17} /> Random year
            </button>
            <button onClick={() => navigate("/taste-genome")} className="btn btn-lg border border-fuchsia-300/25 bg-fuchsia-400/10 text-fuchsia-100 backdrop-blur-md hover:bg-fuchsia-400/20"><Sparkles size={16} /> View Taste Genome</button>
            <button onClick={() => hero && navigate(`/museum/${hero.id}`)} disabled={!hero} className="btn btn-lg border border-amber-300/25 bg-amber-400/10 text-amber-100 backdrop-blur-md hover:bg-amber-400/20"><Landmark size={16} /> Enter Living Museum</button>
          </div>
        </div>
      </section>

      <div className="space-y-10 px-8 py-8">
        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex items-center gap-3">
              <Clock3 size={20} style={{ color: era.accent }} />
              <div><div className="font-bold">Set the dial</div><div className="text-xs text-ink-3">Travel through the AniList archive</div></div>
            </div>
            <div className="flex flex-wrap gap-2">
              {ANIME_ERAS.filter((decade) => decade.start <= LAST_YEAR).map((decade) => (
                <button key={decade.start} onClick={() => travel(decade.start + 5)} className={`h-8 rounded-full px-4 text-xs font-bold transition ${era.start === decade.start ? "text-black" : "bg-white/[0.05] text-ink-2 hover:bg-white/[0.1] hover:text-white"}`} style={era.start === decade.start ? { backgroundColor: decade.accent } : undefined}>{decade.label}</button>
              ))}
            </div>
          </div>
          <input aria-label="Time machine year" type="range" min="1960" max={LAST_YEAR} value={year} onChange={(event) => setYear(Number(event.target.value))} className="mt-6 w-full" style={{ accentColor: era.accent }} />
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,560px)_1fr]">
          <div className="panel p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-amber-200"><Stamp size={14} /> Your passport</div>
                <div className="mt-1 text-lg font-bold">{explored} of {totalYears} years explored</div>
              </div>
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-amber-200" style={{ width: `${(explored / totalYears) * 100}%` }} /></div>
            </div>
            <div className="mt-4 space-y-1.5">
              {ANIME_ERAS.filter((decade) => decade.start <= LAST_YEAR).map((decade) => (
                <div key={decade.start} className="flex items-center gap-1">
                  <span className="w-12 text-[11px] font-bold" style={{ color: decade.accent }}>{decade.label}</span>
                  {Array.from({ length: Math.min(decade.end, LAST_YEAR) - decade.start + 1 }, (_, i) => decade.start + i).map((stamp) => {
                    const seen = visited.has(stamp);
                    return (
                      <button
                        key={stamp}
                        title={historyYears.has(stamp) ? `${stamp} · you've watched something from this year` : String(stamp)}
                        onClick={() => travel(stamp)}
                        className={`relative grid h-7 w-8 place-items-center rounded-md text-[10px] font-bold transition hover:scale-110 ${stamp === year ? "ring-2 ring-white" : ""} ${seen ? "text-black" : "bg-white/[0.05] text-ink-3"}`}
                        style={seen ? { backgroundColor: decade.accent } : undefined}
                      >
                        {String(stamp % 100).padStart(2, "0")}
                        {historyYears.has(stamp) && <span className={`absolute bottom-0.5 h-1 w-1 rounded-full ${seen ? "bg-black" : "bg-white"}`} />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-3">Dots mark years you've watched something from. Click any stamp to travel.</p>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">{SEASONS.map(([key, label]) => <Pill key={key} selected={season === key} accent={era.accent} onClick={() => setSeason(key)}>{label}</Pill>)}</div>
            <div className="flex flex-wrap gap-2">{SORTS.map(([key, label]) => <Pill key={key} selected={sort === key} accent={era.accent} onClick={() => setSort(key)}>{label}</Pill>)}</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/[0.07] bg-surface-1/80 p-4 shadow-card"><div className="text-2xl font-black">{formats.television}</div><div className="text-xs uppercase tracking-wider text-ink-3">TV signals found</div></div>
              <div className="rounded-2xl border border-white/[0.07] bg-surface-1/80 p-4 shadow-card"><div className="text-2xl font-black">{formats.cinema}</div><div className="text-xs uppercase tracking-wider text-ink-3">Films recovered</div></div>
              <div className="rounded-2xl border border-white/[0.07] bg-surface-1/80 p-4 shadow-card"><div className="text-2xl font-black">{formats.ova}</div><div className="text-xs uppercase tracking-wider text-ink-3">OVA artifacts</div></div>
            </div>
            {studios.length > 0 && (
              <div className="rounded-2xl border border-white/[0.07] bg-surface-1/80 p-4 shadow-card">
                <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: era.accent }}>Studios at work</div>
                <div className="mt-2 space-y-1">{studios.map(([name, count]) => <div key={name} className="flex justify-between text-sm"><span className="font-semibold">{name}</span><span className="text-ink-3">{countLabel(count, "title")}</span></div>)}</div>
              </div>
            )}
          </div>
        </section>

        {genreSignal.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2 text-sm font-bold"><Sparkles size={16} style={{ color: era.accent }} /> Genre signal <span className="text-xs font-normal text-ink-3">Choose a signal to view its titles</span></div>
            <div className="flex flex-wrap gap-2">
              <Pill selected={selectedGenre === null} accent={era.accent} onClick={() => setSelectedGenre(null)}>All · {countLabel(anime.length, "title")}</Pill>
              {genreSignal.map(([genre, count]) => (
                <Pill key={genre} selected={selectedGenre === genre} accent={era.accent} onClick={() => setSelectedGenre(selectedGenre === genre ? null : genre)}>{genre} · {countLabel(count, "title")}</Pill>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: era.accent }}>Recovered from {season === "ALL" ? "" : `${seasonLabel} `}{year}</div>
              <h2 className="mt-1 text-2xl font-black">{selectedGenre ? `${selectedGenre} transmission` : sort === "SCORE_DESC" ? "The essential transmission" : "What everyone was watching"}</h2>
            </div>
            <span className="text-xs text-ink-3">{selectedGenre ? `${countLabel(visibleAnime.length, "title")} in this signal` : sort === "SCORE_DESC" ? "Ranked by audience score" : "Ranked by popularity"}</span>
          </div>
          {loading ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {Array.from({ length: 16 }, (_, i) => <div key={i} className="skeleton aspect-[2/3] rounded-2xl" />)}
            </div>
          ) : error ? <button onClick={() => setYear((value) => value === 1988 ? 1989 : 1988)} className="rounded-2xl border border-red-400/20 bg-red-500/10 p-5 text-left text-sm text-red-200 transition hover:bg-red-500/15">{error}</button> : visibleAnime.length === 0 ? (
            <p className="panel p-5 text-sm text-ink-2">Nothing recorded for this {season === "ALL" ? "year" : "season"}. Try another season or year.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">{visibleAnime.map((item) => <Card key={item.id} anime={item} />)}</div>
              {hasMore && !selectedGenre && (
                <div className="mt-8 flex justify-center">
                  <button onClick={loadMore} disabled={loadingMore} className="btn btn-secondary px-6">{loadingMore ? "Recovering…" : `More from ${year}`}</button>
                </div>
              )}
            </>
          )}
        </section>

        {yours.length > 0 && (
          <section>
            <div className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: era.accent }}>From your history</div>
            <h2 className="mt-1 mb-5 text-2xl font-black">You've watched {countLabel(yours.length, "title")} from {year}</h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">{yours.map((item) => <Card key={item.id} anime={item} />)}</div>
          </section>
        )}

        {onThisDay.length > 0 && (
          <section>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-amber-200"><CalendarDays size={14} /> On this day</div>
            <h2 className="mt-1 text-2xl font-black">Premiered on {today.toLocaleDateString(undefined, { month: "long", day: "numeric" })}</h2>
            <p className="mb-5 text-xs text-ink-3">Click a year to travel there.</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {onThisDay.map(({ anime: item, year: premiered }) => (
                <div key={item.id} className="relative">
                  <Card anime={item} />
                  <button
                    onClick={() => travel(premiered)}
                    className="mt-2.5 rounded-full px-2.5 py-0.5 text-xs font-black text-black shadow-lg transition hover:scale-105"
                    style={{ backgroundColor: animeEraForYear(premiered).accent }}
                  >
                    {premiered}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
