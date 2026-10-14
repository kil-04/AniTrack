import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AudioLines, Film, Pause, Play, Shuffle, SkipBack, SkipForward, X } from "lucide-react";
import type { ThemeSong } from "../../../../packages/shared/anime-themes";
import { currentTheme, RADIO_LABEL, useThemePlayer } from "../store/useThemePlayer";

const OPENING = "#ff5c7a";
const ENDING = "#7aa7ff";
const tone = (song: ThemeSong) => (song.type === "OP" ? OPENING : ENDING);

function episodesLabel(episodes: string | null): string | null {
  if (!episodes?.trim()) return null;
  return /[-,]/.test(episodes) ? `Eps ${episodes.replace(/-/g, "–")}` : `Ep ${episodes}`;
}

/** A show's openings and endings, from AnimeThemes.moe. */
export function ThemeSongs({ animeId, animeTitle }: { animeId: number; animeTitle: string }) {
  const [songs, setSongs] = useState<ThemeSong[]>([]);
  const [video, setVideo] = useState<ThemeSong | null>(null);
  const current = useThemePlayer(currentTheme);
  const playing = useThemePlayer((s) => s.playing);
  const { play, toggle } = useThemePlayer.getState();

  useEffect(() => {
    let cancelled = false;
    setSongs([]);
    if (animeId > 0 && animeId < 1_000_000_000) {
      window.api.themes.forAnime(animeId)
        .then((list) => { if (!cancelled) setSongs(list); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [animeId]);

  if (!songs.length) return null;
  const playingHere = current?.animeId === animeId;
  return (
    <section className="mt-8 px-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Theme songs</h2>
        <button
          onClick={() => (playingHere ? toggle() : play(songs, 0, animeTitle))}
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-white/15"
        >
          {playingHere && playing ? <Pause size={13} /> : <Play size={13} />}
          {playingHere && playing ? "Pause" : "Play all"}
        </button>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {songs.map((song, i) => {
          const isCurrent = current?.animeId === song.animeId && current?.slug === song.slug;
          const color = tone(song);
          return (
            <div
              key={song.slug}
              className="flex items-center gap-3 rounded-xl border p-2.5 transition"
              style={{
                borderColor: isCurrent ? `${color}73` : "rgba(255,255,255,0.06)",
                backgroundColor: isCurrent ? `${color}1f` : "rgba(255,255,255,0.03)",
              }}
            >
              <button
                onClick={() => (isCurrent ? toggle() : play(songs, i, animeTitle))}
                disabled={!song.audioUrl}
                title={isCurrent && playing ? "Pause" : "Play"}
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-sm font-black transition hover:brightness-125 disabled:opacity-40"
                style={{ backgroundColor: `${color}29`, color }}
              >
                {isCurrent ? (playing ? <AudioLines size={20} /> : <Play size={18} />) : song.slug.split("-")[0]}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{song.title}</div>
                <div className="truncate text-xs text-white/55">{song.artists.join(", ") || "Unknown artist"}</div>
                <div className="flex items-center gap-1.5 text-[11px] text-white/35">
                  {[song.slug.includes("-") ? song.slug : null, episodesLabel(song.episodes)].filter(Boolean).join(" · ")}
                  {song.spoiler && <span className="rounded border border-white/15 px-1 text-[10px] text-white/50">Spoiler</span>}
                </div>
              </div>
              {song.videoUrl && !song.nsfw && (
                <button
                  onClick={() => setVideo(song)}
                  title="Watch the creditless video"
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white"
                >
                  <Film size={17} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-white/30">Songs and creditless videos from AnimeThemes.moe.</p>
      {video && <ThemeVideoModal song={video} onClose={() => setVideo(null)} />}
    </section>
  );
}

/** Plays a theme's creditless video over the page. */
export function ThemeVideoModal({ song, onClose }: { song: ThemeSong; onClose: () => void }) {
  useEffect(() => {
    useThemePlayer.getState().pause();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!song.videoUrl) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-8" onClick={onClose}>
      <div className="relative w-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-bold">{song.slug} · {song.title}</div>
            <div className="text-sm text-white/60">{[song.artists.join(", "), song.animeTitle].filter(Boolean).join(" — ")}</div>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20" title="Close">
            <X size={18} />
          </button>
        </div>
        <video data-theme-video="true" src={song.videoUrl} controls autoPlay className="aspect-video w-full rounded-xl bg-black" />
      </div>
    </div>,
    document.body,
  );
}

/** The now-playing bar for theme songs, bottom-left over every page. */
export function ThemeBar() {
  const navigate = useNavigate();
  const song = useThemePlayer(currentTheme);
  const playing = useThemePlayer((s) => s.playing);
  const buffering = useThemePlayer((s) => s.buffering);
  const progress = useThemePlayer((s) => s.progress);
  const label = useThemePlayer((s) => s.label);
  const problem = useThemePlayer((s) => s.problem);
  if (!song) return null;
  const { toggle, next, previous, stop } = useThemePlayer.getState();
  const color = tone(song);
  return (
    <div className="fixed bottom-5 left-5 z-[55] w-[400px] overflow-hidden rounded-2xl border border-white/10 bg-surface-1/95 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-3 p-2.5 pr-2">
        <button onClick={() => navigate(`/anime/${song.animeId}`)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {song.cover ? (
            <img src={song.cover} alt="" className="h-11 w-11 flex-shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="h-11 w-11 flex-shrink-0 rounded-lg bg-white/5" />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">{song.slug} · {song.title}</div>
            <div className={`truncate text-xs ${problem ? "text-red-300" : "text-white/50"}`}>
              {problem ?? [song.artists.join(", "), label ?? song.animeTitle].filter(Boolean).join(" · ")}
            </div>
          </div>
        </button>
        <button onClick={previous} title="Previous" className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
          <SkipBack size={15} />
        </button>
        <button onClick={toggle} title={playing ? "Pause" : "Play"} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black hover:bg-white/85">
          {buffering && !playing ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
          ) : playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button onClick={next} title="Next" className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
          <SkipForward size={15} />
        </button>
        <button onClick={stop} title="Stop" className="flex h-8 w-8 items-center justify-center rounded-full text-white/40 hover:bg-white/10 hover:text-white">
          <X size={15} />
        </button>
      </div>
      <div className="h-0.5 w-full bg-white/5">
        <div className="h-full transition-[width] duration-300" style={{ width: `${progress * 100}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

/** Shuffles openings and endings from the shows you've watched. */
export function ThemeRadioButton() {
  const [building, setBuilding] = useState(false);
  const [empty, setEmpty] = useState(false);
  const onAir = useThemePlayer((s) => s.label === RADIO_LABEL && s.index >= 0);
  const playing = useThemePlayer((s) => s.playing);
  const { play, toggle } = useThemePlayer.getState();
  return (
    <button
      onClick={async () => {
        if (onAir) { toggle(); return; }
        setBuilding(true);
        setEmpty(false);
        const songs = await window.api.themes.radio().catch(() => []);
        setBuilding(false);
        if (songs.length) play(songs, 0, RADIO_LABEL);
        else setEmpty(true);
      }}
      disabled={building}
      title={empty ? "No theme songs found for your shows yet" : "Openings and endings from shows you've watched"}
      className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
    >
      {building ? (
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      ) : onAir && playing ? <Pause size={12} /> : <Shuffle size={12} />}
      {onAir ? (playing ? "Pause radio" : "Resume radio") : empty ? "No themes found" : RADIO_LABEL}
    </button>
  );
}
