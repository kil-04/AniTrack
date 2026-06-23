import { NavLink } from "react-router-dom";
import { Home, Search, Clock, Settings } from "lucide-react";

const items = [
  { to: "/", label: "Home", icon: Home },
  { to: "/filter", label: "Search", icon: Search },
  { to: "/continue-watching", label: "History", icon: Clock },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function BottomNav() {
  return (
    <nav className="flex h-16 flex-shrink-0 items-stretch border-t border-white/10 bg-bg-elev">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center justify-center gap-1 text-[10px] transition ${
              isActive ? "text-white" : "text-muted hover:text-white"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
              <span className="font-medium">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
