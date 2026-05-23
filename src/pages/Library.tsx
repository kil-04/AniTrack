import { useEffect, useMemo, useState } from "react";
import Card from "../components/Card";
import { useAppStore } from "../store/useAppStore";
import type { WatchStatus } from "../../shared/types";

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

  const countFor = (key: WatchStatus | "all") =>
    key === "all"
      ? list.filter((x) => x.anime).length
      : list.filter((x) => x.anime && x.entry.status === key).length;

  return (
    <div className="px-8 py-8">
      <h1 className="mb-6 text-3xl font-bold">My list</h1>
      <div className="mb-6 flex gap-2 border-b border-white/10">
        {TABS.map((t) => {
          const count = countFor(t.key);
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm transition ${
                tab === t.key
                  ? "border-b-2 border-accent text-white"
                  : "text-muted hover:text-white"
              }`}
            >
              {t.label}
              {count > 0 && (
                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-xs leading-none">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {filtered.length === 0 ? (
        <div className="py-20 text-center text-muted">
          Nothing here yet. Try connecting MyAnimeList in Settings, or add a show from the home page.
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
          {filtered.map((x) => (
            <Card key={x.entry.animeId} anime={x.anime!} />
          ))}
        </div>
      )}
    </div>
  );
}
