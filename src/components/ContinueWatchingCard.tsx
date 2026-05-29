import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Play, X } from "lucide-react";
import { motion } from "framer-motion";
import { secondsToTimestamp } from "../lib/format";
import { deleteAnimeProgress } from "../lib/supabase-sync";
import type { AnimeMeta } from "../../shared/types";

function cwStreamUrl(session: string, title: string, ep: number, img: string, anilistId?: number) {
  const p: Record<string, string> = { 
    session, 
    title, 
    episode: String(ep),
    ep: String(ep) 
  };
  if (img) {
    p.coverUrl = img;
    p.img = img;
  }
  if (anilistId) {
    p.animeId = String(anilistId);
    p.anilistId = String(anilistId);
  }
  return "/stream-player?" + new URLSearchParams(p).toString();
}

const ContinueWatchingCard = React.memo(function ContinueWatchingCard({ item, paheEpTotals, refreshContinue }: { item: any, paheEpTotals: Map<string, number>, refreshContinue: () => void }) {
  const cwTo = item.animePaheSession
    ? cwStreamUrl(item.animePaheSession, item.anime.title, item.episode, item.anime.coverImage, item.anime.id)
    : item.filePath
    ? `/player/${item.anime.id}/${item.episode}`
    : "/anime/" + item.anime.id;

  const [isHovered, setIsHovered] = useState(false);
  const [fetchedMeta, setFetchedMeta] = useState<AnimeMeta | null>(null);
  const [isFetching, setIsFetching] = useState(false);
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

  const displayAnime = fetchedMeta || item.anime;

  const tooltipPortal = isHovered && rect ? createPortal(
    <div 
      className="fixed z-[9999] w-72 bg-[#15151f] rounded-xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.8)] p-5 flex flex-col pointer-events-none animate-in fade-in zoom-in-95 duration-200"
      style={{
        left: rect.right + 15 + 288 > window.innerWidth ? rect.left - 288 - 15 : rect.right + 15,
        top: Math.max(10, Math.min(window.innerHeight - 320, rect.top + rect.height / 2 - 160)),
      }}
    >
      <h3 className="font-bold text-[#4a9eff] text-lg leading-tight mb-2">{displayAnime.title}</h3>
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
        <p className="text-xs text-[#4a9eff] animate-pulse italic">Loading details from network...</p>
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
        className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition hover:bg-red-500 hover:scale-110 group-hover:opacity-100"
        title="Remove from Continue Watching"
      >
        <X size={14} />
      </button>
      <Link 
        to={cwTo} 
        ref={cardRef}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="block outline-none"
      >
        <div className="relative aspect-video w-72 overflow-hidden rounded-xl bg-[#111118] transition-all duration-300 ease-out group-hover:z-10 group-hover:scale-110 group-hover:shadow-[0_12px_40px_rgb(0,0,0,0.8)] group-hover:shadow-[#4a9eff]/30 group-hover:ring-2 group-hover:ring-white/30">
          {displayAnime.coverImage ? (
            <img
              src={displayAnime.coverImage}
              alt={displayAnime.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-3xl font-bold text-white/20">
              {displayAnime.title.slice(0, 2).toUpperCase()}
            </div>
          )}
          
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-90 transition-opacity duration-300 group-hover:opacity-100" />
          
          <div className="absolute left-2 top-2 rounded shadow-md bg-[#4a9eff] px-2 py-1 text-[10px] font-bold tracking-widest text-white">
            EP {item.episode}
          </div>
          {(() => {
            const key = item.animePaheSession ?? item.anime.title;
            const total = paheEpTotals.get(key);
            if (!total) return null;
            const hasNew = total > item.episode;
            return (
              <div className={`absolute right-2 top-2 rounded shadow-md px-2 py-1 text-[10px] font-bold tracking-widest backdrop-blur-md
                ${hasNew ? "bg-green-500 text-white" : "bg-black/60 text-white/50 border border-white/10"}`}>
                {hasNew ? `EP ${total} ▲` : `EP ${total} ✓`}
              </div>
            );
          })()}
          
          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 group-hover:opacity-100 scale-90 group-hover:scale-100">
            <div className="rounded-full bg-white/20 p-3 text-white shadow-xl backdrop-blur-md border border-white/20">
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

          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/20">
            <div
              className="h-full bg-[#4a9eff] shadow-[0_0_10px_rgba(74,158,255,0.8)]"
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
