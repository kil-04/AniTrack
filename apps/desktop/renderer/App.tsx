import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import TopBar from "./components/TopBar";
import AppSidebar from "./components/AppSidebar";
import BottomNav from "./components/BottomNav";
import UpdateBanner from "./components/UpdateBanner";
import Home from "./pages/Home";
import { useAppStore } from "./store/useAppStore";
import { usePlayerStore } from "./store/usePlayerStore";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { ThemeBar } from "./components/ThemeSongs";
import { modeForPath, rememberMode } from "./lib/manga-api";
import { useMotion, useSkin } from "./lib/skin";
import { PixelFilters } from "./components/PixelScene";
import PixelAmbient from "./components/PixelAmbient";
import { isCapacitor } from "./lib/platform";
import { subscribeDownloads } from "./lib/downloads";
import { deleteAnimeProgress } from "./lib/supabase-sync";
import { holdForPlayerRoute, startBgMusic } from "./store/useBgMusic";
import { AnimatePresence, motion } from "framer-motion";
import type { MalAuthState } from "../../../packages/shared/types";

// Short and opacity-led: AnimatePresence waits for the exit before the next page
// mounts, so 0.2 s each way made every navigation take ~0.4 s.
const PageTransition = ({ children }: { children: React.ReactNode }) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, transition: { duration: 0.07 } }}
    transition={{ duration: 0.14, ease: "easeOut" }}
    className="h-full w-full"
  >
    {children}
  </motion.div>
);

const ShowDetail       = lazy(() => import("./pages/ShowDetail"));
const StreamingPage    = lazy(() => import("./pages/StreamingPage"));
const StreamPlayer     = lazy(() => import("./pages/StreamPlayer"));
const Settings         = lazy(() => import("./pages/Settings"));
const Search           = lazy(() => import("./pages/Search"));
const Filter           = lazy(() => import("./pages/Filter"));
const ContinueWatching = lazy(() => import("./pages/ContinueWatching"));
const Library          = lazy(() => import("./pages/Library"));
const Schedule         = lazy(() => import("./pages/Schedule"));
const LatestEpisodes   = lazy(() => import("./pages/LatestEpisodes"));
const Downloads        = lazy(() => import("./pages/Downloads"));
const TimeMachine      = lazy(() => import("./pages/TimeMachine"));
const Songs            = lazy(() => import("./pages/Songs"));
const CityPop          = lazy(() => import("./pages/CityPop"));
const TasteGenome      = lazy(() => import("./pages/TasteGenome"));
const Museum           = lazy(() => import("./pages/Museum"));
const MangaHome        = lazy(() => import("./pages/manga/MangaHome"));
const MangaSearch      = lazy(() => import("./pages/manga/MangaSearch"));
const MangaList        = lazy(() => import("./pages/manga/MangaList"));
const MangaUpdates     = lazy(() => import("./pages/manga/MangaUpdates"));
const MangaDownloads   = lazy(() => import("./pages/manga/MangaDownloads"));
const MangaDetail      = lazy(() => import("./pages/manga/MangaDetail"));
const MangaReader      = lazy(() => import("./pages/manga/MangaReader"));
const NovelHome        = lazy(() => import("./pages/novel/NovelHome"));
const NovelSearch      = lazy(() => import("./pages/novel/NovelSearch"));
const NovelList        = lazy(() => import("./pages/novel/NovelList"));
const NovelDetail      = lazy(() => import("./pages/novel/NovelDetail"));
const NovelReader      = lazy(() => import("./pages/novel/NovelReader"));
const NovelDownloads   = lazy(() => import("./pages/novel/NovelDownloads"));

const PageFallback = () => (
  <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-3">
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
    Loading…
  </div>
);

// Keep the desktop-style shell on tablets in BOTH orientations. The Tab S7 FE
// is ~853dp wide in portrait, so a 900px cutoff dropped it into phone mode on
// rotation (old mobile UI + a full player layout swap that killed the video).
// Phones stay under 820dp in portrait.
const TABLET_LANDSCAPE = "(min-width: 820px)";

export default function App() {
  const refreshAll   = useAppStore((s) => s.refreshAll);
  const setScanStatus = useAppStore((s) => s.setScanStatus);
  const setMal        = useAppStore((s) => s.setMal);
  const location      = useLocation();
  const isTablet      = useMediaQuery(TABLET_LANDSCAPE);
  const skin          = useSkin();
  const motion        = useMotion();

  const inStreaming   = location.pathname === "/stream";
  const inReader      = location.pathname === "/manga/read";
  const inNovelReader = location.pathname === "/novels/read";

  // Anime, Manga or Novels mode follows the page (main.tsx reopens the last one used).
  useEffect(() => {
    if (!inReader && !inNovelReader) rememberMode(modeForPath(location.pathname));
  }, [location.pathname, inReader, inNovelReader]);
  // The accent follows the mode (azure for anime, deeper blues for manga and novels): see index.css.
  const appMode = inReader ? "manga" : inNovelReader ? "novel" : modeForPath(location.pathname);
  useEffect(() => {
    document.documentElement.dataset.mode = appMode;
  }, [appMode]);
  const isPlayerRoute = location.pathname === "/stream-player";
  const playerSearch  = usePlayerStore((s) => s.search);

  // The stream player lives OUTSIDE the router: entering /stream-player opens a
  // global player session; leaving the route keeps it mounted as a floating
  // mini-player (YouTube-style) until explicitly closed.
  useEffect(() => {
    if (isPlayerRoute) usePlayerStore.getState().open(location.search);
  }, [isPlayerRoute, location.search]);

  // Background music (the user's own tracks) steps aside while the player is open.
  useEffect(() => startBgMusic(), []);
  useEffect(() => holdForPlayerRoute(isPlayerRoute), [isPlayerRoute]);

  useEffect(() => {
    refreshAll();

    const offMalAuth = window.api.on("mal:auth-complete", () => { refreshAll(); });
    // MAL ended the sign-in in the background: Settings and the sidebar ask to reconnect.
    const offMalState = window.api.on("mal:state-changed", (mal) => { setMal(mal as MalAuthState); });
    const offMalPull = window.api.on("mal:pull-progress", (n: any) => {
      setScanStatus(`MAL sync: ${n} entries`);
    });
    // Stand-in shows were folded into their real entries: retire the old ids in
    // gist sync (or another device's copy would bring them back) and repaint.
    const offRepaired = window.api.on("list:repaired", (moved: unknown) => {
      const rows = Array.isArray(moved) ? moved as { from: number; hadPlayback?: boolean }[] : [];
      for (const row of rows) {
        if (row?.hadPlayback && Number.isSafeInteger(row.from)) void deleteAnimeProgress(row.from).catch(() => {});
      }
      refreshAll();
    });
    return () => { offMalAuth(); offMalState(); offMalPull(); offRepaired(); };
  }, [refreshAll, setMal, setScanStatus]);

  // Auto-sync on return: when the window regains focus (desktop) or the app
  // resumes from background (tablet), two-way sync progress with the gist so
  // Continue Watching reflects whatever the other device just watched.
  // Throttled to once a minute to stay well inside GitHub's rate limits.
  useEffect(() => {
    let last = Date.now(); // the refreshAll above already synced on launch
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      useAppStore.getState().refreshContinue();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, []);

  // Notify when a new episode of a tracked show drops — on launch, then hourly.
  useEffect(() => {
    let alive = true;
    import("./lib/airing").then(({ checkAiringNotifications }) => {
      if (alive) checkAiringNotifications();
    });
    const id = setInterval(() => {
      import("./lib/airing").then(({ checkAiringNotifications }) => {
        if (alive) checkAiringNotifications();
      });
    }, 60 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Load the downloads list once so Continue Watching can prefer a local copy.
  useEffect(() => {
    return subscribeDownloads(() => {});
  }, []);

  // Warm the heaviest route chunks (player + detail) once the app is idle so the
  // first stream open is instant instead of showing the "Loading…" fallback.
  useEffect(() => {
    const prefetch = () => {
      import("./pages/ShowDetail");
      import("./pages/StreamPlayer");
    };
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void) => number)
      | undefined;
    if (ric) {
      const id = ric(prefetch);
      return () => (window as any).cancelIdleCallback?.(id);
    }
    const id = setTimeout(prefetch, 2500);
    return () => clearTimeout(id);
  }, []);

  // Persistent player overlay — full-screen on /stream-player, floating mini
  // card everywhere else. Mounted outside <Routes> so navigation never kills
  // the <video> element (playback continues seamlessly while browsing).
  const playerOverlay = playerSearch != null && (
    <Suspense fallback={isPlayerRoute ? <div className="fixed inset-0 z-[60] bg-black" /> : null}>
      <StreamPlayer
        search={playerSearch}
        minimized={!isPlayerRoute}
        onClose={() => usePlayerStore.getState().close()}
      />
    </Suspense>
  );

  // The manga reader takes the whole window.
  if (inReader) {
    return (
      <Suspense fallback={<div className="fixed inset-0 bg-black" />}>
        <MangaReader />
        {playerOverlay}
      </Suspense>
    );
  }

  // The novel reader takes the whole window too.
  if (inNovelReader) {
    return (
      <Suspense fallback={<div className="fixed inset-0 bg-bg" />}>
        <NovelReader />
        {playerOverlay}
      </Suspense>
    );
  }

  // Full-screen routes (no shell)
  if (inStreaming) {
    return (
      <>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/stream" element={<StreamingPage />} />
          </Routes>
        </Suspense>
        {playerOverlay}
      </>
    );
  }

  // Shell layout — Netflix-style top nav on desktop, bottom nav on phone.
  const showBottomNav = !isTablet && isCapacitor; // only on Android phone/portrait
  const showTopBar    = !showBottomNav; // top nav carries the links on desktop; hide on mobile

  return (
    <div className="app-ambient flex h-screen w-screen overflow-hidden text-white">
      {skin === "pixel" && <PixelFilters />}
      {showTopBar && <AppSidebar />}
      <div className="relative isolate flex min-w-0 flex-1 flex-col">
      {/* Pixel mode's animated night, behind the pages; still while the player is open. */}
      {skin === "pixel" && <PixelAmbient motion={motion && !isPlayerRoute} />}
      <UpdateBanner />
      {showTopBar && <TopBar />}
      <main className="thin-scrollbar flex-1 overflow-y-auto">
        <Suspense fallback={<PageFallback />}>
          <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
              <Route path="/"                   element={<PageTransition><Home /></PageTransition>} />
              <Route path="/library"            element={<PageTransition><Library /></PageTransition>} />
              <Route path="/search"             element={<PageTransition><Filter /></PageTransition>} />
              <Route path="/filter"             element={<PageTransition><Filter /></PageTransition>} />
              <Route path="/anime/:id"          element={<PageTransition><ShowDetail /></PageTransition>} />
              <Route path="/settings"           element={<PageTransition><Settings /></PageTransition>} />
              <Route path="/continue-watching"  element={<PageTransition><ContinueWatching /></PageTransition>} />
              <Route path="/schedule"           element={<PageTransition><Schedule /></PageTransition>} />
              <Route path="/latest"             element={<PageTransition><LatestEpisodes /></PageTransition>} />
              <Route path="/downloads"          element={<PageTransition><Downloads /></PageTransition>} />
              <Route path="/time-machine"       element={<PageTransition><TimeMachine /></PageTransition>} />
              <Route path="/songs"              element={<PageTransition><Songs /></PageTransition>} />
              {/* City Pop opens from Songs; the old address still leads there. */}
              <Route path="/songs/city-pop"     element={<PageTransition><CityPop /></PageTransition>} />
              <Route path="/city-pop"           element={<Navigate to="/songs/city-pop" replace />} />
              <Route path="/taste-genome"       element={<PageTransition><TasteGenome /></PageTransition>} />
              <Route path="/museum/:id"         element={<PageTransition><Museum /></PageTransition>} />
              <Route path="/manga"              element={<PageTransition><MangaHome /></PageTransition>} />
              <Route path="/manga/search"       element={<PageTransition><MangaSearch /></PageTransition>} />
              <Route path="/manga/list"         element={<PageTransition><MangaList /></PageTransition>} />
              <Route path="/manga/updates"      element={<PageTransition><MangaUpdates /></PageTransition>} />
              <Route path="/manga/downloads"    element={<PageTransition><MangaDownloads /></PageTransition>} />
              <Route path="/manga/:id"          element={<PageTransition><MangaDetail /></PageTransition>} />
              <Route path="/novels"             element={<PageTransition><NovelHome /></PageTransition>} />
              <Route path="/novels/search"      element={<PageTransition><NovelSearch /></PageTransition>} />
              <Route path="/novels/list"        element={<PageTransition><NovelList /></PageTransition>} />
              <Route path="/novels/downloads"   element={<PageTransition><NovelDownloads /></PageTransition>} />
              <Route path="/novels/t/:source/:id" element={<PageTransition><NovelDetail /></PageTransition>} />
            </Routes>
          </AnimatePresence>
        </Suspense>
      </main>
      {showBottomNav && <BottomNav />}
      </div>
      {!isPlayerRoute && <ThemeBar />}
      {playerOverlay}
    </div>
  );
}
