import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import TopBar from "./components/TopBar";
import BottomNav from "./components/BottomNav";
import UpdateBanner from "./components/UpdateBanner";
import Home from "./pages/Home";
import { useAppStore } from "./store/useAppStore";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { isCapacitor } from "./lib/platform";
import { AnimatePresence, motion } from "framer-motion";

const PageTransition = ({ children }: { children: React.ReactNode }) => (
  <motion.div
    initial={{ opacity: 0, y: 10, scale: 0.98 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, scale: 0.98 }}
    transition={{ duration: 0.2, ease: "easeOut" }}
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
const Downloads        = lazy(() => import("./pages/Downloads"));

const PageFallback = () => (
  <div className="flex h-full items-center justify-center text-white/30 text-sm">
    Loading…
  </div>
);

// On tablet landscape (≥900 px) keep the desktop sidebar.
// On phone or portrait tablet use the bottom nav bar.
const TABLET_LANDSCAPE = "(min-width: 900px)";

export default function App() {
  const refreshAll   = useAppStore((s) => s.refreshAll);
  const setScanStatus = useAppStore((s) => s.setScanStatus);
  const location      = useLocation();
  const isTablet      = useMediaQuery(TABLET_LANDSCAPE);

  const inStreaming  = location.pathname === "/stream" || location.pathname === "/stream-player";

  useEffect(() => {
    refreshAll();

    const offMalAuth = window.api.on("mal:auth-complete", () => { refreshAll(); });
    const offMalPull = window.api.on("mal:pull-progress", (n: any) => {
      setScanStatus(`MAL sync: ${n} entries`);
    });
    return () => { offMalAuth(); offMalPull(); };
  }, [refreshAll, setScanStatus]);

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
    let off = () => {};
    import("./lib/downloads").then(({ subscribeDownloads }) => { off = subscribeDownloads(() => {}); });
    return () => off();
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

  // Full-screen routes (no shell)
  if (inStreaming) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/stream" element={<StreamingPage />} />
          <Route path="/stream-player" element={<StreamPlayer />} />
        </Routes>
      </Suspense>
    );
  }

  // Shell layout — Netflix-style top nav on desktop, bottom nav on phone.
  const showBottomNav = !isTablet && isCapacitor; // only on Android phone/portrait
  const showTopBar    = !showBottomNav; // top nav carries the links on desktop; hide on mobile

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-white">
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
              <Route path="/downloads"          element={<PageTransition><Downloads /></PageTransition>} />
            </Routes>
          </AnimatePresence>
        </Suspense>
      </main>
      {showBottomNav && <BottomNav />}
    </div>
  );
}
