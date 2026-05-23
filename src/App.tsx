import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Home from "./pages/Home";
import Library from "./pages/Library";
import ShowDetail from "./pages/ShowDetail";
import Player from "./pages/Player";
import StreamingPage from "./pages/StreamingPage";
import StreamPlayer from "./pages/StreamPlayer";
import Settings from "./pages/Settings";
import Search from "./pages/Search";
import ContinueWatching from "./pages/ContinueWatching";
import { useAppStore } from "./store/useAppStore";

export default function App() {
  const refreshAll = useAppStore((s) => s.refreshAll);
  const setScanStatus = useAppStore((s) => s.setScanStatus);
  const location = useLocation();
  const inPlayer = location.pathname.startsWith("/player");
  const inStreaming = location.pathname === "/stream" || location.pathname === "/stream-player";

  useEffect(() => {
    refreshAll();
    const offProgress = window.api.on("library:scan-progress", (payload: any) => {
      setScanStatus(`Scanning ${payload.c}/${payload.t} — ${payload.label}`);
    });
    const offMalAuth = window.api.on("mal:auth-complete", () => {
      refreshAll();
    });
    const offMalPull = window.api.on("mal:pull-progress", (n: any) => {
      setScanStatus(`MAL sync: ${n} entries`);
    });
    return () => {
      offProgress();
      offMalAuth();
      offMalPull();
    };
  }, [refreshAll, setScanStatus]);

  if (inPlayer) {
    return (
      <Routes>
        <Route path="/player/:animeId/:episode" element={<Player />} />
        <Route path="/player/pahe/:episode" element={<Player />} />
      </Routes>
    );
  }

  if (inStreaming) {
    return (
      <Routes>
        <Route path="/stream" element={<StreamingPage />} />
        <Route path="/stream-player" element={<StreamPlayer />} />
      </Routes>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-white">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="thin-scrollbar flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/library" element={<Library />} />
            <Route path="/search" element={<Search />} />
            <Route path="/anime/:id" element={<ShowDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/continue-watching" element={<ContinueWatching />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
