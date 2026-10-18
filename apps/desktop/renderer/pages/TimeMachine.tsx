import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Clapperboard, Clock3, Dices, Gem, History, Landmark, Layers, RefreshCw, Sparkles, Stamp, type LucideIcon } from "lucide-react";
import Card from "../components/Card";
import Row from "../components/Row";
import SectionHeader from "../components/SectionHeader";
import type { AnimeMeta, PremieredAnime } from "../../../../packages/shared/types";
import {
  ANIME_ERAS,
  TIME_MACHINE_ROW,
  animeEraForYear,
  clampTimeMachineYear,
  curateTimeMachineYear,
  mysteryPick,
  yearInDecade,
  type TimeMachineCandidate,
  type TimeMachineSeason,
} from "../../../../packages/shared/time-machine";
import { rejectOversizedImage, safeImageSrc } from "../lib/image-guard";

const VISITED_KEY = "anitrack.timeMachine.visited";
const YEAR_KEY = "anitrack.timeMachine.year";
const SEASONS: [TimeMachineSeason, string][] = [["ALL", "All year"], ["WINTER", "Winter"], ["SPRING", "Spring"], ["SUMMER", "Summer"], ["FALL", "Fall"]];
const LAST_YEAR = Math.min(2029, new Date().getFullYear());
/** Fewer titles than this and the year gets a note that AniList's record is thin. */
const QUIET_YEAR = 12;

function countLabel(value: number, singular: string): string {
  return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

function membersLabel(count?: number | null): string {
  if (!count) return "";
  return count >= 1000 ? `${Math.round(count / 1000)}k members` : `${count} members`;
}

// The passport and the last year visited live in this window's storage; unreadable storage just starts fresh.
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

function readLastYear(): number {
  try {
    const saved = Number(window.localStorage.getItem(YEAR_KEY));
    return Number.isInteger(saved) && saved >= 1960 && saved <= LAST_YEAR ? saved : 1988;
  } catch {
    return 1988;
  }
}

function saveLastYear(year: number) {
  try {
    window.localStorage.setItem(YEAR_KEY, String(year));
  } catch {
    // The dial just opens on 1988 next time.
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

/** "Cowboy Bebop, Serial Experiments Lain and Perfect Blue", each a link to its page. */
function TitleLinks({ items }: { items: AnimeMeta[] }) {
  return (
    <>
      {items.map((item, i) => (
        <Fragment key={item.id}>
          {i > 0 && (i === items.length - 1 ? " and " : ", ")}
          <Link to={`/anime/${item.id}`} state={{ anime: item }} className="text-white underline decoration-white/25 underline-offset-4 transition hover:decoration-white">{item.title}</Link>
        </Fragment>
      ))}
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold">{children}</span>
    </div>
  );
}

/** A row of titles; [expandable] rows switch to a full grid beyond the first [TIME_MACHINE_ROW] until [period] changes. */
function TitleRow({ icon, title, subtitle, items, period, expandable = false }: { icon: LucideIcon; title: string; subtitle: string; items: AnimeMeta[]; period: string; expandable?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [period]);
  if (items.length === 0) return null;
  const more = expandable && items.length > TIME_MACHINE_ROW;
  return (
    <section>
      <SectionHeader icon={icon} title={title} subtitle={subtitle} className="px-8">
        {more && (
          <button type="button" onClick={() => setExpanded((value) => !value)} className="btn btn-ghost btn-sm">
            {expanded ? "Show fewer" : `Show all ${items.length}`}
          </button>
        )}
      </SectionHeader>
      {expanded ? (
        <div className="mb-10 grid grid-cols-2 gap-x-4 gap-y-8 px-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          {items.map((item) => <Card key={item.id} anime={item} />)}
        </div>
      ) : (
        <Row>{items.slice(0, TIME_MACHINE_ROW).map((item) => <Card key={item.id} anime={item} size="md" />)}</Row>
      )}
    </section>
  );
}

export default function TimeMachine() {
  const navigate = useNavigate();
  const [year, setYear] = useState(readLastYear);
  const [season, setSeason] = useState<TimeMachineSeason>("ALL");
  const [titles, setTitles] = useState<TimeMachineCandidate[]>([]);
  const [gemTitles, setGemTitles] = useState<TimeMachineCandidate[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visited, setVisited] = useState<Set<number>>(() => readVisited());
  const [history, setHistory] = useState<AnimeMeta[]>([]);
  const [onThisDay, setOnThisDay] = useState<PremieredAnime[]>([]);
  const era = animeEraForYear(year);
  const today = useMemo(() => new Date(), []);

  // The year's titles: the main lists first (what's on screen), then the gems in the background.
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      setTitles([]);
      setGemTitles([]);
      window.api.anilist.timeMachineYear(year, "main")
        .then((found) => {
          if (!active) return;
          setTitles(found);
          setLoading(false);
          saveLastYear(year);
          setVisited((previous) => {
            if (previous.has(year)) return previous;
            const next = new Set(previous).add(year);
            saveVisited(next);
            return next;
          });
          window.api.anilist.timeMachineYear(year, "gems")
            .then((gems) => { if (active) setGemTitles(gems); })
            .catch(() => undefined);
        })
        .catch(() => {
          if (!active) return;
          setError(`AniList didn't answer for ${year}.`);
          setLoading(false);
        });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [year, attempt]);

  // Your own titles (list and Continue Watching), for "From your history", the passport dots and Mystery screening.
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
  const candidates = useMemo(() => [...titles, ...gemTitles], [titles, gemTitles]);
  const wholeYear = useMemo(() => curateTimeMachineYear(candidates), [candidates]);
  const view = useMemo(() => season === "ALL" ? wholeYear : curateTimeMachineYear(candidates, season), [candidates, season, wholeYear]);
  const seasonLabel = SEASONS.find(([key]) => key === season)?.[1] ?? "All year";
  const period = season === "ALL" ? String(year) : `${seasonLabel} ${year}`;
  const hero = wholeYear.headliners[0] ?? wholeYear.newShows[0] ?? wholeYear.films[0];
  const banner = [...wholeYear.headliners, ...wholeYear.newShows, ...wholeYear.films].find((item) => safeImageSrc(item.bannerImage))?.bannerImage;
  const listed = useMemo(() => new Set(history.map((item) => item.id)), [history]);
  const historyYears = useMemo(() => new Set(history.map((item) => item.year).filter((value): value is number => !!value)), [history]);
  const yours = useMemo(() => history.filter((item) => item.year === year), [history, year]);
  const explored = [...visited].filter((value) => value >= 1960 && value <= LAST_YEAR).length;
  const totalYears = LAST_YEAR - 1960 + 1;
  const { biggestDebut, bestRated, busiestStudio, topGenres } = view.stats;
  const nothingThisSeason = !loading && !error && season !== "ALL" && view.titleCount === 0;

  const surprise = () => {
    const pick = mysteryPick(view, listed);
    if (pick) navigate(`/anime/${pick.id}`, { state: { anime: pick } });
  };

  return (
    <div className="min-h-full pb-16">
      <section className="relative mx-8 mt-6 min-h-[390px] overflow-hidden rounded-[28px] bg-surface-1 shadow-pop ring-1 ring-white/[0.07]">
        {safeImageSrc(banner) && (
          <img src={safeImageSrc(banner)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" onLoad={(event) => rejectOversizedImage(event)} />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/85 to-bg/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-bg/20" />
        <div className="relative flex flex-col justify-center px-10 py-12 xl:px-14">
          <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.3em]" style={{ color: era.accent }}>
            <History size={15} /> {yearInDecade(year)}
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
          <div className="mt-7 min-h-7 max-w-4xl text-lg font-semibold leading-relaxed text-white/75">
            {loading ? (
              <span className="skeleton inline-block h-6 w-[min(32rem,80%)] rounded-lg align-middle" />
            ) : wholeYear.headliners.length > 0 ? (
              <>The year of <TitleLinks items={wholeYear.headliners} />.</>
            ) : null}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={surprise} disabled={loading || (view.newShows.length === 0 && view.films.length === 0)} className="btn btn-primary btn-lg">
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
              <div><div className="font-bold">Set the dial</div><div className="text-xs text-ink-3">Every year from 1960 to {LAST_YEAR}</div></div>
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
            <div className="grid gap-3 sm:grid-cols-3">
              {([["New shows", view.newShows.length], ["Films", view.films.length], ["Sequels", view.sequels.length]] as const).map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/[0.07] bg-surface-1/80 p-4 shadow-card">
                  {loading ? <div className="skeleton h-8 w-12 rounded-lg" /> : <div className="text-2xl font-black">{value}</div>}
                  <div className="text-xs uppercase tracking-wider text-ink-3">{label}</div>
                </div>
              ))}
            </div>
            <div className="space-y-2 rounded-2xl border border-white/[0.07] bg-surface-1/80 p-4 shadow-card">
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: era.accent }}>{period} at a glance</div>
              {loading ? (
                Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-5 rounded-md" />)
              ) : view.titleCount === 0 ? (
                <p className="text-sm text-ink-3">Nothing on record for {period}.</p>
              ) : (
                <>
                  {biggestDebut && <Fact label="Biggest debut"><Link to={`/anime/${biggestDebut.id}`} state={{ anime: biggestDebut }} className="hover:underline">{biggestDebut.title}</Link> <span className="font-normal text-ink-3">· {membersLabel(biggestDebut.popularity)}</span></Fact>}
                  {bestRated && <Fact label="Best rated"><Link to={`/anime/${bestRated.id}`} state={{ anime: bestRated }} className="hover:underline">{bestRated.title}</Link> <span className="font-normal text-ink-3">· {bestRated.averageScore}%</span></Fact>}
                  {busiestStudio && <Fact label="Busiest studio">{busiestStudio.name} <span className="font-normal text-ink-3">· {countLabel(busiestStudio.count, "title")}</span></Fact>}
                  {topGenres.length > 0 && <Fact label="Leading genres">{topGenres.join(", ")}</Fact>}
                </>
              )}
            </div>
            <p className="text-xs text-ink-3">
              {loading ? "Reading AniList…" : `Picked from ${countLabel(view.titleCount, "AniList title")} that premiered in ${period}, the most-followed first. Recaps and music videos are left out.`}
            </p>
          </div>
        </section>
      </div>

      {error ? (
        <div className="mx-8 mb-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-5 text-sm text-red-200">
          <span>{error}</span>
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className="btn btn-danger btn-sm"><RefreshCw size={14} /> Try again</button>
        </div>
      ) : loading ? (
        <div className="space-y-10 px-8 pb-10">
          {Array.from({ length: 2 }, (_, row) => (
            <div key={row}>
              <div className="skeleton mb-4 h-7 w-56 rounded-lg" />
              <div className="flex gap-4 overflow-hidden">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-64 w-44 shrink-0 rounded-2xl" />)}</div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {!nothingThisSeason && view.titleCount < QUIET_YEAR && (
            <p className="panel mx-8 mb-8 p-5 text-sm text-ink-2">
              A quiet {season === "ALL" ? "year" : "season"} in the archive: AniList lists only {countLabel(view.titleCount, "title")} from {period}.
            </p>
          )}
          {nothingThisSeason && (
            <p className="panel mx-8 mb-8 p-5 text-sm text-ink-2">Nothing on AniList premiered in {period}. Try another season, or All year.</p>
          )}
          <TitleRow icon={Sparkles} title={`New in ${period}`} subtitle="First seasons and brand-new shows, one per franchise" items={view.newShows} period={period} expandable />
          <TitleRow icon={Clapperboard} title="On the big screen" subtitle={`Films from ${period}, without recap movies`} items={view.films} period={period} expandable />
          <TitleRow icon={Layers} title="Sequels and spin-offs" subtitle="New seasons and side stories of earlier shows" items={view.sequels} period={period} expandable />
          {view.gems.length >= 3 && <TitleRow icon={Gem} title="Hidden gems" subtitle="Well-rated new titles that fewer people found" items={view.gems} period={period} />}
        </>
      )}

      <div className="space-y-10 px-8">
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
