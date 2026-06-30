import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Loader2 } from "lucide-react";
import { getTrackedAiring } from "../lib/airing";
import type { AiringInfo } from "../../shared/types";

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

  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <div className="mb-1 flex items-center gap-2">
        <CalendarClock size={22} className="text-[#e50914]" />
        <h1 className="text-2xl font-bold text-white">Schedule</h1>
      </div>
      <p className="mb-6 text-sm text-white/40">
        Upcoming episodes for shows you're watching or planning to watch.
      </p>

      {airing === null && (
        <div className="flex items-center gap-2 py-16 text-white/40">
          <Loader2 size={18} className="animate-spin" /> Loading schedule…
        </div>
      )}

      {airing !== null && airing.length === 0 && (
        <div className="rounded-lg border border-white/10 bg-white/5 px-5 py-12 text-center text-sm text-white/40">
          Nothing scheduled. Add some currently-airing shows to your list to see
          when new episodes drop.
        </div>
      )}

      <div className="flex flex-col gap-7">
        {groups.map((g) => (
          <section key={g.label}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">
              {g.label}
            </div>
            <div className="flex flex-col divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
              {g.items.map((a) => (
                <button
                  key={`${a.animeId}-${a.episode}`}
                  onClick={() => navigate(`/anime/${a.animeId}`)}
                  className="flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                >
                  {a.coverImage ? (
                    <img
                      src={a.coverImage}
                      alt=""
                      className="h-14 w-10 shrink-0 rounded object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="h-14 w-10 shrink-0 rounded bg-white/5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{a.title}</div>
                    <div className="text-xs text-white/45">Episode {a.episode}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm text-white/80">{timeLabel(a.airingAt)}</div>
                    <div className="text-xs text-[#e50914]">{countdown(a.airingAt, now)}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
