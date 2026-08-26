import React, { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { createPortal } from "react-dom";
import type { AnimeMeta } from "../../../../packages/shared/types";
import { Play, Captions, Star } from "lucide-react";
import { motion } from "framer-motion";

interface Props {
  anime: AnimeMeta;
  progressPercent?: number;
  episode?: number;
  size?: "sm" | "md" | "lg";
}

// AniList MediaFormat -> short label shown on the card's type badge.
function formatLabel(f?: string | null): string | null {
  if (!f) return null;
  switch (f) {
    case "TV": return "TV";
    case "TV_SHORT": return "TV";
    case "MOVIE": return "Movie";
    case "OVA": return "OVA";
    case "ONA": return "ONA";
    case "SPECIAL": return "Special";
    case "MUSIC": return "Music";
    default: return f;
  }
}

const Card = React.memo(function Card({ anime, progressPercent, episode, size }: Props) {
  const sizing = size === "sm" ? "w-36 h-52" : size === "lg" ? "w-56 h-80" : "w-44 h-64";
  // When an explicit size is given the card lives in a horizontal row, so the
  // fixed dimensions must sit on the flex item itself (otherwise `w-full`
  // expands each card to the image's natural width). Without a size the card
  // fills its grid cell (Search/Filter/Library), the original behaviour.
  const fixed = size != null;
  
  const [isHovered, setIsHovered] = useState(false);
  const [fetchedMeta, setFetchedMeta] = useState<AnimeMeta | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const cardRef = useRef<HTMLAnchorElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (isHovered && cardRef.current) {
      setRect(cardRef.current.getBoundingClientRect());
      
      // Fetch full metadata if synopsis is missing
      if (!anime.synopsis && !fetchedMeta && !isFetching) {
        setIsFetching(true);
        if (anime.id > 0 && anime.id < 1000000000) {
          window.api.anilist.get(anime.id).then((meta: AnimeMeta | null) => {
            if (meta) setFetchedMeta(meta);
            setIsFetching(false);
          }).catch(() => setIsFetching(false));
        } else if (anime.title) {
          window.api.anilist.search(anime.title).then((results: AnimeMeta[]) => {
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
    }
  }, [isHovered, anime.id, anime.title, anime.synopsis, fetchedMeta, isFetching]);

  const displayAnime = fetchedMeta || anime;

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
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className={`shrink-0 ${fixed ? sizing : ""}`}
      >
        <Link
          to={`/anime/${anime.id}`}
          state={{ anime: displayAnime }}
          ref={cardRef}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className={`group block w-full h-full ${fixed ? "" : sizing} outline-none`}
        >
          <div className="relative h-full w-full overflow-hidden rounded-xl bg-[#1b1b1b] transition-all duration-300 ease-out hover:z-10 hover:scale-110 hover:shadow-[0_12px_40px_rgb(0,0,0,0.8)] hover:shadow-[#e50914]/30 hover:ring-2 hover:ring-white/30">
            {anime.coverImage ? (
              <img src={anime.coverImage} alt={anime.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1b1b1b] to-[#222222] text-3xl font-bold text-white/20">{anime.title.slice(0,2).toUpperCase()}</div>
            )}
            
            {/* Anikoto-style corner badges */}
            {anime.averageScore != null && (
              <div className="absolute top-2 right-2 z-[2] flex items-center gap-0.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 backdrop-blur-sm">
                <Star size={9} fill="currentColor" />
                {(anime.averageScore / 10).toFixed(1)}
              </div>
            )}
            <div className="absolute top-2 left-2 z-[2] flex flex-col items-start gap-1">
              {formatLabel(anime.format) && (
                <span className="rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/90 backdrop-blur-sm">
                  {formatLabel(anime.format)}
                </span>
              )}
              {anime.episodes != null && anime.episodes > 0 && (
                <span className="flex items-center gap-1 rounded-md bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-bold text-black shadow-sm">
                  <Captions size={11} />
                  {anime.episodes}
                </span>
              )}
            </div>

            {/* Permanent bottom gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-90 transition-opacity duration-300 group-hover:opacity-100" />
            
            {/* Title and Info (Always visible, moves up slightly on hover) */}
            <div className="absolute bottom-0 left-0 right-0 p-3 flex flex-col justify-end translate-y-1 transition-transform duration-300 group-hover:translate-y-0">
              <div className="line-clamp-2 text-sm font-bold leading-tight text-white drop-shadow-md">
                {anime.title}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[10px] font-medium text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                <Play size={10} fill="currentColor" />
                <span>{episode ? `Ep ${episode}` : "Play Now"}</span>
                <span className="mx-0.5 text-white/40">•</span>
                <span className="text-white/70">{anime.year ?? "TBA"}</span>
              </div>
            </div>
            
            {/* Play Icon Center Hover */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 scale-90 transition-all duration-300 group-hover:opacity-100 group-hover:scale-100">
              <div className="rounded-full bg-white/20 p-3 text-white backdrop-blur-md border border-white/20 shadow-xl">
                <Play size={24} fill="currentColor" className="ml-1" />
              </div>
            </div>

            {progressPercent != null && (
              <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/20">
                <div className="h-full bg-[#e50914] shadow-[0_0_10px_rgba(229, 9, 20,0.8)]" style={{ width: `${Math.min(100, progressPercent)}%` }} />
              </div>
            )}
          </div>
        </Link>
      </motion.div>
      {tooltipPortal}
    </>
  );
});

export default Card;
