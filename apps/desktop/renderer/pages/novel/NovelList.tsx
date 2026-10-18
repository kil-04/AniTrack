import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { BookMarked, Search } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import { NOVEL_STATUS_LABELS, NOVEL_STATUSES, novelSourceLabel, type NovelListEntry, type NovelStatus } from "../../../../../packages/shared/novel";
import { NovelCover } from "../../components/novel/NovelCards";
import { novelApi, novelTitlePath } from "../../lib/novel-api";
import { onNovelSync, syncNovelReading } from "../../lib/novel-sync";

export default function NovelList() {
  const [rows, setRows] = useState<NovelListEntry[] | null>(null);
  const [tab, setTab] = useState<NovelStatus | "all">("all");

  useEffect(() => {
    const load = () => { novelApi().list().then(setRows).catch(() => setRows([])); };
    load();
    // The list follows other devices.
    const stop = onNovelSync(load);
    void syncNovelReading().catch(() => {});
    return stop;
  }, []);

  const shown = (rows ?? []).filter((row) => tab === "all" || row.status === tab);
  const count = (status: NovelStatus) => (rows ?? []).filter((row) => row.status === status).length;
  const total = rows?.length ?? 0;

  return (
    <div className="mx-auto max-w-[1680px] px-8 pb-16 pt-8">
      <PageHeader
        icon={BookMarked}
        title="My Novels"
        subtitle={total > 0 ? `${total} title${total === 1 ? "" : "s"} on your shelf` : "Everything you read, by status"}
      />
      <div className="mb-8 inline-flex flex-wrap gap-1 rounded-2xl border border-white/[0.07] bg-surface-1/70 p-1">
        {(["all", ...NOVEL_STATUSES] as const).map((key) => {
          const on = tab === key;
          const n = key === "all" ? total : count(key);
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`relative flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors ${on ? "text-white" : "text-ink-3 hover:text-white"}`}
            >
              {on && (
                <motion.span layoutId="novel-list-tab" className="absolute inset-0 rounded-xl bg-accent-gradient shadow-glow" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
              )}
              <span className="relative">{key === "all" ? "All" : NOVEL_STATUS_LABELS[key]}</span>
              {n > 0 && (
                <span className={`relative rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums ${on ? "bg-white/25 text-white" : "bg-white/[0.08] text-ink-2"}`}>{n}</span>
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
          title={rows.length ? "Nothing here yet" : "Your novel list is empty"}
          action={<Link to="/novels/search" className="btn btn-primary"><Search size={16} /> Browse novels</Link>}
        >
          {rows.length ? "No titles have this status yet." : "Add titles from their page and they show up here."}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
          {shown.map((row) => (
            <Link key={`${row.sourceId}:${row.titleId}`} to={novelTitlePath(row.sourceId, row.titleId)} className="group block">
              <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-surface-1 shadow-card ring-1 ring-white/[0.06] transition-all duration-300 group-hover:-translate-y-1.5 group-hover:shadow-glow-lg group-hover:ring-2 group-hover:ring-accent/70">
                <NovelCover cover={row.cover} title={row.title} className="transition duration-700 ease-out group-hover:scale-[1.07]" />
                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent" />
                {tab === "all" && (
                  <span className="badge badge-glass absolute bottom-2 left-2 normal-case tracking-normal">{NOVEL_STATUS_LABELS[row.status]}</span>
                )}
              </div>
              <div className="mt-2.5 line-clamp-2 text-sm font-semibold leading-tight text-white/90 transition-colors group-hover:text-white">{row.title}</div>
              <div className="mt-0.5 text-xs text-ink-3">{novelSourceLabel(row.sourceId)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
