import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Bookmark, BookmarkPlus, Settings as SettingsIcon } from "lucide-react";
import Card from "../components/Card";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { useAppStore } from "../store/useAppStore";
import type { WatchStatus } from "../../../../packages/shared/types";

const TABS: { key: WatchStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "watching", label: "Watching" },
  { key: "completed", label: "Completed" },
  { key: "plan_to_watch", label: "Plan to watch" },
  { key: "on_hold", label: "On hold" },
  { key: "dropped", label: "Dropped" },
];

export default function Library() {
  const list = useAppStore((s) => s.list);
  const refreshList = useAppStore((s) => s.refreshList);
  const [tab, setTab] = useState<WatchStatus | "all">("all");

  // Always fetch fresh list data when the page is opened.
  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const filtered = useMemo(
    () =>
      list.filter((x) => x.anime && (tab === "all" || x.entry.status === tab)),
    [list, tab],
  );

  const counts = useMemo(() => {
    const withAnime = list.filter((x) => x.anime);
    const m = new Map<WatchStatus | "all", number>([["all", withAnime.length]]);
    for (const { key } of TABS.slice(1)) {
      m.set(key as WatchStatus, withAnime.filter((x) => x.entry.status === key).length);
    }
    return m;
  }, [list]);

  const countFor = useCallback(
    (key: WatchStatus | "all") => counts.get(key) ?? 0,
    [counts],
  );

  const total = countFor("all");

  return (
    <div className="mx-auto max-w-[1680px] px-8 py-8">
      <PageHeader scene="sakura"
        icon={Bookmark}
        title="My List"
        subtitle={total > 0 ? `${total} title${total === 1 ? "" : "s"} tracked` : "Everything you track, by status"}
      />
      <div className="mb-8 inline-flex flex-wrap gap-1 rounded-2xl border border-white/[0.07] bg-surface-1/70 p-1">
        {TABS.map((t) => {
          const count = countFor(t.key);
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors ${
                on ? "text-white" : "text-ink-3 hover:text-white"
              }`}
            >
              {on && (
                <motion.span
                  layoutId="library-tab"
                  className="absolute inset-0 rounded-xl bg-accent-gradient shadow-glow"
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
              )}
              <span className="relative">{t.label}</span>
              {count > 0 && (
                <span
                  className={`relative rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums ${
                    on ? "bg-white/25 text-white" : "bg-white/[0.08] text-ink-2"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {filtered.length === 0 ? (
        <EmptyState
          icon={BookmarkPlus}
          title={tab === "all" ? "Your list is empty" : `Nothing in ${TABS.find((t) => t.key === tab)?.label ?? "this list"}`}
          action={
            <>
              <Link to="/" className="btn btn-primary">Browse anime</Link>
              <Link to="/settings" className="btn btn-secondary">
                <SettingsIcon size={16} /> Connect MyAnimeList
              </Link>
            </>
          }
        >
          Connect MyAnimeList in Settings, or add a show from its page.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
          {filtered.map((x) => (
            <Card
              key={x.entry.animeId}
              anime={x.anime!}
              progressPercent={
                x.entry.status !== "completed" && x.entry.episodesWatched > 0 && x.anime!.episodes
                  ? (x.entry.episodesWatched / x.anime!.episodes) * 100
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
