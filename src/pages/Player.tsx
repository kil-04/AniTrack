import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Maximize,
  Minimize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { AnimeMeta, LocalEpisode } from "../../shared/types";
import { secondsToTimestamp } from "../lib/format";
import { pushProgress } from "../lib/supabase-sync";

export default function Player() {
  const { animeId: idStr, episode: epStr } = useParams();
  const [searchParams] = useSearchParams();
  const streamUrl = searchParams.get("stream");   // set by PahePanel
  const streamTitle = searchParams.get("title");  // set by PahePanel
  const animeId = Number(idStr);                   // NaN for pahe streams — that's fine
  const episode = Number(epStr);
  const navigate = useNavigate();

  const [anime, setAnime] = useState<AnimeMeta | null>(null);
  const [episodes, setEpisodes] = useState<LocalEpisode[]>([]);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [mouseNearTop, setMouseNearTop] = useState(false);
  const [resumeOffered, setResumeOffered] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number | null>(null);
  const singleClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersist = useRef<number>(0);
  const lastPositionUpdate = useRef<number>(0);

  // Load metadata + resolve file path (or use stream URL directly for pahe)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (streamUrl) {
        // AnimePahe stream — use URL directly, no library lookup needed
        setSrc(decodeURIComponent(streamUrl));
        return;
      }
      const [a, eps] = await Promise.all([
        window.api.anilist.get(animeId),
        window.api.library.episodesFor(animeId),
      ]);
      if (cancelled) return;
      setAnime(a);
      setEpisodes(eps);
      const target = eps.find((e) => e.episode === episode);
      if (!target) {
        setError("No local file for this episode. Add it to your library and re-scan.");
        return;
      }
      const url = await window.api.player.resolveFile(target.filePath);
      setSrc(url);

      // Check existing progress to offer resume.
      const p = await window.api.progress.get(animeId, episode);
      if (p && p.positionSec > 30 && p.positionSec / p.durationSec < 0.92) {
        setResumeOffered(p.positionSec);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [animeId, episode, streamUrl]);

  // Pause playback when app window is hidden to tray
  useEffect(() => {
    const unsub = window.api.on("app:window-hidden", () => {
      const v = videoRef.current;
      if (v && !v.paused) {
        v.pause();
      }
    });
    return unsub;
  }, []);

  // Persist progress
  function persist(pos: number, dur: number, force = false) {
    if (!Number.isFinite(pos) || !Number.isFinite(dur) || dur <= 0) return;
    const now = Date.now();
    if (!force && now - lastPersist.current < 5000) return;
    lastPersist.current = now;
    window.api.progress.set({
      animeId,
      episode,
      positionSec: pos,
      durationSec: dur,
      updatedAt: now,
    });
    pushProgress({
      animeId,
      episode,
      positionSec: pos,
      durationSec: dur,
      animeTitle:    anime?.title      ?? undefined,
      animeCoverUrl: anime?.coverImage ?? undefined,
      updatedAt: now,
    }).catch(() => {});
  }

  // Persist final position on unmount or window reload/closure so close-mid-episode doesn't lose progress.
  useEffect(() => {
    const handleBeforeUnload = () => {
      const v = videoRef.current;
      if (v) persist(v.currentTime, v.duration, true);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      const v = videoRef.current;
      if (v) persist(v.currentTime, v.duration, true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeId, episode]);

  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    persist(v.currentTime, v.duration);
    // Throttle React state (and therefore re-renders) to ~4 fps — the seek bar
    // and timestamp don't need to update at the full timeupdate rate (~10 fps).
    const now = Date.now();
    if (now - lastPositionUpdate.current >= 250) {
      lastPositionUpdate.current = now;
      setPosition(v.currentTime);
    }
  }

  function onLoaded() {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    v.volume = volume;
    v.muted = muted;
    v.play().catch(() => {});
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }

  function seek(delta: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
  }

  function gotoEpisode(delta: number) {
    const target = episodes.find((e) => e.episode === episode + delta);
    if (target) navigate(`/player/${animeId}/${target.episode}`, { replace: true });
  }

  function resume() {
    if (resumeOffered != null && videoRef.current) {
      videoRef.current.currentTime = resumeOffered;
      setResumeOffered(null);
    }
  }

  function fullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen();
  }

  // Track fullscreen state
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          seek(10);
          break;
        case "ArrowLeft":
          seek(-10);
          break;
        case "f":
          fullscreen();
          break;
        case "m":
          setMuted((m) => {
            const next = !m;
            if (videoRef.current) videoRef.current.muted = next;
            return next;
          });
          break;
        case "Escape":
          if (!document.fullscreenElement) navigate(-1);
          break;
        case "n":
          gotoEpisode(1);
          break;
        case "p":
          gotoEpisode(-1);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodes, episode, animeId]);

  // Auto-hide controls — start timer on mount so controls hide after idle
  useEffect(() => {
    hideTimer.current = window.setTimeout(() => setShowControls(false), 3000);
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (singleClickTimer.current) clearTimeout(singleClickTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function bumpControls(e?: React.MouseEvent) {
    setShowControls(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => { setShowControls(false); setMouseNearTop(false); }, 2500);
    if (e && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setMouseNearTop(e.clientY - rect.top < 70);
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative h-screen w-screen overflow-hidden bg-black"
      onMouseMove={bumpControls}
    >
      {error ? (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <div className="text-lg">{error}</div>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 rounded-md bg-white/10 px-4 py-2 hover:bg-white/20"
          >
            Back
          </button>
        </div>
      ) : src ? (
        <video
          ref={videoRef}
          src={src}
          className="h-full w-full"
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onLoaded}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onClick={() => {
            // Single click → play/pause after 250ms; double-click cancels timer → fullscreen
            if (singleClickTimer.current) {
              clearTimeout(singleClickTimer.current);
              singleClickTimer.current = null;
              fullscreen();
              return;
            }
            singleClickTimer.current = setTimeout(() => {
              singleClickTimer.current = null;
              togglePlay();
            }, 250);
          }}
          onEnded={() => {
            if (localStorage.getItem("ap-autonext") !== "false") gotoEpisode(1);
          }}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-muted">
          Loading…
        </div>
      )}

      {/* Fullscreen exit X — only when mouse is near top */}
      {isFullscreen && (
        <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-30 transition-opacity duration-300 ${mouseNearTop ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <button
            onClick={fullscreen}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 transition"
            title="Exit fullscreen"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="h-4 w-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Top bar */}
      <div
        className={`absolute left-0 right-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent p-4 transition ${
          showControls ? "opacity-100" : "opacity-0"
        }`}
      >
        <button
          onClick={() => navigate(-1)}
          className="rounded-full bg-black/40 p-2 hover:bg-black/70"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <div className="text-xs text-white/60">Episode {episode}</div>
          <div className="text-base font-semibold">
            {streamTitle ? decodeURIComponent(streamTitle) : (anime?.title ?? "Loading…")}
          </div>
        </div>
      </div>

      {/* Resume prompt */}
      {resumeOffered != null && (
        <div className="absolute bottom-32 left-1/2 -translate-x-1/2 rounded-lg bg-black/80 px-6 py-3 backdrop-blur">
          <div className="text-sm text-white/80">
            Resume from {secondsToTimestamp(resumeOffered)}?
          </div>
          <div className="mt-2 flex justify-center gap-2">
            <button
              onClick={resume}
              className="rounded-md bg-white px-4 py-1.5 text-sm font-semibold text-black"
            >
              Resume
            </button>
            <button
              onClick={() => setResumeOffered(null)}
              className="rounded-md bg-white/20 px-4 py-1.5 text-sm"
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-6 pt-12 transition ${
          showControls ? "opacity-100" : "opacity-0"
        }`}
      >
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={position}
          onChange={(e) => {
            const t = Number(e.target.value);
            if (videoRef.current) videoRef.current.currentTime = t;
            setPosition(t);
          }}
          className="w-full accent-accent"
        />
        <div className="mt-2 flex items-center justify-between text-sm">
          <div className="flex items-center gap-3">
            <button onClick={() => gotoEpisode(-1)} className="hover:opacity-80">
              <SkipBack size={20} />
            </button>
            <button
              onClick={togglePlay}
              className="rounded-full bg-white/10 p-2 hover:bg-white/20"
            >
              {playing ? (
                <Pause size={20} fill="currentColor" />
              ) : (
                <Play size={20} fill="currentColor" />
              )}
            </button>
            <button onClick={() => gotoEpisode(1)} className="hover:opacity-80">
              <SkipForward size={20} />
            </button>
            <div className="ml-3 flex items-center gap-2">
              <button
                onClick={() => {
                  setMuted((m) => {
                    const next = !m;
                    if (videoRef.current) videoRef.current.muted = next;
                    return next;
                  });
                }}
              >
                {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  if (videoRef.current) videoRef.current.volume = v;
                }}
                className="w-24 accent-white"
              />
            </div>
            <div className="ml-3 tabular-nums text-white/80">
              {secondsToTimestamp(position)} / {secondsToTimestamp(duration)}
            </div>
          </div>
          <button onClick={fullscreen} className="rounded-md bg-white/10 p-2 hover:bg-white/20" title={isFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}>
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
