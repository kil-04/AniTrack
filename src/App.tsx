import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Sidebar from "./components/Sidebar";
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
const Player           = lazy(() => import("./pages/Player"));
const StreamingPage    = lazy(() => import("./pages/StreamingPage"));
const StreamPlayer     = lazy(() => import("./pages/StreamPlayer"));
const Settings         = lazy(() => import("./pages/Settings"));
const Search           = lazy(() => import("./pages/Search"));
const Filter           = lazy(() => import("./pages/Filter"));
const ContinueWatching = lazy(() => import("./pages/ContinueWatching"));
const Library          = lazy(() => import("./pages/Library"));

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

  const inPlayer    = location.pathname.startsWith("/player");
  const inStreaming  = location.pathname === "/stream" || location.pathname === "/stream-player";

  useEffect(() => {
    refreshAll();

    // library:scan-progress is Electron-only; window.api.on is a no-op stub on Android
    const offProgress = window.api.on("library:scan-progress", (payload: any) => {
      setScanStatus(`Scanning ${payload.c}/${payload.t} — ${payload.label}`);
    });
    const offMalAuth = window.api.on("mal:auth-complete", () => { refreshAll(); });
    const offMalPull = window.api.on("mal:pull-progress", (n: any) => {
      setScanStatus(`MAL sync: ${n} entries`);
    });
    return () => { offProgress(); offMalAuth(); offMalPull(); };
  }, [refreshAll, setScanStatus]);

  // Full-screen routes (no shell)
  if (inPlayer) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/player/:animeId/:episode" element={<Player />} />
          <Route path="/player/pahe/:episode" element={<Player />} />
        </Routes>
      </Suspense>
    );
  }

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

  // Shell layout — sidebar on wide tablet, bottom nav on phone
  const showSidebar  = isTablet;
  const showBottomNav = !isTablet && isCapacitor; // only on Android phone/portrait
  const showTopBar    = !showBottomNav; // TopBar is Electron-style titlebar; hide on mobile

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-white">
      <div className="flex flex-1 overflow-hidden">
        {showSidebar && <Sidebar />}
        <div className="flex flex-1 flex-col overflow-hidden">
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
                </Routes>
              </AnimatePresence>
            </Suspense>
          </main>
        </div>
      </div>
      {showBottomNav && <BottomNav />}
    </div>
  );
}
