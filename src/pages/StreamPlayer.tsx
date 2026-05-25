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
  ArrowLeft,
} from "lucide-react";
import Hls from "hls.js";
import { secondsToTimestamp } from "../lib/format";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { isCapacitor } from "../lib/platform";
import { pushProgress } from "../lib/supabase-sync";

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
  // Range-based pagination: show 100 episodes per page (instead of AnimePahe's
  // native 30). `rangeStart` is the first episode of the visible range.
  const RANGE_SIZE = 100;
  const PAHE_PAGE_SIZE = 30; // fixed by AnimePahe's API
  const [rangeStart, setRangeStart] = useState(1);
  const [totalEpisodes, setTotalEpisodes] = useState(0);
  const [loadingEps, setLoadingEps] = useState(true);
  const [findNum, setFindNum] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);

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
  const [mouseNearTop, setMouseNearTop] = useState(false);
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
  const rangeStartRef = useRef(rangeStart);
  const totalEpisodesRef = useRef(totalEpisodes);
  // Cache of fetched episode pages by AnimePahe page number — survives range changes.
  const paheCacheRef = useRef<Map<number, any[]>>(new Map());
  const lastPositionUpdate = useRef<number>(0);

  // Pending seek position — set before attachStream, applied in onCanPlay.
  // This avoids passing startPosition to hls.js (which stalls AnimePahe CDN).
  const pendingSeekRef = useRef<number | null>(null);

  // Stable effective anime ID — computed once on mount so playEpisode and the
  // progress timer both agree on which ID to use.
  const effectiveAnimeIdRef = useRef<number>(0);
  useEffect(() => {
    const anilistId = Number(params.get("animeId") ?? 0);
    effectiveAnimeIdRef.current = anilistId > 0 ? anilistId : paheSessionId(animeSession);

    // Load initial watched-episode map from DB.
    if (effectiveAnimeIdRef.current !== 0) {
      window.api.progress.getForAnime(effectiveAnimeIdRef.current)
        .then((rows) => {
          const m = new Map<number, number>();
          for (const r of rows) {
            if (r.durationSec > 0) m.set(r.episode, (r.positionSec / r.durationSec) * 100);
          }
          setWatchedEps(m);
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watched episodes map — keyed by episode number, value is percent watched.
  const [watchedEps, setWatchedEps] = useState<Map<number, number>>(new Map());

  useEffect(() => { autoNextRef.current = autoNext; }, [autoNext]);
  useEffect(() => { currentEpRef.current = currentEp; }, [currentEp]);
  useEffect(() => { episodesRef.current = episodes; }, [episodes]);
  useEffect(() => { linksRef.current = links; }, [links]);
  useEffect(() => { rangeStartRef.current = rangeStart; }, [rangeStart]);
  useEffect(() => { totalEpisodesRef.current = totalEpisodes; }, [totalEpisodes]);

  // ── Controls overlay auto-hide ─────────────────────────────────────────────

  function showControlsNow() {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
  }

  function handleVideoAreaMouseMove(e: React.MouseEvent) {
    showControlsNow();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMouseNearTop(e.clientY - rect.top < 70);
  }

  function handleVideoAreaMouseLeave() {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => { setShowControls(false); setMouseNearTop(false); }, 800);
  }

  useEffect(() => {
    return () => { if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current); };
  }, []);

  // ── Episode list loading ───────────────────────────────────────────────────

  // Fetch a single AnimePahe page with caching (paheCacheRef survives navigation).
  const fetchPahePage = useCallback(async (paheePage: number): Promise<{ data: any[]; total: number }> => {
    const cached = paheCacheRef.current.get(paheePage);
    if (cached) return { data: cached, total: totalEpisodesRef.current };
    const r = await window.api.pahe.episodes(animeSession, paheePage);
    paheCacheRef.current.set(paheePage, r.data);
    return { data: r.data, total: r.total };
  }, [animeSession]);

  // Load all AnimePahe pages needed to cover [rangeStart, rangeStart+RANGE_SIZE-1].
  useEffect(() => {
    if (!animeSession) return;
    let cancelled = false;
    setLoadingEps(true);
    const rangeEnd = rangeStart + RANGE_SIZE - 1;
    const firstPaheePage = Math.max(1, Math.ceil(rangeStart / PAHE_PAGE_SIZE));
    // We don't yet know totalEpisodes on first call — fetch first needed page,
    // get total, then fetch the rest in parallel.
    fetchPahePage(firstPaheePage)
      .then(async ({ data: firstData, total }) => {
        if (cancelled) return;
        if (firstData.length === 0) {
          // Session expired or failed to load. Redirect back to Anime page to refresh session.
          const id = Number(params.get("animeId") ?? 0);
          if (id > 0) {
            navigate(`/anime/${id}`, { replace: true });
            return;
          }
        }
        if (total) setTotalEpisodes(total);
        const lastPaheePage = Math.min(
          Math.ceil(Math.min(rangeEnd, total || rangeEnd) / PAHE_PAGE_SIZE),
          Math.ceil((total || (firstPaheePage * PAHE_PAGE_SIZE)) / PAHE_PAGE_SIZE),
        );
        const remaining: Promise<{ data: any[] }>[] = [];
        for (let p = firstPaheePage + 1; p <= lastPaheePage; p++) {
          remaining.push(fetchPahePage(p));
        }
        const rest = await Promise.all(remaining);
        if (cancelled) return;
        const all = [firstData, ...rest.map((r) => r.data)].flat();
        const filtered = all
          .filter((e: any) => e.episode >= rangeStart && e.episode <= rangeEnd)
          .sort((a: any, b: any) => a.episode - b.episode);
        setEpisodes(filtered);
        // Auto-play the requested startEp once, only on the initial load.
        if (startEp && rangeStart === Math.floor((startEp - 1) / RANGE_SIZE) * RANGE_SIZE + 1) {
          const ep = filtered.find((e: any) => e.episode === startEp);
          if (ep && !currentEpRef.current) playEpisode(ep, animeSession);
        }
      })
      .catch((e) => { if (!cancelled) console.warn("[pahe] episode load failed", e); })
      .finally(() => { if (!cancelled) setLoadingEps(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeSession, rangeStart, fetchPahePage]);

  // Reset cache when anime changes
  useEffect(() => {
    paheCacheRef.current.clear();
    // If startEp is set, open the range that contains it.
    if (startEp) {
      const targetRange = Math.floor((startEp - 1) / RANGE_SIZE) * RANGE_SIZE + 1;
      setRangeStart(targetRange);
    } else {
      setRangeStart(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeSession]);

  // ── HLS / video setup ─────────────────────────────────────────────────────

  // On Android, hls.js XHR requests get CORS-blocked and native <video> bypasses
  // shouldInterceptRequest (API 24+ limitation). Instead we route every hls.js
  // network request through the native OkHttp fetchUrl plugin method, which sends
  // proper Referer/Cookie headers and is not subject to browser CORS enforcement.
  function buildCapacitorLoader() {
    return class CapacitorLoader {
      // hls.js reads loader.stats and stores it as frag.stats — must be a live reference.
      stats: any = {
        aborted: false, loaded: 0, total: 0, retry: 0, chunkCount: 0, bwEstimate: 0,
        loading: { start: 0, first: 0, end: 0 },
        parsing: { start: 0, end: 0 },
        buffering: { start: 0, end: 0, first: 0 },
      };
      private aborted = false;

      load(context: any, _config: any, callbacks: any) {
        this.aborted = false;
        const { url, responseType } = context;
        const binary = responseType === "arraybuffer";
        const trequest = performance.now();
        this.stats.loading.start = trequest;

        console.log('[CapLoader] fetching', url, 'binary=', binary);
        window.api.pahe.fetchUrl!(url, binary)
          .then((result) => {
            if (this.aborted) return;
            console.log('[CapLoader] got response status=', result.status, 'size=', result.data?.length, 'url=', url);
            let data: string | ArrayBuffer;
            if (binary && result.binary) {
              const raw = atob(result.data);
              const buf = new ArrayBuffer(raw.length);
              const view = new Uint8Array(buf);
              for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
              data = buf;
            } else {
              data = result.data;
            }
            const tload = performance.now();
            const loaded = binary
              ? (data as ArrayBuffer).byteLength
              : (data as string).length;
            // Mutate this.stats in-place — hls.js holds a reference via frag.stats = loader.stats
            this.stats.loaded = loaded;
            this.stats.total = loaded;
            this.stats.loading.first = trequest;
            this.stats.loading.end = tload;
            callbacks.onSuccess({ url, data }, this.stats, context, null);
          })
          .catch((err: any) => {
            if (this.aborted) return;
            console.error('[CapLoader] fetchUrl ERROR:', String(err), 'url=', url);
            this.stats.aborted = false;
            callbacks.onError({ code: 0, text: String(err) }, context, null, this.stats);
          });
      }

      abort() { this.aborted = true; this.stats.aborted = true; }
      destroy() { this.aborted = true; }
    };
  }

  function attachStream(url: string) {
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = url.includes(".m3u8");

    if (isHls && Hls.isSupported()) {
      buildHls(url, video, { worker: !isCapacitor, startLevel: -1, attempt: 1 });
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

    const hlsConfig: Partial<Hls["config"]> = {
      enableWorker: opts.worker,
      lowLatencyMode: false,
      preferManagedMediaSource: false,
      startLevel: opts.startLevel,
      startPosition: -1,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
    };
    if (isCapacitor) {
      (hlsConfig as any).loader = buildCapacitorLoader();
    }
    const hls = new Hls(hlsConfig as any);
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
      console.log('[HLS] MANIFEST_PARSED — starting playback');
      if (autoPlay) video.play().catch(() => {});
    });

    hls.on(Hls.Events.ERROR, (_e, data) => {
      const errInfo = `type=${data.type} details=${data.details} fatal=${data.fatal} url=${(data as any).url ?? (data as any).frag?.url ?? ''}`;
      console.error('[HLS ERROR]', errInfo, data);
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

      setStreamError(`HLS error: ${data.details} (${data.type})`);
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
        // Run links fetch and saved-progress lookup in parallel — they're
        // independent and saving even ~50ms of perceived latency matters here.
        const [fetchedLinks, savedProgress] = await Promise.all([
          window.api.pahe.links(ep.session, session),
          window.api.progress.get(effectiveAnimeIdRef.current, ep.episode).catch(() => null),
        ]);
        if (!fetchedLinks.length) throw new Error("No stream links found for this episode");
        const bestIdx = fetchedLinks.reduce((best: number, link: any, i: number) =>
          (Number(link.quality) || 0) > (Number(fetchedLinks[best]?.quality) || 0) ? i : best, 0);
        setLinks(fetchedLinks);
        setSelectedLink(bestIdx);

        // We apply the resume seek in onCanPlay (after the video is ready) rather than
        // passing startPosition to hls.js — hls.js startPosition stalls on
        // AnimePahe CDN because it tries to fetch mid-stream segments cold.
        pendingSeekRef.current = (savedProgress && savedProgress.positionSec > 5)
          ? savedProgress.positionSec
          : null;

        const { url } = await window.api.pahe.resolve(fetchedLinks[bestIdx].kwik);
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
    // Next episode is in the following range — jump to it.
    const nextEpNum = ep.episode + 1;
    if (nextEpNum <= totalEpisodesRef.current) {
      const targetRange = Math.floor((nextEpNum - 1) / RANGE_SIZE) * RANGE_SIZE + 1;
      setRangeStart(targetRange);
    }
  }

  function playPrev() {
    const ep = currentEpRef.current;
    const eps = episodesRef.current;
    if (!ep) return;
    const prev = eps.find((e) => e.episode === ep.episode - 1);
    if (prev) { playEpisode(prev); return; }
    const prevEpNum = ep.episode - 1;
    if (prevEpNum >= 1) {
      const targetRange = Math.floor((prevEpNum - 1) / RANGE_SIZE) * RANGE_SIZE + 1;
      setRangeStart(targetRange);
    }
  }

  function handleFindSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(findNum);
    if (!n) return;
    // First try the current range; if not found, jump to the range containing it.
    const ep = episodes.find((ep) => ep.episode === n);
    if (ep) { playEpisode(ep); setFindNum(""); return; }
    if (n >= 1 && n <= totalEpisodes) {
      const targetRange = Math.floor((n - 1) / RANGE_SIZE) * RANGE_SIZE + 1;
      setRangeStart(targetRange);
      setFindNum("");
    }
  }

  function seek(delta: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
  }

  function toggleFullscreen() {
    if (isCapacitor && isMobile) {
      // On Android phone: use ScreenOrientation to lock landscape (YouTube-style).
      // Dynamic import so ScreenOrientation is never loaded in Electron.
      if (!isFullscreen) {
        import("../lib/api-capacitor").then(({ ScreenOrientation }) => {
          ScreenOrientation.lock({ orientation: "landscape" }).catch(() => {});
        });
        setIsFullscreen(true);
      } else {
        import("../lib/api-capacitor").then(({ ScreenOrientation }) => {
          ScreenOrientation.unlock().catch(() => {});
        });
        setIsFullscreen(false);
      }
      return;
    }
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
      if (seekingRef.current) return;
      const now = Date.now();
      if (now - lastPositionUpdate.current >= 250) {
        lastPositionUpdate.current = now;
        setPosition(video.currentTime);
        // Mark current episode as watched when ≥85% — optimistic update so
        // the grid turns green immediately without waiting for a DB round-trip.
        const ep = currentEpRef.current;
        if (ep && video.duration && video.currentTime / video.duration >= 0.85) {
          setWatchedEps((prev) => {
            if ((prev.get(ep.episode) ?? 0) >= 85) return prev;
            const next = new Map(prev);
            next.set(ep.episode, (video.currentTime / video.duration) * 100);
            return next;
          });
        }
      }
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

  // Progress save (every 10s + on episode change / unmount)
  useEffect(() => {
    if (!currentEp) return;

    function saveNow() {
      const video = videoRef.current;
      if (!video || !video.duration || !isFinite(video.duration)) return;
      const payload = {
        animeId: effectiveAnimeIdRef.current,
        episode: currentEpRef.current?.episode ?? currentEp.episode,
        positionSec: video.currentTime,
        durationSec: video.duration,
        updatedAt: Date.now(),
        animeTitle: animeTitle,
        animeCoverUrl: animeCoverUrl,
        animePaheSession: animeSession || undefined,
      };
      window.api.progress.set(payload).catch(() => {});
      pushProgress(payload).catch(() => {});
    }

    const timer = setInterval(saveNow, 10_000);
    return () => { clearInterval(timer); saveNow(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEp]);

  // ── Derived ────────────────────────────────────────────────────────────────

  // Compute available ranges from totalEpisodes — chunks of RANGE_SIZE.
  const ranges = (() => {
    const total = totalEpisodes || (episodes.length > 0 ? episodes[episodes.length - 1].episode : 0);
    if (total <= 0) return [{ start: 1, end: RANGE_SIZE }];
    const r: { start: number; end: number }[] = [];
    for (let i = 1; i <= total; i += RANGE_SIZE) {
      r.push({ start: i, end: Math.min(i + RANGE_SIZE - 1, total) });
    }
    return r;
  })();
  const currentRange = ranges.find((r) => r.start === rangeStart) ?? ranges[0];
  const rangeLabel = currentRange
    ? `${String(currentRange.start).padStart(3, "0")}-${String(currentRange.end).padStart(3, "0")}`
    : "---";

  const progressPct = duration > 0 ? (position / duration) * 100 : 0;

  // ── Responsive layout ───────────────────────────────────────────────────────
  const isTablet = useMediaQuery("(min-width: 900px)");
  // On Android phone (portrait) we use the YouTube-style layout.
  const isMobile = isCapacitor && !isTablet;

  // ── Touch controls (mobile) ─────────────────────────────────────────────────
  function handleVideoTap() {
    showControlsNow();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // Shared sub-components

  const EpisodePanel = (
    <div className={`flex flex-col ${isMobile ? "flex-1 overflow-hidden" : "w-[260px] flex-shrink-0 border-r border-white/10"} bg-[#111118]`}>
      <div className="relative flex gap-2 border-b border-white/10 p-2">
        <div className="relative">
          <button
            onClick={() => setRangeOpen((o) => !o)}
            disabled={ranges.length <= 1}
            className="flex h-8 items-center gap-1 rounded border border-white/10 bg-white/5 px-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-60"
          >
            <span>{rangeLabel}</span>
            {ranges.length > 1 && (
              <ChevronDown size={12} className={`transition-transform ${rangeOpen ? "rotate-180" : ""}`} />
            )}
          </button>
          {rangeOpen && ranges.length > 1 && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setRangeOpen(false)} />
              <div className="absolute left-0 top-full z-30 mt-1 max-h-80 w-32 overflow-y-auto rounded-md border border-white/10 bg-[#1a1a24] shadow-xl">
                {ranges.map((r) => {
                  const label = `${String(r.start).padStart(3, "0")}-${String(r.end).padStart(3, "0")}`;
                  const active = r.start === rangeStart;
                  return (
                    <button
                      key={r.start}
                      onClick={() => { setRangeStart(r.start); setRangeOpen(false); }}
                      className={`block w-full px-3 py-1.5 text-left text-xs transition hover:bg-white/10 ${active ? "bg-white/10 text-white" : "text-white/70"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </>
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
              const pct = watchedEps.get(ep.episode) ?? 0;
              const watched = !isCurrent && pct >= 85;
              return (
                <button
                  key={ep.session}
                  onClick={() => playEpisode(ep)}
                  className={`flex h-9 items-center justify-center rounded text-xs font-medium transition
                    ${isCurrent
                      ? "bg-[#4a9eff] text-white"
                      : watched
                        ? "bg-green-500/20 text-green-400 ring-1 ring-green-500/30 hover:bg-green-500/30"
                        : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"}`}
                >
                  {ep.episode}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const VideoControls = (
    <div className={`absolute inset-0 flex flex-col justify-end transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
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
            <div className="absolute inset-y-0 left-0 rounded-full bg-[#f5c518]" style={{ width: `${progressPct}%` }} />
            <div className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity" style={{ left: `${progressPct}%` }} />
            <input
              type="range" min={0} max={duration || 1} step={0.5} value={position}
              disabled={!currentEp || !duration}
              onMouseDown={() => { seekingRef.current = true; }}
              onMouseUp={(e) => { seekingRef.current = false; const t = Number((e.target as HTMLInputElement).value); if (videoRef.current) videoRef.current.currentTime = t; }}
              onTouchStart={() => { seekingRef.current = true; }}
              onTouchEnd={(e) => { seekingRef.current = false; const t = Number((e.target as HTMLInputElement).value); if (videoRef.current) videoRef.current.currentTime = t; }}
              onChange={(e) => setPosition(Number(e.target.value))}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>
          <span className="min-w-[7rem] text-right text-xs tabular-nums text-white/70">
            {secondsToTimestamp(position)} / {secondsToTimestamp(duration)}
          </span>
        </div>

        {/* Button row */}
        <div className="flex items-center gap-1 flex-wrap">
          <button onClick={() => { const v = videoRef.current; if (!v) return; v.paused ? v.play().catch(() => {}) : v.pause(); }} disabled={!currentEp} className="flex h-8 w-8 items-center justify-center rounded text-white hover:bg-white/10 disabled:opacity-30 transition">
            {playing ? <Pause size={16} fill="white" /> : <Play size={16} fill="white" />}
          </button>
          <button onClick={() => seek(-10)} disabled={!currentEp} className="flex h-8 items-center gap-0.5 rounded px-2 text-xs text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition">
            <Rewind size={13} /><span>{isMobile ? "10" : "5"}</span>
          </button>
          <button onClick={() => seek(isMobile ? 10 : 5)} disabled={!currentEp} className="flex h-8 items-center gap-0.5 rounded px-2 text-xs text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition">
            <span>{isMobile ? "10" : "5"}</span><FastForward size={13} />
          </button>
          <button onClick={() => { const next = !muted; setMuted(next); if (videoRef.current) videoRef.current.muted = next; }} className="flex h-8 w-8 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white transition">
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          {!isMobile && (
            <input type="range" min={0} max={1} step={0.02} value={muted ? 0 : volume}
              onChange={(e) => { const v = Number(e.target.value); setVolume(v); setMuted(v === 0); localStorage.setItem("ap-volume", String(v)); if (videoRef.current) { videoRef.current.volume = v; videoRef.current.muted = v === 0; } }}
              className="w-20 accent-white cursor-pointer"
            />
          )}
          <div className="flex-1" />
          {!isMobile && (
            <>
              <button onClick={() => setAutoPlay((v) => { const n = !v; localStorage.setItem("ap-autoplay", String(n)); return n; })} className={`h-8 rounded px-2 text-xs transition ${autoPlay ? "text-[#4a9eff]" : "text-white/40 hover:text-white/60"}`}>
                {autoPlay ? "✓ " : ""}Auto Play
              </button>
              <button onClick={() => setAutoNext((v) => { const n = !v; localStorage.setItem("ap-autonext", String(n)); return n; })} className={`h-8 rounded px-2 text-xs transition ${autoNext ? "text-[#4a9eff]" : "text-white/40 hover:text-white/60"}`}>
                {autoNext ? "✓ " : ""}Auto Next
              </button>
            </>
          )}
          <button onClick={playPrev} disabled={!currentEp} className="h-8 rounded px-2 text-xs text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30 transition">⏮ Prev</button>
          <button onClick={playNext} disabled={!currentEp} className="h-8 rounded px-2 text-xs text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30 transition">Next ⏭</button>
          {links.length > 1 && (
            <div className="relative">
              <button onClick={() => setQualityOpen((o) => !o)} className="flex h-8 items-center gap-1 rounded px-2 text-xs text-white/70 hover:bg-white/10 hover:text-white transition">
                {links[selectedLink]?.quality ?? "?"}p <ChevronDown size={11} />
              </button>
              {qualityOpen && (
                <div className="absolute bottom-10 right-0 z-20 min-w-[90px] overflow-hidden rounded-lg border border-white/10 bg-[#1a1a24] shadow-xl">
                  {links.map((l, i) => (
                    <button key={i} onClick={() => changeQuality(i)} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-white/10 ${i === selectedLink ? "text-[#4a9eff]" : "text-white/70"}`}>
                      {i === selectedLink && <span>✓</span>}
                      <span className={i === selectedLink ? "" : "ml-3"}>{l.quality}p</span>
                      {l.audio && l.audio !== "jpn" && <span className="ml-auto rounded bg-white/10 px-1 text-[10px]">{l.audio}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={toggleFullscreen} className="flex h-8 w-8 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white transition" title="Fullscreen (F)">
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>
    </div>
  );

  const VideoArea = (fullHeight = false) => (
    <div
      ref={videoWrapRef}
      className={`relative flex ${fullHeight ? "flex-1" : ""} flex-col bg-black overflow-hidden`}
      style={{ cursor: isMobile ? "default" : (showControls ? "default" : "none") }}
      onMouseMove={handleVideoAreaMouseMove}
      onMouseLeave={handleVideoAreaMouseLeave}
      onTouchStart={handleVideoTap}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest("button") || t.closest("input") || t.closest("select")) return;
        if (singleClickTimerRef.current) {
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
      <video ref={videoRef} className="h-full w-full object-contain" playsInline />
      {!currentEp && !loadingStream && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-white/30">Select an episode to start watching</p>
        </div>
      )}
      {loadingStream && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/40 pointer-events-none">
          <Loader2 size={36} className="animate-spin" />
          <span className="text-sm">Resolving stream…</span>
        </div>
      )}
      {streamError && !loadingStream && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="max-w-sm rounded-lg bg-red-500/10 p-4 text-center text-sm text-red-400">{streamError}</div>
        </div>
      )}
      {isFullscreen && (
        <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-30 transition-opacity duration-300 ${(isMobile || mouseNearTop) ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 transition" title="Exit fullscreen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="h-4 w-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
      {VideoControls}
      {qualityOpen && <div className="absolute inset-0 z-10" onClick={() => setQualityOpen(false)} />}
    </div>
  );

  // ── Mobile layout (YouTube-style) ───────────────────────────────────────────
  if (isMobile) {
    // Fullscreen: fill entire screen in landscape (orientation is locked by toggleFullscreen)
    if (isFullscreen) {
      return (
        <div className="flex h-screen w-screen bg-black text-white">
          {VideoArea(true)}
        </div>
      );
    }

    // Portrait: video (16:9) at top, episode panel below
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-[#0d0d12] text-white">
        {/* Top bar */}
        <div className="flex h-12 flex-shrink-0 items-center gap-2 bg-[#111118] px-3">
          <button onClick={() => navigate("/")} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm font-semibold">{animeTitle}</div>
            {currentEp && <div className="text-xs text-white/50">Episode {currentEp.episode}</div>}
          </div>
          {loadingStream && <Loader2 size={14} className="animate-spin text-white/40" />}
        </div>

        {/* Video — 16:9 aspect ratio */}
        <div className="aspect-video w-full flex-shrink-0 bg-black">
          {VideoArea(true)}
        </div>

        {/* Episode list — scrollable below video */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {EpisodePanel}
        </div>
      </div>
    );
  }

  // ── Desktop / tablet layout (split view) ────────────────────────────────────
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

      {/* Main content — episode panel left, video right */}
      <div className="flex flex-1 overflow-hidden">
        {EpisodePanel}
        {VideoArea(true)}
      </div>
    </div>
  );
}
