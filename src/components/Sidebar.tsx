import { NavLink } from "react-router-dom";
import { Home, Library, Search, Settings, Tv } from "lucide-react";
import { useAppStore } from "../store/useAppStore";

const items = [
  { to: "/", label: "Home", icon: Home },
  { to: "/search", label: "Search", icon: Search },
  { to: "/library", label: "My List", icon: Library },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const mal = useAppStore((s) => s.mal);
  const al = useAppStore((s) => s.al);
  return (
    <aside className="flex w-60 flex-col border-r border-white/5 bg-bg-elev">
      <div className="flex items-center gap-2 px-6 py-6 titlebar-drag">
        <Tv size={24} className="text-accent" />
        <span className="text-lg font-bold tracking-tight">AniTrack</span>
      </div>
      <nav className="flex-1 px-3">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2 my-1 text-sm transition ${
                isActive
                  ? "bg-white/10 text-white"
                  : "text-muted hover:bg-white/5 hover:text-white"
              }`
            }
          >
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="p-4 text-xs space-y-2">
        {mal.connected ? (
          <div className="rounded-md bg-bg-card px-3 py-2">
            <div className="text-muted">MAL</div>
            <div className="truncate font-medium text-white">{mal.username || "—"}</div>
          </div>
        ) : (
          <NavLink
            to="/settings"
            className="block rounded-md bg-accent/20 px-3 py-2 text-accent hover:bg-accent/30"
          >
            Connect MAL →
          </NavLink>
        )}
        {al.connected ? (
          <div className="rounded-md bg-bg-card px-3 py-2">
            <div className="text-muted">AniList</div>
            <div className="truncate font-medium text-white">{al.username || "—"}</div>
          </div>
        ) : (
          <NavLink
            to="/settings"
            className="block rounded-md bg-[#02a9ff]/10 px-3 py-2 text-[#02a9ff]/80 hover:bg-[#02a9ff]/20"
          >
            Connect AniList →
          </NavLink>
        )}
      </div>
    </aside>
  );
}
