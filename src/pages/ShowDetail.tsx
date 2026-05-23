import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Check } from "lucide-react";
import type { AnimeMeta, ListEntry, WatchStatus } from "../../shared/types";
import PahePanel from "../components/PahePanel";
import { useAppStore } from "../store/useAppStore";

const STATUS_OPTIONS: { value: WatchStatus; label: string }[] = [
  { value: "watching", label: "Watching" },
  { value: "completed", label: "Completed" },
  { value: "on_hold", label: "On hold" },
  { value: "dropped", label: "Dropped" },
  { value: "plan_to_watch", label: "Plan to watch" },
];

export default function ShowDetail() {
  const { id } = useParams();
  const animeId = Number(id);
  const navigate = useNavigate();
  const [anime, setAnime] = useState<AnimeMeta | null>(null);
  const list = useAppStore((s) => s.list);
  const refreshList = useAppStore((s) => s.refreshList);
  const entry: ListEntry | undefined = list.find(
    (x) => x.entry.animeId === animeId,
  )?.entry;

  useEffect(() => {
    setAnime(null);
    window.api.anilist.get(animeId).then((a) => {
      if (a) { setAnime(a); return; }
      const fromStore = list.find((x) => x.entry.animeId === animeId)?.anime;
      if (fromStore) setAnime(fromStore);
      else setAnime({ id: animeId, title: "Unknown", coverImage: null } as any);
    });
  }, [animeId]);

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
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b0f] via-[#0b0b0f]/60 to-transparent" />
        <button
          onClick={() => navigate(-1)}
          className="absolute left-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm hover:bg-black/80 transition"
        >
          <ArrowLeft size={16} />
        </button>
      </div>

      {/* Cover + info */}
      <div className="relative -mt-20 flex items-end gap-7 px-8">
        {anime.coverImage && (
          <img
            src={anime.coverImage}
            alt={anime.title}
            className="h-[260px] w-[175px] flex-shrink-0 rounded-lg object-cover shadow-2xl ring-2 ring-white/10"
          />
        )}

        <div className="min-w-0 flex-1 pb-1">
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
              <span className="flex items-center gap-1.5 text-xs text-white/40">
                <Check size={13} />
                {entry.episodesWatched}/{anime.episodes ?? "?"} watched
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-white/40">
                <Plus size={13} /> Not in list
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Synopsis */}
      {anime.synopsis && (
        <p className="mt-6 max-w-4xl px-8 text-sm leading-relaxed text-white/70">
          {anime.synopsis}
        </p>
      )}

      {/* AnimePahe episodes */}
      {anime.status === "NOT_YET_RELEASED" ? (
        <div className="mt-8 px-8">
          <h2 className="mb-3 text-lg font-semibold">Episodes</h2>
          <p className="text-sm text-white/30">Not yet airing — check back when this title releases.</p>
        </div>
      ) : (
        <div className="mt-8 px-8">
          <PahePanel
            animeTitle={anime.titleEnglish || anime.title}
            animeTitleAlt={anime.titleEnglish ? anime.title : undefined}
            animeId={anime.id}
            animeMalId={anime.malId ?? undefined}
            animeYear={anime.year ?? undefined}
            resumeEpisode={entry ? entry.episodesWatched + 1 : 1}
            inline
          />
        </div>
      )}
    </div>
  );
}
