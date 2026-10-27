import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, CalendarX2, Clock } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { getTrackedAiring } from "../lib/airing";
import type { AiringInfo } from "../../../../packages/shared/types";

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayLabel(airingAtSec: number, now: number): string {
  const d = new Date(airingAtSec * 1000);
  const today = startOfDay(new Date(now));
  const target = startOfDay(d);
  const diffDays = Math.round((target - today) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 0) return "Aired";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function timeLabel(airingAtSec: number): string {
  return new Date(airingAtSec * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function countdown(airingAtSec: number, now: number): string {
  const secs = airingAtSec - Math.floor(now / 1000);
  if (secs <= 0) return "out now";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

export default function Schedule() {
  const navigate = useNavigate();
  const [airing, setAiring] = useState<AiringInfo[] | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    getTrackedAiring()
      .then((a) => { if (alive) setAiring(a); })
      .catch(() => { if (alive) setAiring([]); });
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Group soonest-first into day buckets, preserving order.
  const groups = useMemo(() => {
    if (!airing) return [];
    const out: { label: string; items: AiringInfo[] }[] = [];
    for (const a of airing) {
      const label = dayLabel(a.airingAt, now);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(a);
      else out.push({ label, items: [a] });
    }
    return out;
  }, [airing, now]);

  // The soonest episode that hasn't aired yet gets the spotlight.
  const next = airing?.find((a) => a.airingAt * 1000 > now) ?? null;

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <PageHeader scene="station"
        icon={CalendarClock}
        title="Schedule"
        subtitle="Upcoming episodes for shows you're watching or planning to watch"
      />

      {airing === null && (
        <div className="flex flex-col gap-3">
          <div className="skeleton mb-7 h-[168px] rounded-[24px]" />
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton h-[96px] rounded-2xl" />
          ))}
        </div>
      )}

      {airing !== null && airing.length === 0 && (
        <EmptyState icon={CalendarX2} title="Nothing scheduled">
          Add some currently-airing shows to your list to see when new episodes drop.
        </EmptyState>
      )}

      {next && (
        <button
          onClick={() => navigate(`/anime/${next.animeId}`)}
          className="group relative mb-10 flex w-full items-center gap-6 overflow-hidden rounded-[24px] border border-white/[0.07] bg-surface-1 p-6 text-left shadow-pop transition hover:border-accent/30"
        >
          {next.coverImage && (
            <img src={next.coverImage} alt="" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-25 blur-2xl" />
          )}
          <div className="absolute inset-0 bg-[radial-gradient(60%_90%_at_0%_50%,rgb(var(--accent)/0.28),transparent_70%)]" />
          {next.coverImage ? (
            <img
              src={next.coverImage}
              alt=""
              className="relative h-[120px] w-[84px] shrink-0 rounded-2xl object-cover shadow-card ring-1 ring-white/15 transition duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="relative h-[120px] w-[84px] shrink-0 rounded-2xl bg-white/5" />
          )}
          <div className="relative min-w-0 flex-1">
            <div className="eyebrow mb-2">Next up</div>
            <div className="line-clamp-2 text-2xl font-extrabold leading-tight tracking-tight text-white">{next.title}</div>
            <div className="mt-2 text-sm text-ink-2">
              Episode {next.episode} · {dayLabel(next.airingAt, now)} at {timeLabel(next.airingAt)}
            </div>
          </div>
          <div className="relative shrink-0 text-right">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-3">Airs in</div>
            <div className="bg-accent-gradient bg-clip-text text-4xl font-black tabular-nums tracking-tight text-transparent">
              {countdown(next.airingAt, now).replace(/^in /, "")}
            </div>
          </div>
        </button>
      )}

      <div className="flex flex-col gap-9">
        {groups.map((g) => {
          const today = g.label === "Today";
          return (
            <section key={g.label}>
              <div className="mb-3 flex items-center gap-3">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    today ? "bg-accent shadow-[0_0_12px_rgb(var(--accent))]" : "bg-white/20"
                  }`}
                />
                <h2 className={`text-sm font-bold uppercase tracking-[0.14em] ${today ? "text-white" : "text-ink-2"}`}>{g.label}</h2>
                <span className="text-xs text-ink-3">
                  {g.items.length} episode{g.items.length === 1 ? "" : "s"}
                </span>
                <div className="h-px flex-1 bg-white/[0.06]" />
              </div>
              <div className="flex flex-col gap-2.5">
                {g.items.map((a) => {
                  const secs = a.airingAt - Math.floor(now / 1000);
                  const soon = secs > 0 && secs < 86_400;
                  return (
                    <button
                      key={`${a.animeId}-${a.episode}`}
                      onClick={() => navigate(`/anime/${a.animeId}`)}
                      className="group flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-surface-1/70 p-3 pr-5 text-left transition hover:-translate-y-0.5 hover:border-accent/30 hover:bg-surface-2/80 hover:shadow-glow"
                    >
                      {a.coverImage ? (
                        <img
                          src={a.coverImage}
                          alt=""
                          className="h-[72px] w-[52px] shrink-0 rounded-xl object-cover ring-1 ring-white/10"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="h-[72px] w-[52px] shrink-0 rounded-xl bg-white/5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold text-white">{a.title}</div>
                        <span className="badge mt-1.5 bg-white/[0.07] text-ink-2">Episode {a.episode}</span>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="flex items-center justify-end gap-1.5 text-[15px] font-semibold tabular-nums text-white">
                          <Clock size={14} className="text-ink-3" />
                          {timeLabel(a.airingAt)}
                        </div>
                        <div className={`mt-1 text-xs font-semibold ${soon ? "text-accent" : "text-ink-3"}`}>
                          {countdown(a.airingAt, now)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
