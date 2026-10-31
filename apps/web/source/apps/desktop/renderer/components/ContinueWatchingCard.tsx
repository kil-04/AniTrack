import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Play, X } from "lucide-react";
import { motion } from "framer-motion";
import { secondsToTimestamp } from "../lib/format";
import { deleteAnimeProgress } from "../lib/supabase-sync";
import { downloadsSupported, getDownloads } from "../lib/downloads";
import type { AnimeMeta } from "../../../../packages/shared/types";

// Build the URL that resumes a continue-watching item. Prefers a finished local
// download; otherwise opens the stream player — with the session if we have it,
// or just the title/id so the player resolves the provider itself. Never dead-ends
// on the title page.
export function cwResumeUrl(item: any): string {
  const animeId: number = item.anime.id;
  const ep: number = item.episode;
  const title: string = item.anime.title;
  const img: string | undefined = item.anime.coverImage;

  const dl = downloadsSupported() ? getDownloads().get(`${animeId}:${ep}`) : undefined;
  if (dl?.status === "done") {
    const p: Record<string, string> = { download: dl.id, animeId: String(animeId), episode: String(ep), ep: String(ep), title };
    if (img) p.coverUrl = img;
    return "/stream-player?" + new URLSearchParams(p).toString();
  }

  const p: Record<string, string> = { title, episode: String(ep), ep: String(ep) };
  const session: string | undefined = item.animePaheSession;
  if (session) {
    const isUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(session);
    p.session = session;
    p.providerId = item.providerId ?? (isUuid ? "animepahe" : "anikoto");
  }
  if (img) { p.coverUrl = img; p.img = img; }
  if (animeId) { p.animeId = String(animeId); p.anilistId = String(animeId); }
  return "/stream-player?" + new URLSearchParams(p).toString();
}

const ContinueWatchingCard = React.memo(function ContinueWatchingCard({ item, paheEpTotals, refreshContinue }: { item: any, paheEpTotals: Map<string, number>, refreshContinue: () => void }) {
  const [isHovered, setIsHovered] = useState(false);
  const [fetchedMeta, setFetchedMeta] = useState<AnimeMeta | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const displayAnime = fetchedMeta || item.anime;

  // Continue Watching always resumes playback (download or stream) — never the
  // title page; the player resolves the provider if we don't have a session.
  const goesToDetail = false;
  const cwTo = cwResumeUrl(item);

  const cardRef = useRef<HTMLAnchorElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (isHovered && cardRef.current) {
      setRect(cardRef.current.getBoundingClientRect());
    }
  }, [isHovered]);

  useEffect(() => {
    const missingData = !item.anime.synopsis || !item.anime.coverImage;
    if ((missingData || isHovered) && !fetchedMeta && !isFetching) {
      setIsFetching(true);
      if (item.anime.id > 0 && item.anime.id < 1000000000) {
        window.api.anilist.get(item.anime.id).then((meta: AnimeMeta | null) => {
          if (meta) setFetchedMeta(meta);
          setIsFetching(false);
        }).catch(() => setIsFetching(false));
      } else if (item.anime.title) {
        window.api.anilist.search(item.anime.title).then((results: AnimeMeta[]) => {
           if (results && results.length > 0) {
             return window.api.anilist.get(results[0].id);
           }
           throw new Error("Not found");
        }).then((meta: AnimeMeta | null) => {
           if (meta) setFetchedMeta(meta);
           setIsFetching(false);
         }).catch(() => setIsFetching(false));
      } else {
        setIsFetching(false);
      }
    }
  }, [isHovered, item.anime.id, item.anime.title, item.anime.synopsis, item.anime.coverImage, fetchedMeta, isFetching]);

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
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="group relative w-72 shrink-0"
    >
      <button
        onClick={(e) => {
          e.preventDefault();
          window.api.list.dismissContinueWatching(item.anime.id)
            .then(() => { deleteAnimeProgress(item.anime.id); refreshContinue(); })
            .catch(() => {});
        }}
        className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white opacity-0 backdrop-blur-md transition hover:scale-110 hover:border-red-400/40 hover:bg-red-500 group-hover:opacity-100"
        title="Remove from Continue Watching"
      >
        <X size={14} />
      </button>
      <Link
        to={cwTo}
        state={goesToDetail ? { anime: displayAnime } : undefined}
        ref={cardRef}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="block outline-none"
      >
        <div className="relative aspect-video w-72 overflow-hidden rounded-2xl bg-surface-1 shadow-card ring-1 ring-white/[0.06] transition-all duration-300 ease-out group-hover:z-10 group-hover:-translate-y-1.5 group-hover:shadow-glow-lg group-hover:ring-2 group-hover:ring-accent/70">
          {displayAnime.coverImage ? (
            <img
              src={displayAnime.coverImage}
              alt={displayAnime.title}
              className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.07]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-3xl font-bold text-white/20">
              {displayAnime.title.slice(0, 2).toUpperCase()}
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/25 to-transparent opacity-90 transition-opacity duration-300 group-hover:opacity-100" />

          <div className="badge badge-accent absolute left-2 top-2 px-2 py-1 tracking-widest">
            EP {item.episode}
          </div>
          {(() => {
            const key = item.animePaheSession ?? item.anime.title;
            const total = paheEpTotals.get(key);
            if (!total) return null;
            const hasNew = total > item.episode;
            return (
              <div className={`badge absolute right-2 top-2 px-2 py-1 tracking-widest
                ${hasNew ? "bg-emerald-400 text-[#04150d] shadow-[0_4px_14px_-4px_rgb(52_211_153/0.8)]" : "badge-glass text-white/60"}`}>
                {hasNew ? `EP ${total} ▲` : `EP ${total} ✓`}
              </div>
            );
          })()}

          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 group-hover:opacity-100 scale-90 group-hover:scale-100">
            <div className="rounded-full bg-accent-gradient p-3 text-white shadow-glow-lg ring-1 ring-white/30">
              <Play size={24} fill="currentColor" className="ml-1" />
            </div>
          </div>

          <div className="absolute bottom-0 left-0 right-0 p-3 flex flex-col justify-end translate-y-1 transition-transform duration-300 group-hover:translate-y-0">
            <div className="line-clamp-2 text-sm font-bold leading-tight text-white drop-shadow-md">
              {item.anime.title}
            </div>
            <div className="mt-1 flex items-center justify-between">
              <div className="tabular-nums text-[10px] font-medium text-white/80 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                {secondsToTimestamp(item.positionSec)} / {secondsToTimestamp(item.durationSec)}
              </div>
            </div>
          </div>

          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/15">
            <div
              className="h-full rounded-r-full bg-accent-gradient shadow-[0_0_12px_rgb(var(--accent)/0.85)]"
              style={{ width: `${Math.min(100, item.percent)}%` }}
            />
          </div>
        </div>
      </Link>
      {tooltipPortal}
    </motion.div>
  );
});

export default ContinueWatchingCard;
