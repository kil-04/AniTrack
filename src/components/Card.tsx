import { Link } from "react-router-dom";
import type { AnimeMeta } from "../../shared/types";
import { Play } from "lucide-react";

interface Props {
  anime: AnimeMeta;
  progressPercent?: number;
  episode?: number;
  size?: "sm" | "md" | "lg";
}

export default function Card({ anime, progressPercent, episode, size = "md" }: Props) {
  const sizing =
    size === "sm"
      ? "w-36 h-52"
      : size === "lg"
        ? "w-56 h-80"
        : "w-44 h-64";
  const cardWidth = size === "sm" ? "w-36" : size === "lg" ? "w-56" : "w-44";
  return (
    <Link to={`/anime/${anime.id}`} className={`group block shrink-0 ${cardWidth}`}>
      <div
        className={`relative ${sizing} overflow-hidden rounded-md bg-bg-card transition duration-200 group-hover:scale-105 group-hover:ring-2 group-hover:ring-white/60`}
      >
        {anime.coverImage ? (
          <img
            src={anime.coverImage}
            alt={anime.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-bg-card to-bg-elev text-3xl font-bold text-muted">
            {anime.title.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent opacity-0 transition group-hover:opacity-100" />
        <div className="absolute bottom-0 left-0 right-0 p-3 opacity-0 transition group-hover:opacity-100">
          <div className="flex items-center gap-1 text-xs text-white">
            <Play size={12} fill="currentColor" />
            <span>{episode ? `Ep ${episode}` : "Open"}</span>
          </div>
        </div>
        {progressPercent != null && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
            <div
              className="h-full bg-accent"
              style={{ width: `${Math.min(100, progressPercent)}%` }}
            />
          </div>
        )}
      </div>
      <div className="mt-2 line-clamp-2 h-[2.5rem] text-sm leading-tight text-white/90">
        {anime.title}
      </div>
      <div className="text-xs text-muted">
        {anime.year ?? ""}{anime.episodes ? ` • ${anime.episodes} ep` : ""}
      </div>
    </Link>
  );
}
