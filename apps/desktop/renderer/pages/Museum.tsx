import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Archive, ArrowLeft, BookOpen, Landmark, Sparkles } from "lucide-react";
import Card from "../components/Card";
import type { AnimeMeta } from "../../../../packages/shared/types";
import { buildMuseumExhibit } from "../../../../packages/shared/living-museum";
import { animeEraForYear } from "../../../../packages/shared/time-machine";

export default function Museum() {
  const id = Number(useParams().id);
  const [anime, setAnime] = useState<AnimeMeta | null>(null);
  const [shelf, setShelf] = useState<AnimeMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    window.api.anilist.get(id)
      .then(async (item) => {
        if (!active) return;
        if (!item) throw new Error("This artifact is missing from the archive.");
        setAnime(item);
        if (item.year) {
          const page = await window.api.anilist.advancedSearch({ year: item.year, sort: "SCORE_DESC" });
          if (active) setShelf(page.results.filter((candidate) => candidate.id !== item.id).slice(0, 12));
        }
      })
      .catch((reason) => { if (active) setError(reason?.message ?? "The museum archive did not answer."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  const exhibit = useMemo(() => anime ? buildMuseumExhibit(anime) : null, [anime]);
  const era = anime?.year ? animeEraForYear(anime.year) : null;

  if (loading) return <div className="mx-auto min-h-full max-w-[1500px] animate-pulse bg-white/[0.025]" />;
  if (!anime || !exhibit) return <div className="flex min-h-full items-center justify-center p-8"><div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-red-200">{error ?? "Artifact not found."}</div></div>;

  return (
    <div className="min-h-full bg-black pb-16">
      <section className="relative min-h-[520px] overflow-hidden border-b border-white/10">
        {(anime.bannerImage || anime.coverImage) && <img src={anime.bannerImage || anime.coverImage || ""} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35 blur-[1px]" />}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/90 to-black/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-black/50" />
        <div className="relative mx-auto flex min-h-[520px] max-w-[1500px] items-end gap-8 px-6 py-12 lg:px-12">
          {anime.coverImage && <img src={anime.coverImage} alt={anime.title} className="hidden h-80 w-56 rounded-lg object-cover shadow-2xl ring-1 ring-white/15 md:block" />}
          <div className="max-w-4xl">
            <Link to="/time-machine" className="mb-8 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-white/45 hover:text-white"><ArrowLeft size={14} /> Return to Time Machine</Link>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.3em]" style={{ color: era?.accent ?? "#d6c29e" }}><Landmark size={15} /> {exhibit.eyebrow}</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-7xl">{anime.title}</h1>
            {anime.titleRomaji && anime.titleRomaji !== anime.title && <div className="mt-2 text-lg text-white/40">{anime.titleRomaji}</div>}
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/65">{exhibit.curatorLine}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to={`/anime/${anime.id}`} state={{ anime }} className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:scale-105">Open full anime record</Link>
              <span className="rounded-full border border-white/15 bg-black/35 px-4 py-2.5 font-mono text-xs text-white/55">ACCESSION {exhibit.accession}</span>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] space-y-12 px-6 py-10 lg:px-12">
        <section>
          <div className="mb-5 flex items-center gap-2"><Archive size={18} style={{ color: era?.accent }} /><h2 className="text-xl font-black">Artifact label</h2></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {exhibit.facts.map((fact) => <div key={fact.label} className="rounded-xl border border-white/10 bg-white/[0.035] p-5"><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">{fact.label}</div><div className="mt-2 text-xl font-black capitalize">{fact.value}</div></div>)}
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em]" style={{ color: era?.accent }}><BookOpen size={15} /> Curator's transcript</div>
            <h2 className="mt-3 text-2xl font-black">{exhibit.room}</h2>
            <p className="mt-4 max-w-3xl whitespace-pre-line text-sm leading-7 text-white/58">{anime.synopsis || "No synopsis is preserved in the current catalogue record."}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em]" style={{ color: era?.accent }}><Sparkles size={15} /> Classification</div>
            <div className="mt-4 flex flex-wrap gap-2">{exhibit.tags.length ? exhibit.tags.map((tag) => <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/65">{tag}</span>) : <span className="text-sm text-white/35">No genre labels recorded.</span>}</div>
          </div>
        </section>

        {shelf.length > 0 && <section><div className="mb-5"><div className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: era?.accent }}>Nearby in the archive</div><h2 className="mt-1 text-2xl font-black">The {anime.year} shelf</h2><p className="mt-1 text-xs text-white/35">Other highly rated works from the same year.</p></div><div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">{shelf.map((item) => <Card key={item.id} anime={item} />)}</div></section>}
      </div>
    </div>
  );
}
