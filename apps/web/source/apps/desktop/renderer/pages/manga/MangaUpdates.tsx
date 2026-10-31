import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { BookOpenCheck, ChevronRight, CloudOff, Inbox, Link2, Loader2, RefreshCw, Sparkles } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import {
  chapterLabel,
  newChapterCount,
  uploadedLabel,
  type MangaSourceInfo,
  type TrackedTitle,
} from "../../../../../packages/shared/manga";
import { mangaApi, titlePref } from "../../lib/manga-api";

interface UpdateEntry extends TrackedTitle {
  latest: number | null;
  latestAt: number | null;
  source: string;
}

/** Titles checked at once; each source still spaces its own requests. */
const PARALLEL = 4;

/**
 * Manga mode's counterpart of the anime Schedule: the newest chapter of every manga
 * in your list or reading history, newest first, with what's new since the chapter
 * you last read. Each title is checked on the source it reads from (the one picked
 * on its page, else wherever it was matched).
 */
export default function MangaUpdates() {
  const [entries, setEntries] = useState<UpdateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [sources, setSources] = useState<MangaSourceInfo[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<"all" | "new">("all");

  useEffect(() => {
    mangaApi().sources().then(setSources).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setBlocked([]);
    setEntries([]);
    (async () => {
      const tracked = await mangaApi().tracked().catch((): TrackedTitle[] => []);
      if (!alive) return;
      setEmpty(!tracked.length);
      // Sources that asked for their check are skipped for the rest of this pass.
      const skip = new Set<string>();
      let next = 0;
      const worker = async () => {
        while (alive && next < tracked.length) {
          const title = tracked[next++];
          const result = await mangaApi().latest(title.mangaId, titlePref(title.mangaId, "source"), [...skip]).catch(() => null);
          if (!alive || !result) continue;
          if (result.blocked.length) {
            result.blocked.forEach((id) => skip.add(id));
            setBlocked([...skip]);
          }
          const found = result.found;
          if (!found) continue;
          const entry: UpdateEntry = { ...title, latest: found.chapter, latestAt: found.at, source: found.label };
          setEntries((list) => [...list, entry].sort((a, b) => (b.latestAt ?? 0) - (a.latestAt ?? 0)));
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [attempt]);

  async function connect(source: MangaSourceInfo) {
    setConnecting(true);
    const ok = await mangaApi().connect(source.id).catch(() => false);
    setConnecting(false);
    if (ok) setAttempt((n) => n + 1);
  }

  const isNew = (entry: UpdateEntry) => (newChapterCount(entry.latest, entry.lastRead) ?? 0) > 0;
  const fresh = entries.filter(isNew).length;
  const shown = filter === "new" ? entries.filter(isNew) : entries;
  const needsConnect = sources.filter((source) => blocked.includes(source.id));
  const now = Date.now();

  return (
    <div className="mx-auto max-w-4xl px-8 pb-16 pt-8">
      <PageHeader scene="dusk-line" icon={Sparkles} title="Updates" subtitle="Newest chapters for manga in your list and reading history">
        {loading ? (
          <span className="chip h-8 text-[13px]">
            <Loader2 size={14} className="animate-spin text-accent" /> Checking sources…
          </span>
        ) : (
          <button onClick={() => setAttempt((n) => n + 1)} className="btn btn-secondary btn-sm" title="Check again">
            <RefreshCw size={14} /> Check again
          </button>
        )}
      </PageHeader>

      {entries.length > 0 && (
        <div className="mb-6 inline-flex gap-1 rounded-2xl border border-white/[0.07] bg-surface-1/70 p-1">
          {([["all", "All", entries.length], ["new", "New chapters", fresh]] as const).map(([key, label, count]) => {
            const on = filter === key;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`relative flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors ${on ? "text-white" : "text-ink-3 hover:text-white"}`}
              >
                {on && (
                  <motion.span
                    layoutId="updates-filter"
                    className="absolute inset-0 rounded-xl bg-accent-gradient shadow-glow"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
                <span className="relative">{label}</span>
                <span className={`relative rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums ${on ? "bg-white/25 text-white" : "bg-white/[0.08] text-ink-2"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {needsConnect.map((source) => (
        <div key={source.id} className="panel mb-4 flex items-center gap-4 p-4 text-sm text-ink-2">
          <span className="icon-tile">
            <Link2 size={17} />
          </span>
          <span className="flex-1">{source.web?.description ?? `${source.label} needs a one-time check before AniTrack can check it for updates.`}</span>
          {source.web?.state === "native-required" ? <a href={source.web.website} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Open {source.label}</a> : <button
            onClick={() => void connect(source)}
            disabled={connecting}
            className="btn btn-primary btn-sm"
            title={`Opens ${source.label} so you can complete its one-time check`}
          >
            <Link2 size={13} /> {connecting ? "Waiting for the check…" : `Connect ${source.label}`}
          </button>}
        </div>
      ))}

      {!loading && empty && (
        <EmptyState icon={Inbox} title="Nothing to track yet" className="mb-4">
          Add manga to your list or start reading one, and its new chapters show up here.
        </EmptyState>
      )}
      {!loading && !empty && !entries.length && !needsConnect.length && (
        <EmptyState
          icon={CloudOff}
          title="No updates found"
          className="mb-4"
          action={
            <button onClick={() => setAttempt((n) => n + 1)} className="btn btn-secondary">
              <RefreshCw size={15} /> Try again
            </button>
          }
        >
          The reading sources didn't answer for these titles. Try again in a moment.
        </EmptyState>
      )}
      {!loading && filter === "new" && !shown.length && entries.length > 0 && (
        <EmptyState icon={BookOpenCheck} title="You're all caught up" className="mb-4">
          No new chapters since the ones you last read.
        </EmptyState>
      )}
      {loading && !entries.length && !empty && (
        <div className="space-y-2.5">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-[96px] rounded-2xl" />)}</div>
      )}

      <div className="space-y-2.5">
        {shown.map((entry) => {
          const count = newChapterCount(entry.latest, entry.lastRead) ?? 0;
          return (
            <Link
              key={entry.mangaId}
              to={`/manga/${entry.mangaId}`}
              className={`group flex items-center gap-4 rounded-2xl border p-3 pr-4 transition hover:-translate-y-0.5 hover:bg-surface-2/80 hover:shadow-glow ${
                count > 0 ? "border-accent/35 bg-accent/[0.06]" : "border-white/[0.06] bg-surface-1/70"
              }`}
            >
              {entry.cover ? (
                <img src={entry.cover} alt="" loading="lazy" decoding="async" className="h-[72px] w-[52px] flex-shrink-0 rounded-xl object-cover ring-1 ring-white/10" />
              ) : (
                <div className="h-[72px] w-[52px] flex-shrink-0 rounded-xl bg-white/5" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-white/90 group-hover:text-white">{entry.title}</div>
                <div className="mt-0.5 text-xs text-ink-2">
                  {[entry.latest != null ? `Ch. ${chapterLabel(entry.latest)}` : null, entry.latestAt ? uploadedLabel(entry.latestAt, now) : null, entry.source]
                    .filter(Boolean).join(" · ")}
                </div>
                {entry.lastRead != null && <div className="mt-0.5 text-[11px] text-ink-3">You're on Ch. {chapterLabel(entry.lastRead)}</div>}
              </div>
              {count > 0 && <span className="badge badge-accent px-2 text-[11px]">{count === 1 ? "1 NEW" : `${count} NEW`}</span>}
              <ChevronRight size={18} className="flex-shrink-0 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-accent" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
