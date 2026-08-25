import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import { motion } from "framer-motion";
import type { RecentEpisode } from "../../shared/types";

function airedLabel(airingAt: number): string {
  const date = new Date(airingAt * 1000);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const LatestEpCard = React.memo(function LatestEpCard({ ep }: { ep: RecentEpisode }) {
  const anime = ep.anime;
  const image = anime.bannerImage || anime.coverImage;
  const [isHovered, setIsHovered] = useState(false);
  const cardRef = useRef<HTMLAnchorElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const showTooltip = () => {
    setIsHovered(true);
    if (cardRef.current) setRect(cardRef.current.getBoundingClientRect());
  };

  const tooltipPortal = isHovered && rect ? createPortal(
    <div
      className="fixed z-[9999] w-72 bg-[#1f1f1f] rounded-xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.8)] p-5 flex flex-col pointer-events-none animate-in fade-in zoom-in-95 duration-200"
      style={{
        left: rect.right + 15 + 288 > window.innerWidth ? rect.left - 288 - 15 : rect.right + 15,
        top: Math.max(10, Math.min(window.innerHeight - 320, rect.top + rect.height / 2 - 160)),
      }}
    >
      <h3 className="font-bold text-white text-lg leading-tight mb-2">{anime.title}</h3>
      {anime.averageScore && (
        <div className="text-sm font-bold text-green-400 mb-3">★ {(anime.averageScore / 10).toFixed(1)} / 10</div>
      )}
      <div className="flex flex-wrap gap-2 mb-3">
        {anime.year && <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-bold">{anime.year}</span>}
        {anime.status && <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-bold">{anime.status}</span>}
        <span className="px-1.5 py-0.5 rounded bg-[#e50914]/20 text-[10px] font-bold">EP {ep.episode}</span>
      </div>
      {!!anime.genres?.length && <div className="text-xs text-white/50 mb-3">{anime.genres.join(", ")}</div>}
      <p className="text-xs text-white/80 line-clamp-5 leading-relaxed">
        {anime.synopsis || "No synopsis available."}
      </p>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full h-full"
      >
        <Link
          to={`/anime/${anime.id}`}
          ref={cardRef}
          onMouseEnter={showTooltip}
          onMouseLeave={() => setIsHovered(false)}
          className="group relative block aspect-[16/9] w-full overflow-hidden rounded-lg bg-[#1b1b1b] transition-all duration-300 ease-out hover:z-10 hover:scale-110 hover:shadow-[0_12px_40px_rgb(0,0,0,0.8)] hover:shadow-[#e50914]/30 hover:ring-2 hover:ring-[#e50914]/50 outline-none"
        >
          {image ? (
            <img src={image} alt={anime.title} className="h-full w-full object-cover opacity-80 transition-transform duration-500 group-hover:scale-105" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#222222] text-xs text-white/30">No Image</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-90 transition-opacity duration-300 group-hover:opacity-100" />
          <div className="absolute left-2 top-2 rounded bg-[#e50914] px-2 py-1 text-[10px] font-bold text-white">EP {ep.episode}</div>
          <div className="absolute bottom-0 left-0 right-0 p-2.5 flex flex-col justify-end translate-y-1 transition-transform duration-300 group-hover:translate-y-0">
            <div className="line-clamp-1 text-xs font-bold leading-tight text-white drop-shadow-md">{anime.title}</div>
            <div className="mt-1 text-[10px] font-medium text-white/60">{airedLabel(ep.airingAt)}</div>
          </div>
          <div className="absolute inset-0 flex items-center justify-center opacity-0 scale-90 transition-all duration-300 group-hover:opacity-100 group-hover:scale-100">
            <div className="rounded-full bg-white/20 p-2.5 text-white backdrop-blur-md border border-white/20 shadow-xl">
              <Play size={20} fill="currentColor" className="ml-0.5" />
            </div>
          </div>
        </Link>
      </motion.div>
      {tooltipPortal}
    </>
  );
});

export default LatestEpCard;
