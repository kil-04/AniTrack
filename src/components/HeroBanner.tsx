import { Link } from "react-router-dom";
import { Info, Play } from "lucide-react";
import type { AnimeMeta } from "../../shared/types";
import { truncate } from "../lib/format";

interface Props {
  anime: AnimeMeta;
}

export default function HeroBanner({ anime }: Props) {
  const bg = anime.bannerImage || anime.coverImage;
  return (
    <div className="relative h-[65vh] min-h-[460px] max-h-[700px] w-full overflow-hidden">
      {bg && (
        <img
          src={bg}
          alt={anime.title}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-bg/95 via-bg/40 to-transparent" />
      <div className="absolute bottom-10 sm:bottom-20 left-6 sm:left-8 max-w-2xl animate-fade-in p-4 sm:p-0">
        <div className="text-xs uppercase tracking-widest text-accent">
          Trending now
        </div>
        <h1 className="mt-2 text-3xl sm:text-4xl md:text-5xl font-extrabold leading-tight">
          {anime.title}
        </h1>
        <div className="mt-2 flex items-center gap-3 text-xs sm:text-sm text-white/70">
          {anime.year && <span>{anime.year}</span>}
          {anime.episodes && <span>{anime.episodes} episodes</span>}
          {anime.averageScore && <span>★ {(anime.averageScore / 10).toFixed(1)}</span>}
        </div>
        <p className="mt-4 text-xs sm:text-sm leading-relaxed text-white/80 line-clamp-2 sm:line-clamp-3">
          {anime.synopsis ? truncate(anime.synopsis.replace(/<[^>]*>/g, ""), 200) : ""}
        </p>
        <div className="mt-6 flex items-center gap-3">
          <Link
            to={`/anime/${anime.id}`}
            state={{ anime }}
            className="flex items-center gap-2 rounded-md bg-white px-5 sm:px-6 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-black transition hover:bg-white/90"
          >
            <Play size={16} fill="currentColor" />
            Play
          </Link>
          <Link
            to={`/anime/${anime.id}`}
            state={{ anime }}
            className="flex items-center gap-2 rounded-md bg-white/20 px-5 sm:px-6 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-white backdrop-blur transition hover:bg-white/30"
          >
            <Info size={16} />
            More info
          </Link>
        </div>
      </div>
    </div>
  );
}
