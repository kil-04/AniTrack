import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  BellRing, Bookmark, BookOpen, BookText, CalendarDays, Download, History, House, MonitorPlay, Music2,
  PanelLeftClose, PanelLeftOpen, Search, Settings, Tv, UserRound, type LucideIcon,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { hasMangaMode, lastReadingHome, modeForPath, modeHome } from "../lib/manga-api";
import { hasNovelMode } from "../lib/novel-api";
import { useMediaQuery } from "../hooks/useMediaQuery";
import BrandMark, { Wordmark } from "./BrandMark";

type Item = { to: string; label: string; icon: LucideIcon; end?: boolean };
type Group = { title: string; items: Item[] };

const ANIME: Group[] = [
  {
    title: "Browse",
    items: [
      { to: "/", label: "Home", icon: House, end: true },
      { to: "/filter", label: "Search", icon: Search },
      { to: "/schedule", label: "Schedule", icon: CalendarDays },
      { to: "/time-machine", label: "Time Machine", icon: History },
      { to: "/songs", label: "Songs", icon: Music2 },
    ],
  },
  {
    title: "Library",
    items: [
      { to: "/library", label: "My List", icon: Bookmark },
      { to: "/continue-watching", label: "Continue Watching", icon: MonitorPlay },
      { to: "/downloads", label: "Downloads", icon: Download },
    ],
  },
];

const MANGA: Group[] = [
  {
    title: "Browse",
    items: [
      { to: "/manga", label: "Home", icon: House, end: true },
      { to: "/manga/search", label: "Search", icon: Search },
    ],
  },
  {
    title: "Library",
    items: [
      { to: "/manga/list", label: "My List", icon: Bookmark },
      { to: "/manga/updates", label: "Updates", icon: BellRing },
      { to: "/manga/downloads", label: "Downloads", icon: Download },
    ],
  },
];

const NOVEL: Group[] = [
  {
    title: "Browse",
    items: [
      { to: "/novels", label: "Home", icon: House, end: true },
      { to: "/novels/search", label: "Search", icon: Search },
    ],
  },
  {
    title: "Library",
    items: [
      { to: "/novels/list", label: "My List", icon: Bookmark },
      { to: "/novels/downloads", label: "Downloads", icon: Download },
    ],
  },
];

const PREF = "anitrack.sidebar";
const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/** The app's navigation: mode switch, grouped destinations, settings and account. */
export default function AppSidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const mal = useAppStore((s) => s.mal);
  // City Pop lives under Songs (/songs/city-pop), so Songs stays lit there.
  const mode = modeForPath(pathname);
  const groups = mode === "manga" ? MANGA : mode === "novel" ? NOVEL : ANIME;
  const narrow = useMediaQuery("(max-width: 1279px)");
  const [pref, setPref] = useState<"collapsed" | "expanded" | null>(() => {
    try { return (localStorage.getItem(PREF) as "collapsed" | "expanded" | null) ?? null; } catch { return null; }
  });
  const collapsed = pref ? pref === "collapsed" : narrow;
  useEffect(() => {
    try { if (pref) localStorage.setItem(PREF, pref); } catch { /* ignore */ }
  }, [pref]);

  const signedIn = mal.connected && !!mal.username;

  return (
    <aside
      className={`relative z-40 flex h-full shrink-0 flex-col border-r border-white/[0.06] bg-bg-elev/70 backdrop-blur-xl transition-[width] duration-300 ease-out ${collapsed ? "w-[76px]" : "w-[236px]"}`}
    >
      {/* Brand (doubles as the window drag area) */}
      <div className={`titlebar-drag flex h-16 shrink-0 items-center ${collapsed ? "justify-center" : "px-5"} ${isMac ? "mt-6" : ""}`}>
        <button
          onClick={() => navigate(modeHome(mode))}
          className="titlebar-no-drag flex items-center gap-2.5 rounded-xl"
          title="AniTrack"
        >
          <BrandMark size={34} className="shadow-[0_8px_22px_-6px_rgb(var(--accent)/0.55)]" />
          {!collapsed && <Wordmark className="text-[20px]" />}
        </button>
      </div>

      {/* Anime / Manga, and in Manga mode the kind of reading: Manga · Novels */}
      {hasMangaMode() && (
        <div className={`titlebar-no-drag ${collapsed ? "px-3" : "px-4"} pb-2`}>
          <div className={`relative flex rounded-2xl border border-white/[0.07] bg-white/[0.04] p-1 ${collapsed ? "flex-col gap-1" : ""}`}>
            {[
              { label: "Anime", to: "/", on: mode === "anime", icon: Tv },
              { label: "Manga", to: lastReadingHome(), on: mode !== "anime", icon: BookOpen },
            ].map((m) => (
              <button
                key={m.label}
                onClick={() => { if (!m.on) navigate(m.to); }}
                title={m.label}
                className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-colors ${m.on ? "text-white" : "text-ink-3 hover:text-white"}`}
              >
                {m.on && (
                  <motion.span
                    layoutId="mode-thumb"
                    className="absolute inset-0 -z-10 rounded-xl bg-accent-gradient shadow-glow"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <m.icon size={15} strokeWidth={2.2} />
                {!collapsed && m.label}
              </button>
            ))}
          </div>
          {mode !== "anime" && hasNovelMode() && (
            <div className={`mt-2 flex ${collapsed ? "flex-col items-center gap-1" : "gap-1 px-1"}`}>
              {[
                { label: "Manga", to: "/manga", on: mode === "manga", icon: BookOpen },
                { label: "Novels", to: "/novels", on: mode === "novel", icon: BookText },
              ].map((k) => (
                <button
                  key={k.label}
                  onClick={() => { if (!k.on) navigate(k.to); }}
                  title={k.label}
                  className={`flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${collapsed ? "h-7 w-9 px-0" : "flex-1"} ${k.on ? "bg-white/[0.08] text-white" : "text-ink-3 hover:bg-white/[0.04] hover:text-white"}`}
                >
                  <k.icon size={13} strokeWidth={2.2} className={k.on ? "text-accent" : ""} />
                  {!collapsed && k.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Destinations */}
      <nav className="no-scrollbar titlebar-no-drag flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((g) => (
          <div key={g.title} className="mt-4">
            {!collapsed ? (
              <div className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-ink-3/80">{g.title}</div>
            ) : (
              <div className="mx-auto mb-2 h-px w-8 bg-white/[0.07]" />
            )}
            {g.items.map((item) => (
              <SideLink key={item.to} item={item} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </nav>

      {/* Settings + account */}
      <div className="titlebar-no-drag border-t border-white/[0.06] px-3 py-3">
        <SideLink item={{ to: "/settings", label: "Settings", icon: Settings }} collapsed={collapsed} />
        <button
          onClick={() => navigate("/settings")}
          title={signedIn ? `Signed in as ${mal.username}` : "Sign in"}
          className={`mt-1 flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-white/[0.05] ${collapsed ? "justify-center" : ""}`}
        >
          {signedIn ? (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-gradient text-sm font-bold text-white shadow-glow">
              {mal.username!.slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-ink-2">
              <UserRound size={16} />
            </span>
          )}
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-white">{signedIn ? mal.username : "Sign in"}</span>
              <span className="flex items-center gap-1.5 truncate text-[11px] text-ink-3">
                <span className={`h-1.5 w-1.5 rounded-full ${signedIn ? "bg-emerald-400" : mal.needsReconnect ? "bg-amber-400" : "bg-white/25"}`} />
                {signedIn ? "MyAnimeList synced" : mal.needsReconnect ? "Reconnect MyAnimeList" : "Connect MyAnimeList"}
              </span>
            </span>
          )}
        </button>
        <button
          onClick={() => setPref(collapsed ? "expanded" : "collapsed")}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium text-ink-3 transition hover:bg-white/[0.05] hover:text-white ${collapsed ? "justify-center px-0" : ""}`}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <><PanelLeftClose size={17} /> Collapse</>}
        </button>
      </div>
    </aside>
  );
}

function SideLink({ item, collapsed }: { item: Item; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-xl py-2.5 text-[13.5px] font-medium transition-colors ${collapsed ? "justify-center px-0" : "px-3"} ${isActive ? "text-white" : "text-ink-2 hover:bg-white/[0.045] hover:text-white"}`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="nav-active"
              className="absolute inset-0 rounded-xl border border-accent/25 bg-accent/[0.13]"
              transition={{ type: "spring", stiffness: 460, damping: 36 }}
            >
              <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-x-[1px] -translate-y-1/2 rounded-full bg-accent shadow-[0_0_12px_rgb(var(--accent))]" />
            </motion.span>
          )}
          <Icon size={18} strokeWidth={isActive ? 2.3 : 1.9} className={`relative ${isActive ? "text-accent" : "text-ink-3 group-hover:text-white"}`} />
          {!collapsed && <span className="relative truncate">{item.label}</span>}
        </>
      )}
    </NavLink>
  );
}
