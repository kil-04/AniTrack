import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Home,
  Loader2,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Rewind,
  FastForward,
  Maximize2,
  Minimize2,
  ChevronDown,
} from "lucide-react";
import Hls from "hls.js";
import { secondsToTimestamp } from "../lib/format";

// ── Synthetic anime ID for AnimePahe-only watches ─────────────────────────
// When a user watches via Latest Episodes there is no AniList ID in the URL.
// We hash the AnimePahe session string to a stable NEGATIVE integer so it
// never collides with real AniList IDs (which are always positive).
function paheSessionId(session: string): number {
  let h = 5381;
  for (let i = 0; i < session.length; i++) {
    h = (((h << 5) + h) ^ session.charCodeAt(i)) | 0; // djb2-xor, 32-bit signed
  }
  return -(Math.abs(h) || 1);
}

// ── MSE codec compatibility shim ───────────────────────────────────────────
// AnimePahe HLS manifests declare audio as mp4a.40.1 (AAC Main Profile).
// Chromium's MediaSource only accepts mp4a.40.2 (AAC-LC), so addSourceBuffer
// throws NotSupportedError and hls.js crashes with bufferAddCodecError.
// The streams are actually AAC-LC content mislabeled as Main — remapping the
// codec string to 40.2 is safe and lets Chromium decode them correctly.
if (typeof MediaSource !== "undefined") {
  const _orig = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (mime: string) {
    return _orig.call(this, mime.replace(/mp4a\.40\.1\b/g, "mp4a.40.2"));
  };
}

export default function StreamPlayer() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const animeSession = params.get("session") ?? "";
  const animeTitle = params.get("title") ?? "Anime";
  const animeCoverUrl = params.get("coverUrl") ?? undefined;
  const startEp = Number(params.get("episode") ?? 0);

  // Episode list
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [loadingEps, setLoadingEps] = useState(true);
  const [findNum, setFindNum] = useState("");

  // Stream quality options
  const [links, setLinks] = useState<any[]>([]);
  const [selectedLink, setSelectedLink] = useState(0);
  const [qualityOpen, setQualityOpen] = useState(false);

  // Playback state
  const [currentEp, setCurrentEp] = useState<any | null>(null);
  const [loadingStream, setLoadingStream] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Controls overlay visibility
  const [showControls, setShowControls] = useState(true);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Settings — persisted in localStorage
  const [autoPlay, setAutoPlay] = useState(() => localStorage.getItem("ap-autoplay") !== "false");
  const [autoNext, setAutoNext] = useState(() => localStorage.getItem("ap-autonext") !== "false");
  const [volume, setVolume] = useState(() => {
    const v = parseFloat(localStorage.getItem("ap-volume") ?? "1");
    return isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  });

  // Apply persisted volume on first video load
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoWrapRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const seekingRef = useRef(false);
  const singleClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNextRef = useRef(autoNext);
  const currentEpRef = useRef<any>(null);
  const episodesRef = useRef<any[]>([]);
  const linksRef = useRef<any[]>([]);
  const pageRef = useRef(page);
  const lastPageRef = useRef(lastPage);

  // Pending seek position — set before attachStream, applied in onCanPlay.
  // This avoids passing startPosition to hls.js (which stalls AnimePahe CDN).
  const pendingSeekRef = useRef<number | null>(null);

  // Stable effective anime ID — computed once on mount so playEpisode and the
  // progress timer both agree on which ID to use.
  const effectiveAnimeIdRef = useRef<number>(0);
  useEffect(() => {
    const anilistId = Number(params.get("animeId") ?? 0);
    effectiveAnimeIdRef.current = anilistId > 0 ? anilistId : paheSessionId(animeSession);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { autoNextRef.current = autoNext; }, [autoNext]);
  useEffect(() => { currentEpRef.current = currentEp; }, [currentEp]);
  useEffect(() => { episodesRef.current = episodes; }, [episodes]);
  useEffect(() => { linksRef.current = links; }, [links]);
  useEffect(() => { pageRef.current = page; }, [page]);
  useEffect(() => { lastPageRef.current = lastPage; }, [lastPage]);

  // ── Controls overlay auto-hide ─────────────────────────────────────────────

  function showControlsNow() {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
  }

  function handleVideoAreaMouseMove() {
    showControlsNow();
  }

  function handleVideoAreaMouseLeave() {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 800);
  }

  useEffect(() => {
    return () => { if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current); };
  }, []);

  // ── Episode list loading ───────────────────────────────────────────────────

  useEffect(() => {
    if (!animeSession) return;
    setLoadingEps(true);
    window.api.pahe
      .episodes(animeSession, page)
      .then((r) => {
        setEpisodes(r.data);
        setLastPage(r.lastPage);
        if (startEp && page === 1) {
          const ep = r.data.find((e: any) => e.episode === startEp);
          if (ep) playEpisode(ep, animeSession);
        }
      })
      .finally(() => setLoadingEps(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeSession, page]);

  // ── HLS / video setup ─────────────────────────────────────────────────────

  function attachStream(url: string) {
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = url.includes(".m3u8");

    if (isHls && Hls.isSupported()) {
      buildHls(url, video, { worker: true, startLevel: -1, attempt: 1 });
    } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      if (autoPlay) video.play().catch(() => {});
    } else {
      video.src = url;
      if (autoPlay) video.play().catch(() => {});
    }
  }

  function buildHls(
    url: string,
    video: HTMLVideoElement,
    opts: { worker: boolean; startLevel: number; attempt: number },
  ) {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const hls = new Hls({
      enableWorker: opts.worker,
      lowLatencyMode: false,
      preferManagedMediaSource: false,
      startLevel: opts.startLevel,
      startPosition: -1,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
    });
    hlsRef.current = hls;

    hls.on(Hls.Events.BUFFER_CODECS, (_e, data) => {
      const audioCodec = (data as any).audio?.codec ?? "";
      if (audioCodec) {
        const ok = MediaSource.isTypeSupported(`audio/mp4; codecs="${audioCodec}"`);
        if (!ok) console.warn(`[hls] audio codec not supported: ${audioCodec}`);
      }
    });

    hls.loadSource(url);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (autoPlay) video.play().catch(() => {});
    });

    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;

      if (data.details === Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR) {
        if (opts.attempt === 1) {
          buildHls(url, video, { worker: false, startLevel: -1, attempt: 2 });
          return;
        }
        if (opts.attempt === 2) {
          buildHls(url, video, { worker: false, startLevel: 0, attempt: 3 });
          return;
        }
      }

      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && opts.attempt < 3) {
        hls.recoverMediaError();
        return;
      }

      setStreamError(`HLS error: ${data.details}`);
      setLoadingStream(false);
    });
  }

  // ── Playback ───────────────────────────────────────────────────────────────

  const loadingStreamRef = useRef(false);

  const playEpisode = useCallback(
    async (ep: any, session = animeSession) => {
      if (loadingStreamRef.current && currentEpRef.current?.session === ep.session) return;
      loadingStreamRef.current = true;
      setCurrentEp(ep);
      setStreamError(null);
      setLoadingStream(true);
      setPosition(0);
      setDuration(0);
      setLinks([]);
      setSelectedLink(0);
      try {
        const fetchedLinks: any[] = await window.api.pahe.links(ep.session, session);
        if (!fetchedLinks.length) throw new Error("No stream links found for this episode");
        setLinks(fetchedLinks);
        setSelectedLink(0);

        // Look up saved progress and store it in pendingSeekRef.
        // We apply the seek in onCanPlay (after the video is ready) rather than
        // passing startPosition to hls.js — hls.js startPosition stalls on
        // AnimePahe CDN because it tries to fetch mid-stream segments cold.
        const savedProgress = await window.api.progress.get(
          effectiveAnimeIdRef.current,
          ep.episode,
        ).catch(() => null);
        pendingSeekRef.current = (savedProgress && savedProgress.positionSec > 5)
          ? savedProgress.positionSec
          : null;

        const { url } = await window.api.pahe.resolve(fetchedLinks[0].kwik);
        attachStream(url);

        // Pre-fetch next episode in background
        const nextEp = episodesRef.current.find((e) => e.episode === ep.episode + 1);
        if (nextEp) {
          window.api.pahe.links(nextEp.session, session)
            .then((nextLinks: any[]) => {
              if (nextLinks[0]?.kwik) window.api.pahe.prefetch(nextLinks[0].kwik);
            })
            .catch(() => {});
        }
      } catch (e: any) {
        setStreamError(e.message ?? String(e));
        setLoadingStream(false);
      } finally {
        loadingStreamRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [animeSession, autoPlay],
  );

  async function changeQuality(idx: number) {
    const link = linksRef.current[idx];
    if (!link) return;
    setSelectedLink(idx);
    setQualityOpen(false);
    setLoadingStream(true);
    setStreamError(null);
    try {
      const { url } = await window.api.pahe.resolve(link.kwik);
      // Store the current position in pendingSeekRef so onCanPlay applies it
      // after the new stream is ready — same pattern as episode resume.
      const pos = videoRef.current?.currentTime ?? 0;
      pendingSeekRef.current = pos > 1 ? pos : null;
      attachStream(url);
    } catch (e: any) {
      setStreamError(e.message ?? String(e));
      setLoadingStream(false);
    }
  }

  function playNext() {
    const ep = currentEpRef.current;
    const eps = episodesRef.current;
    if (!ep) return;
    const next = eps.find((e) => e.episode === ep.episode + 1);
    if (next) { playEpisode(next); return; }
    if (pageRef.current < lastPageRef.current) setPage((p) => p + 1);
  }

  function playPrev() {
    const ep = currentEpRef.current;
    const eps = episodesRef.current;
    if (!ep) return;
    const prev = eps.find((e) => e.episode === ep.episode - 1);
    if (prev) playEpisode(prev);
  }

  function handleFindSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(findNum);
    if (!n) return;
    const ep = episodes.find((ep) => ep.episode === n);
    if (ep) { playEpisode(ep); setFindNum(""); }
  }

  function seek(delta: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
  }

  function toggleFullscreen() {
    const el = videoWrapRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // ── Video element event handlers ───────────────────────────────────────────

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      if (!seekingRef.current) setPosition(video.currentTime);
    };
    const onDurationChange = () => setDuration(isFinite(video.duration) ? video.duration : 0);
    const onEnded = () => { if (autoNextRef.current) playNext(); };
    const onCanPlay = () => {
      setLoadingStream(false);
      // Apply saved resume position now that the video element is ready.
      if (pendingSeekRef.current !== null && videoRef.current) {
        videoRef.current.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
      }
    };
    const onError = () => {
      const err = video.error;
      if (err) setStreamError(`Video error: ${err.message || err.code}`);
      setLoadingStream(false);
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("ended", onEnded);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("error", onError);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (singleClickTimerRef.current) { clearTimeout(singleClickTimerRef.current); singleClickTimerRef.current = null; }
    };
  }, []);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const video = videoRef.current;
      if (!video) return;
      showControlsNow();

      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        video.paused ? video.play().catch(() => {}) : video.pause();
      }
      if (e.key === "ArrowRight") { e.preventDefault(); seek(5); }
      if (e.key === "ArrowLeft")  { e.preventDefault(); seek(-5); }
      if (e.key === "m") { video.muted = !video.muted; setMuted(video.muted); }
      if (e.key === "n") playNext();
      if (e.key === "p") playPrev();
      if (e.key === "f") toggleFullscreen();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Progress save (every 10s)
  useEffect(() => {
    if (!currentEp) return;

    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || !video.duration || !isFinite(video.duration)) return;
      window.api.progress
        .set({
          animeId: effectiveAnimeIdRef.current,
          episode: currentEpRef.current?.episode ?? currentEp.episode,
          positionSec: video.currentTime,
          durationSec: video.duration,
          updatedAt: Date.now(),
          animeTitle: animeTitle,
          animeCoverUrl: animeCoverUrl,
          animePaheSession: animeSession || undefined,
        })
        .catch(() => {});
    }, 10_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEp]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const epRange =
    episodes.length > 0
      ? `${String(episodes[0].episode).padStart(3, "0")}-${String(episodes[episodes.length - 1].episode).padStart(3, "0")}`
      : "---";

  const progressPct = duration > 0 ? (position / duration) * 100 : 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0d0d12] text-white">

      {/* Top bar */}
      <div className="flex h-10 flex-shrink-0 items-center gap-3 border-b border-white/10 bg-[#111118] px-3">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1 rounded px-2 py-1 text-sm text-white/60 hover:bg-white/10 hover:text-white"
          title="Home"
        >
          <Home size={14} /> Home
        </button>
        <button
          className="truncate text-sm font-semibold hover:text-[#4a9eff] transition-colors text-left"
          title="Go to anime page"
          onClick={async () => {
            const id = Number(params.get("animeId") ?? 0);
            if (id > 0) { navigate(`/anime/${id}`); return; }
            try {
              const results = await window.api.anilist.search(animeTitle);
              if (results.length > 0) navigate(`/anime/${results[0].id}`);
            } catch { /* ignore */ }
          }}
        >
          {animeTitle}
        </button>
        {currentEp && <span className="text-sm text-white/50">— Episode {currentEp.episode}</span>}
        {loadingStream && <Loader2 size={13} className="ml-auto animate-spin text-white/40" />}
        {streamError && !loadingStream && (
          <span className="ml-auto max-w-xs truncate text-xs text-red-400">{streamError}</span>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">

        {/* Episode list — 260 px */}
        <div className="flex w-[260px] flex-shrink-0 flex-col border-r border-white/10 bg-[#111118]">
          <div className="flex gap-2 border-b border-white/10 p-2">
            <div className="flex h-8 items-center rounded border border-white/10 bg-white/5 px-2 text-xs text-white/70 gap-1">
              <span>{epRange}</span>
              {lastPage > 1 && (
                <div className="flex gap-0.5 ml-1">
                  <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
                    className="px-1 hover:text-white disabled:opacity-30">&#8249;</button>
                  <button disabled={page === lastPage} onClick={() => setPage((p) => p + 1)}
                    className="px-1 hover:text-white disabled:opacity-30">&#8250;</button>
                </div>
              )}
            </div>
            <form onSubmit={handleFindSubmit} className="flex-1">
              <input
                value={findNum}
                onChange={(e) => setFindNum(e.target.value)}
                placeholder="Find number"
                className="h-8 w-full rounded border border-white/10 bg-white/5 px-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30"
                type="number" min={1}
              />
            </form>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {loadingEps ? (
              <div className="flex h-20 items-center justify-center">
                <Loader2 size={16} className="animate-spin text-white/40" />
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-1">
                {episodes.map((ep) => {
                  const isCurrent = currentEp?.session === ep.session;
                  return (
                    <button
                      key={ep.session}
                      onClick={() => playEpisode(ep)}
                      className={`flex h-9 items-center justify-center rounded text-xs font-medium transition
                        ${isCurrent ? "bg-[#4a9eff] text-white" : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"}`}
                    >
                      {ep.episode}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Video area */}
        <div
          ref={videoWrapRef}
          className="relative flex flex-1 flex-col bg-black overflow-hidden"
          onMouseMove={handleVideoAreaMouseMove}
          onMouseLeave={handleVideoAreaMouseLeave}
          style={{ cursor: showControls ? "default" : "none" }}
          onClick={(e) => {
            // Single click = play/pause (after 250ms delay to allow double-click detection).
            const t = e.target as HTMLElement;
            if (t.closest("button") || t.closest("input") || t.closest("select")) return;
            if (singleClickTimerRef.current) {
              // Second click within 250ms -> double-click -> fullscreen toggle
              clearTimeout(singleClickTimerRef.current);
              singleClickTimerRef.current = null;
              toggleFullscreen();
              return;
            }
            singleClickTimerRef.current = setTimeout(() => {
              singleClickTimerRef.current = null;
              const v = videoRef.current;
              if (!v) return;
              v.paused ? v.play().catch(() => {}) : v.pause();
              showControlsNow();
            }, 250);
          }}
        >
          <video
            ref={videoRef}
            className="h-full w-full object-contain"
            playsInline
          />

          {/* Empty state */}
          {!currentEp && !loadingStream && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-sm text-white/30">Select an episode to start watching</p>
            </div>
          )}

          {/* Loading overlay */}
          {loadingStream && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/40 pointer-events-none">
              <Loader2 size={36} className="animate-spin" />
              <span className="text-sm">Resolving stream…</span>
            </div>
          )}

          {/* Error overlay */}
          {streamError && !loadingStream && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="max-w-sm rounded-lg bg-red-500/10 p-4 text-center text-sm text-red-400">
                {streamError}
              </div>
            </div>
          )}

          {/* Fullscreen exit button — top-center, shown on hover */}
          {isFullscreen && (
            <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-30 transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
              <button
                onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 transition"
                title="Exit fullscreen"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="h-4 w-4">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}

          {/* Controls overlay */}
          <div
            className={`absolute inset-0 flex flex-col justify-end transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          >
            {/* Bottom gradient */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

            {/* Controls */}
            <div className="relative px-4 pb-3 pt-2 select-none">

              {/* Seek bar */}
              <div className="group mb-3 flex items-center gap-2">
                <div className="relative h-1 flex-1 cursor-pointer rounded-full bg-white/20"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = (e.clientX - rect.left) / rect.width;
                    const v = videoRef.current;
                    if (v && duration) v.currentTime = pct * duration;
                  }}
                >
                  {/* Played */}
                  <div className="absolute inset-y-0 left-0 rounded-full bg-[#f5c518]"
                    style={{ width: `${progressPct}%` }} />
                  {/* Thumb */}
                  <div
                    className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ left: `${progressPct}%` }}
                  />
                  {/* Hidden native range for drag */}
                  <input
                    type="range" min={0} max={duration || 1} step={0.5} value={position}
                    disabled={!currentEp || !duration}
                    onMouseDown={() => { seekingRef.current = true; }}
                    onMouseUp={(e) => {
                      seekingRef.current = false;
                      const t = Number((e.target as HTMLInputElement).value);
                      if (videoRef.current) videoRef.current.currentTime = t;
                    }}
                    onChange={(e) => setPosition(Number(e.target.value))}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </div>
                <span className="min-w-[7rem] text-right text-xs tabular-nums text-white/70">
                  {secondsToTimestamp(position)} / {secondsToTimestamp(duration)}
                </span>
              </div>

              {/* Button row */}
              <div className="flex items-center gap-1">

                {/* Play / Pause */}
                <button
                  onClick={() => { const v = videoRef.current; if (!v) return; v.paused ? v.play().catch(() => {}) : v.pause(); }}
                  disabled={!currentEp}
                  className="flex h-8 w-8 items-center justify-center rounded text-white hover:bg-white/10 disabled:opacity-30 transition"
                >
                  {playing ? <Pause size={16} fill="white" /> : <Play size={16} fill="white" />}
                </button>

                {/* -5s */}
                <button
                  onClick={() => seek(-5)}
                  disabled={!currentEp}
                  className="flex h-8 items-center gap-0.5 rounded px-2 text-xs text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                  title="Rewind 5s (←)"
                >
                  <Rewind size={13} />
                  <span>5</span>
                </button>

                {/* +5s */}
                <button
                  onClick={() => seek(5)}
                  disabled={!currentEp}
                  className="flex h-8 items-center gap-0.5 rounded px-2 text-xs text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                  title="Forward 5s (→)"
                >
                  <span>5</span>
                  <FastForward size={13} />
                </button>

                {/* Volume */}
                <button
                  onClick={() => { const next = !muted; setMuted(next); if (videoRef.current) videoRef.current.muted = next; }}
                  className="flex h-8 w-8 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white transition"
                >
                  {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
                <input
                  type="range" min={0} max={1} step={0.02} value={muted ? 0 : volume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVolume(v); setMuted(v === 0);
                    localStorage.setItem("ap-volume", String(v));
                    if (videoRef.current) { videoRef.current.volume = v; videoRef.current.muted = v === 0; }
                  }}
                  className="w-20 accent-white cursor-pointer"
                />

                {/* Spacer */}
                <div className="flex-1" />

                {/* Auto Play toggle */}
                <button
                  onClick={() => setAutoPlay((v) => { const n = !v; localStorage.setItem("ap-autoplay", String(n)); return n; })}
                  className={`h-8 rounded px-2 text-xs transition ${autoPlay ? "text-[#4a9eff]" : "text-white/40 hover:text-white/60"}`}
                >
                  {autoPlay ? "✓ " : ""}Auto Play
                </button>

                {/* Auto Next toggle */}
                <button
                  onClick={() => setAutoNext((v) => { const n = !v; localStorage.setItem("ap-autonext", String(n)); return n; })}
                  className={`h-8 rounded px-2 text-xs transition ${autoNext ? "text-[#4a9eff]" : "text-white/40 hover:text-white/60"}`}
                >
                  {autoNext ? "✓ " : ""}Auto Next
                </button>

                {/* Prev / Next */}
                <button
                  onClick={playPrev} disabled={!currentEp}
                  className="h-8 rounded px-2 text-xs text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                >
                  ⏮ Prev
                </button>
                <button
                  onClick={playNext} disabled={!currentEp}
                  className="h-8 rounded px-2 text-xs text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                >
                  Next ⏭
                </button>

                {/* Quality selector */}
                {links.length > 1 && (
                  <div className="relative">
                    <button
                      onClick={() => setQualityOpen((o) => !o)}
                      className="flex h-8 items-center gap-1 rounded px-2 text-xs text-white/70 hover:bg-white/10 hover:text-white transition"
                    >
                      {links[selectedLink]?.quality ?? "?"}p
                      <ChevronDown size={11} />
                    </button>
                    {qualityOpen && (
                      <div className="absolute bottom-10 right-0 z-20 min-w-[90px] overflow-hidden rounded-lg border border-white/10 bg-[#1a1a24] shadow-xl">
                        {links.map((l, i) => (
                          <button
                            key={i}
                            onClick={() => changeQuality(i)}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-white/10
                              ${i === selectedLink ? "text-[#4a9eff]" : "text-white/70"}`}
                          >
                            {i === selectedLink && <span>✓</span>}
                            <span className={i === selectedLink ? "" : "ml-3"}>{l.quality}p</span>
                            {l.audio && l.audio !== "jpn" && (
                              <span className="ml-auto rounded bg-white/10 px-1 text-[10px]">{l.audio}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Fullscreen */}
                <button
                  onClick={toggleFullscreen}
                  className="flex h-8 w-8 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white transition"
                  title="Fullscreen (F)"
                >
                  {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </div>
            </div>
          </div>

          {/* Click-outside to close quality dropdown */}
          {qualityOpen && (
            <div className="absolute inset-0 z-10" onClick={() => setQualityOpen(false)} />
          )}
        </div>
      </div>
    </div>
  );
}
