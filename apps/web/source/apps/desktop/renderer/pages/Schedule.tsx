import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bookmark, CalendarClock, CalendarX2, ChevronRight, Play } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { formatLabel } from "../components/Card";
import type { RecentEpisode } from "../../../../packages/shared/types";

/**
 * The next 7 days of airing, one day at a time, as on Android (ui/ScheduleScreen.kt):
 * everything AniList lists for the day, your shows highlighted and tagged, with a
 * switch to show only them.
 */

const DAY_MS = 86_400_000;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayLabel(day: Date, today: Date): string {
  const diff = Math.round((day.getTime() - today.getTime()) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return day.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

function timeLabel(airingAtSec: number): string {
  return new Date(airingAtSec * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "in 3h 20m", "in 12m" or "Aired" (Android's relativeAiring). */
function relativeAiring(airingAtSec: number, nowSec: number): string {
  const secs = airingAtSec - nowSec;
  if (secs <= 0) return "Aired";
  const minutes = Math.floor(secs / 60);
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
  return `in ${Math.max(1, minutes)}m`;
}

export default function Schedule() {
  const navigate = useNavigate();
  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)), [today]);
  // Each day loads when first selected (AniList pages hold 50 episodes, under two days).
  const [byDay, setByDay] = useState<Record<string, RecentEpisode[]>>({});
  const [dayIndex, setDayIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [onList, setOnList] = useState<Set<number>>(new Set());
  // Shows you're watching without listing them (Continue Watching) count as yours too.
  const [watching, setWatching] = useState<Set<number>>(new Set());
  const [onlyMine, setOnlyMine] = useState(false);
  const [now, setNow] = useState(Date.now());

  const day = days[dayIndex];
  const key = day.toDateString();

  useEffect(() => {
    if (byDay[key]) return;
    let alive = true;
    setFailed(false);
    const from = Math.floor(day.getTime() / 1000);
    const to = Math.floor(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime() / 1000);
    window.api.anilist.airingBetween(from, to)
      .then((list) => { if (alive) setByDay((all) => ({ ...all, [key]: list })); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.api.list.getAll()
      .then((all) => setOnList(new Set((all as any[]).map((x) => x?.entry?.animeId).filter((id): id is number => Number.isInteger(id) && id > 0))))
      .catch(() => {});
    window.api.list.continueWatching()
      .then((items) => setWatching(new Set(items.map((item) => item.anime?.id).filter((id): id is number => Number.isInteger(id) && id > 0))))
      .catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const mine = (id: number) => onList.has(id) || watching.has(id);
  const loaded = byDay[key];
  const shown = (loaded ?? []).filter((a) => !onlyMine || mine(a.anime.id));
  const nowSec = Math.floor(now / 1000);

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <PageHeader scene="station"
        icon={CalendarClock}
        title="Schedule"
        subtitle="Episodes airing over the next 7 days, in your time zone."
      />

      <div className="mb-3 flex flex-wrap gap-2">
        {days.map((d, i) => {
          const count = byDay[d.toDateString()]?.length;
          const active = i === dayIndex;
          return (
            <button key={d.toDateString()} type="button" onClick={() => setDayIndex(i)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${active ? "bg-accent text-white shadow-glow" : "bg-white/[0.06] text-ink-2 hover:bg-white/10 hover:text-white"}`}>
              {dayLabel(d, today)}
              {count != null && <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${active ? "bg-white/20" : "bg-white/10 text-ink-3"}`}>{count}</span>}
            </button>
          );
        })}
      </div>
      {(onList.size > 0 || watching.size > 0) && (
        <button type="button" onClick={() => setOnlyMine((v) => !v)}
          className={`mb-5 flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${onlyMine ? "border-accent/50 bg-accent/15 text-white" : "border-white/10 text-ink-2 hover:text-white"}`}>
          <Bookmark size={15} className={onlyMine ? "text-accent" : ""} /> Only my shows
        </button>
      )}

      {!loaded && !failed && (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-[84px] rounded-2xl" />)}
        </div>
      )}

      {(failed || (loaded && shown.length === 0)) && (
        <EmptyState icon={CalendarX2} title={failed ? "Couldn't load the schedule" : "Nothing airing"}
          action={failed ? <button type="button" className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>Retry</button> : undefined}>
          {failed ? "AniList didn't answer. Check your connection and try again."
            : onlyMine ? "None of your shows air this day." : "AniList has no episodes listed for this day yet."}
        </EmptyState>
      )}

      {loaded && (
        <div className="flex flex-col gap-2.5">
          {shown.map((a) => {
            const listed = onList.has(a.anime.id);
            const yours = listed || watching.has(a.anime.id);
            const aired = a.airingAt <= nowSec;
            const format = formatLabel(a.anime.format);
            return (
              <button key={`${a.anime.id}-${a.episode}`} type="button" onClick={() => navigate(`/anime/${a.anime.id}`)}
                className={`group flex items-center gap-4 rounded-2xl border p-3 pr-4 text-left transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow ${yours ? "border-accent/35 bg-accent/[0.08]" : "border-white/[0.06] bg-surface-1/70 hover:bg-surface-2/80"}`}>
                {/* Time block: the local airing time and how far away it is. */}
                <div className="w-[76px] shrink-0">
                  <div className="text-[15px] font-bold tabular-nums text-white">{timeLabel(a.airingAt)}</div>
                  <div className={`mt-0.5 text-xs font-semibold ${aired ? "text-emerald-400" : "text-ink-3"}`}>{relativeAiring(a.airingAt, nowSec)}</div>
                </div>
                {a.anime.coverImage ? (
                  <img src={a.anime.coverImage} alt="" loading="lazy" decoding="async" className="h-[62px] w-[44px] shrink-0 rounded-lg object-cover ring-1 ring-white/10" />
                ) : (
                  <div className="h-[62px] w-[44px] shrink-0 rounded-lg bg-white/5" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold text-white">{a.anime.title}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-ink-2">
                    <span>Episode {a.episode}{format ? ` · ${format}` : ""}</span>
                    {listed ? (
                      <span className="badge flex items-center gap-1 bg-accent/15 text-accent"><Bookmark size={11} /> ON MY LIST</span>
                    ) : yours ? (
                      <span className="badge flex items-center gap-1 bg-accent/15 text-accent"><Play size={11} /> WATCHING</span>
                    ) : null}
                  </div>
                </div>
                <ChevronRight size={18} className="shrink-0 text-ink-3 transition group-hover:text-white" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
