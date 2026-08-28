import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock3, Dices, Radio, Sparkles } from "lucide-react";
import Card from "../components/Card";
import type { AnimeMeta } from "../../../../packages/shared/types";
import { ANIME_ERAS, animeEraForYear, clampTimeMachineYear, yearTransmission } from "../../../../packages/shared/time-machine";

const FAVORITE_DECADES = [1970, 1980, 1990];

function countLabel(value: number, singular: string): string {
  return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

export default function TimeMachine() {
  const navigate = useNavigate();
  const [year, setYear] = useState(1988);
  const [anime, setAnime] = useState<AnimeMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const era = animeEraForYear(year);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      window.api.anilist.advancedSearch({ year, sort: "SCORE_DESC" })
        .then((page) => { if (active) setAnime(page.results); })
        .catch(() => { if (active) setError(`The ${year} archive did not answer. Try the transmission again.`); })
        .finally(() => { if (active) setLoading(false); });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [year]);

  const hero = anime[0];
  const formats = useMemo(() => ({
    television: anime.filter((item) => item.format === "TV" || item.format === "TV_SHORT").length,
    cinema: anime.filter((item) => item.format === "MOVIE").length,
    ova: anime.filter((item) => item.format === "OVA").length,
  }), [anime]);
  const genreSignal = useMemo(() => {
    const counts = new Map<string, number>();
    anime.flatMap((item) => item.genres ?? []).forEach((genre) => counts.set(genre, (counts.get(genre) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [anime]);

  const surprise = () => {
    if (anime.length === 0) return;
    const pick = anime[Math.floor(Math.random() * Math.min(15, anime.length))];
    navigate(`/anime/${pick.id}`, { state: { anime: pick } });
  };

  return (
    <div className="min-h-full bg-black pb-16">
      <section className="relative min-h-[390px] overflow-hidden border-b border-white/10">
        {hero?.bannerImage && (
          <img src={hero.bannerImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/85 to-black/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/20" />
        <div className="relative mx-auto flex max-w-[1500px] flex-col justify-center px-6 py-12 lg:px-12">
          <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.3em]" style={{ color: era.accent }}>
            <Radio size={15} className="animate-pulse" /> {yearTransmission(year)}
          </div>
          <div className="flex flex-wrap items-end gap-5">
            <span className="text-[clamp(5rem,13vw,11rem)] font-black leading-[0.72] tracking-[-0.08em] text-white">{year}</span>
            <div className="max-w-xl pb-1">
              <h1 className="text-3xl font-extrabold md:text-5xl">{era.headline}</h1>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/60 md:text-base">{era.atmosphere}</p>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={surprise} disabled={anime.length === 0} className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-40">
              <Dices size={17} /> Mystery screening
            </button>
            <button onClick={() => navigate("/taste-genome")} className="flex items-center gap-2 rounded-full border border-fuchsia-300/25 bg-fuchsia-400/10 px-5 py-2.5 text-sm font-bold text-fuchsia-100 backdrop-blur hover:bg-fuchsia-400/20"><Sparkles size={16} /> View Taste Genome</button>
            <button onClick={() => setYear(clampTimeMachineYear(year - 1))} className="rounded-full border border-white/15 bg-black/30 px-5 py-2.5 text-sm text-white/80 backdrop-blur hover:bg-white/10">Previous year</button>
            <button onClick={() => setYear(clampTimeMachineYear(year + 1))} className="rounded-full border border-white/15 bg-black/30 px-5 py-2.5 text-sm text-white/80 backdrop-blur hover:bg-white/10">Next year</button>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] space-y-10 px-6 py-8 lg:px-12">
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex items-center gap-3">
              <Clock3 size={20} style={{ color: era.accent }} />
              <div><div className="font-bold">Set the dial</div><div className="text-xs text-white/40">Travel through the AniList archive</div></div>
            </div>
            <div className="flex gap-2">
              {FAVORITE_DECADES.map((decade) => (
                <button key={decade} onClick={() => setYear(decade + 5)} className={`rounded-full px-4 py-2 text-xs font-bold transition ${era.start === decade ? "text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`} style={era.start === decade ? { backgroundColor: era.accent } : undefined}>{decade}s</button>
              ))}
            </div>
          </div>
          <input aria-label="Time machine year" type="range" min="1960" max={Math.min(2029, new Date().getFullYear())} value={year} onChange={(event) => setYear(Number(event.target.value))} className="mt-6 w-full accent-white" />
          <div className="mt-2 flex justify-between text-[10px] font-semibold tracking-widest text-white/25">
            {ANIME_ERAS.map((item) => <span key={item.start}>{item.start}</span>)}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4"><div className="text-2xl font-black">{formats.television}</div><div className="text-xs uppercase tracking-wider text-white/40">TV signals found</div></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4"><div className="text-2xl font-black">{formats.cinema}</div><div className="text-xs uppercase tracking-wider text-white/40">Films recovered</div></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4"><div className="text-2xl font-black">{formats.ova}</div><div className="text-xs uppercase tracking-wider text-white/40">OVA artifacts</div></div>
        </section>

        {genreSignal.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2 text-sm font-bold"><Sparkles size={16} style={{ color: era.accent }} /> Genre signal</div>
            <div className="flex flex-wrap gap-2">{genreSignal.map(([genre, count]) => <span key={genre} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/60">{genre} · {countLabel(count, "title")}</span>)}</div>
          </section>
        )}

        <section>
          <div className="mb-5 flex items-end justify-between gap-4"><div><div className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: era.accent }}>Recovered from {year}</div><h2 className="mt-1 text-2xl font-black">The essential transmission</h2></div><span className="text-xs text-white/35">Ranked by contemporary audience score</span></div>
          {loading ? <div className="h-64 animate-pulse rounded-2xl bg-white/5" /> : error ? <button onClick={() => setYear((value) => value === 1988 ? 1989 : 1988)} className="rounded-xl border border-red-500/20 bg-red-500/10 p-5 text-left text-sm text-red-200">{error}</button> : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">{anime.slice(0, 24).map((item) => <Card key={item.id} anime={item} />)}</div>
          )}
        </section>
      </div>
    </div>
  );
}
