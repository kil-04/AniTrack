import { useAppStore } from "../store/useAppStore";
import GlobalSearch from "./GlobalSearch";

export default function TopBar() {
  const scanStatus = useAppStore((s) => s.scanStatus);

  return (
    <div className="titlebar-drag flex h-14 items-center justify-between gap-4 border-b border-white/5 bg-bg-elev/80 px-6 backdrop-blur relative z-50">
      <GlobalSearch />
      <div className="titlebar-no-drag text-xs text-muted">
        {scanStatus && <span>{scanStatus}</span>}
      </div>
    </div>
  );
}
