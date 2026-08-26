import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
  X,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import { SkipOverlay } from "../components/player/SkipOverlay";
import { VideoControls } from "../components/player/VideoControls";
import { useVideoGestures, GestureFeedback } from "../components/player/useVideoGestures";
import Hls from "hls.js";
import { secondsToTimestamp } from "../lib/format";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { isCapacitor } from "../lib/platform";
import { enterNativePip } from "../lib/pip";
import { pushProgress, pullRemoteProgress, flushOnQuit } from "../lib/supabase-sync";
import { getPlayUrl as getDownloadPlayUrl, readLocalFile, isLocalDownloadUrl, getDownloads, subscribeDownloads } from "../lib/downloads";
import { scoreMatch, pickVerifiedCandidate } from "../lib/match";
import {
  preferredStreamLinkIndex,
  providerClient,
  providerName,
  providerVariantPreference,
  saveProviderVariantPreference,
  streamVariant,
} from "../lib/provider-api";
import type { ProviderDescriptor, StreamLink } from "../../../../packages/shared/provider-types";

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

// Thin rAF-driven progress hairline for the mini-player (no React re-renders).
function MiniProgressBar({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const barRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      const b = barRef.current;
      if (v && b && v.duration && isFinite(v.duration)) {
        b.style.width = `${(v.currentTime / v.duration) * 100}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
      <div ref={barRef} className="h-full bg-[#e50914]" style={{ width: "0%" }} />
    </div>
  );
}

export default function StreamPlayer({
  search,
  minimized,
  onClose,
}: {
  search: string;
  minimized: boolean;
  onClose: () => void;
}) {
  // The player is mounted globally (outside <Routes>) so it survives navigation
  // as a mini-player. Query params come in via the `search` prop, not the URL.
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const navigate = useNavigate();
  const minimizedRef = useRef(minimized);
  minimizedRef.current = minimized;

  // URL sync that respects the mini-player: expanded → replace the route URL;
  // minimized → update the global session only (don't hijack navigation).
  const syncPlayerUrl = useCallback(
    (p: URLSearchParams) => {
      if (minimizedRef.current) usePlayerStore.getState().open(`?${p.toString()}`);
      else navigate(`/stream-player?${p.toString()}`, { replace: true });
    },
    [navigate],
  );
  const animeSession = params.get("session") ?? "";
  // The session the player was OPENED with (from CW card / detail page). Used to
  // limit stale-session self-healing to stored sessions only.
  const initialSessionRef = useRef(animeSession);
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
  const [providerDescriptors, setProviderDescriptors] = useState<ProviderDescriptor[]>([]);
  // Brief status shown while we auto-switch to a backup provider after a failure.
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    providerClient.list().then((descriptors) => {
      if (!cancelled) setProviderDescriptors(descriptors);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Playback state
  const [currentEp, setCurrentEp] = useState<any | null>(null);
  const [loadingStream, setLoadingStream] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTheater, setIsTheater] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(() => {
    const r = parseFloat(localStorage.getItem("ap-speed") ?? "1");
    return isFinite(r) && r > 0 ? r : 1;
  });
  const playbackRateRef = useRef(playbackRate);

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
  const [cueFontSize, setCueFontSize] = useState(() => localStorage.getItem("ap-cue-size") ?? "20px");
  const [cueFontFamily, setCueFontFamily] = useState(() => localStorage.getItem("ap-cue-font") ?? "'Outfit', 'Inter', sans-serif");
  const [cueBgOpacity, setCueBgOpacity] = useState(() => parseFloat(localStorage.getItem("ap-cue-opacity") ?? "0.25"));
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
  // Player origin (e.g. https://vidtube.site) captured at resolve time. On Android
  // the CapacitorLoader sends it as Referer so the segment CDN's hotlink check passes.
  const refererRef = useRef<string | null>(null);
  const currentStreamUrlRef = useRef<string | null>(null);
  // Per-episode link cache so prefetched episodes switch without re-scraping.
  const linksCacheRef = useRef<Map<string, any[]>>(new Map());
  // Live ref to playEpisode so the PiP-return hook can reload the current episode
  // (the WebView MediaSource is destroyed during PiP and can't be revived in place).
  const playEpisodeRef = useRef<((ep: any, session?: string, resumePos?: number) => void) | null>(null);
  const seekingRef = useRef(false);
  const singleClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNextRef = useRef(autoNext);
  const currentEpRef = useRef<any>(null);
  const episodesRef = useRef<any[]>([]);
  const linksRef = useRef<any[]>([]);
  const rangeStartRef = useRef(rangeStart);
  const totalEpisodesRef = useRef(totalEpisodes);
  // Cache of fetched episode pages by AnimePahe page number — survives range changes.
  // Episode-page cache. Keyed by `${session}:${page}` — NEVER by page alone:
  // the player instance persists across shows (mini-player) and sessions can
  // switch mid-load (stale-session self-heal), so an in-flight fetch for the
  // old session must not be able to poison the new session's pages (this is
  // how City Hunter once showed City Hunter '91 for its first 13 episodes).
  const paheCacheRef = useRef<Map<string, any>>(new Map());
  const lastPositionUpdate = useRef<number>(0);

  // Live mirror of availableSources + the auto-fallback fn so stale closures
  // (buildHls's error handler, playEpisode's catch) always read the latest.
  const availableSourcesRef = useRef<any[]>([]);
  const fallbackRef = useRef<(epNum: number | undefined) => boolean>(() => false);
  // Which providers we've already auto-tried per episode, so a failing stream
  // walks each provider exactly once instead of ping-ponging forever.
  const fallbackTriedRef = useRef<Map<number, Set<string>>>(new Map());

  // Pending seek position — set before attachStream, applied in onCanPlay.
  // This avoids passing startPosition to hls.js (which stalls AnimePahe CDN).
  const pendingSeekRef = useRef<number | null>(null);
  const pendingAutoPlayEpNumRef = useRef<number | null>(null);

  // Stable effective anime ID — computed once on mount so playEpisode and the
  // progress timer both agree on which ID to use.
  const effectiveAnimeIdRef = useRef<number>(0);
  const malIdCacheRef = useRef<number | null>(null);

  function resetPlayer() {
    seekingRef.current = false; // clear any stuck seek flag (e.g. across a PiP transition)
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

  // Stable identity for the CURRENT show. The player instance persists across
  // navigations (mini-player), so everything per-show below must re-run when
  // this changes — running it on mount only meant a newly-opened show inherited
  // the PREVIOUS show's sources/anime-id (Cat's Eye playing City Hunter 2).
  const animeIdentity = (() => {
    const aid = Number(params.get("animeId") ?? params.get("anilistId") ?? 0);
    return aid > 0 ? `id:${aid}` : `title:${animeTitle}`;
  })();

  useEffect(() => {
    // Guards every async setState below: a slow provider search must never
    // land its results after the user has already switched to another show.
    let cancelled = false;
    const anilistId = Number(params.get("animeId") ?? params.get("anilistId") ?? 0);
    effectiveAnimeIdRef.current = anilistId > 0 ? anilistId : paheSessionId(animeSession);
    // A different show arrived on this mounted player: the previous show's
    // provider matches are meaningless (and actively dangerous — the session
    // self-heal would rewrite the new show's session to the old show's match).
    setAvailableSources([]);
    setWatchedEps(new Map());
    epOffsetRef.current = Number(params.get("episodeOffset") ?? 0);
    pendingSeekRef.current = null;
    fallbackTriedRef.current.clear();

    // Load initial watched-episode map from DB.
    if (effectiveAnimeIdRef.current !== 0) {
      window.api.progress.getForAnime(effectiveAnimeIdRef.current)
        .then((rows) => {
          if (cancelled) return;
          const m = new Map<number, number>();
          for (const r of rows) {
            if (r.durationSec > 0) m.set(r.episode, (r.positionSec / r.durationSec) * 100);
          }
          setWatchedEps(m);
        })
        .catch(() => {});
    }

    // Fetch available providers for this anime (skipped for offline downloads —
    // we play the local file, no provider lookup needed).
    if (animeTitle && animeTitle !== "Anime" && !params.get("download")) {
      (async () => {
        let targetYear = params.get("year") ? Number(params.get("year")) : undefined;
        let targetEpisodes = params.get("episodes") ? Number(params.get("episodes")) : undefined;
        let targetStatus = params.get("status") ? params.get("status")! : undefined;
        const searchQueries = [animeTitle];
        const anilistId = Number(params.get("animeId") ?? params.get("anilistId") ?? 0);
        let meta: any = null;
        try {
          if (anilistId > 0 && anilistId < 1_000_000_000) {
            meta = await window.api.anilist.get(anilistId);
          } else {
            // Latest Episodes (and other AnimePahe-only entries) pass no AniList id.
            // Resolve it from the title so we get romaji/English variants — without them
            // the Anikoto search uses only AnimePahe's title and usually fails to match,
            // so no Anikoto source is offered.
            const results = await window.api.anilist.search(animeTitle);
            if (results && results.length > 0) meta = results[0];
          }
        } catch (e) {
          console.warn("[StreamPlayer] Failed to load AniList metadata:", e);
        }
        let targetMalId: number | undefined;
        if (meta) {
          if (meta.year) targetYear = meta.year;
          if (meta.episodes) targetEpisodes = meta.episodes;
          if (meta.status) targetStatus = meta.status;
          if (meta.malId) targetMalId = meta.malId;
          if (meta.titleRomaji && meta.titleRomaji.toLowerCase() !== animeTitle.toLowerCase()) {
            searchQueries.push(meta.titleRomaji);
          }
          if (meta.title && meta.title.toLowerCase() !== animeTitle.toLowerCase() && (!meta.titleRomaji || meta.title.toLowerCase() !== meta.titleRomaji.toLowerCase())) {
            searchQueries.push(meta.title);
          }
        }

        // Run searches in parallel
        const searchResultsList = await Promise.all(searchQueries.map(q => providerClient.search(q).catch(() => [])));
        const combinedMap = new Map<string, { item: any; matchedQuery: string }>();
        for (let idx = 0; idx < searchQueries.length; idx++) {
          const list = searchResultsList[idx];
          const query = searchQueries[idx];
          for (const item of list) {
            const uniqKey = `${item.providerId ?? "animepahe"}:${item.id}`;
            if (!combinedMap.has(uniqKey)) {
              combinedMap.set(uniqKey, { item, matchedQuery: query });
            }
          }
        }

        const filtered = Array.from(combinedMap.values()).filter(({ item }) => {
          if (targetYear && item.year) {
            return Math.abs(Number(item.year) - targetYear) <= 3;
          }
          return true;
        });

        const scored = filtered
          .map(({ item, matchedQuery }) => {
            let score = scoreMatch(item, matchedQuery, targetYear, targetEpisodes, targetStatus);
            for (const otherQuery of searchQueries) {
              if (otherQuery !== matchedQuery) {
                const otherScore = scoreMatch(item, otherQuery, targetYear, targetEpisodes, targetStatus);
                if (otherScore > score) score = otherScore;
              }
            }
            return { item, score };
          })
          .filter((x) => x.score >= 20)
          .sort((a, b) => b.score - a.score)
          .map((x) => x.item);

        if (scored.length > 0) {
          // Group the top few candidates per provider (score order preserved).
          const byProvider = new Map<string, any[]>();
          for (const item of scored) {
            const pid = item.providerId || "animepahe";
            const arr = byProvider.get(pid) ?? [];
            if (arr.length < 3) arr.push(item);
            byProvider.set(pid, arr);
          }

          // OPTIMISTIC: publish the top-scored pick per provider right away so
          // the episode list starts loading immediately. Verification below
          // swaps a pick only in the rare case the title score was wrong.
          const optimistic = Array.from(byProvider.values()).map((c) => c[0]);
          if (cancelled) return;
          setAvailableSources(optimistic);

          // Title-plausible candidates the YEAR gate rejected. A mislabeled
          // entry parses the wrong year out of its lying title (anikoto's real
          // City Hunter is titled "City Hunter '91"), so id verification must
          // get a look at these too.
          const normT = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
          const plausibleRejects = Array.from(combinedMap.values())
            .filter(({ item }) => targetYear && item.year && Math.abs(Number(item.year) - targetYear) > 3)
            .filter(({ item }) => {
              const c = normT(item.title);
              return searchQueries.some((q) => { const t = normT(q); return !!t && !!c && (c.includes(t) || t.includes(c)); });
            })
            .map(({ item }) => item);

          // Verify each provider's pick against real ids when we have them —
          // titles lie (anikoto's "City Hunter" entry actually contains City
          // Hunter '91's episodes), but the provider-embedded MAL id doesn't.
          // pickVerifiedCandidate runs checks serially/time-boxed: the common
          // case costs ONE provider request; parallel bursts tripped anti-bot
          // limits and froze the whole app.
          const realAnilistId = anilistId > 0 && anilistId < 1_000_000_000 ? anilistId : undefined;
          if (realAnilistId || targetMalId) {
            const verified: any[] = [];
            let changed = false;
            for (const [pid, candidates] of byProvider.entries()) {
              const rejects = plausibleRejects.filter((i) => (i.providerId || "animepahe") === pid).slice(0, 2);
              const pick = (await pickVerifiedCandidate([...candidates, ...rejects], realAnilistId, targetMalId)) ?? candidates[0];
              if (pick !== candidates[0]) changed = true;
              verified.push(pick);
              if (cancelled) return;
            }
            if (changed && !cancelled) setAvailableSources(verified);
          }
        } else {
          setLoadingEps(false);
        }
      })().catch(() => {
        if (!cancelled) setLoadingEps(false);
      });
    } else {
      setLoadingEps(false);
    }
    return () => { cancelled = true; };
  // Re-run per SHOW (not per mount — the mini-player instance persists across
  // navigations, and stale sources from the previous show corrupt the new one).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeIdentity]);

  // ── Offline download playback ───────────────────────────────────────────────
  // When opened with ?download=<id>, skip the whole provider/resolve flow and play
  // the locally-saved HLS straight through the existing player (hls.js + the
  // capacitor loader, which reads anitrack-dl:// URLs from disk).
  const isOffline = !!params.get("download");

  async function playLocal(dlId: string, epNum: number) {
    resetPlayer();
    setStreamError(null);
    setLoadingStream(true);
    setCurrentEp({ episodeNumber: epNum, episode: epNum, id: dlId, session: dlId });
    const url = await getDownloadPlayUrl(dlId);
    if (!url) { setStreamError("Download not found on this device."); setLoadingStream(false); return; }
    const saved = await window.api.progress.get(effectiveAnimeIdRef.current, epNum).catch(() => null);
    pendingSeekRef.current = saved && saved.positionSec > 5 ? saved.positionSec : null;
    refererRef.current = null;
    // Offer the locally-saved subtitle (if any) — attachStream drops it when the
    // download has none (hard-subbed AnimePahe).
    const subUrl = url.replace(/index\.m3u8$/, "subs.vtt");
    attachStream(url, [{ file: subUrl, label: "English", kind: "captions" }]);
  }

  // Next/prev downloaded episode of the same title (offline navigation).
  function offlineNeighbor(delta: 1 | -1): { id: string; episode: number } | null {
    const cur = currentEpRef.current?.episodeNumber;
    if (cur == null) return null;
    const eps = Array.from(getDownloads().values())
      .filter((d) => d.animeId === effectiveAnimeIdRef.current && d.status === "done")
      .sort((a, b) => a.episode - b.episode);
    if (delta > 0) return eps.find((d) => d.episode > cur) ?? null;
    let prev: { id: string; episode: number } | null = null;
    for (const d of eps) { if (d.episode < cur) prev = d; else break; }
    return prev;
  }

  useEffect(() => {
    const dlId = params.get("download");
    if (!dlId) return;
    // Populate the downloads list so next/prev among downloads works.
    const unsub = subscribeDownloads(() => {});
    setLoadingEps(false);
    playLocal(dlId, startEp || 1);
    return () => unsub();
  // Keyed on the download id — the persistent player instance can be handed a
  // different offline episode without remounting.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("download")]);

  // ── Auto-correct provider and session from availableSources ───────────────
  useEffect(() => {
    if (availableSources.length === 0) return;

    const p = new URLSearchParams(params);
    let changed = false;

    const sourceProviderId = (source: any) => source.providerId ?? "animepahe";
    const sourceSession = (source: any) => source.id || source.session;
    const currentProviderMatch = availableSources.find((source) => sourceProviderId(source) === providerId);

    if (!animeSession) {
      // Prefer the requested connector, then fall back to the registry's first
      // available source. This works for any number of providers.
      const match = currentProviderMatch ?? availableSources[0];
      if (match) {
        p.set("providerId", sourceProviderId(match));
        p.set("session", sourceSession(match));
        changed = true;
      }
    } else {
      // Verify the stored session against freshly matched provider sources.
      const actualSource = availableSources.find((source) => sourceSession(source) === animeSession);
      if (actualSource) {
        const actualProvider = sourceProviderId(actualSource);
        if (actualProvider !== providerId) {
          p.set("providerId", actualProvider);
          changed = true;
        }
      } else if (animeSession === initialSessionRef.current) {
        // A stale synced session is repaired from the current connector's match;
        // if that connector has no match, use the first enabled alternative.
        const replacement = currentProviderMatch ?? availableSources[0];
        if (replacement && sourceSession(replacement) !== animeSession) {
          p.set("providerId", sourceProviderId(replacement));
          p.set("session", sourceSession(replacement));
          changed = true;
        }
      }
    }

    if (changed) {
      console.log(`[StreamPlayer] Auto-correcting query params:`, p.toString());
      syncPlayerUrl(p);
    }
  }, [availableSources, animeSession, providerId, params, syncPlayerUrl]);

  // Watched episodes map — keyed by episode number, value is percent watched.
  const [watchedEps, setWatchedEps] = useState<Map<number, number>>(new Map());

  useEffect(() => { autoNextRef.current = autoNext; }, [autoNext]);
  useEffect(() => { currentEpRef.current = currentEp; }, [currentEp]);
  useEffect(() => { availableSourcesRef.current = availableSources; }, [availableSources]);
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

  // ── YouTube-style touch gestures (Android / tablet) ─────────────────────────
  const setUiVolume = useCallback((v: number) => {
    setVolume(v);
    setMuted(v === 0);
    localStorage.setItem("ap-volume", String(v));
    const vid = videoRef.current;
    if (vid) { vid.volume = v; vid.muted = v === 0; }
  }, []);

  const gestures = useVideoGestures({
    enabled: isCapacitor,
    videoRef,
    wrapRef: videoWrapRef,
    onToggleControls: () => {
      setShowControls((prev) => {
        const next = !prev;
        if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
        if (next) controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
        return next;
      });
    },
    onShowControls: showControlsNow,
    setUiVolume,
    // The seek bar self-reads the playhead now, so gestures don't need to push it.
    setUiPosition: () => {},
  });

  const changePlaybackRate = useCallback((rate: number) => {
    setPlaybackRate(rate);
    playbackRateRef.current = rate;
    localStorage.setItem("ap-speed", String(rate));
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, []);

  const togglePiP = useCallback(async () => {
    // Android WebView can't composite <video> into PiP → hand the HLS stream to a
    // native ExoPlayer overlay (needs the stream url + referer + current position).
    if (isCapacitor) {
      const url = currentStreamUrlRef.current;
      if (url) await enterNativePip({ url, referer: refererRef.current, position: videoRef.current?.currentTime ?? 0 });
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if ((v as any).requestPictureInPicture) await v.requestPictureInPicture();
    } catch { /* PiP unsupported or blocked */ }
  }, []);

  // Native PiP teardown calls this on return. The WebView <video> MediaSource is
  // destroyed while suspended in PiP, so reload the current episode through the normal
  // play path (links are cached + resolve is pre-warmed → fast) and resume at the
  // position ExoPlayer reached. Using the full path keeps loading/controls state correct.
  useEffect(() => {
    (window as any).__anitrackPipResume = (posSec: number) => {
      const ep = currentEpRef.current;
      if (ep) playEpisodeRef.current?.(ep, undefined, posSec > 5 ? posSec : undefined);
    };
    return () => { try { delete (window as any).__anitrackPipResume; } catch { /* noop */ } };
  }, []);

  // On Android the WebView's <video> event listeners stop firing after a PiP session
  // (so onCanPlay/timeupdate no longer clear "Resolving", apply the resume seek, or
  // move the scrubber). Poll the element directly so the controls stay correct
  // regardless of whether the events fire.
  useEffect(() => {
    if (!isCapacitor) return;
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v) return;
      // Apply a pending resume seek once metadata is available (onCanPlay may not fire).
      if (pendingSeekRef.current != null && v.readyState >= 1) {
        try { v.currentTime = pendingSeekRef.current; } catch { /* noop */ }
        pendingSeekRef.current = null;
      }
      // Clear the "Resolving" overlay once the stream can actually play.
      if (v.readyState >= 3) setLoadingStream(false);
      if (isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
      setPlaying(!v.paused);
    }, 400);
    return () => clearInterval(id);
  }, []);

  // ── Episode list loading ───────────────────────────────────────────────────

  // Fetch a single page with caching (paheCacheRef survives navigation).
  // The player instance persists across navigations now (mini-player), so a new
  // anime/provider session can arrive on an already-mounted component. Reset the
  // per-anime caches (memory hygiene — keys are session-scoped) and episode
  // state exactly like a fresh mount would.
  // Re-arm stale-session self-healing when a different SHOW arrives (the
  // persistent mini-player instance can be handed a new anime via params).
  const prevTitleRef = useRef(animeTitle);
  useEffect(() => {
    if (prevTitleRef.current === animeTitle) return;
    prevTitleRef.current = animeTitle;
    initialSessionRef.current = animeSession;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeTitle]);

  const prevSessionKeyRef = useRef(`${animeSession}|${providerId}`);
  useEffect(() => {
    const key = `${animeSession}|${providerId}`;
    if (prevSessionKeyRef.current === key) return;
    prevSessionKeyRef.current = key;
    // Kill the PREVIOUS show's stream immediately. If the new episode load
    // fails (network, provider anti-bot), the old video must not keep playing
    // under the new title ("says Cat's Eye, plays Dragon Ball").
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    const v = videoRef.current;
    if (v) {
      try { v.pause(); v.removeAttribute("src"); v.load(); } catch { /* ignore */ }
    }
    paheCacheRef.current.clear();
    linksCacheRef.current.clear();
    setEpisodes([]);
    setCurrentEp(null);
    currentEpRef.current = null;
    setRangeStart(1);
    setTotalEpisodes(0);
    setStreamError(null);
    setLinks([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeSession, providerId]);

  const fetchProviderPage = useCallback(async (providerPage: number): Promise<{ data: any[]; total: number; lastPage: number }> => {
    const cacheKey = `${providerId}:${animeSession}:${providerPage}`;
    const lastPageKey = `${providerId}:${animeSession}:lastPage`;
    const cached = paheCacheRef.current.get(cacheKey);
    if (cached) return { data: cached, total: totalEpisodesRef.current, lastPage: paheCacheRef.current.get(lastPageKey) ?? 999 };
    try {
      const r = await providerClient.episodes(providerId, animeSession, providerPage);
      paheCacheRef.current.set(cacheKey, r.data);
      paheCacheRef.current.set(lastPageKey, r.lastPage ?? 999);
      return { data: r.data, total: r.total, lastPage: r.lastPage ?? 999 };
    } catch {
      return { data: [], total: 0, lastPage: 1 };
    }
  }, [animeSession, providerId]);

  // Load all connector pages needed to cover [rangeStart, rangeStart+RANGE_SIZE-1].
  useEffect(() => {
    if (!animeSession) return;
    let cancelled = false;
    setLoadingEps(true);
    const rangeEnd = rangeStart + RANGE_SIZE - 1;
    const providerPageSize = providerDescriptors.find((item) => item.id === providerId)
      ?.capabilities.episodePageSize ?? PAHE_PAGE_SIZE;
    const firstProviderPage = Math.max(1, Math.ceil(rangeStart / providerPageSize));
    // We don't yet know totalEpisodes on first call — fetch first needed page,
    // get total, then fetch the rest in parallel.
    fetchProviderPage(firstProviderPage)
      .then(async ({ data: firstData, total, lastPage: providerLastPage }) => {
        if (cancelled) return;
        if (firstData.length === 0) {
          // Session expired or failed to load. Redirect back to Anime page to
          // refresh the session — but never hijack navigation while minimized;
          // in mini mode just surface the error on the card.
          const id = Number(params.get("animeId") ?? 0);
          if (id > 0) {
            if (!minimizedRef.current) {
              navigate(`/anime/${id}`, { replace: true });
            } else {
              setStreamError("Session expired — tap to reopen this show.");
              setLoadingEps(false);
            }
            return;
          }
        }
        if (total) setTotalEpisodes(total);

        // Cap page fetching to what the provider actually has.
        const lastProviderPage = Math.min(
          providerLastPage,
          Math.ceil(Math.min(rangeEnd, total || rangeEnd) / providerPageSize),
          Math.ceil((total || (firstProviderPage * providerPageSize)) / providerPageSize),
        );

        // Calculate episodeOffset from page 1 data if not already explicitly provided in URL
        let epOffset = epOffsetRef.current;
        let page1Data = firstData;
        // We need page-1 data to learn the provider's true first episode number,
        // both to auto-compute the offset and to sanity-check a URL-provided one.
        if (firstProviderPage > 1) {
          try { page1Data = (await fetchProviderPage(1)).data; } catch { /* keep firstData */ }
        }
        if (page1Data.length > 0) {
          const sortedPage1 = [...page1Data].sort((a: any, b: any) => {
            const aNum = a.episodeNumber ?? a.episode ?? 0;
            const bNum = b.episodeNumber ?? b.episode ?? 0;
            return aNum - bNum;
          });
          const firstEp = sortedPage1[0].episodeNumber ?? sortedPage1[0].episode ?? 1;
          const maxOffset = Math.max(0, firstEp - 1);
          // Use the auto-computed offset, or clamp a URL-provided one so it can't
          // push episodes below 1. Providers number episodes differently (Anikoto
          // is relative 1-N, AnimePahe can be absolute), so a season-based offset
          // meant for one would otherwise collapse every episode of the other to "1".
          epOffset = epOffset ? Math.min(epOffset, maxOffset) : maxOffset;
          epOffsetRef.current = epOffset;
        }

        // Map firstData to relative episode numbers after sorting firstData
        const sortedFirstData = [...firstData].sort((a: any, b: any) => {
          const aNum = a.episodeNumber ?? a.episode ?? 0;
          const bNum = b.episodeNumber ?? b.episode ?? 0;
          return aNum - bNum;
        });

        const firstMapped = sortedFirstData.map((e: any) => {
          const orig = e.episodeNumber ?? e.episode ?? 0;
          const relativeEp = Math.max(1, orig - epOffset);
          return {
            ...e,
            originalEpisodeNumber: orig,
            episodeNumber: relativeEp,
            episode: relativeEp,
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
        for (let p = firstProviderPage + 1; p <= lastProviderPage; p++) {
          remaining.push(fetchProviderPage(p));
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
          }).catch((err) => console.warn("[provider] background episode load failed", err));
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
      .catch((e) => { if (!cancelled) console.warn("[provider] episode load failed", e); })
      .finally(() => { if (!cancelled) setLoadingEps(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeSession, rangeStart, fetchProviderPage, providerDescriptors, providerId]);

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
        const ref = refererRef.current;
        const hdrs = ref ? { Referer: ref.replace(/\/?$/, "/"), Origin: ref } : undefined;
        // Offline downloads are read from disk via the downloader plugin instead
        // of the network — same response shape, so the decode path below is shared.
        const fetcher = isLocalDownloadUrl(url)
          ? readLocalFile(url, binary)
          : window.api.pahe.fetchUrl!(url, binary, hdrs);
        fetcher
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

  function attachStream(url: string, subtitles?: any[], startPos?: number) {
    const video = videoRef.current;
    if (!video) return;
    currentStreamUrlRef.current = url;

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
      buildHls(url, video, { worker: !isCapacitor, startLevel: -1, attempt: 1, startPosition: startPos ?? -1 });
    } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      if (startPos && startPos > 0) pendingSeekRef.current = startPos;
      if (autoPlay) video.play().catch(() => {});
    } else {
      video.src = url;
      if (startPos && startPos > 0) pendingSeekRef.current = startPos;
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
          const subRef = refererRef.current;
          const subHdrs = subRef ? { Referer: subRef.replace(/\/?$/, "/"), Origin: subRef } : undefined;
          // Offline downloads read the saved .vtt from disk; streams fetch it.
          const local = isLocalDownloadUrl(sub.file);
          const fetchSub = local
            ? readLocalFile(sub.file, false)
            : window.api.pahe.fetchUrl!(sub.file, false, subHdrs);
          fetchSub
            .then((result) => {
              // A downloaded episode may have no subtitle file (e.g. hard-subbed
              // AnimePahe) — drop the empty track instead of showing a blank entry.
              if (local && (result.status !== 200 || !result.data || !result.data.includes("WEBVTT"))) {
                try { video.removeChild(track); } catch (e) {}
                setAvailableSubtitles((prev) => prev.filter((s: any) => s.file !== sub.file));
                return;
              }
              const blob = new Blob([result.data], { type: "text/vtt" });
              track.src = URL.createObjectURL(blob);
              try { track.track.mode = subtitlesEnabled ? "showing" : "hidden"; } catch (e) {}
            })
            .catch((err) => {
              console.error("[Subtitles] Failed to fetch subtitle file:", err, "url=", sub.file);
              if (local) { try { video.removeChild(track); } catch (e) {} return; }
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
    opts: { worker: boolean; startLevel: number; attempt: number; startPosition?: number },
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
      startPosition: opts.startPosition ?? -1,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      // Stall recovery — AnimePahe/Anikoto segments occasionally leave a small
      // buffer hole that freezes the playhead. Let hls.js jump bigger gaps, watch
      // for stalls sooner, and nudge harder before giving up (the watchdog below
      // is the final backstop). Without these the user has to seek ±5s by hand.
      maxBufferHole: 0.5,
      highBufferWatchdogPeriod: 1,
      nudgeOffset: 0.2,
      nudgeMaxRetry: 10,
      maxFragLookUpTolerance: 0.25,
    };
    if (isCapacitor) {
      (hlsConfig as any).loader = buildCapacitorLoader();
    }
    const hls = new Hls(hlsConfig as any);
    hlsRef.current = hls;

    // Fatal network errors (cold manifest/segment fetch, CDN warm-up race) are
    // usually transient — retry via hls.startLoad() before surfacing an error.
    let networkRetries = 0;

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

      // Transient network error — retry the load a few times before giving up.
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
        networkRetries++;
        console.warn(`[HLS] network error (${data.details}); retry ${networkRetries}/3`);
        setTimeout(() => { try { hls.startLoad(); } catch { /* destroyed */ } }, 800 * networkRetries);
        return;
      }

      // Stream is dead on this provider — try the next one before giving up.
      if (fallbackRef.current(currentEpRef.current?.episodeNumber)) return;
      setStreamError(`HLS error: ${data.details} (${data.type})`);
      setLoadingStream(false);
    });
  }

  // ── Playback ───────────────────────────────────────────────────────────────

  const loadingStreamRef = useRef(false);

  const playEpisode = useCallback(
    async (ep: any, session = animeSession, resumePos?: number) => {
      if (loadingStreamRef.current && (currentEpRef.current?.session ?? currentEpRef.current?.id) === (ep.session ?? ep.id)) return;
      resetPlayer();
      loadingStreamRef.current = true;
      setCurrentEp(ep);
      setStreamError(null);
      setLoadingStream(true);
      setDuration(0);
      setLinks([]);
      
      const epKey = String(ep.session ?? ep.id);
      // The connector describes whether these are quality or subtitle-type
      // variants; the player only applies the generic preference policy.
      const descriptor = providerDescriptors.find((item) => item.id === providerId);
      const pickBestIdx = (items: StreamLink[]): number => preferredStreamLinkIndex(
        items,
        descriptor,
        providerVariantPreference(providerId),
      );

      try {
        // Use prefetched links if available (instant switch); else fetch. Run the
        // links fetch, local saved-progress, and the cloud's latest position for
        // this episode all in parallel (the remote pull adds no extra latency).
        const [fetchedLinks, savedProgress, remoteProgress] = await Promise.all([
          linksCacheRef.current.get(epKey) ?? providerClient.links(providerId, ep.session ?? ep.id, animeSession),
          window.api.progress.get(effectiveAnimeIdRef.current, ep.episodeNumber).catch(() => null),
          pullRemoteProgress(effectiveAnimeIdRef.current, ep.episodeNumber).catch(() => null),
        ]);

        fetchSkipTimes(ep.episodeNumber).catch(() => {});

        if (!fetchedLinks.length) throw new Error("No stream links found for this episode");
        linksCacheRef.current.set(epKey, fetchedLinks);
        setLinks(fetchedLinks);

        // Resume from the freshest saved position across this device and the cloud
        // (the other device), so e.g. pausing on the tablet resumes here exactly —
        // even if the tablet was watched after this app launched.
        const freshest = ([savedProgress, remoteProgress] as Array<{ positionSec: number; updatedAt: number } | null>)
          .filter((p): p is { positionSec: number; updatedAt: number } => !!p && p.positionSec > 5)
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null;

        // We apply the resume seek in onCanPlay (after the video is ready) rather than
        // passing startPosition to hls.js — hls.js startPosition stalls on
        // AnimePahe CDN because it tries to fetch mid-stream segments cold.
        pendingSeekRef.current = (resumePos != null && resumePos > 5)
          ? resumePos
          : freshest
          ? freshest.positionSec
          : null;

        const bestIdx = pickBestIdx(fetchedLinks);
        setSelectedLink(bestIdx);
        const { url, subtitles, intro, outro, referer } = await providerClient.resolve(providerId, fetchedLinks[bestIdx].id ?? fetchedLinks[bestIdx].kwik);
        refererRef.current = referer ?? null;
        if (!url) {
          throw new Error("Resolved stream URL is empty. The stream server may be down, or we failed to fetch it.");
        }
        
        if (intro || outro) {
          setSkipTimes({ op: intro, ed: outro });
        }
        
        const activeSubs = streamVariant(fetchedLinks[bestIdx]) === "hard" ? [] : subtitles;

        attachStream(url, activeSubs);

        // Warm the NEXT episode so "Next" is near-instant: cache its links and
        // pre-resolve only the quality we'd actually play (resolving every quality
        // would compete with the current stream's bandwidth and slow startup).
        const nextEp = episodesRef.current.find((e) => e.episodeNumber === ep.episodeNumber + 1);
        if (nextEp) {
          const nextKey = String(nextEp.session ?? nextEp.id);
          const cached = linksCacheRef.current.get(nextKey);
          const warm = cached
            ? Promise.resolve(cached)
            : providerClient.links(providerId, nextEp.session ?? nextEp.id, animeSession);
          warm.then((nextLinks: any[]) => {
            if (!nextLinks?.length) return;
            linksCacheRef.current.set(nextKey, nextLinks);
            const ni = pickBestIdx(nextLinks);
            providerClient.prefetch(providerId, nextLinks[ni].id ?? nextLinks[ni].kwik);
          }).catch(() => {});
        }

        // Pre-fetch the current episode's OTHER qualities a few seconds later, so the
        // background resolves don't compete with the stream that just started.
        setTimeout(() => {
          fetchedLinks.forEach((l: any, idx: number) => {
            if (idx !== bestIdx) providerClient.prefetch(providerId, l.id ?? l.kwik);
          });
        }, 5000);
      } catch (e: any) {
        // Try the next provider before surfacing the error to the user.
        if (fallbackRef.current(ep.episodeNumber)) {
          loadingStreamRef.current = false;
          return;
        }
        setStreamError(e.message ?? String(e));
        setLoadingStream(false);
        setFallbackNotice(null);
      } finally {
        loadingStreamRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [animeSession, autoPlay, providerDescriptors, providerId],
  );

  // Keep a live reference to playEpisode for the PiP-return hook (registered once).
  useEffect(() => { playEpisodeRef.current = playEpisode; });

  // ── Provider switching + automatic fallback ─────────────────────────────────
  const providerLabel = useCallback(
    (pid: string) => providerName(providerDescriptors, pid),
    [providerDescriptors],
  );

  // Navigate to another provider's source, preserving the episode we're watching.
  // Used by both the manual "Servers" buttons and the automatic failure fallback.
  const switchToProvider = useCallback(
    (source: any, epNum?: number) => {
      const pid = source.providerId || "animepahe";
      const targetEp =
        epNum ?? currentEpRef.current?.episodeNumber ?? currentEpRef.current?.episode ?? startEp;
      // Reset stream/episode state so the load effect performs a full reload.
      setCurrentEp(null);
      currentEpRef.current = null;
      setEpisodes([]);
      setLoadingEps(true);
      setStreamError(null);
      setLoadingStream(false);
      paheCacheRef.current.clear();
      linksCacheRef.current.clear();

      const p = new URLSearchParams(params);
      p.set("providerId", pid);
      p.set("session", source.id || source.session);
      if (targetEp) p.set("episode", String(targetEp));
      syncPlayerUrl(p);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, syncPlayerUrl, startEp],
  );

  // After a stream fails, transparently try the next provider we haven't tried for
  // this episode yet. Returns true if a switch was kicked off (caller should keep
  // the loading state), false if every provider is exhausted (caller shows error).
  const attemptAutoFallback = useCallback(
    (epNum: number | undefined): boolean => {
      if (epNum == null) return false;
      const sources = availableSourcesRef.current;
      if (sources.length < 2) return false;

      let tried = fallbackTriedRef.current.get(epNum);
      if (!tried) { tried = new Set(); fallbackTriedRef.current.set(epNum, tried); }
      tried.add(providerId); // the provider we're on just failed

      const alt = sources.find((s) => !tried!.has(s.providerId || "animepahe"));
      if (!alt) return false;

      const altPid = alt.providerId || "animepahe";
      tried.add(altPid);
      setFallbackNotice(`${providerLabel(providerId)} unavailable — trying ${providerLabel(altPid)}…`);
      setStreamError(null);
      setLoadingStream(true);
      switchToProvider(alt, epNum);
      return true;
    },
    [providerId, providerLabel, switchToProvider],
  );
  useEffect(() => { fallbackRef.current = attemptAutoFallback; });

  async function changeQuality(idx: number) {
    const link = linksRef.current[idx];
    if (!link) return;
    // resetPlayer() clears the media element (and currentTime), so capture the
    // live playhead before switching quality or Anikoto subtitle type.
    const resumePosition = videoRef.current?.currentTime ?? 0;
    setSelectedLink(idx);
    const variant = streamVariant(link);
    if (variant) saveProviderVariantPreference(providerId, variant);
    setQualityOpen(false);
    setLoadingStream(true);
    setStreamError(null);
    resetPlayer();
    try {
      const { url, subtitles, referer } = await providerClient.resolve(providerId, link.id ?? link.kwik);
      refererRef.current = referer ?? null;
      if (!url) {
        throw new Error("Resolved stream URL is empty. The stream server may be down, or we failed to fetch it.");
      }
      // Store the current position in pendingSeekRef so onCanPlay applies it
      // after the new stream is ready — same pattern as episode resume.
      pendingSeekRef.current = resumePosition > 1 ? resumePosition : null;

      const activeSubs = streamVariant(link) === "hard" ? [] : subtitles;

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
    if (!ep) return;
    if (isOffline) {
      const n = offlineNeighbor(1);
      if (n) playLocal(n.id, n.episode);
      return;
    }
    const eps = episodesRef.current;
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
    if (!ep) return;
    if (isOffline) {
      const p = offlineNeighbor(-1);
      if (p) playLocal(p.id, p.episode);
      return;
    }
    const eps = episodesRef.current;
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

  // Media Session: gives the desktop PiP window its ±5s seek buttons (Chromium
  // only shows them when seek handlers are registered) and puts proper
  // title/episode/cover metadata + prev/next into the OS media controls.
  useEffect(() => {
    const ms: any = (navigator as any).mediaSession;
    if (!ms) return;
    try {
      // NOTE: no previoustrack/nexttrack here — when track handlers exist,
      // Chromium's PiP window shows episode-skip buttons INSTEAD of the ±5s
      // seek arrows, which is exactly what we don't want.
      ms.setActionHandler("seekbackward", (d: any) => seek(-(d?.seekOffset || 5)));
      ms.setActionHandler("seekforward", (d: any) => seek(d?.seekOffset || 5));
      ms.setActionHandler("play", () => videoRef.current?.play().catch(() => {}));
      ms.setActionHandler("pause", () => videoRef.current?.pause());
    } catch { /* older engines may not know some actions */ }
    return () => {
      for (const a of ["seekbackward", "seekforward", "play", "pause"]) {
        try { ms.setActionHandler(a, null); } catch { /* ignore */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ms: any = (navigator as any).mediaSession;
    if (!ms || !("MediaMetadata" in window) || !currentEp) return;
    try {
      ms.metadata = new MediaMetadata({
        title: `Episode ${currentEp.episodeNumber ?? currentEp.episode}`,
        artist: animeTitle,
        artwork: animeCoverUrl ? [{ src: animeCoverUrl, sizes: "512x512", type: "image/jpeg" }] : [],
      });
    } catch { /* ignore */ }
  }, [currentEp, animeTitle, animeCoverUrl]);

  // Minimizing while fullscreen makes no sense — drop out of fullscreen first
  // so the mini card renders correctly.
  useEffect(() => {
    if (!minimized) return;
    if (isCapacitor && isMobile) {
      import("../lib/api-capacitor").then(({ ScreenOrientation }) => {
        ScreenOrientation.unlock().catch(() => {});
      });
      setIsFullscreen(false);
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minimized]);

  // ── "Up next" autoplay countdown (YouTube-style) ────────────────────────────

  const [upNext, setUpNext] = useState<{ episode: number; count: number } | null>(null);
  const upNextTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearUpNext = useCallback(() => {
    if (upNextTimerRef.current) { clearInterval(upNextTimerRef.current); upNextTimerRef.current = null; }
    setUpNext(null);
  }, []);

  function beginUpNext() {
    const ep = currentEpRef.current;
    if (!ep) return;
    let nextEpNum: number | null = null;
    if (isOffline) {
      nextEpNum = offlineNeighbor(1)?.episode ?? null;
    } else {
      const n = (ep.episodeNumber ?? ep.episode) + 1;
      nextEpNum =
        episodesRef.current.some((e: any) => e.episodeNumber === n) || n <= totalEpisodesRef.current
          ? n
          : null;
    }
    if (nextEpNum == null) return; // series finished — nothing to queue
    clearUpNext();
    let count = 5;
    setUpNext({ episode: nextEpNum, count });
    upNextTimerRef.current = setInterval(() => {
      count -= 1;
      if (count <= 0) {
        clearUpNext();
        playNext();
      } else {
        setUpNext((u) => (u ? { ...u, count } : u));
      }
    }, 1000);
  }
  const beginUpNextRef = useRef(beginUpNext);
  beginUpNextRef.current = beginUpNext;
  // Fresh-closure refs for mount-once handlers (keyboard, Media Session): the
  // persistent player renders many shows over one mount, so direct closures
  // over playNext/playPrev would go stale after the first show.
  const playNextRef = useRef(playNext);
  playNextRef.current = playNext;
  const playPrevRef = useRef(playPrev);
  playPrevRef.current = playPrev;

  // A new episode starting (or unmount) cancels any pending countdown.
  useEffect(() => { clearUpNext(); }, [currentEp, clearUpNext]);
  useEffect(() => () => { if (upNextTimerRef.current) clearInterval(upNextTimerRef.current); }, []);

  // ── Video element event handlers ───────────────────────────────────────────

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onStalled = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onTimeUpdate = () => {
      if (seekingRef.current) return;
      setBuffering(false); // playhead advanced → not stalled
      const now = Date.now();
      if (now - lastPositionUpdate.current >= 250) {
        lastPositionUpdate.current = now;
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
    const onProgress = () => {
      if (!video.duration || !isFinite(video.duration) || video.buffered.length === 0) return;
      setBufferedPct((video.buffered.end(video.buffered.length - 1) / video.duration) * 100);
    };
    const onEnded = () => { if (autoNextRef.current) beginUpNextRef.current(); };
    const onCanPlay = () => {
      setLoadingStream(false);
      setBuffering(false);
      // Stream is healthy again — clear the fallback notice and let this episode
      // fall back afresh if it dies again later in the session.
      setFallbackNotice(null);
      const ep = currentEpRef.current;
      if (ep) fallbackTriedRef.current.delete(ep.episodeNumber);
      // Re-apply the chosen playback speed (a new source resets it to 1×).
      video.playbackRate = playbackRateRef.current;
      // Apply saved resume position now that the video element is ready.
      if (pendingSeekRef.current !== null && videoRef.current) {
        videoRef.current.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
      }
    };
    const onEnterPiP = () => setIsPiP(true);
    const onLeavePiP = () => setIsPiP(false);
    const onError = () => {
      const err = video.error;
      // Ignore errors caused by intentionally resetting the source to empty string
      const cleanSrc = video.src ? video.src.split("?")[0].split("#")[0] : "";
      const cleanLoc = window.location.href.split("?")[0].split("#")[0];
      if (!video.src || cleanSrc === cleanLoc || video.src.includes("about:blank")) {
        return;
      }
      if (err) {
        if (fallbackRef.current(currentEpRef.current?.episodeNumber)) return;
        setStreamError(`Video error: ${err.message || err.code}`);
      }
      setLoadingStream(false);
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("progress", onProgress);
    video.addEventListener("ended", onEnded);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("error", onError);
    video.addEventListener("enterpictureinpicture", onEnterPiP);
    video.addEventListener("leavepictureinpicture", onLeavePiP);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error", onError);
      video.removeEventListener("enterpictureinpicture", onEnterPiP);
      video.removeEventListener("leavepictureinpicture", onLeavePiP);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stall watchdog — the backstop for buffer holes hls.js's gap controller can't
  // jump. If the playhead is frozen while we're supposed to be playing, resume
  // loading and nudge over the gap automatically (what the user did by hand).
  useEffect(() => {
    let lastTime = -1;
    let stalledTicks = 0;
    let recovering = false;
    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      // Only watch when a stream should actively be playing.
      if (
        loadingStreamRef.current ||
        !currentEpRef.current ||
        video.paused ||
        video.seeking ||
        video.ended ||
        recovering
      ) {
        lastTime = video.currentTime;
        stalledTicks = 0;
        return;
      }

      if (Math.abs(video.currentTime - lastTime) > 0.05) {
        lastTime = video.currentTime; // progressing normally
        stalledTicks = 0;
        return;
      }

      // Playhead frozen while "playing" → count it; recover after ~3s.
      stalledTicks++;
      if (stalledTicks < 3) return;
      recovering = true;
      setBuffering(true);
      const t = video.currentTime;
      try {
        hlsRef.current?.startLoad();
        // Jump into the nearest buffered range ahead (skips the hole), else nudge.
        let jumped = false;
        const b = video.buffered;
        for (let i = 0; i < b.length; i++) {
          const start = b.start(i);
          const end = b.end(i);
          if (t >= start && t < end - 0.1) {
            video.currentTime = Math.min(end - 0.1, t + 0.1); // stuck inside a range
            jumped = true;
            break;
          }
          if (start > t && start - t < 8) {
            video.currentTime = start + 0.05; // gap with buffer beyond it
            jumped = true;
            break;
          }
        }
        if (!jumped) video.currentTime = t + 0.2;
        video.play().catch(() => {});
      } catch {
        /* ignore */
      }
      lastTime = video.currentTime;
      stalledTicks = 0;
      setTimeout(() => { recovering = false; }, 1000);
    }, 1000);
    return () => clearInterval(id);
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
      // While minimized the user is browsing the app — don't hijack their keys.
      if (minimizedRef.current) return;
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
      if (e.key === "n") playNextRef.current();
      if (e.key === "p") playPrevRef.current();
      if (e.key === "f") toggleFullscreen();
      if (e.key === "t") setIsTheater((t) => !t);
      if (e.key === "i") togglePiP();
      if (e.key === "c") toggleSubtitles();
      if (e.key === ">" || e.key === ".") changePlaybackRate(Math.min(2, Math.round((playbackRateRef.current + 0.25) * 100) / 100));
      if (e.key === "<" || e.key === ",") changePlaybackRate(Math.max(0.25, Math.round((playbackRateRef.current - 0.25) * 100) / 100));
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
        providerId,
        animePaheSession: animeSession || undefined,
      };
      window.api.progress.set(payload).catch(() => {});
      pushProgress(payload).catch(() => {});
    }

    const timer = setInterval(saveNow, 10_000);
    const handleBeforeUnload = () => {
      saveNow();
      // The sync module's own quit listener registered before this one and has
      // already fired — flush again so the position saveNow just pushed makes
      // it into the gist before the process dies.
      flushOnQuit();
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

  // ── Responsive layout ───────────────────────────────────────────────────────
  // 820px so a tablet stays in the desktop/tablet layout in BOTH orientations —
  // crossing this breakpoint mid-playback swaps layout branches and remounts
  // the <video>, which killed playback when rotating to portrait.
  const isTablet = useMediaQuery("(min-width: 820px)");
  // On Android phone (portrait) we use the YouTube-style layout.
  const isMobile = isCapacitor && !isTablet;

  // ── Render ─────────────────────────────────────────────────────────────────

  const activeProviderDescriptor = providerDescriptors.find((item) => item.id === providerId);

  // The next provider we could fall back to, if one matched this anime.
  const altSource = availableSources.find((s) => (s.providerId || "animepahe") !== providerId);

  // Shared sub-components

  const EpisodePanel = (
    <div className={`flex flex-col ${isMobile ? "flex-1 overflow-hidden" : "w-[260px] flex-shrink-0 border-r border-white/10"} bg-[#000000]`}>
      {availableSources.length > 0 && (
        <div className="border-b border-white/10 p-2">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-white/50 font-semibold">Servers</div>
          <div className="flex flex-wrap gap-2">
            {availableSources.map(s => {
              const pid = s.providerId || "animepahe";
              const isActive = pid === providerId;
              const name = providerLabel(pid);
              return (
                <button
                  key={pid}
                  onClick={() => { if (!isActive) switchToProvider(s); }}
                  className={`flex h-8 items-center gap-2 rounded px-3 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-[#e50914] text-white"
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
      {activeProviderDescriptor?.capabilities.streamVariants === "subtitle-type" && links.length > 1 && (
        <div className="border-b border-white/10 p-2">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-white/50 font-semibold">Sub Type</div>
          <div className="flex gap-2">
            {links.map((link, idx) => {
              const variant = streamVariant(link);
              const label = variant === "hard" ? "Hard Sub" : variant === "dub" ? "Dub" : "Soft Sub";
              return (
                <button
                  key={idx}
                  onClick={() => changeQuality(idx)}
                  className={`flex h-8 flex-1 items-center justify-center rounded text-xs font-semibold transition-all duration-200 ${
                    selectedLink === idx
                      ? "bg-[#e50914] text-white shadow-[0_0_12px_rgba(229, 9, 20,0.4)]"
                      : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              );
            })}
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
              <div className="absolute left-0 top-full z-30 mt-1 max-h-80 w-32 overflow-y-auto rounded-md border border-white/10 bg-[#222222] shadow-xl">
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
                      ? "bg-[#e50914] text-white"
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
      <video ref={videoRef} className={`h-full w-full ${gestures.fitMode === "cover" ? "object-cover" : "object-contain"}`} playsInline crossOrigin="anonymous" />
      {/* YouTube-style gesture layer (Android / tablet). Sits above the video but
          below the controls pill & overlay buttons (which come later in the DOM).
          Stops the synthetic click so the desktop onClick play/pause doesn't fire. */}
      {isCapacitor && !minimized && (
        <div
          className="absolute inset-0"
          style={{ touchAction: "none" }}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={gestures.touchHandlers.onTouchStart}
          onTouchMove={gestures.touchHandlers.onTouchMove}
          onTouchEnd={gestures.touchHandlers.onTouchEnd}
          onTouchCancel={gestures.touchHandlers.onTouchCancel}
        />
      )}
      <GestureFeedback fb={gestures.feedback} />
      {/* Center play/pause button (touch / Android) — appears with the controls */}
      {isCapacitor && !minimized && currentEp && !loadingStream && (
        <button
          onClick={(e) => { e.stopPropagation(); const v = videoRef.current; if (!v) return; v.paused ? v.play().catch(() => {}) : v.pause(); showControlsNow(); }}
          className={`absolute left-1/2 top-1/2 z-30 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition-all duration-300 ${showControls ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-90"}`}
          title="Play / Pause"
        >
          {playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" className="ml-0.5" />}
        </button>
      )}
      {!currentEp && !loadingStream && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-white/30">Select an episode to start watching</p>
        </div>
      )}
      {loadingStream && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/40 pointer-events-none">
          <Loader2 size={36} className="animate-spin" />
          <span className="text-sm">{fallbackNotice ?? "Resolving stream…"}</span>
        </div>
      )}
      {buffering && !loadingStream && !streamError && currentEp && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 size={44} className="animate-spin text-white/70 drop-shadow-lg" />
        </div>
      )}
      {streamError && !loadingStream && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg bg-red-500/10 p-5 text-center">
            <div className="text-sm text-red-400">{streamError}</div>
            <div className="flex gap-2">
              <button
                onClick={() => { const ep = currentEpRef.current; if (ep) playEpisodeRef.current?.(ep); }}
                className="rounded bg-white/10 px-4 py-1.5 text-xs font-medium text-white hover:bg-white/20 transition-colors"
              >
                Retry
              </button>
              {altSource && (
                <button
                  onClick={() => switchToProvider(altSource)}
                  className="rounded bg-[#e50914] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#f6121d] transition-colors"
                >
                  Try {providerLabel(altSource.providerId || "animepahe")}
                </button>
              )}
            </div>
          </div>
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
        videoRef={videoRef}
        skipTimes={skipTimes}
        showControls={showControls}
        onSkip={(endTime) => { if (videoRef.current) videoRef.current.currentTime = endTime; }}
      />
      <VideoControls
        showControls={showControls && !minimized}
        videoRef={videoRef}
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
        bufferedPct={bufferedPct}
        isTheater={isTheater}
        isPiP={isPiP}
        playbackRate={playbackRate}
        onToggleTheater={() => setIsTheater((t) => !t)}
        onTogglePiP={togglePiP}
        onChangePlaybackRate={changePlaybackRate}
        onSeekToPct={(pct) => { const v = videoRef.current; if (v && duration) v.currentTime = pct * duration; }}
        onSeekBy={seek}
        onSeekStart={() => { seekingRef.current = true; }}
        onSeekEnd={(time) => { seekingRef.current = false; if (videoRef.current) videoRef.current.currentTime = time; }}
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
        streamVariants={activeProviderDescriptor?.capabilities.streamVariants}
        cueFontSize={cueFontSize}
        setCueFontSize={setCueFontSize}
        cueFontFamily={cueFontFamily}
        setCueFontFamily={setCueFontFamily}
        cueBgOpacity={cueBgOpacity}
        setCueBgOpacity={setCueBgOpacity}
        cueColor={cueColor}
        setCueColor={setCueColor}
      />

      {/* "Up next" autoplay countdown (YouTube-style) */}
      {upNext && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70">
          <div className={`flex flex-col items-center text-center ${minimized ? "gap-1" : "gap-3"}`}>
            <div className={`uppercase tracking-widest text-white/50 ${minimized ? "text-[9px]" : "text-xs"}`}>Up next</div>
            <div className={`font-bold ${minimized ? "text-sm" : "text-xl"}`}>Episode {upNext.episode}</div>
            {/* Countdown ring around a play button */}
            <button
              onClick={(e) => { e.stopPropagation(); clearUpNext(); playNext(); }}
              className={`relative flex items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 ${minimized ? "h-10 w-10" : "h-16 w-16"}`}
              title="Play now"
            >
              <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full -rotate-90">
                <circle cx="32" cy="32" r="29" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
                <circle
                  cx="32" cy="32" r="29" fill="none" stroke="#e50914" strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 29}
                  strokeDashoffset={2 * Math.PI * 29 * (1 - upNext.count / 5)}
                  style={{ transition: "stroke-dashoffset 1s linear" }}
                />
              </svg>
              <Play size={minimized ? 16 : 26} fill="currentColor" className="ml-0.5" />
            </button>
            {!minimized && (
              <button
                onClick={(e) => { e.stopPropagation(); clearUpNext(); }}
                className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/20"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // ── Mini-player overlay (shown when minimized) ──────────────────────────────
  const expandMini = () => navigate(`/stream-player${search.startsWith("?") ? search : `?${search}`}`);

  // Drag-to-move (YouTube-style): drag the card anywhere, snap to the nearest
  // corner on release. A plain tap (movement < 8px) still expands the player.
  const [miniPos, setMiniPos] = useState<{ x: number; y: number } | null>(null);
  const miniDragRef = useRef<{ px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);
  const miniSuppressClickRef = useRef(false);

  function onMiniPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    const card = (e.currentTarget as HTMLElement).parentElement;
    if (!card) return;
    const r = card.getBoundingClientRect();
    miniDragRef.current = { px: e.clientX, py: e.clientY, ox: r.left, oy: r.top, moved: false };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  function onMiniPointerMove(e: React.PointerEvent) {
    const d = miniDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 8) return;
    d.moved = true;
    const card = (e.currentTarget as HTMLElement).parentElement;
    if (!card) return;
    setMiniPos({
      x: Math.min(Math.max(4, d.ox + dx), window.innerWidth - card.offsetWidth - 4),
      y: Math.min(Math.max(4, d.oy + dy), window.innerHeight - card.offsetHeight - 4),
    });
  }
  function onMiniPointerUp(e: React.PointerEvent) {
    const d = miniDragRef.current;
    miniDragRef.current = null;
    if (!d?.moved) return;
    miniSuppressClickRef.current = true; // this gesture was a drag, not a tap
    const card = (e.currentTarget as HTMLElement).parentElement;
    if (!card) return;
    const r = card.getBoundingClientRect();
    const margin = 12;
    const bottomMargin = isMobile ? 88 : 24; // clear the bottom nav on phones
    setMiniPos({
      x: r.left + r.width / 2 < window.innerWidth / 2 ? margin : window.innerWidth - r.width - margin,
      y: r.top + r.height / 2 < window.innerHeight / 2 ? margin : window.innerHeight - r.height - bottomMargin,
    });
  }

  const miniCardStyle = miniPos
    ? { left: miniPos.x, top: miniPos.y, right: "auto" as const, bottom: "auto" as const }
    : undefined;

  const MiniOverlay = (
    <div
      className="group absolute inset-0 z-[45] cursor-pointer select-none"
      style={{ touchAction: "none" }}
      onClick={() => {
        if (miniSuppressClickRef.current) { miniSuppressClickRef.current = false; return; }
        expandMini();
      }}
      onPointerDown={onMiniPointerDown}
      onPointerMove={onMiniPointerMove}
      onPointerUp={onMiniPointerUp}
      onPointerCancel={() => { miniDragRef.current = null; }}
      title="Tap to expand · drag to move"
    >
      {/* Close */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/85"
        title="Close player"
      >
        <X size={14} />
      </button>
      {/* Expand */}
      <button
        onClick={(e) => { e.stopPropagation(); expandMini(); }}
        className="absolute left-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/85"
        title="Expand player"
      >
        <Maximize2 size={13} />
      </button>
      {/* Center controls — always visible (no hover on touch screens) */}
      {!upNext && (
        <div className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); playPrev(); }}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/85"
            title="Previous episode"
          >
            <SkipBack size={14} fill="currentColor" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); const v = videoRef.current; if (!v) return; v.paused ? v.play().catch(() => {}) : v.pause(); }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white transition hover:bg-black/85"
            title="Play / Pause"
          >
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); playNext(); }}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/85"
            title="Next episode"
          >
            <SkipForward size={14} fill="currentColor" />
          </button>
        </div>
      )}
      {/* Title strip */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-5">
        <div className="truncate text-[11px] font-semibold text-white/90">{animeTitle}</div>
        {currentEp && (
          <div className="text-[10px] text-white/50">Episode {currentEp.episodeNumber ?? currentEp.episode}</div>
        )}
      </div>
      <MiniProgressBar videoRef={videoRef} />
    </div>
  );

  // ── Mobile layout (YouTube-style) ───────────────────────────────────────────
  // Minimize is CSS-only (class swaps + `hidden`) so the <video> element never
  // remounts — playback continues seamlessly between full and mini modes.
  if (isMobile) {
    // One structure for portrait / fullscreen / minimized — mode changes are
    // pure CSS so the <video> element never remounts and playback never skips.
    const fs = isFullscreen && !minimized;
    return (
      <div
        className={
          minimized
            ? "fixed bottom-20 right-3 z-[60] aspect-video w-[min(62vw,320px)] overflow-hidden rounded-xl border border-white/15 bg-black text-white shadow-2xl"
            : "fixed inset-0 z-[60] flex flex-col overflow-hidden bg-[#000000] text-white"
        }
        style={minimized ? miniCardStyle : undefined}
      >
        {/* Top bar */}
        <div className={`flex h-12 flex-shrink-0 items-center gap-2 bg-[#000000] px-3 ${minimized || fs ? "hidden" : ""}`}>
          <button onClick={() => navigate("/")} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm font-semibold">{animeTitle}</div>
            {currentEp && <div className="text-xs text-white/50">Episode {currentEp.episodeNumber ?? currentEp.episode}</div>}
          </div>
          {loadingStream && <Loader2 size={14} className="animate-spin text-white/40" />}
        </div>

        {/* Video — 16:9 in portrait, full-bleed in fullscreen, fills the card when mini */}
        <div className={minimized ? "h-full w-full bg-black" : fs ? "min-h-0 w-full flex-1 bg-black" : "aspect-video w-full flex-shrink-0 bg-black"}>
          {VideoArea(true)}
        </div>

        {/* Episode list — scrollable below video */}
        <div className={`flex flex-1 flex-col overflow-hidden ${minimized || fs ? "hidden" : ""}`}>
          {EpisodePanel}
        </div>

        {minimized && MiniOverlay}
      </div>
    );
  }

  // ── Desktop / tablet layout (split view) ────────────────────────────────────
  return (
    <div
      className={
        minimized
          ? "fixed bottom-6 right-6 z-[60] aspect-video w-[400px] overflow-hidden rounded-xl border border-white/15 bg-black text-white shadow-2xl"
          : "fixed inset-0 z-[60] flex flex-col overflow-hidden bg-[#000000] text-white"
      }
      style={minimized ? miniCardStyle : undefined}
    >

      {/* Top bar */}
      <div className={`flex h-10 flex-shrink-0 items-center gap-3 border-b border-white/10 bg-[#000000] px-3 ${minimized ? "hidden" : ""}`}>
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1 rounded px-2 py-1 text-sm text-white/60 hover:bg-white/10 hover:text-white"
          title="Home"
        >
          <Home size={14} /> Home
        </button>
        <button
          className="truncate text-sm font-semibold hover:text-white transition-colors text-left"
          title="Go to anime page"
          onClick={async () => {
            const id = Number(params.get("animeId") ?? 0);
            if (id > 0) { navigate(`/anime/${id}`); return; }
            try {
              const results = await window.api.anilist.search(animeTitle);
              if (results.length > 0) navigate(`/anime/${results[0].id}`, { state: { anime: results[0] } });
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

      {/* Main content — episode panel left, video right (theater mode hides the panel) */}
      <div className={`flex overflow-hidden ${minimized ? "h-full" : "flex-1"}`}>
        {!isTheater && !minimized && EpisodePanel}
        {VideoArea(true)}
      </div>

      {minimized && MiniOverlay}
    </div>
  );
}
