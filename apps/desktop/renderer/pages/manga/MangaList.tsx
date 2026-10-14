import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { BookMarked, Search } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import { MANGA_STATUS_LABELS, MANGA_STATUSES, type MangaListEntry, type MangaStatus } from "../../../../../packages/shared/manga";
import { mangaApi } from "../../lib/manga-api";

export default function MangaList() {
  const [rows, setRows] = useState<MangaListEntry[] | null>(null);
  const [tab, setTab] = useState<MangaStatus | "all">("all");

  useEffect(() => {
    mangaApi().list().then(setRows).catch(() => setRows([]));
  }, []);

  const shown = (rows ?? []).filter((row) => tab === "all" || row.status === tab);
  const count = (status: MangaStatus) => (rows ?? []).filter((row) => row.status === status).length;

  const total = rows?.length ?? 0;

  return (
    <div className="mx-auto max-w-[1680px] px-8 pb-16 pt-8">
      <PageHeader
        icon={BookMarked}
        title="My Manga"
        subtitle={total > 0 ? `${total} title${total === 1 ? "" : "s"} on your shelf` : "Everything you read, by status"}
      />
      <div className="mb-8 inline-flex flex-wrap gap-1 rounded-2xl border border-white/[0.07] bg-surface-1/70 p-1">
        {(["all", ...MANGA_STATUSES] as const).map((key) => {
          const on = tab === key;
          const n = key === "all" ? total : count(key);
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`relative flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors ${on ? "text-white" : "text-ink-3 hover:text-white"}`}
            >
              {on && (
                <motion.span
                  layoutId="manga-list-tab"
                  className="absolute inset-0 rounded-xl bg-accent-gradient shadow-glow"
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
              )}
              <span className="relative">{key === "all" ? "All" : MANGA_STATUS_LABELS[key]}</span>
              {n > 0 && (
                <span className={`relative rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums ${on ? "bg-white/25 text-white" : "bg-white/[0.08] text-ink-2"}`}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {rows === null ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
          {Array.from({ length: 14 }, (_, i) => <div key={i} className="skeleton aspect-[2/3] rounded-2xl" />)}
        </div>
      ) : !shown.length ? (
        <EmptyState
          icon={BookMarked}
          title={rows.length ? "Nothing here yet" : "Your manga list is empty"}
          action={
            <Link to="/manga/search" className="btn btn-primary">
              <Search size={16} /> Browse manga
            </Link>
          }
        >
          {rows.length ? "No titles have this status yet." : "Add titles from their page and they show up here."}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
          {shown.map((row) => (
            <Link key={row.mangaId} to={`/manga/${row.mangaId}`} className="group block">
              <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-surface-1 shadow-card ring-1 ring-white/[0.06] transition-all duration-300 group-hover:-translate-y-1.5 group-hover:shadow-glow-lg group-hover:ring-2 group-hover:ring-accent/70">
                {row.cover && <img src={row.cover} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.07]" />}
                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent" />
                {tab === "all" && (
                  <span className="badge badge-glass absolute bottom-2 left-2 normal-case tracking-normal">{MANGA_STATUS_LABELS[row.status]}</span>
                )}
              </div>
              <div className="mt-2.5 line-clamp-2 text-sm font-semibold leading-tight text-white/90 transition-colors group-hover:text-white">{row.title}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
