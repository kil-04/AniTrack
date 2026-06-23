import { NavLink, useNavigate } from "react-router-dom";
import { Tv } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import GlobalSearch from "./GlobalSearch";

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/filter", label: "Search", end: false },
  { to: "/library", label: "My List", end: false },
  { to: "/continue-watching", label: "Continue", end: false },
  { to: "/settings", label: "Settings", end: false },
];

export default function TopBar() {
  const mal = useAppStore((s) => s.mal);
  const scanStatus = useAppStore((s) => s.scanStatus);
  const navigate = useNavigate();

  return (
    <header className="titlebar-drag relative z-50 flex h-14 items-center gap-6 border-b border-white/5 bg-[#000000]/95 px-6 backdrop-blur">
      {/* Logo */}
      <button
        onClick={() => navigate("/")}
        className="titlebar-no-drag flex shrink-0 items-center gap-2"
      >
        <Tv size={22} className="text-accent" />
        <span className="text-lg font-extrabold tracking-tight text-accent">AniTrack</span>
      </button>

      {/* Primary nav (Netflix-style horizontal links) */}
      <nav className="titlebar-no-drag flex items-center gap-5">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `text-sm transition-colors ${
                isActive ? "font-semibold text-white" : "text-white/60 hover:text-white"
              }`
            }
          >
            {n.label}
          </NavLink>
        ))}
      </nav>

      {/* Right cluster: status · search · account */}
      <div className="titlebar-no-drag ml-auto flex items-center gap-4">
        {scanStatus && <span className="hidden text-xs text-muted lg:inline">{scanStatus}</span>}
        <GlobalSearch />
        <button
          onClick={() => navigate("/settings")}
          className="flex items-center gap-2 rounded px-1.5 py-1 transition hover:bg-white/10"
          title={mal.connected ? `Signed in as ${mal.username}` : "Sign in"}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded bg-accent text-xs font-bold text-white">
            {mal.connected && mal.username ? mal.username.slice(0, 1).toUpperCase() : "?"}
          </span>
          <span className="hidden text-xs text-white/70 xl:inline">
            {mal.connected ? mal.username : "Sign in"}
          </span>
        </button>
      </div>
    </header>
  );
}
