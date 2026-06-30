import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Plus, Check } from "lucide-react";
import type { AnimeMeta, ListEntry, RelatedAnime, WatchStatus } from "../../shared/types";
import PahePanel from "../components/PahePanel";
import { useAppStore } from "../store/useAppStore";

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
      className="fixed z-[9999] w-72 bg-[#1f1f1f] rounded-xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.8)] p-5 flex flex-col pointer-events-none animate-in fade-in zoom-in-95 duration-200"
      style={{
        left: rect.right + 15 + 288 > window.innerWidth ? rect.left - 288 - 15 : rect.right + 15,
        top: Math.max(10, Math.min(window.innerHeight - 320, rect.top + rect.height / 2 - 160)),
      }}
    >
      <h3 className="font-bold text-white text-lg leading-tight mb-2">{displayAnime.title}</h3>
      {displayAnime.averageScore && (
        <div className="text-sm font-bold text-green-400 mb-3">★ {(displayAnime.averageScore / 10).toFixed(1)} / 10</div>
      )}
      {(displayAnime.year || displayAnime.status || displayAnime.episodes || displayAnime.duration) && (
        <div className="flex flex-wrap gap-2 mb-3">
          {displayAnime.year && <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-bold">{displayAnime.year}</span>}
          {displayAnime.status && <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-bold">{displayAnime.status}</span>}
          {displayAnime.episodes && <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-bold">{displayAnime.episodes} EPS</span>}
          {displayAnime.duration && <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-bold">{displayAnime.duration}m</span>}
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
        className="flex-shrink-0 w-28 text-left group"
      >
        <div className="relative overflow-hidden rounded-lg">
          {rel.coverImage ? (
            <img
              src={rel.coverImage}
              alt={rel.title}
              className="h-40 w-28 object-cover transition group-hover:scale-105"
            />
          ) : (
            <div className="h-40 w-28 rounded-lg bg-white/5" />
          )}
          <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1.5 py-1 text-[10px] text-white/70 capitalize">
            {relationType.toLowerCase().replace(/_/g, " ")}
          </div>
        </div>
        <p className="mt-1.5 text-xs leading-tight text-white/70 line-clamp-2 group-hover:text-white transition">{rel.title}</p>
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
    }
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeId, stateAnime]);

  if (!anime) return <div className="p-8 text-white/40">Loading…</div>;

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

  const bannerSrc = anime.bannerImage || anime.coverImage || "";

  return (
    <div className="relative pb-16">

      {/* Banner */}
      <div className="relative h-[32vh] min-h-[200px] w-full overflow-hidden">
        {bannerSrc && (
          <img src={bannerSrc} alt="" className="h-full w-full object-cover object-top" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#000000] via-[#000000]/60 to-transparent" />
        <button
          onClick={() => navigate(-1)}
          className="absolute left-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm hover:bg-black/80 transition"
        >
          <ArrowLeft size={16} />
        </button>
      </div>

      {/* Cover + info */}
      <div className="relative -mt-20 flex flex-col md:flex-row items-start md:items-end gap-7 px-8">
        {anime.coverImage && (
          <motion.img
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            src={anime.coverImage}
            alt={anime.title}
            className="h-[260px] w-[175px] flex-shrink-0 rounded-xl object-cover shadow-[0_8px_30px_rgb(0,0,0,0.8)] ring-1 ring-white/20"
          />
        )}

        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
          className="min-w-0 flex-1 pb-1"
        >
          <h1 className="text-3xl font-extrabold leading-tight">{anime.title}</h1>
          {anime.titleRomaji && anime.titleRomaji !== anime.title && (
            <div className="mt-1 text-sm text-white/50">{anime.titleRomaji}</div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-3 text-sm text-white/70">
            {anime.year && <span>{anime.year}</span>}
            {anime.episodes && <span>{anime.episodes} eps</span>}
            {anime.averageScore && (
              <span>★ {(anime.averageScore / 10).toFixed(1)}</span>
            )}
            {anime.status && (
              <span className="rounded bg-white/10 px-2 py-0.5 text-xs uppercase tracking-wide">
                {anime.status}
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {(anime.genres ?? []).map((g) => (
              <span key={g} className="rounded-full bg-white/10 px-3 py-1 text-xs">{g}</span>
            ))}
          </div>

          {/* List controls */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <select
              value={entry?.status ?? ""}
              onChange={(e) => updateStatus(e.target.value as WatchStatus)}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white backdrop-blur-sm"
            >
              <option value="" disabled>
                {entry ? "In your list" : "Add to list"}
              </option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>

            {/* Score input */}
            {entry && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-white/40">★</span>
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
                  className="w-16 rounded-md border border-white/10 bg-white/5 px-2 py-2 text-center text-sm text-white placeholder-white/30 backdrop-blur-sm focus:border-accent focus:outline-none"
                  title="Your score (0–10)"
                />
                <span className="text-xs text-white/30">/10</span>
              </div>
            )}

            {entry ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-white/50 bg-white/5 px-2 py-1.5 rounded-md border border-white/5 backdrop-blur-sm">
                <Check size={13} className="text-green-500" />
                {entry.episodesWatched}/{anime.episodes ?? "?"} watched
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-white/40 bg-white/5 px-2 py-1.5 rounded-md border border-white/5 backdrop-blur-sm">
                <Plus size={13} /> Not in list
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
          className="mt-6 max-w-4xl px-8 text-sm leading-relaxed text-white/70"
        >
          {anime.synopsis}
        </motion.p>
      )}

      {/* Related anime */}
      {related.length > 0 && (
        <div className="mt-8 px-8">
          <h2 className="mb-3 text-lg font-semibold">Related</h2>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {related.map(({ relationType, anime: rel }) => (
              <RelatedCard key={rel.id} rel={rel} relationType={relationType} />
            ))}
          </div>
        </div>
      )}

      {/* AnimePahe episodes — always check providers; AniList's "not yet released"
          status is often stale, and the show may already be streamable. */}
      <div className="mt-8 px-8">
        {anime.status === "NOT_YET_RELEASED" && (
          <p className="mb-3 text-xs text-white/30">
            AniList lists this as upcoming — checking providers in case it's already streamable…
          </p>
        )}
        <PahePanel
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
    </div>
  );
}
