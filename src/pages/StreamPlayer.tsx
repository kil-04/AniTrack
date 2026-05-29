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
import { SkipOverlay } from "../components/player/SkipOverlay";
import { VideoControls } from "../components/player/VideoControls";
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

function getSeasonNumber(title: string): number | null {
  const clean = title.toLowerCase();
  
  // Pattern 1: "season 4" or "season iv" or "ss 4"
  const seasonMatch = clean.match(/\b(season|ss|part|cour)\s+(\d+|ii|iii|iv|v|vi|vii|viii|ix|x)\b/);
  if (seasonMatch) {
    const val = seasonMatch[2];
    if (/^\d+$/.test(val)) return parseInt(val, 10);
    const romanMap: Record<string, number> = {
      i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10
    };
    if (romanMap[val] !== undefined) return romanMap[val];
  }

  // Pattern 2: "4th season" or "2nd season"
  const ordinalMatch = clean.match(/\b(\d+)(st|nd|rd|th)\s+(season|part|ss|cour)\b/);
  if (ordinalMatch) {
    return parseInt(ordinalMatch[1], 10);
  }

  // Pattern 3: Lone Roman numerals at the end of the title
  const endRomanMatch = clean.match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b\s*$/);
  if (endRomanMatch) {
    const romanMap: Record<string, number> = {
      ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10
    };
    return romanMap[endRomanMatch[1]];
  }

  // Pattern 4: Lone digits at the end
  const endDigitMatch = clean.match(/\b(\d+)\b\s*$/);
  if (endDigitMatch) {
    return parseInt(endDigitMatch[1], 10);
  }

  return null;
}

function scoreMatch(candidate: any, targetTitle: string, targetYear?: number, targetEpisodes?: number, targetStatus?: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  const t = norm(targetTitle);
  const c = norm(candidate.title ?? "");
  let score = 0;
  if (c === t) {
    score += 100;
  } else if (c.includes(t) || t.includes(c)) {
    const ratio = Math.min(c.length, t.length) / Math.max(c.length, t.length);
    score += Math.round(40 * ratio);
  } else {
    const tw = new Set(t.split(/\s+/));
    const cw = c.split(/\s+/);
    const overlap = cw.filter((w: string) => tw.has(w)).length;
    score += Math.round((overlap / Math.max(tw.size, cw.length)) * 30);
  }

  // Add a prefix match bonus if the first few words match exactly.
  // This helps match shows that differ in season suffix (e.g. "Classroom of the Elite IV" and "Classroom of the Elite 4th Season")
  const tw_arr = t.split(/\s+/);
  const cw_arr = c.split(/\s+/);
  let prefixMatch = 0;
  for (let i = 0; i < Math.min(3, tw_arr.length, cw_arr.length); i++) {
    if (tw_arr[i] === cw_arr[i]) prefixMatch++;
    else break;
  }
  if (prefixMatch >= 2) {
    score += prefixMatch * 10;
  }

  if (targetYear && candidate.year) {
    if (Number(candidate.year) === targetYear) score += 8;
    else if (Math.abs(Number(candidate.year) - targetYear) <= 1) score += 2;
    else score -= 5;
  }

  // Season number mismatch check
  const candidateSeason = getSeasonNumber(candidate.title) || 1;
  const targetSeason = getSeasonNumber(targetTitle) || 1;
  if (candidateSeason !== targetSeason) {
    score -= 50; // Heavy penalty for mismatched seasons
  }

  // Episode mismatch check
  if (targetEpisodes && candidate.episodes) {
    const diff = Math.abs(candidate.episodes - targetEpisodes);
    if (diff > 0) {
      const isTargetAiring = targetStatus === "RELEASING" || targetStatus === "RELEASING".toLowerCase();
      const isCandidateAiring = candidate.status && (
        candidate.status.toLowerCase().includes("airing") ||
        candidate.status.toLowerCase().includes("releasing") ||
        candidate.status.toLowerCase().includes("current")
      );
      const isAiring = isTargetAiring || isCandidateAiring;

      if (isAiring && candidate.episodes < targetEpisodes) {
        // No penalty if the show is currently airing and has fewer episodes on the provider
      } else {
        if (diff <= 1) {
          score -= 2;
        } else if (diff <= 3) {
          score -= 5;
        } else {
          score -= 40; // Heavy penalty for mismatch
        }
      }
    }
  }

  return score;
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
  const providerId = params.get("providerId") ?? "animepahe";
  const animeTitle = params.get("title") ?? "Anime";
  const animeCoverUrl = params.get("coverUrl") ?? params.get("img") ?? undefined;
  const startEp = Math.max(0, Number(params.get("episode") ?? params.get("ep") ?? 0));
  const urlOffset = Number(params.get("episodeOffset") ?? 0);
  const epOffsetRef = useRef<number>(urlOffset);

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

  // HLS qualities state (for Anikoto / native HLS players)
  const [hlsLevels, setHlsLevels] = useState<any[]>([]);
  const [currentHlsLevel, setCurrentHlsLevel] = useState(-1);

  // Soft subtitles state
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [availableSubtitles, setAvailableSubtitles] = useState<any[]>([]);

  // Available sources (providers) for this anime
  const [availableSources, setAvailableSources] = useState<any[]>([]);

  // Playback state
  const [currentEp, setCurrentEp] = useState<any | null>(null);
  const [loadingStream, setLoadingStream] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Skip times
  const [skipTimes, setSkipTimes] = useState<{
    op?: { start: number; end: number };
    ed?: { start: number; end: number };
  }>({});

  // Controls overlay visibility
  const [showControls, setShowControls] = useState(true);
  const [mouseNearTop, setMouseNearTop] = useState(false);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Settings — persisted in localStorage
  const [autoPlay, setAutoPlay] = useState(() => localStorage.getItem("ap-autoplay") !== "false");
  const [autoNext, setAutoNext] = useState(() => localStorage.getItem("ap-autonext") !== "false");

  // Soft Subtitle Caption Customization Settings — persisted in localStorage
  const [cueFontSize, setCueFontSize] = useState(() => localStorage.getItem("ap-cue-size") ?? "16px");
  const [cueFontFamily, setCueFontFamily] = useState(() => localStorage.getItem("ap-cue-font") ?? "'Outfit', 'Inter', sans-serif");
  const [cueBgOpacity, setCueBgOpacity] = useState(() => parseFloat(localStorage.getItem("ap-cue-opacity") ?? "0.85"));
  const [cueColor, setCueColor] = useState(() => localStorage.getItem("ap-cue-color") ?? "#f5f5f7");
  const [volume, setVolume] = useState(() => {
    const v = parseFloat(localStorage.getItem("ap-volume") ?? "1");
    return isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  });

  // Apply persisted volume on first video load
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const paheCacheRef = useRef<Map<number, any>>(new Map());
  const lastPositionUpdate = useRef<number>(0);

  // Pending seek position — set before attachStream, applied in onCanPlay.
  // This avoids passing startPosition to hls.js (which stalls AnimePahe CDN).
  const pendingSeekRef = useRef<number | null>(null);
  const pendingAutoPlayEpNumRef = useRef<number | null>(null);

  // Stable effective anime ID — computed once on mount so playEpisode and the
  // progress timer both agree on which ID to use.
  const effectiveAnimeIdRef = useRef<number>(0);
  const malIdCacheRef = useRef<number | null>(null);

  function resetPlayer() {
    const video = videoRef.current;
    if (video) {
      video.pause();
      try { video.src = ""; } catch (e) {}
      try { video.load(); } catch (e) {}
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }

  async function fetchSkipTimes(epNum: number) {
    setSkipTimes({});
    const anilistId = effectiveAnimeIdRef.current;
    if (anilistId <= 0) return; // Cannot fetch without real AniList ID

    try {
      // 1. Get MAL ID from AniList
      let malId = malIdCacheRef.current;
      if (!malId) {
        const query = `query($id:Int){Media(id:$id){idMal}}`;
        const res = await fetch("https://graphql.anilist.co", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, variables: { id: anilistId } }),
        });
        const json = await res.json();
        malId = json?.data?.Media?.idMal;
        if (malId) malIdCacheRef.current = malId;
      }
      if (!malId) return;

      // 2. Fetch skip times from AniSkip
      const skipUrl = `https://api.aniskip.com/v2/skip-times/${malId}/${epNum}?types[]=op&types[]=ed&episodeLength=0`;
      const skipResObj = await fetch(skipUrl);
      if (!skipResObj.ok) return;
      const skipJson = await skipResObj.json();
      
      const newSkips: any = {};
      if (skipJson.found && skipJson.results) {
        for (const res of skipJson.results) {
          if (res.skipType === "op") {
            newSkips.op = { start: res.interval.startTime, end: res.interval.endTime };
          } else if (res.skipType === "ed") {
            newSkips.ed = { start: res.interval.startTime, end: res.interval.endTime };
          }
        }
      }
      setSkipTimes(newSkips);
    } catch (e) {
      console.warn("Failed to fetch skip times", e);
    }
  }

  useEffect(() => {
    const anilistId = Number(params.get("animeId") ?? params.get("anilistId") ?? 0);
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

    // Fetch available providers for this anime
    if (animeTitle && animeTitle !== "Anime") {
      (async () => {
        let targetYear = params.get("year") ? Number(params.get("year")) : undefined;
        let targetEpisodes = params.get("episodes") ? Number(params.get("episodes")) : undefined;
        let targetStatus = params.get("status") ? params.get("status")! : undefined;
        const anilistId = Number(params.get("animeId") ?? params.get("anilistId") ?? 0);
        if (anilistId > 0 && anilistId < 1_000_000_000) {
          try {
            const meta = await window.api.anilist.get(anilistId);
            if (meta) {
              if (meta.year) targetYear = meta.year;
              if (meta.episodes) targetEpisodes = meta.episodes;
              if (meta.status) targetStatus = meta.status;
            }
          } catch (e) {
            console.warn("[StreamPlayer] Failed to load AniList metadata:", e);
          }
        }

        const res = await window.api.pahe.search(animeTitle);
        const scored = res
          .map((r) => ({ r, score: scoreMatch(r, animeTitle, targetYear, targetEpisodes, targetStatus) }))
          .filter((x) => x.score >= 20)
          .sort((a, b) => b.score - a.score)
          .map((x) => x.r);

        if (scored.length > 0) {
          // Deduplicate available sources by provider ID, keeping the highest-scored match for each provider
          const uniqueProviders: any[] = [];
          const seenProviders = new Set<string>();
          for (const item of scored) {
            const pid = item.providerId || "animepahe";
            if (!seenProviders.has(pid)) {
              seenProviders.add(pid);
              uniqueProviders.push(item);
            }
          }
          setAvailableSources(uniqueProviders);
        } else {
          setLoadingEps(false);
        }
      })().catch(() => {
        setLoadingEps(false);
      });
    } else {
      setLoadingEps(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-correct provider and session from availableSources ───────────────
  useEffect(() => {
    if (availableSources.length === 0) return;

    const p = new URLSearchParams(params);
    let changed = false;

    const paheMatch = availableSources.find((s) => (s.providerId ?? "animepahe") === "animepahe");
    const anikotoMatch = availableSources.find((s) => (s.providerId ?? "animepahe") === "anikoto");

    if (!animeSession) {
      // 1. Session is completely missing: find the match for the active providerId (default: animepahe)
      let match = availableSources.find((s) => (s.providerId ?? "animepahe") === providerId);
      // Fallback: if active provider has no match, but the other one does, use that
      if (!match) {
        match = providerId === "animepahe" ? anikotoMatch : paheMatch;
        if (match) {
          p.set("providerId", match.providerId ?? "animepahe");
        }
      }
      if (match) {
        p.set("session", match.id || match.session);
        changed = true;
      }
    } else {
      // 2. Session is present: verify if it matches the current providerId
      const actualSource = availableSources.find((s) => (s.id || s.session) === animeSession);
      if (actualSource) {
        const actualProvider = actualSource.providerId ?? "animepahe";
        if (actualProvider !== providerId) {
          p.set("providerId", actualProvider);
          changed = true;
        }
      } else {
        // Fallback checks for incorrect mapping
        const isPaheSession = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(animeSession);
        if (providerId === "animepahe" && !isPaheSession && anikotoMatch) {
          p.set("providerId", "anikoto");
          p.set("session", anikotoMatch.id || anikotoMatch.session);
          changed = true;
        } else if (providerId === "animepahe" && !paheMatch && anikotoMatch) {
          p.set("providerId", "anikoto");
          p.set("session", anikotoMatch.id || anikotoMatch.session);
          changed = true;
        } else if (providerId === "anikoto" && isPaheSession && paheMatch) {
          p.set("providerId", "animepahe");
          p.set("session", paheMatch.id || paheMatch.session);
          changed = true;
        }
      }
    }

    if (changed) {
      console.log(`[StreamPlayer] Auto-correcting query params:`, p.toString());
      navigate(`/stream-player?${p.toString()}`, { replace: true });
    }
  }, [availableSources, animeSession, providerId, params, navigate]);

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

  // Fetch a single page with caching (paheCacheRef survives navigation).
  const fetchPahePage = useCallback(async (paheePage: number): Promise<{ data: any[]; total: number; lastPage: number }> => {
    const cached = paheCacheRef.current.get(paheePage);
    if (cached) return { data: cached, total: totalEpisodesRef.current, lastPage: paheCacheRef.current.get(-1) ?? 999 };
    try {
      const r = await window.api.pahe.episodes(providerId, animeSession, paheePage);
      paheCacheRef.current.set(paheePage, r.data);
      paheCacheRef.current.set(-1, r.lastPage ?? 999); // cache lastPage under key -1
      return { data: r.data, total: r.total, lastPage: r.lastPage ?? 999 };
    } catch {
      return { data: [], total: 0, lastPage: 1 };
    }
  }, [animeSession, providerId]);

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
      .then(async ({ data: firstData, total, lastPage: providerLastPage }) => {
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

        // Cap page fetching to what the provider actually has.
        const lastPaheePage = Math.min(
          providerLastPage,
          Math.ceil(Math.min(rangeEnd, total || rangeEnd) / PAHE_PAGE_SIZE),
          Math.ceil((total || (firstPaheePage * PAHE_PAGE_SIZE)) / PAHE_PAGE_SIZE),
        );

        // Calculate episodeOffset from page 1 data if not already explicitly provided in URL
        let epOffset = epOffsetRef.current;
        let page1Data = firstData;
        if (!epOffset && firstPaheePage > 1) {
          const p1 = await fetchPahePage(1);
          page1Data = p1.data;
        }
        if (!epOffset && page1Data.length > 0) {
          const firstEp = page1Data[0].episodeNumber ?? page1Data[0].episode ?? 1;
          epOffset = firstEp - 1;
          epOffsetRef.current = epOffset;
        }

        // Map firstData to relative episode numbers
        const firstMapped = firstData.map((e: any) => {
          const orig = e.episodeNumber ?? e.episode ?? 0;
          return {
            ...e,
            originalEpisodeNumber: orig,
            episodeNumber: orig - epOffset,
            episode: orig - epOffset,
          };
        });

        // 1. Instantly play the starting episode if it exists on the first loaded page
        if (startEp && rangeStart === Math.floor((startEp - 1) / RANGE_SIZE) * RANGE_SIZE + 1) {
          let ep = firstMapped.find((e: any) => e.episodeNumber === startEp);
          if (!ep) {
            ep = firstMapped.find((e: any) => e.originalEpisodeNumber === startEp);
          }
          if (!ep && startEp >= 1 && startEp <= firstMapped.length) {
            ep = firstMapped[startEp - 1];
          }
          if (ep && !currentEpRef.current) {
            playEpisode(ep, animeSession);
          }
        }

        // Display the first page episodes immediately to make UI interactive
        const firstFiltered = firstMapped
          .filter((e: any) => e.episodeNumber >= rangeStart && e.episodeNumber <= rangeEnd)
          .sort((a: any, b: any) => a.episodeNumber - b.episodeNumber);
        setEpisodes(firstFiltered);

        // 2. Fetch the remaining pages of the range in the background
        const remaining: Promise<{ data: any[] }>[] = [];
        for (let p = firstPaheePage + 1; p <= lastPaheePage; p++) {
          remaining.push(fetchPahePage(p));
        }

        if (remaining.length > 0) {
          Promise.all(remaining).then((rest) => {
            if (cancelled) return;
            const all = [firstData, ...rest.map((r) => r.data)].flat();
            
            const mapped = all.map((e: any) => {
              const orig = e.episodeNumber ?? e.episode ?? 0;
              return {
                ...e,
                originalEpisodeNumber: orig,
                episodeNumber: orig - epOffset,
                episode: orig - epOffset,
              };
            });

            const filtered = mapped
              .filter((e: any) => e.episodeNumber >= rangeStart && e.episodeNumber <= rangeEnd)
              .sort((a: any, b: any) => a.episodeNumber - b.episodeNumber);

            setEpisodes(filtered);

            // 3. Fallback: If starting episode wasn't in firstData, try to play it from the fully loaded list
            if (startEp && !currentEpRef.current && rangeStart === Math.floor((startEp - 1) / RANGE_SIZE) * RANGE_SIZE + 1) {
              let ep = filtered.find((e: any) => e.episodeNumber === startEp);
              if (!ep) ep = filtered.find((e: any) => e.originalEpisodeNumber === startEp);
              if (!ep && startEp >= 1 && startEp <= filtered.length) ep = filtered[startEp - 1];
              if (ep) playEpisode(ep, animeSession);
            }

            // Also check if there is a pending auto-play episode (e.g. from cross-range playNext/playPrev)
            if (pendingAutoPlayEpNumRef.current) {
              const ep = filtered.find((e: any) => e.episodeNumber === pendingAutoPlayEpNumRef.current);
              if (ep) {
                pendingAutoPlayEpNumRef.current = null;
                playEpisode(ep, animeSession);
              }
            }
          }).catch((err) => console.warn("[pahe] background episode load failed", err));
        } else {
          // No more pages to load — check if we have a pending auto-play from state
          if (pendingAutoPlayEpNumRef.current) {
            const ep = firstFiltered.find((e: any) => e.episodeNumber === pendingAutoPlayEpNumRef.current);
            if (ep) {
              pendingAutoPlayEpNumRef.current = null;
              playEpisode(ep, animeSession);
            }
          }
        }
      })
      .catch((e) => { if (!cancelled) console.warn("[pahe] episode load failed", e); })
      .finally(() => { if (!cancelled) setLoadingEps(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeSession, rangeStart, fetchPahePage]);

  // Reset cache when anime or provider changes
  useEffect(() => {
    resetPlayer();
    paheCacheRef.current.clear();
    epOffsetRef.current = urlOffset;
    // If startEp is set, open the range that contains it.
    if (startEp) {
      const targetRange = Math.floor((startEp - 1) / RANGE_SIZE) * RANGE_SIZE + 1;
      setRangeStart(targetRange);
    } else {
      setRangeStart(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeSession, providerId, urlOffset]);

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
            if (result.status < 200 || result.status >= 300) {
              console.error('[CapLoader] fetchUrl HTTP error status:', result.status, 'url=', url);
              callbacks.onError({ code: result.status, text: `HTTP ${result.status}` }, context, null, this.stats);
              return;
            }
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

  function attachStream(url: string, subtitles?: any[]) {
    const video = videoRef.current;
    if (!video) return;

    setStreamError(null);

    // Reset HLS qualities state for the new stream
    setHlsLevels([]);
    setCurrentHlsLevel(-1);

    // Clear old HLS player to prevent resource leaks and avoid double-binding media elements
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Clear old subtitle tracks from DOM
    const oldTracks = video.querySelectorAll("track");
    oldTracks.forEach(t => t.remove());

    // Listen for dynamically added tracks (e.g. from HLS.js or browser's native manifest parser)
    video.textTracks.onaddtrack = (e) => {
      const trackObj = e.track;
      if (!trackObj) return;
      const isCustom = Array.from(video.querySelectorAll("track")).some(t => t.label === trackObj.label);
      if (!isCustom) {
        trackObj.mode = "disabled";
        console.log("[Subtitles] Automatically disabled HLS/non-custom track:", trackObj.label);
      }
    };

    // Setup new video source first (so track injection happens after source binding and avoids resetting)
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

    // Filter to English subtitles to avoid irrelevant subtitles in other languages
    let filteredSubs = (subtitles || []).filter((sub: any) => {
      const label = (sub.label || "").toLowerCase();
      return label.includes("english") || label.includes("eng");
    });
    if (filteredSubs.length === 0 && subtitles && subtitles.length > 0) {
      filteredSubs = [subtitles[0]];
    }

    // Inject new subtitles after source setup
    if (filteredSubs.length > 0) {
      setAvailableSubtitles(filteredSubs);
      filteredSubs.forEach((sub: any) => {
        const track = document.createElement("track");
        track.kind = sub.kind || "captions";
        track.label = sub.label || "English";
        track.srclang = "en";

        if (isCapacitor) {
          window.api.pahe.fetchUrl!(sub.file, false)
            .then((result) => {
              const blob = new Blob([result.data], { type: "text/vtt" });
              track.src = URL.createObjectURL(blob);
              console.log("[Subtitles] Successfully loaded subtitle blob URL for Capacitor:", track.src);
              try { track.track.mode = subtitlesEnabled ? "showing" : "hidden"; } catch (e) {}
            })
            .catch((err) => {
              console.error("[Subtitles] Failed to fetch subtitle file:", err, "url=", sub.file);
              track.src = sub.file;
              try { track.track.mode = subtitlesEnabled ? "showing" : "hidden"; } catch (e) {}
            });
        } else {
          track.src = sub.file;
        }

        if (sub.default) track.default = true;
        video.appendChild(track);

        // Set mode immediately after appending (synchronous binding)
        try {
          track.track.mode = subtitlesEnabled ? "showing" : "hidden";
        } catch (e) {}
      });

      // Defer track mode settings to a safer timeout to override async browser state resets
      setTimeout(() => {
        const tracks = video.textTracks;
        console.log(`[Subtitles] Safely initialized track modes for ${tracks.length} tracks to: ${subtitlesEnabled ? "showing" : "hidden"}`);
        let firstCustomShown = false;
        for (let i = 0; i < tracks.length; i++) {
          const isCustom = Array.from(video.querySelectorAll("track")).some(t => t.label === tracks[i].label);
          if (isCustom) {
            if (subtitlesEnabled && !firstCustomShown) {
              tracks[i].mode = "showing";
              firstCustomShown = true;
            } else {
              tracks[i].mode = "hidden";
            }
          } else {
            tracks[i].mode = "disabled";
          }
        }
      }, 200);
    } else {
      setAvailableSubtitles([]);
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        tracks[i].mode = "disabled";
      }
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
      
      // Extract available HLS qualities
      if (hls.levels && hls.levels.length > 0) {
        const levels = hls.levels.map((lvl, index) => ({
          index,
          quality: lvl.height || parseInt(lvl.name) || 720,
          bitrate: lvl.bitrate,
        }));
        // Sort quality high-to-low
        levels.sort((a, b) => b.quality - a.quality);
        setHlsLevels(levels);
        setCurrentHlsLevel(hls.currentLevel);
      } else {
        setHlsLevels([]);
      }

      if (autoPlay) video.play().catch(() => {});
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
      console.log('[HLS] LEVEL_SWITCHED — active index:', data.level);
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
      if (loadingStreamRef.current && (currentEpRef.current?.session ?? currentEpRef.current?.id) === (ep.session ?? ep.id)) return;
      resetPlayer();
      loadingStreamRef.current = true;
      setCurrentEp(ep);
      setStreamError(null);
      setLoadingStream(true);
      setPosition(0);
      setDuration(0);
      setLinks([]);
      
      const preferredIdx = providerId === "anikoto" 
        ? (localStorage.getItem("anitrack-anikoto-subtype") === "hard" ? 1 : 0)
        : 0;
      setSelectedLink(preferredIdx);

      try {
        // Run links fetch and saved-progress lookup in parallel — they're
        // independent and saving even ~50ms of perceived latency matters here.
        const [fetchedLinks, savedProgress] = await Promise.all([
          window.api.pahe.links(providerId, ep.session ?? ep.id, animeSession),
          window.api.progress.get(effectiveAnimeIdRef.current, ep.episodeNumber).catch(() => null),
        ]);

        fetchSkipTimes(ep.episodeNumber).catch(() => {});

        if (!fetchedLinks.length) throw new Error("No stream links found for this episode");
        setLinks(fetchedLinks);
        
        // We apply the resume seek in onCanPlay (after the video is ready) rather than
        // passing startPosition to hls.js — hls.js startPosition stalls on
        // AnimePahe CDN because it tries to fetch mid-stream segments cold.
        pendingSeekRef.current = (savedProgress && savedProgress.positionSec > 5)
          ? savedProgress.positionSec
          : null;
        
        const bestIdx = preferredIdx < fetchedLinks.length ? preferredIdx : 0;
        const { url, subtitles, intro, outro } = await window.api.pahe.resolve(providerId, fetchedLinks[bestIdx].id ?? fetchedLinks[bestIdx].kwik);
        if (!url) {
          throw new Error("Resolved stream URL is empty. The stream server may be down, or we failed to fetch it.");
        }
        
        if (intro || outro) {
          setSkipTimes({ op: intro, ed: outro });
        }
        
        let activeSubs = subtitles;
        try {
          const linkParsed = JSON.parse(fetchedLinks[bestIdx].id);
          if (linkParsed.subType === "hard") {
            activeSubs = [];
          }
        } catch (e) {}

        attachStream(url, activeSubs);

        // 1. Pre-fetch other qualities for the current episode in the background
        for (let idx = 0; idx < fetchedLinks.length; idx++) {
          if (idx !== bestIdx) {
            const targetLink = fetchedLinks[idx];
            const linkIdToResolve = targetLink.id ?? targetLink.kwik;
            window.api.pahe.prefetch(providerId, linkIdToResolve);
          }
        }

        // 2. Pre-fetch next episode and its qualities in the background
        const nextEp = episodesRef.current.find((e) => e.episodeNumber === ep.episodeNumber + 1);
        if (nextEp) {
          window.api.pahe.links(providerId, nextEp.session ?? nextEp.id, animeSession)
            .then((nextLinks: any[]) => {
              for (const targetLink of nextLinks) {
                const linkIdToResolve = targetLink.id ?? targetLink.kwik;
                window.api.pahe.prefetch(providerId, linkIdToResolve);
              }
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
    [animeSession, autoPlay, providerId],
  );

  async function changeQuality(idx: number) {
    const link = linksRef.current[idx];
    if (!link) return;
    setSelectedLink(idx);
    if (providerId === "anikoto") {
      localStorage.setItem("anitrack-anikoto-subtype", idx === 1 ? "hard" : "soft");
    }
    setQualityOpen(false);
    setLoadingStream(true);
    setStreamError(null);
    resetPlayer();
    try {
      const { url, subtitles } = await window.api.pahe.resolve(providerId, link.id ?? link.kwik);
      if (!url) {
        throw new Error("Resolved stream URL is empty. The stream server may be down, or we failed to fetch it.");
      }
      // Store the current position in pendingSeekRef so onCanPlay applies it
      // after the new stream is ready — same pattern as episode resume.
      const pos = videoRef.current?.currentTime ?? 0;
      pendingSeekRef.current = pos > 1 ? pos : null;

      let activeSubs = subtitles;
      try {
        const linkParsed = JSON.parse(link.id);
        if (linkParsed.subType === "hard") {
          activeSubs = [];
        }
      } catch (e) {}

      attachStream(url, activeSubs);
    } catch (e: any) {
      setStreamError(e.message ?? String(e));
      setLoadingStream(false);
    }
  }

  function changeHlsLevel(idx: number) {
    console.log('[changeHlsLevel] idx:', idx, 'hlsRef.current:', !!hlsRef.current);
    if (hlsRef.current) {
      hlsRef.current.nextLevel = idx;
      hlsRef.current.loadLevel = idx;
      setCurrentHlsLevel(idx);
    }
    setQualityOpen(false);
  }

  function toggleSubtitles() {
    const next = !subtitlesEnabled;
    setSubtitlesEnabled(next);
    const video = videoRef.current;
    if (video) {
      const tracks = video.textTracks;
      let firstCustomShown = false;
      for (let i = 0; i < tracks.length; i++) {
        const isCustom = Array.from(video.querySelectorAll("track")).some(t => t.label === tracks[i].label);
        if (isCustom) {
          if (next && !firstCustomShown) {
            tracks[i].mode = "showing";
            firstCustomShown = true;
          } else {
            tracks[i].mode = "hidden";
          }
        } else {
          tracks[i].mode = "disabled";
        }
      }
    }
  }

  function playNext() {
    const ep = currentEpRef.current;
    const eps = episodesRef.current;
    if (!ep) return;
    const next = eps.find((e) => e.episodeNumber === ep.episodeNumber + 1);
    if (next) { playEpisode(next); return; }
    // Next episode is in the following range — jump to it.
    const nextEpNum = ep.episodeNumber + 1;
    if (nextEpNum <= totalEpisodesRef.current) {
      pendingAutoPlayEpNumRef.current = nextEpNum;
      const targetRange = Math.floor((nextEpNum - 1) / RANGE_SIZE) * RANGE_SIZE + 1;
      setRangeStart(targetRange);
    }
  }

  function playPrev() {
    const ep = currentEpRef.current;
    const eps = episodesRef.current;
    if (!ep) return;
    const prev = eps.find((e) => e.episodeNumber === ep.episodeNumber - 1);
    if (prev) { playEpisode(prev); return; }
    const prevEpNum = ep.episodeNumber - 1;
    if (prevEpNum >= 1) {
      pendingAutoPlayEpNumRef.current = prevEpNum;
      const targetRange = Math.floor((prevEpNum - 1) / RANGE_SIZE) * RANGE_SIZE + 1;
      setRangeStart(targetRange);
    }
  }

  function handleFindSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(findNum);
    if (!n) return;
    // First try the current range; if not found, jump to the range containing it.
    const ep = episodes.find((ep) => ep.episodeNumber === n);
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
            if ((prev.get(ep.episodeNumber) ?? 0) >= 85) return prev;
            const next = new Map(prev);
            next.set(ep.episodeNumber, (video.currentTime / video.duration) * 100);
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
      // Ignore errors caused by intentionally resetting the source to empty string
      const cleanSrc = video.src ? video.src.split("?")[0].split("#")[0] : "";
      const cleanLoc = window.location.href.split("?")[0].split("#")[0];
      if (!video.src || cleanSrc === cleanLoc || video.src.includes("about:blank")) {
        return;
      }
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
      resetPlayer();
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
        episode: currentEpRef.current?.episodeNumber ?? currentEpRef.current?.episode ?? currentEp.episodeNumber ?? currentEp.episode,
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
    const handleBeforeUnload = () => {
      saveNow();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      saveNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEp]);

  // ── Derived ────────────────────────────────────────────────────────────────

  // Compute available ranges from totalEpisodes — chunks of RANGE_SIZE.
  const ranges = (() => {
    const total = totalEpisodes || (episodes.length > 0 ? (episodes[episodes.length - 1].episodeNumber ?? episodes[episodes.length - 1].episode) : 0);
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
      {availableSources.length > 0 && (
        <div className="border-b border-white/10 p-2">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-white/50 font-semibold">Servers</div>
          <div className="flex flex-wrap gap-2">
            {availableSources.map(s => {
              const pid = s.providerId || "animepahe";
              const isActive = pid === providerId;
              const name = pid === "anikoto" ? "Anikoto" : "AnimePahe";
              return (
                <button
                  key={pid}
                  onClick={() => {
                    if (isActive) return;
                    // Reset current stream state so it forces a full reload
                    setCurrentEp(null);
                    setEpisodes([]);
                    setLoadingEps(true);
                    setStreamError(null);
                    setLoadingStream(false);
                    paheCacheRef.current.clear();
                    
                    const p = new URLSearchParams(params);
                    p.set("providerId", pid);
                    p.set("session", s.id || s.session);
                    // Preserve the current episode number we were watching
                    const epNum = currentEpRef.current?.episodeNumber ?? currentEpRef.current?.episode ?? startEp;
                    if (epNum) p.set("episode", String(epNum));
                    
                    navigate(`/stream-player?${p.toString()}`, { replace: true });
                  }}
                  className={`flex h-8 items-center gap-2 rounded px-3 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-[#4a9eff] text-white"
                      : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {providerId === "anikoto" && links.length > 1 && (
        <div className="border-b border-white/10 p-2">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-white/50 font-semibold">Sub Type</div>
          <div className="flex gap-2">
            <button
              onClick={() => changeQuality(0)}
              className={`flex h-8 flex-1 items-center justify-center rounded text-xs font-semibold transition-all duration-200 ${
                selectedLink === 0
                  ? "bg-[#4a9eff] text-white shadow-[0_0_12px_rgba(74,158,255,0.4)]"
                  : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              Soft Sub
            </button>
            <button
              onClick={() => changeQuality(1)}
              className={`flex h-8 flex-1 items-center justify-center rounded text-xs font-semibold transition-all duration-200 ${
                selectedLink === 1
                  ? "bg-[#4a9eff] text-white shadow-[0_0_12px_rgba(74,158,255,0.4)]"
                  : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              Hard Sub
            </button>
          </div>
        </div>
      )}
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
              const isCurrent = (currentEp?.id ?? currentEp?.session) === (ep.id ?? ep.session);
              const pct = watchedEps.get(ep.episodeNumber ?? ep.episode) ?? 0;
              const watched = !isCurrent && pct >= 85;
              return (
                <button
                  key={ep.id ?? ep.session}
                  onClick={() => playEpisode(ep)}
                  className={`flex h-9 items-center justify-center rounded text-xs font-medium transition
                    ${isCurrent
                      ? "bg-[#4a9eff] text-white"
                      : watched
                        ? "bg-green-500/20 text-green-400 ring-1 ring-green-500/30 hover:bg-green-500/30"
                        : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"}`}
                >
                  {ep.episodeNumber ?? ep.episode}
                </button>
              );
            })}
          </div>
        )}
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
      <style>{`
        video::cue {
          background-color: rgba(11, 11, 15, ${cueBgOpacity}) !important;
          color: ${cueColor} !important;
          font-family: ${cueFontFamily} !important;
          font-size: ${cueFontSize} !important;
        }
      `}</style>
      <video ref={videoRef} className="h-full w-full object-contain" playsInline crossOrigin="anonymous" />
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
      {/* Skip Intro / Outro Overlays */}
      <SkipOverlay 
        duration={duration} 
        position={position} 
        skipTimes={skipTimes} 
        showControls={showControls} 
        onSkip={(endTime) => { if (videoRef.current) videoRef.current.currentTime = endTime; }} 
      />
      <VideoControls
        showControls={showControls}
        progressPct={progressPct}
        position={position}
        duration={duration}
        playing={playing}
        muted={muted}
        volume={volume}
        autoPlay={autoPlay}
        autoNext={autoNext}
        currentEp={currentEp}
        links={links}
        selectedLink={selectedLink}
        isMobile={isMobile}
        qualityOpen={qualityOpen}
        isFullscreen={isFullscreen}
        onSeekToPct={(pct) => { const v = videoRef.current; if (v && duration) v.currentTime = pct * duration; }}
        onSeekBy={seek}
        onSeekStart={() => { seekingRef.current = true; }}
        onSeekEnd={(time) => { seekingRef.current = false; if (videoRef.current) videoRef.current.currentTime = time; }}
        onPositionChange={setPosition}
        onTogglePlay={() => { const v = videoRef.current; if (!v) return; v.paused ? v.play().catch(() => {}) : v.pause(); }}
        onToggleMute={() => { const next = !muted; setMuted(next); if (videoRef.current) videoRef.current.muted = next; }}
        onVolumeChange={(v) => { setVolume(v); setMuted(v === 0); localStorage.setItem("ap-volume", String(v)); if (videoRef.current) { videoRef.current.volume = v; videoRef.current.muted = v === 0; } }}
        onToggleAutoPlay={() => setAutoPlay((v) => { const n = !v; localStorage.setItem("ap-autoplay", String(n)); return n; })}
        onToggleAutoNext={() => setAutoNext((v) => { const n = !v; localStorage.setItem("ap-autonext", String(n)); return n; })}
        onPlayPrev={playPrev}
        onPlayNext={playNext}
        onToggleFullscreen={toggleFullscreen}
        onToggleQualityMenu={() => setQualityOpen((o) => !o)}
        onChangeQuality={changeQuality}
        onCloseQualityMenu={() => setQualityOpen(false)}
        
        // HLS qualities and subtitles toggle
        hlsLevels={hlsLevels}
        currentHlsLevel={currentHlsLevel}
        onChangeHlsLevel={changeHlsLevel}
        subtitlesEnabled={subtitlesEnabled}
        availableSubtitles={availableSubtitles}
        onToggleSubtitles={toggleSubtitles}
        providerId={providerId}
        cueFontSize={cueFontSize}
        setCueFontSize={setCueFontSize}
        cueFontFamily={cueFontFamily}
        setCueFontFamily={setCueFontFamily}
        cueBgOpacity={cueBgOpacity}
        setCueBgOpacity={setCueBgOpacity}
        cueColor={cueColor}
        setCueColor={setCueColor}
      />

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
            {currentEp && <div className="text-xs text-white/50">Episode {currentEp.episodeNumber ?? currentEp.episode}</div>}
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
        {currentEp && <span className="text-sm text-white/50">— Episode {currentEp.episodeNumber ?? currentEp.episode}</span>}
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
