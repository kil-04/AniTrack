import { Link } from "react-router-dom";
import { HardDriveDownload, Loader2, Search, Square, Trash2, TriangleAlert } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import { novelSourceLabel } from "../../../../../packages/shared/novel";
import { NovelCover } from "../../components/novel/NovelCards";
import { useNovelDownloads } from "../../hooks/useNovelDownloads";
import { humanBytes, novelApi, novelTitlePath } from "../../lib/novel-api";

/** Novels saved to read offline, with live progress for the ones still downloading. */
export default function NovelDownloads() {
  const titles = useNovelDownloads();
  const total = (titles ?? []).reduce((sum, t) => sum + t.sizeBytes, 0);
  const chapters = (titles ?? []).reduce((sum, t) => sum + t.saved, 0);

  return (
    <div className="mx-auto max-w-[1280px] px-8 pb-16 pt-8">
      <PageHeader
        icon={HardDriveDownload}
        title="Novel Downloads"
        subtitle={titles?.length ? `${chapters.toLocaleString()} chapters offline · ${humanBytes(total)}` : "Chapters you save read without a connection"}
      />
      {titles === null ? (
        <div className="space-y-3">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}</div>
      ) : !titles.length ? (
        <EmptyState
          icon={HardDriveDownload}
          title="Nothing saved yet"
          action={<Link to="/novels/search" className="btn btn-primary"><Search size={16} /> Find a novel</Link>}
        >
          Use Download on a novel's page to save its next chapters, a range, or everything.
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {titles.map((t) => {
            const busy = t.queued > 0;
            const done = t.saved / Math.max(1, t.saved + t.queued);
            return (
              <div key={`${t.sourceId}:${t.titleId}`} className="panel flex items-center gap-5 p-4">
                <Link to={novelTitlePath(t.sourceId, t.titleId)} className="h-24 w-16 flex-shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10">
                  <NovelCover cover={t.cover} title={t.title} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link to={novelTitlePath(t.sourceId, t.titleId)} className="line-clamp-1 text-[15px] font-bold text-white hover:underline">{t.title}</Link>
                  <div className="mt-0.5 text-xs text-ink-3">
                    {novelSourceLabel(t.sourceId)} · {t.saved.toLocaleString()} chapters · {humanBytes(t.sizeBytes)}
                    {t.failed > 0 && <span className="text-amber-300/90"> · {t.failed} failed</span>}
                  </div>
                  {busy && (
                    <div className="mt-3">
                      <div className="mb-1 flex items-center gap-2 text-xs text-ink-2">
                        <Loader2 size={12} className="animate-spin text-accent" />
                        <span className="truncate">{t.current ? `Saving ${t.current}` : "Waiting…"} · {t.queued.toLocaleString()} left</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-accent-gradient transition-[width] duration-500" style={{ width: `${Math.round(done * 100)}%` }} />
                      </div>
                    </div>
                  )}
                  {!busy && t.error && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-200/90"><TriangleAlert size={12} /> {t.error}</div>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {busy && (
                    <button onClick={() => void novelApi().cancelDownloads(t.sourceId, t.titleId)} className="btn btn-secondary btn-sm">
                      <Square size={12} /> Stop
                    </button>
                  )}
                  <button
                    onClick={() => { if (window.confirm(`Remove the ${t.saved.toLocaleString()} saved chapters of "${t.title}"?`)) void novelApi().removeDownloads(t.sourceId, t.titleId); }}
                    className="btn btn-ghost btn-sm text-red-300 hover:text-red-200"
                    title="Remove these downloads"
                  >
                    <Trash2 size={14} /> Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
