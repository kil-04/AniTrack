import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, BookOpen, ChevronDown, HardDriveDownload, Loader2, RotateCcw, Trash2 } from "lucide-react";
import {
  chapterLabel,
  humanSize,
  isFinished,
  normalizeChapters,
  progressFor,
  resumeTarget,
  withUpload,
  type MangaDownload,
  type MangaMeta,
  type ReadState,
} from "../../../../../packages/shared/manga";
import { mangaApi } from "../../lib/manga-api";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import { followMangaDownloads, useMangaDownloads } from "../../store/useMangaDownloads";
import { useMangaReader } from "../../store/useMangaReader";

/** Enough of the title to read its downloads offline (AniList may be out of reach). */
const offlineManga = (item: MangaDownload): MangaMeta => ({
  id: item.mangaId, malId: null, title: item.mangaTitle, titleRomaji: null, cover: item.cover, banner: null,
  chapters: null, volumes: null, status: null, format: null, year: null, score: null, synopsis: null,
  genres: [], popularity: null, country: item.country, synonyms: [],
});

const sourceTitleOf = (item: MangaDownload) => ({ sourceId: item.sourceId, id: item.sourceTitleId, title: item.sourceTitle });

/** Manga mode's Downloads: chapters saved for offline reading, grouped by title. */
export default function MangaDownloads() {
  const navigate = useNavigate();
  const items = useMangaDownloads((s) => s.items);
  const loaded = useMangaDownloads((s) => s.loaded);
  const [toggled, setToggled] = useState<Map<number, boolean>>(new Map());
  // Progress for the titles listed (keyed by them), so Continue/Read never shows from a stale or empty load.
  const [progress, setProgress] = useState<{ ids: string; byTitle: Map<number, Record<string, ReadState>> } | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  useEffect(() => followMangaDownloads(), []);

  const groups = useMemo(() => {
    const byTitle = new Map<number, MangaDownload[]>();
    for (const item of items) byTitle.set(item.mangaId, [...(byTitle.get(item.mangaId) ?? []), item]);
    return [...byTitle.values()].map((list) => [...list].sort((a, b) => a.chapter.number - b.chapter.number));
  }, [items]);
  const done = items.filter((item) => item.status === "done");
  const totalSize = done.reduce((sum, item) => sum + item.sizeBytes, 0);

  // Reading progress per title, for each title's Continue button.
  const titleIds = useMemo(() => [...new Set(items.map((item) => item.mangaId))].join(","), [items]);
  useEffect(() => {
    let alive = true;
    const ids = titleIds ? titleIds.split(",").map(Number) : [];
    Promise.all(ids.map(async (id) => [id, await mangaApi().reading(id).catch((): Record<string, ReadState> => ({}))] as const))
      .then((entries) => { if (alive) setProgress({ ids: titleIds, byTitle: new Map(entries) }); });
    return () => { alive = false; };
  }, [titleIds]);

  /** The downloaded chapter to continue with: the one read last (or the next once finished), among the downloads. */
  function resumeOf(group: MangaDownload[]): { item: MangaDownload; started: boolean } | null {
    if (progress?.ids !== titleIds) return null;
    const saved = group.filter((item) => item.status === "done");
    const chapters = normalizeChapters(saved.map((item) => item.chapter));
    const own = progressFor(chapters, progress.byTitle.get(group[0].mangaId) ?? {});
    const target = resumeTarget(chapters, own);
    const item = saved.find((d) => d.chapter.id === target?.id) ?? saved[0];
    return item ? { item, started: Object.keys(own).length > 0 } : null;
  }

  async function removeAll(group: MangaDownload[]) {
    setConfirming(null);
    for (const item of group) await mangaApi().removeDownload(item.key).catch(() => {});
  }

  async function read(item: MangaDownload) {
    // Offline reading moves between this title's downloaded chapters, one per number:
    // where two groups' uploads of a chapter are saved, the opened chapter's group wins.
    const downloaded = items.filter((d) => d.mangaId === item.mangaId && d.status === "done").map((d) => d.chapter);
    const chapters = withUpload(normalizeChapters(downloaded, item.chapter.group), item.chapter);
    const progress = await mangaApi().reading(item.mangaId).catch((): Record<string, ReadState> => ({}));
    const state = progress[String(item.chapter.number)];
    useMangaReader.getState().open({
      manga: offlineManga(item),
      title: sourceTitleOf(item),
      chapters,
      index: Math.max(0, chapters.findIndex((c) => c.id === item.chapter.id)),
      startPage: state && !isFinished(state) ? state.page : 0,
      back: "/manga/downloads",
    });
    navigate("/manga/read");
  }

  function retry(item: MangaDownload) {
    void mangaApi().download(
      { id: item.mangaId, title: item.mangaTitle, cover: item.cover, country: item.country },
      sourceTitleOf(item),
      item.chapter,
    ).catch(() => {});
  }

  return (
    <div className="mx-auto max-w-4xl px-8 pb-16 pt-8">
      <PageHeader scene="bedroom"
        icon={HardDriveDownload}
        title="Downloads"
        subtitle={
          done.length
            ? [`${done.length} chapter${done.length === 1 ? "" : "s"}`, humanSize(totalSize), "available offline"].filter(Boolean).join(" · ")
            : "Read downloaded chapters offline, in the app"
        }
      />

      {!loaded && (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton h-[98px] rounded-2xl" />)}</div>
      )}

      {loaded && !items.length && (
        <EmptyState icon={HardDriveDownload} title="No downloads yet">
          Use the download button on a chapter, or Download range on a title's page to save several.
        </EmptyState>
      )}

      <div className="flex flex-col gap-3">
        {groups.map((group) => {
          const head = group[0];
          const finished = group.filter((item) => item.status === "done");
          const active = group.filter((item) => item.status === "queued" || item.status === "downloading").length;
          const open = toggled.get(head.mangaId) ?? (groups.length === 1 || active > 0);
          const resume = resumeOf(group);
          const summary = [
            `${finished.length} chapter${finished.length === 1 ? "" : "s"}`,
            humanSize(finished.reduce((sum, item) => sum + item.sizeBytes, 0)),
            active ? `${active} in queue` : "",
          ].filter(Boolean).join(" · ");
          return (
            <section key={head.mangaId} className="panel overflow-hidden">
              <div
                onClick={() => setToggled((map) => new Map(map).set(head.mangaId, !open))}
                className="flex cursor-pointer items-center gap-4 p-3 pr-4 transition hover:bg-white/[0.03]"
              >
                <button onClick={(event) => { event.stopPropagation(); navigate(`/manga/${head.mangaId}`); }} className="shrink-0 rounded-xl" title="Open the title's page">
                  {head.cover ? <img src={head.cover} alt="" className="h-[72px] w-[52px] rounded-xl object-cover ring-1 ring-white/10 transition hover:ring-accent/60" loading="lazy" decoding="async" /> : <div className="h-[72px] w-[52px] rounded-xl bg-white/5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <button
                    onClick={(event) => { event.stopPropagation(); navigate(`/manga/${head.mangaId}`); }}
                    className="block max-w-full truncate text-left text-[15px] font-semibold text-white transition hover:text-accent"
                  >
                    {head.mangaTitle}
                  </button>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
                    {active > 0 && <Loader2 size={11} className="animate-spin text-accent" />}
                    {summary}
                  </div>
                </div>
                {active > 0 && (
                  <button
                    onClick={(event) => { event.stopPropagation(); void mangaApi().cancelDownloads(head.mangaId).catch(() => {}); }}
                    className="btn btn-danger btn-sm"
                  >
                    Cancel {active}
                  </button>
                )}
                {resume && (
                  <button
                    onClick={(event) => { event.stopPropagation(); void read(resume.item); }}
                    className="btn btn-primary btn-sm flex-shrink-0"
                    title="Opens the chapter you're on (or the next one), offline"
                  >
                    <BookOpen size={13} /> {resume.started ? "Continue" : "Read"} · Ch {chapterLabel(resume.item.chapter.number)}
                  </button>
                )}
                {confirming === head.mangaId ? (
                  <span onClick={(event) => event.stopPropagation()} className="flex flex-shrink-0 items-center gap-1 text-xs">
                    <span className="mr-1 text-ink-2">Delete {group.length} chapter{group.length === 1 ? "" : "s"}?</span>
                    <button onClick={() => void removeAll(group)} className="btn btn-danger btn-sm">Delete</button>
                    <button onClick={() => setConfirming(null)} className="btn btn-ghost btn-sm">Keep</button>
                  </span>
                ) : (
                  <button
                    onClick={(event) => { event.stopPropagation(); setConfirming(head.mangaId); }}
                    className="btn btn-ghost btn-sm w-8 flex-shrink-0 px-0 hover:bg-red-500/10 hover:text-red-300"
                    title="Delete this title's downloads"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-3 transition ${open ? "bg-white/[0.07] text-white" : ""}`}>
                  <ChevronDown size={18} className={`transition-transform ${open ? "rotate-180" : ""}`} />
                </span>
              </div>

              {open && (
                <div className="flex flex-col gap-1 border-t border-white/[0.06] p-2">
                  {group.map((item) => (
                    <div key={item.key} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/[0.03]">
                      <span className="grid h-10 min-w-[2.5rem] shrink-0 place-items-center rounded-xl bg-white/[0.05] px-1.5 text-xs font-bold tabular-nums text-ink-2 ring-1 ring-inset ring-white/[0.06]">
                        {chapterLabel(item.chapter.number)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white">
                          Ch. {chapterLabel(item.chapter.number)}{item.chapter.title ? ` · ${item.chapter.title}` : ""}
                        </div>
                        <div className={`truncate text-xs ${item.status === "failed" ? "text-red-300/80" : "text-ink-3"}`}>
                          {item.status === "done" && [item.chapter.group, item.total ? `${item.total} pages` : null, humanSize(item.sizeBytes) || null].filter(Boolean).join(" · ")}
                          {item.status === "downloading" && `Downloading ${item.done}/${item.total}`}
                          {item.status === "queued" && "Queued"}
                          {item.status === "failed" && (item.error ?? "Download failed.")}
                        </div>
                        {item.status === "downloading" && (
                          <div className="mt-1.5 h-1 max-w-[260px] overflow-hidden rounded-full bg-white/[0.08]">
                            <div className="h-full rounded-full bg-accent-gradient transition-all" style={{ width: `${item.total ? Math.round((item.done / item.total) * 100) : 0}%` }} />
                          </div>
                        )}
                      </div>

                      {item.status === "queued" && <Loader2 size={14} className="animate-spin text-ink-3" />}
                      {item.status === "failed" && (
                        <>
                          <AlertCircle size={16} className="text-red-300" />
                          <button
                            onClick={() => retry(item)}
                            className="btn btn-secondary btn-sm"
                          >
                            <RotateCcw size={12} /> Retry
                          </button>
                        </>
                      )}
                      {item.status === "done" && (
                        <button
                          onClick={() => void read(item)}
                          className="btn btn-primary btn-sm"
                        >
                          <BookOpen size={13} /> Read
                        </button>
                      )}
                      <button
                        onClick={() => void mangaApi().removeDownload(item.key).catch(() => {})}
                        className="btn btn-ghost btn-sm w-8 px-0 hover:bg-red-500/10 hover:text-red-300"
                        title="Delete download"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
