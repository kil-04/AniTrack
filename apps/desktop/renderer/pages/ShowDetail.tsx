import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Bookmark, Check, ChevronDown, Layers, Play, Star } from "lucide-react";
import SectionHeader from "../components/SectionHeader";
import { animeStatusLabel } from "../lib/format";
import type { AnimeMeta, ListEntry, RelatedAnime, WatchStatus } from "../../../../packages/shared/types";
import ProviderPanel from "../components/ProviderPanel";
import WatchOrder from "../components/WatchOrder";
import { MoreInPrint, StoryCard } from "../components/StoryCard";
import { ThemeSongs } from "../components/ThemeSongs";
import type { StoryPlan } from "../../../../packages/shared/story-bridge";
import { useAppStore } from "../store/useAppStore";
import { rejectOversizedImage, safeImageSrc } from "../lib/image-guard";

const STATUS_OPTIONS: { value: WatchStatus; label: string }[] = [
  { value: "watching", label: "Watching" },
  { value: "completed", label: "Completed" },
  { value: "on_hold", label: "On hold" },
  { value: "dropped", label: "Dropped" },
  { value: "plan_to_watch", label: "Plan to watch" },
];

function RelatedCard({ rel, relationType }: { rel: AnimeMeta; relationType: string }) {
  const navigate = useNavigate();
  const [isHovered, setIsHovered] = useState(false);
  const [fetchedMeta, setFetchedMeta] = useState<AnimeMeta | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const cardRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (isHovered && cardRef.current) {
      setRect(cardRef.current.getBoundingClientRect());
      if (!rel.synopsis && !fetchedMeta && !isFetching) {
        setIsFetching(true);
        if (rel.id > 0 && rel.id < 1000000000) {
          window.api.anilist.get(rel.id).then((meta: AnimeMeta | null) => {
            if (meta) setFetchedMeta(meta);
            setIsFetching(false);
          }).catch(() => setIsFetching(false));
        } else if (rel.title) {
          window.api.anilist.search(rel.title).then((results: AnimeMeta[]) => {
             if (results && results.length > 0) return window.api.anilist.get(results[0].id);
             throw new Error("Not found");
          }).then((meta: AnimeMeta | null) => {
             if (meta) setFetchedMeta(meta);
             setIsFetching(false);
          }).catch(() => setIsFetching(false));
        } else {
          setIsFetching(false);
        }
      }
    }
  }, [isHovered, rel.id, rel.title, rel.synopsis, fetchedMeta, isFetching]);

  const displayAnime = fetchedMeta || rel;

  const tooltipPortal = isHovered && rect ? createPortal(
    <div 
      className="pointer-events-none fixed z-[9999] flex w-72 flex-col rounded-2xl border border-white/10 bg-surface-1/95 p-5 shadow-pop backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200"
      style={{
        left: rect.right + 15 + 288 > window.innerWidth ? rect.left - 288 - 15 : rect.right + 15,
        top: Math.max(10, Math.min(window.innerHeight - 320, rect.top + rect.height / 2 - 160)),
      }}
    >
      <h3 className="font-bold text-white text-lg leading-tight mb-2">{displayAnime.title}</h3>
      {displayAnime.averageScore && (
        <div className="mb-3 text-sm font-bold text-amber-300">★ {(displayAnime.averageScore / 10).toFixed(1)} / 10</div>
      )}
      {(displayAnime.year || displayAnime.status || displayAnime.episodes || displayAnime.duration) && (
        <div className="flex flex-wrap gap-2 mb-3">
          {displayAnime.year && <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-bold text-ink-2">{displayAnime.year}</span>}
          {displayAnime.status && <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-bold text-ink-2">{displayAnime.status}</span>}
          {displayAnime.episodes && <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-bold text-ink-2">{displayAnime.episodes} EPS</span>}
          {displayAnime.duration && <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-bold text-ink-2">{displayAnime.duration}m</span>}
        </div>
      )}
      {displayAnime.genres && displayAnime.genres.length > 0 && (
        <div className="text-xs text-white/50 mb-3">{displayAnime.genres.join(", ")}</div>
      )}
      {displayAnime.synopsis ? (
        <p className="text-xs text-white/80 line-clamp-5 leading-relaxed" dangerouslySetInnerHTML={{ __html: displayAnime.synopsis }} />
      ) : isFetching ? (
        <p className="text-xs text-white animate-pulse italic">Loading details from network...</p>
      ) : (
        <p className="text-xs text-white/40 italic">No synopsis available.</p>
      )}
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button
        ref={cardRef}
        onClick={() => navigate(`/anime/${rel.id}`, { state: { anime: displayAnime } })}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="group w-32 flex-shrink-0 text-left"
      >
        <div className="relative overflow-hidden rounded-xl shadow-card ring-1 ring-white/[0.06] transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-glow group-hover:ring-2 group-hover:ring-accent/60">
          {rel.coverImage ? (
            <img
              src={rel.coverImage}
              alt={rel.title}
              className="h-48 w-32 object-cover transition duration-700 ease-out group-hover:scale-[1.06]"
            />
          ) : (
            <div className="h-48 w-32 rounded-xl bg-white/5" />
          )}
          <div className="badge badge-glass absolute left-1.5 top-1.5 normal-case tracking-normal">
            {relationType.toLowerCase().replace(/_/g, " ")}
          </div>
        </div>
        <p className="mt-2 line-clamp-2 text-xs font-medium leading-tight text-ink-2 transition group-hover:text-white">{rel.title}</p>
      </button>
      {tooltipPortal}
    </>
  );
}

export default function ShowDetail() {
  const { id } = useParams();
  const animeId = Number(id);
  const navigate = useNavigate();
  const location = useLocation();
  const stateAnime = location.state?.anime as AnimeMeta | undefined;
  const [anime, setAnime] = useState<AnimeMeta | null>(stateAnime || null);
  const [related, setRelated] = useState<RelatedAnime[]>([]);
  const [chainIds, setChainIds] = useState<number[]>([]);
  const [story, setStory] = useState<StoryPlan | null>(null);
  const list = useAppStore((s) => s.list);
  const refreshList = useAppStore((s) => s.refreshList);
  const entry: ListEntry | undefined = list.find(
    (x) => x.entry.animeId === animeId,
  )?.entry;

  useEffect(() => {
    let cancelled = false;
    if (stateAnime) {
      setAnime(stateAnime);
    } else {
      setAnime(null);
    }
    setRelated([]);
    setChainIds([]);
    setStory(null);
    window.api.anilist.get(animeId).then((a) => {
      if (cancelled) return;
      if (a) { setAnime(a); return; }
      const fromStore = list.find((x) => x.entry.animeId === animeId)?.anime;
      if (fromStore) setAnime(fromStore);
      else if (!stateAnime) setAnime({ id: animeId, title: "Unknown", coverImage: null } as any);
    }).catch(() => {
      if (!stateAnime && !cancelled) {
        setAnime({ id: animeId, title: "Unknown", coverImage: null } as any);
      }
    });
    if (animeId > 0 && animeId < 1_000_000_000) {
      window.api.anilist.relations(animeId)
        .then((r) => {
          if (cancelled) return;
          setRelated(r.filter((x) => ["SEQUEL", "PREQUEL", "SIDE_STORY", "ALTERNATIVE", "SPIN_OFF", "PARENT"].includes(x.relationType)));
        })
        .catch(() => {});
      window.api.anilist.story(animeId)
        .then((plan) => { if (!cancelled) setStory(plan); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeId, stateAnime]);

  if (!anime) return (
    <div className="px-8 pt-6">
      <div className="skeleton h-[46vh] max-h-[480px] min-h-[320px] w-full rounded-[28px]" />
    </div>
  );

  async function updateStatus(status: WatchStatus) {
    await window.api.list.set({
      animeId,
      status,
      episodesWatched: entry?.episodesWatched ?? 0,
      score: entry?.score ?? null,
      updatedAt: Date.now(),
    });
    await refreshList();
  }

  async function updateScore(score: number | null) {
    if (!entry) return;
    await window.api.list.set({
      animeId,
      status: entry.status,
      episodesWatched: entry.episodesWatched,
      score,
      updatedAt: Date.now(),
    });
    await refreshList();
  }

  const bannerSrc = safeImageSrc(anime.bannerImage, anime.coverImage) || "";

  return (
    <div className="relative pb-16">

      {/* Banner */}
      <div className="relative h-[46vh] max-h-[480px] min-h-[320px] w-full overflow-hidden">
        {bannerSrc && (
          <img src={bannerSrc} alt="" className="h-full w-full scale-105 object-cover object-top" onLoad={(event) => rejectOversizedImage(event, anime.coverImage)} />
        )}
        <div className="absolute inset-0 bg-scrim-b" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_80%_at_18%_100%,rgb(var(--accent)/0.22),transparent_70%)]" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-bg/70 to-transparent" />
        <button
          onClick={() => navigate(-1)}
          className="btn btn-secondary btn-icon absolute left-6 top-6 h-10 w-10 rounded-full"
          title="Back"
        >
          <ArrowLeft size={17} />
        </button>
      </div>

      {/* Cover + info */}
      <div className="relative -mt-44 flex flex-col items-start gap-8 px-8 md:flex-row md:items-end">
        {anime.coverImage && (
          <motion.img
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            src={anime.coverImage}
            alt={anime.title}
            className="h-[300px] w-[204px] flex-shrink-0 rounded-2xl object-cover shadow-pop ring-1 ring-white/15"
          />
        )}

        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
          className="min-w-0 flex-1 pb-1"
        >
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight drop-shadow-[0_4px_24px_rgb(0_0_0/0.5)] xl:text-5xl">{anime.title}</h1>
          {anime.titleRomaji && anime.titleRomaji !== anime.title && (
            <div className="mt-1.5 text-sm text-ink-2">{anime.titleRomaji}</div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {anime.averageScore != null && (
              <span className="chip border-amber-300/25 bg-amber-300/10 text-amber-200">
                <Star size={12} fill="currentColor" /> {(anime.averageScore / 10).toFixed(1)}
              </span>
            )}
            {anime.year && <span className="chip">{anime.year}</span>}
            {anime.format && <span className="chip">{anime.format.replace("_", " ")}</span>}
            {anime.episodes && <span className="chip">{anime.episodes} episodes</span>}
            {anime.duration && <span className="chip">{anime.duration} min</span>}
            {anime.status && (
              <span className="chip">
                <span className={`h-1.5 w-1.5 rounded-full ${anime.status === "RELEASING" ? "bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153)]" : "bg-white/40"}`} />
                {animeStatusLabel(anime.status)}
              </span>
            )}
          </div>

          {!!anime.genres?.length && (
            <div className="mt-3 text-sm font-medium text-ink-2">{anime.genres.join("  ·  ")}</div>
          )}

          {/* List controls */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={() => document.getElementById("episodes")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="btn btn-primary btn-lg"
            >
              <Play size={18} fill="currentColor" />
              {entry && entry.episodesWatched > 0 ? `Continue · Ep ${entry.episodesWatched + 1}` : "Start watching"}
            </button>
            <label className="relative">
              <Bookmark size={16} className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 ${entry ? "fill-accent text-accent" : "text-white/80"}`} />
              <select
                value={entry?.status ?? ""}
                onChange={(e) => updateStatus(e.target.value as WatchStatus)}
                className="btn btn-secondary btn-lg cursor-pointer appearance-none pl-11 pr-10 [&>option]:bg-surface-2"
              >
              <option value="" disabled>
                {entry ? "In your list" : "Add to list"}
              </option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/60" />
            </label>

            {/* Score input */}
            {entry && (
              <div className="flex h-12 items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.05] px-3">
                <Star size={14} className="text-amber-300" />
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  placeholder="—"
                  value={entry.score ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "") { updateScore(null); return; }
                    const n = parseFloat(raw);
                    if (isFinite(n)) updateScore(Math.max(0, Math.min(10, n)));
                  }}
                  className="w-12 bg-transparent text-center text-sm font-semibold text-white outline-none placeholder:text-white/30"
                  title="Your score (0–10)"
                />
                <span className="text-xs text-ink-3">/ 10</span>
              </div>
            )}

            {entry && (
              <span className="flex h-12 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-xs font-semibold text-ink-2">
                <Check size={14} className="text-emerald-400" />
                {entry.episodesWatched} / {anime.episodes ?? "?"} watched
                {!!anime.episodes && (
                  <span className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
                    <span className="block h-full rounded-full bg-accent-gradient" style={{ width: `${Math.min(100, (entry.episodesWatched / anime.episodes) * 100)}%` }} />
                  </span>
                )}
              </span>
            )}
          </div>
        </motion.div>
      </div>

      {/* Synopsis */}
      {anime.synopsis && (
        <motion.p 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
          className="mt-8 max-w-3xl px-8 text-[15px] leading-relaxed text-ink-2"
        >
          {anime.synopsis}
        </motion.p>
      )}

      {/* The manga or novel behind this anime */}
      {story && (
        <StoryCard
          plan={story}
          finishedAnime={entry?.status === "completed" || (!!entry && !!anime.episodes && entry.episodesWatched >= anime.episodes)}
        />
      )}

      {/* Franchise watch order (season spine: prequels → this → sequels) */}
      <WatchOrder animeId={animeId} onChain={setChainIds} />

      {/* Related anime (movies, side stories, spin-offs — seasons already in the
          watch-order timeline above are filtered out to avoid duplicates) */}
      {(() => {
        const rest = related.filter(({ anime: rel }) => !chainIds.includes(rel.id));
        if (!rest.length) return null;
        return (
          <div className="mt-10 px-8">
            <SectionHeader icon={Layers} title="Related" />
            <div className="no-scrollbar flex gap-4 overflow-x-auto pb-3 pt-1">
              {rest.map(({ relationType, anime: rel }) => (
                <RelatedCard key={rel.id} rel={rel} relationType={relationType} />
              ))}
            </div>
          </div>
        );
      })()}

      {story && <MoreInPrint more={story.more} />}

      {/* Streaming episodes — always check providers; AniList's "not yet released"
          status is often stale, and the show may already be streamable. */}
      <div id="episodes" className="mt-10 scroll-mt-6 px-8">
        {anime.status === "NOT_YET_RELEASED" && (
          <p className="mb-3 text-xs text-ink-3">
            AniList lists this as upcoming — checking providers in case it's already streamable…
          </p>
        )}
        <ProviderPanel
          animeTitle={anime.titleEnglish || anime.title}
          animeTitleAlt={anime.titleEnglish ? anime.title : undefined}
          animeTitleRomaji={anime.titleRomaji ?? undefined}
          animeId={anime.id}
          animeMalId={anime.malId ?? undefined}
          animeYear={anime.year ?? undefined}
          animeEpisodes={anime.episodes ?? undefined}
          animeStatus={anime.status ?? undefined}
          resumeEpisode={entry ? entry.episodesWatched + 1 : 1}
          inline
        />
      </div>

      {/* Openings and endings (AnimeThemes.moe, AnisongDB) */}
      <ThemeSongs animeId={animeId} animeTitle={anime.title} malId={anime.malId} />
    </div>
  );
}
