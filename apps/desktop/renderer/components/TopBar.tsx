import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import GlobalSearch from "./GlobalSearch";
import { BackgroundMusicButton } from "./BackgroundMusic";
import { MangaSearchBox } from "./manga/MangaCards";
import { isMangaPath } from "../lib/manga-api";

/**
 * The slim header above every page: history buttons, the mode's search and sync
 * status. Navigation lives in the sidebar; this bar is also the window's drag area.
 */
export default function TopBar() {
  const scanStatus = useAppStore((s) => s.scanStatus);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const manga = isMangaPath(pathname);

  return (
    <header className="titlebar-drag relative z-30 flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.05] bg-bg/55 px-5 backdrop-blur-xl">
      <div className="titlebar-no-drag flex items-center gap-1">
        <button onClick={() => navigate(-1)} className="btn btn-ghost btn-icon h-9 w-9 rounded-full" title="Back">
          <ChevronLeft size={19} />
        </button>
        <button onClick={() => navigate(1)} className="btn btn-ghost btn-icon h-9 w-9 rounded-full" title="Forward">
          <ChevronRight size={19} />
        </button>
      </div>

      <div className="titlebar-no-drag w-full max-w-[560px]">
        {manga ? <MangaSearchBox /> : <GlobalSearch />}
      </div>

      <div className="titlebar-no-drag ml-auto flex items-center gap-3">
        {scanStatus && (
          <span className="hidden items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.04] px-3 py-1.5 text-xs text-ink-2 lg:inline-flex">
            <RefreshCw size={12} className="animate-spin text-accent" />
            {scanStatus}
          </span>
        )}
        <BackgroundMusicButton />
      </div>
    </header>
  );
}
