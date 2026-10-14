import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import { motion } from "framer-motion";
import type { RecentEpisode } from "../../../../packages/shared/types";
import { rejectOversizedImage, safeImageSrc } from "../lib/image-guard";

function airedLabel(airingAt: number): string {
  const date = new Date(airingAt * 1000);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const LatestEpCard = React.memo(function LatestEpCard({ ep }: { ep: RecentEpisode }) {
  const anime = ep.anime;
  const image = safeImageSrc(anime.bannerImage, anime.coverImage);
  const [isHovered, setIsHovered] = useState(false);
  const cardRef = useRef<HTMLAnchorElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const showTooltip = () => {
    setIsHovered(true);
    if (cardRef.current) setRect(cardRef.current.getBoundingClientRect());
  };

  const tooltipPortal = isHovered && rect ? createPortal(
    <div
      className="pointer-events-none fixed z-[9999] flex w-72 flex-col rounded-2xl border border-white/10 bg-surface-1/95 p-5 shadow-pop backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200"
      style={{
        left: rect.right + 15 + 288 > window.innerWidth ? rect.left - 288 - 15 : rect.right + 15,
        top: Math.max(10, Math.min(window.innerHeight - 320, rect.top + rect.height / 2 - 160)),
      }}
    >
      <h3 className="font-bold text-white text-lg leading-tight mb-2">{anime.title}</h3>
      {anime.averageScore && (
        <div className="mb-3 text-sm font-bold text-amber-300">★ {(anime.averageScore / 10).toFixed(1)} / 10</div>
      )}
      <div className="flex flex-wrap gap-2 mb-3">
        {anime.year && <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-bold text-ink-2">{anime.year}</span>}
        {anime.status && <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-bold text-ink-2">{anime.status}</span>}
        <span className="px-1.5 py-0.5 rounded bg-accent/20 text-[10px] font-bold">EP {ep.episode}</span>
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
          className="group relative block aspect-[16/9] w-full overflow-hidden rounded-2xl bg-surface-1 shadow-card outline-none ring-1 ring-white/[0.06] transition-all duration-300 ease-out hover:z-10 hover:-translate-y-1.5 hover:shadow-glow-lg hover:ring-2 hover:ring-accent/70"
        >
          {image ? (
            <img src={image} alt={anime.title} className="h-full w-full object-cover opacity-90 transition-transform duration-700 ease-out group-hover:scale-[1.07]" loading="lazy" onLoad={(event) => rejectOversizedImage(event, anime.coverImage)} />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-surface-2 text-xs text-ink-3">No Image</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-transparent opacity-90 transition-opacity duration-300 group-hover:opacity-100" />
          <div className="badge badge-accent absolute left-2 top-2 px-2 py-1">EP {ep.episode}</div>
          <div className="absolute bottom-0 left-0 right-0 p-2.5 flex flex-col justify-end translate-y-1 transition-transform duration-300 group-hover:translate-y-0">
            <div className="line-clamp-1 text-xs font-bold leading-tight text-white drop-shadow-md">{anime.title}</div>
            <div className="mt-1 text-[10px] font-medium text-white/60">{airedLabel(ep.airingAt)}</div>
          </div>
          <div className="absolute inset-0 flex items-center justify-center opacity-0 scale-90 transition-all duration-300 group-hover:opacity-100 group-hover:scale-100">
            <div className="rounded-full bg-accent-gradient p-2.5 text-white shadow-glow-lg ring-1 ring-white/30">
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
