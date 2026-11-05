import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, CalendarDays, Clock, Flame, Moon, PartyPopper, Sparkles, Trophy, Tv } from "lucide-react";
import {
  MONTH_NAMES,
  buildYearRecap,
  formatWatchTime,
  recapYears,
  timeOfDayLabel,
  type RecapRead,
  type RecapTitle,
  type RecapWatch,
} from "../../../../packages/shared/year-review";
import { safeImageSrc } from "../lib/image-guard";

type Activity = { watches: RecapWatch[]; reads: RecapRead[] };

function Stat({ value, unit, label, icon: Icon }: { value: string; unit?: string; label: string; icon: typeof Clock }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
      <Icon size={16} className="mb-3 text-accent" />
      <div className="text-3xl font-black tabular-nums">{value}{unit && <span className="ml-1.5 text-base font-bold text-white/45">{unit}</span>}</div>
      <div className="mt-1 text-xs uppercase tracking-wider text-white/40">{label}</div>
    </div>
  );
}

/** One series per chart: bars by month, hover for the exact value. */
function MonthChart({ title, values, format }: { title: string; values: number[]; format: (v: number) => string }) {
  const max = Math.max(1, ...values);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-bold uppercase tracking-[0.22em] text-white/50">{title}</h3>
        <span className="text-xs tabular-nums text-white/60">{hover != null ? `${MONTH_NAMES[hover]}: ${format(values[hover])}` : " "}</span>
      </div>
      <div className="flex h-40 items-end gap-1.5 border-b border-white/10" role="list" aria-label={title}>
        {values.map((v, i) => (
          <div
            key={i}
            role="listitem"
            aria-label={`${MONTH_NAMES[i]}: ${format(v)}`}
            className="group flex h-full flex-1 cursor-default items-end"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className={`w-full rounded-t bg-accent transition-opacity ${hover != null && hover !== i ? "opacity-40" : ""}`}
              style={{ height: v > 0 ? `${Math.max(2, (v / max) * 100)}%` : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5 text-center text-[10px] text-white/35">
        {MONTH_NAMES.map((m) => <span key={m} className="flex-1">{m.slice(0, 1)}</span>)}
      </div>
    </section>
  );
}

function titleLink(kind: "anime" | "manga" | "novel", key: string): string | null {
  if (kind === "anime") return Number(key) > 0 && Number(key) < 1_000_000_000 ? `/anime/${key}` : null;
  if (kind === "manga") return `/manga/${key}`;
  const split = key.indexOf(":");
  return split > 0 ? `/novels/t/${encodeURIComponent(key.slice(0, split))}/${encodeURIComponent(key.slice(split + 1))}` : null;
}

function Cover({ item, className }: { item: RecapTitle; className: string }) {
  const src = safeImageSrc(item.cover);
  return src
    ? <img src={src} alt="" className={`${className} object-cover`} loading="lazy" />
    : <div className={`${className} bg-white/5`} />;
}

function Linked({ to, children, className }: { to: string | null; children: React.ReactNode; className?: string }) {
  return to ? <Link to={to} className={className}>{children}</Link> : <div className={className}>{children}</div>;
}

function Highlight({ icon: Icon, label, value, detail }: { icon: typeof Clock; label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-white/45"><Icon size={14} className="text-accent" /> {label}</div>
      <div className="mt-3 text-xl font-black">{value}</div>
      {detail && <div className="mt-1 text-sm text-white/45">{detail}</div>}
    </div>
  );
}

export default function YearReview() {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    window.api.list.recapActivity()
      .then(setActivity)
      .catch((reason) => setError(reason?.message ?? "Your history couldn't be read."));
  }, []);

  const years = useMemo(() => {
    const found = activity ? recapYears(activity.watches, activity.reads) : [];
    const thisYear = new Date().getFullYear();
    return found.includes(thisYear) ? found : [thisYear, ...found];
  }, [activity]);

  const recap = useMemo(() => activity ? buildYearRecap(year, activity.watches, activity.reads) : null, [activity, year]);

  if (error) return <div className="flex min-h-full items-center justify-center p-8"><div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-red-200">{error}</div></div>;
  if (!recap) return <div className="mx-auto min-h-full max-w-[1450px] animate-pulse bg-white/[0.025]" />;

  const time = formatWatchTime(recap.minutes);
  const chapters = recap.mangaChapters + recap.novelChapters;
  const busiest = recap.busiestMonth;

  return (
    <div className="min-h-full overflow-hidden bg-black pb-16">
      <section className="relative border-b border-white/10 px-6 py-14 lg:px-12">
        <div className="pointer-events-none absolute -right-40 -top-56 h-[520px] w-[520px] rounded-full bg-accent/20 blur-[130px]" />
        <div className="relative mx-auto max-w-[1450px]">
          <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.3em] text-accent"><PartyPopper size={17} /> Your {recap.year} in review</div>
          <h1 className="max-w-4xl text-4xl font-black tracking-tight md:text-6xl">{recap.persona.title}</h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/55">{recap.persona.line}</p>
          <div className="mt-7 flex flex-wrap gap-2" role="tablist" aria-label="Year">
            {years.map((y) => (
              <button
                key={y}
                role="tab"
                aria-selected={y === year}
                onClick={() => setYear(y)}
                className={`rounded-full px-4 py-2 text-xs font-bold transition ${y === year ? "bg-white text-black" : "border border-white/10 bg-white/5 text-white/60 hover:bg-white/10"}`}
              >{y}</button>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1450px] space-y-9 px-6 py-9 lg:px-12">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Clock} value={time.value} unit={time.unit} label="Watched" />
          <Stat icon={Tv} value={recap.episodes.toLocaleString("en-US")} label={recap.episodes === 1 ? "Episode finished" : "Episodes finished"} />
          <Stat icon={Sparkles} value={String(recap.shows)} label={recap.shows === 1 ? "Show" : "Shows"} />
          <Stat icon={BookOpen} value={chapters.toLocaleString("en-US")} label={chapters === 1 ? "Chapter read" : "Chapters read"} />
        </section>

        {!recap.hasActivity ? (
          <section className="rounded-2xl border border-dashed border-white/15 px-6 py-20 text-center">
            <CalendarDays className="mx-auto mb-4 text-white/25" size={36} />
            <h2 className="text-xl font-bold">Nothing recorded for {recap.year}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-white/40">The recap is built from episodes played and chapters read in AniTrack on this computer. Watch or read something and it starts filling in.</p>
          </section>
        ) : (
          <>
            {recap.topShows.length > 0 && (
              <section>
                <div className="mb-5 flex items-center gap-2"><Trophy size={17} className="text-accent" /><h2 className="text-2xl font-black">Your top shows</h2></div>
                <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {recap.topShows.map((show, i) => (
                    <li key={show.key}>
                      <Linked to={titleLink("anime", show.key)} className="flex h-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3 transition hover:bg-white/[0.07] xl:flex-col xl:items-start">
                        <div className="relative shrink-0 xl:w-full">
                          <Cover item={show} className="h-24 w-16 rounded-lg xl:h-56 xl:w-full" />
                          <span className="absolute -left-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm font-black text-black">{i + 1}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="line-clamp-2 font-bold">{show.title}</div>
                          <div className="mt-1 text-xs text-white/45">{show.count} {show.count === 1 ? "episode" : "episodes"} · {formatWatchTime(show.minutes).value} {formatWatchTime(show.minutes).unit}</div>
                        </div>
                      </Linked>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section className="grid gap-4 lg:grid-cols-2">
              <MonthChart title="Watching by month" values={recap.monthMinutes} format={(v) => { const t = formatWatchTime(v); return `${t.value} ${t.unit}`; }} />
              {chapters > 0
                ? <MonthChart title="Reading by month" values={recap.monthChapters} format={(v) => `${v} ${v === 1 ? "chapter" : "chapters"}`} />
                : (
                  <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                    <h3 className="text-xs font-bold uppercase tracking-[0.22em] text-white/50">Top genres</h3>
                    <GenreList genres={recap.topGenres} />
                  </section>
                )}
            </section>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {busiest != null && <Highlight icon={CalendarDays} label="Busiest month" value={MONTH_NAMES[busiest]} detail={`${formatWatchTime(recap.monthMinutes[busiest]).value} ${formatWatchTime(recap.monthMinutes[busiest]).unit} watched${recap.monthChapters[busiest] ? `, ${recap.monthChapters[busiest]} chapters read` : ""}`} />}
              {recap.biggestDay && <Highlight icon={Flame} label="Biggest day" value={`${MONTH_NAMES[recap.biggestDay.month]} ${recap.biggestDay.day}`} detail={`${recap.biggestDay.count} ${recap.biggestDay.count === 1 ? "episode" : "episodes"} in one day`} />}
              <Highlight icon={Sparkles} label="Longest streak" value={`${recap.longestStreak} ${recap.longestStreak === 1 ? "day" : "days"}`} detail={`${recap.activeDays} active ${recap.activeDays === 1 ? "day" : "days"} in all`} />
              {recap.timeOfDay && <Highlight icon={Moon} label="Favourite time" value={timeOfDayLabel(recap.timeOfDay).replace(/^./, (c) => c.toUpperCase())} detail={`${recap.timeOfDayShare}% of your sessions`} />}
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              {recap.firstShow && (
                <TitleCard label={`Your ${recap.year} began with`} item={recap.firstShow} to={titleLink("anime", recap.firstShow.key)} detail={`${recap.firstShow.count} ${recap.firstShow.count === 1 ? "episode" : "episodes"} this year`} />
              )}
              {recap.topManga && <TitleCard label="Most-read manga" item={recap.topManga} to={titleLink("manga", recap.topManga.key)} detail={`${recap.topManga.count} ${recap.topManga.count === 1 ? "chapter" : "chapters"}`} />}
              {recap.topNovel && <TitleCard label="Most-read novel" item={recap.topNovel} to={titleLink("novel", recap.topNovel.key)} detail={`${recap.topNovel.count} ${recap.topNovel.count === 1 ? "chapter" : "chapters"}`} />}
              {chapters > 0 && recap.topGenres.length > 0 && (
                <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                  <h3 className="text-xs font-bold uppercase tracking-[0.22em] text-white/50">Top genres</h3>
                  <GenreList genres={recap.topGenres} />
                </section>
              )}
            </section>

            <p className="text-xs text-white/30">Built from what you played and read in AniTrack on this computer, including progress synced from your other devices. Episodes count once you've watched 85% of them; shows you removed from Continue Watching aren't included.</p>
          </>
        )}
      </div>
    </div>
  );
}

function GenreList({ genres }: { genres: { label: string; count: number }[] }) {
  if (!genres.length) return <div className="py-8 text-center text-sm text-white/30">Not enough show details yet</div>;
  const max = genres[0].count;
  return (
    <div className="mt-4 space-y-3">
      {genres.map((g) => (
        <div key={g.label}>
          <div className="mb-1 flex justify-between text-sm"><span className="font-semibold">{g.label}</span><span className="text-xs text-white/40 tabular-nums">{g.count}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-accent" style={{ width: `${(g.count / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function TitleCard({ label, item, to, detail }: { label: string; item: RecapTitle; to: string | null; detail: string }) {
  return (
    <Linked to={to} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4 transition hover:bg-white/[0.07]">
      <Cover item={item} className="h-24 w-16 shrink-0 rounded-lg" />
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">{label}</div>
        <div className="mt-1 line-clamp-2 text-lg font-black">{item.title}</div>
        <div className="mt-1 text-sm text-white/45">{detail}</div>
      </div>
    </Linked>
  );
}
