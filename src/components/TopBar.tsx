import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAppStore } from "../store/useAppStore";

export default function TopBar() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const scanStatus = useAppStore((s) => s.scanStatus);

  return (
    <div className="titlebar-drag flex h-14 items-center justify-between gap-4 border-b border-white/5 bg-bg-elev/80 px-6 backdrop-blur">
      <form
        className="titlebar-no-drag relative flex w-96 items-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <Search
          size={16}
          className="pointer-events-none absolute left-3 text-muted"
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search anime..."
          className="w-full rounded-full border border-white/10 bg-bg-card/80 py-1.5 pl-9 pr-4 text-sm text-white placeholder:text-muted focus:border-accent focus:outline-none"
        />
      </form>
      <div className="titlebar-no-drag text-xs text-muted">
        {scanStatus && <span>{scanStatus}</span>}
      </div>
    </div>
  );
}
