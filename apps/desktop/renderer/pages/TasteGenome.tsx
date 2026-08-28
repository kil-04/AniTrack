import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Activity, Dna, Sparkles } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import Card from "../components/Card";
import { analyzeTasteGenome, type TasteAffinity } from "../../../../packages/shared/taste-genome";

function SignalBars({ title, items, color }: { title: string; items: TasteAffinity[]; color: string }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
      <div className="mb-5 text-xs font-bold uppercase tracking-[0.22em] text-white/45">{title}</div>
      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.key}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold">{item.label}</span>
              <span className="text-xs text-white/35">{item.count} titles{item.averageScore ? ` · ${item.averageScore.toFixed(1)}` : ""}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${item.strength}%`, backgroundColor: color, boxShadow: `0 0 14px ${color}66` }} />
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="py-8 text-center text-sm text-white/30">Not enough metadata yet</div>}
      </div>
    </section>
  );
}

export default function TasteGenomePage() {
  const list = useAppStore((state) => state.list);
  const mal = useAppStore((state) => state.mal);
  const refreshList = useAppStore((state) => state.refreshList);

  useEffect(() => { void refreshList(); }, [refreshList]);

  const genome = useMemo(() => analyzeTasteGenome(list.map(({ entry, anime }) => ({
    status: entry.status,
    score: entry.score,
    year: anime?.year,
    genres: anime?.genres,
    format: anime?.format,
  }))), [list]);

  const signalTitles = useMemo(() => list
    .filter(({ entry, anime }) => anime && (entry.status === "completed" || entry.status === "watching"))
    .sort((a, b) => (b.entry.score ?? 0) - (a.entry.score ?? 0) || b.entry.updatedAt - a.entry.updatedAt)
    .slice(0, 12), [list]);

  return (
    <div className="min-h-full overflow-hidden bg-black pb-16">
      <section className="relative border-b border-white/10 px-6 py-14 lg:px-12">
        <div className="pointer-events-none absolute -left-32 -top-48 h-[500px] w-[500px] rounded-full bg-fuchsia-600/15 blur-[120px]" />
        <div className="pointer-events-none absolute right-0 top-0 h-full w-1/2 bg-[radial-gradient(circle_at_center,rgba(76,168,222,0.12),transparent_68%)]" />
        <div className="relative mx-auto grid max-w-[1450px] items-center gap-10 lg:grid-cols-[1fr_auto]">
          <div>
            <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.3em] text-fuchsia-300"><Dna size={17} /> Personal taste sequence</div>
            <h1 className="max-w-4xl text-4xl font-black tracking-tight md:text-6xl">{genome.archetype}</h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/55">{genome.summary}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/60">{mal.connected ? `Sequenced from ${mal.username ?? "your MAL"}` : "Sequenced from your local list"}</span>
              <Link to="/time-machine" className="rounded-full border border-fuchsia-300/20 bg-fuchsia-400/10 px-4 py-2 text-xs font-bold text-fuchsia-200 hover:bg-fuchsia-400/20">Enter the Time Machine →</Link>
            </div>
          </div>
          <div className="relative flex h-44 w-44 items-center justify-center rounded-full" style={{ background: `conic-gradient(#e879f9 ${genome.confidence}%, rgba(255,255,255,0.06) 0)` }}>
            <div className="flex h-[156px] w-[156px] flex-col items-center justify-center rounded-full bg-black">
              <span className="text-4xl font-black">{genome.confidence}%</span>
              <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">Signal confidence</span>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1450px] space-y-9 px-6 py-9 lg:px-12">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-5"><div className="text-3xl font-black">{genome.analyzed}</div><div className="mt-1 text-xs uppercase tracking-wider text-white/35">Experienced titles</div></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-5"><div className="text-3xl font-black">{genome.meanScore?.toFixed(2) ?? "—"}</div><div className="mt-1 text-xs uppercase tracking-wider text-white/35">Mean personal score</div></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-5"><div className="text-3xl font-black">{genome.classicShare}%</div><div className="mt-1 text-xs uppercase tracking-wider text-white/35">Pre-2000 signal</div></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-5"><div className="text-3xl font-black">{genome.rated}</div><div className="mt-1 text-xs uppercase tracking-wider text-white/35">Explicit ratings</div></div>
        </section>

        {genome.analyzed === 0 ? (
          <section className="rounded-2xl border border-dashed border-white/15 px-6 py-20 text-center">
            <Activity className="mx-auto mb-4 text-white/25" size={36} />
            <h2 className="text-xl font-bold">No taste signal yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-white/40">Connect MAL or mark anime as watching/completed. Plan-to-watch titles are deliberately excluded because wanting to try something is not the same as liking it.</p>
          </section>
        ) : (
          <>
            <section className="grid gap-4 lg:grid-cols-3">
              <SignalBars title="Era chromosomes" items={genome.eras} color="#e879f9" />
              <SignalBars title="Genre chromosomes" items={genome.genres} color="#60a5fa" />
              <SignalBars title="Format chromosomes" items={genome.formats} color="#34d399" />
            </section>
            {signalTitles.length > 0 && (
              <section>
                <div className="mb-5 flex items-center gap-2"><Sparkles size={17} className="text-fuchsia-300" /><div><div className="text-xs font-bold uppercase tracking-[0.22em] text-fuchsia-300">Strongest memories</div><h2 className="text-2xl font-black">Titles shaping your sequence</h2></div></div>
                <div className="flex gap-5 overflow-x-auto pb-5 pt-1 no-scrollbar">{signalTitles.map(({ entry, anime }) => <Card key={entry.animeId} anime={anime!} size="sm" />)}</div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
