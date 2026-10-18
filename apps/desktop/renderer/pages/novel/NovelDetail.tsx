import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowDownUp, ArrowLeft, BookOpen, Bookmark, Check, CheckCheck, ChevronDown, ExternalLink, Link2, Link2Off, ListOrdered, Loader2,
  RefreshCw, Search, Star, TriangleAlert, X,
} from "lucide-react";
import {
  chapterKey,
  isChapterFinished,
  isNovelSource,
  NOVEL_SOURCES,
  NOVEL_STATUS_LABELS,
  NOVEL_STATUSES,
  novelResumeTarget,
  novelSourceLabel,
  progressFor,
  type NovelCard as Card,
  type NovelChapter,
  type NovelDetail as Detail,
  type NovelGroup,
  type NovelProgressMap,
  type NovelSourceId,
  type NovelStatus,
} from "../../../../../packages/shared/novel";
import EmptyState from "../../components/EmptyState";
import { NovelCover } from "../../components/novel/NovelCards";
import { ChapterSaveMark, NovelDownloadButton } from "../../components/novel/NovelDownloadUi";
import { useNovelTitleDownloads } from "../../hooks/useNovelDownloads";
import { novelApi, novelReaderPath, novelTitlePath, unwrap } from "../../lib/novel-api";
import { novelReadingChanged, novelRemoved, onNovelSync, syncNovelReading } from "../../lib/novel-sync";

const PAGE = 100;

type Chapters = { state: "loading" } | { state: "failed"; text: string } | { state: "ready"; list: NovelChapter[]; stale?: boolean };
type Finding = { source: NovelSourceId; state: "searching" } | { source: NovelSourceId; state: "pick"; items: Card[] } | { source: NovelSourceId; state: "none" | "error"; text: string };

export default function NovelDetail() {
  const params = useParams();
  const navigate = useNavigate();
  const sourceId = isNovelSource(params.source) ? params.source : null;
  const titleId = params.id ?? "";

  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapters>({ state: "loading" });
  const [progress, setProgress] = useState<NovelProgressMap>({});
  const [group, setGroup] = useState<NovelGroup | null>(null);
  const [status, setStatus] = useState<NovelStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [newestFirst, setNewestFirst] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [attempt, setAttempt] = useState(0);
  const [finding, setFinding] = useState<Finding | null>(null);
  const downloads = useNovelTitleDownloads(sourceId, titleId);

  useEffect(() => {
    if (!sourceId) return;
    let alive = true;
    setDetailError(null);
    setChapters({ state: "loading" });
    setFinding(null);
    setLimit(PAGE);
    // The saved copy paints at once (and offline); fresh answers replace it.
    void novelApi().savedTitle(sourceId, titleId).then((saved) => {
      if (!alive || !saved) return;
      setDetail((d) => (d && d.id === titleId ? d : saved.detail));
      if (saved.chapters.length) setChapters((c) => (c.state === "ready" ? c : { state: "ready", list: saved.chapters, stale: true }));
    });
    unwrap(novelApi().title(sourceId, titleId))
      .then((value) => {
        if (!alive) return;
        setDetail(value);
        // Fetching the details may have linked this copy to one already known (shared with other devices).
        void novelApi().group(sourceId, titleId).then((g) => {
          if (!alive) return;
          setGroup((before) => {
            if (before && g.members.length !== before.members.length) novelReadingChanged();
            return g;
          });
        });
        void novelApi().reading(sourceId, titleId).then((p) => { if (alive) setProgress(p); });
      })
      .catch((error: Error) => { if (alive) setDetailError(error.message); });
    unwrap(novelApi().chapters(sourceId, titleId))
      .then((list) => { if (alive) setChapters({ state: "ready", list }); })
      .catch((error: Error) => { if (alive) setChapters((c) => (c.state === "ready" ? { ...c, stale: true } : { state: "failed", text: error.message })); });
    const loadProgress = () => { void novelApi().reading(sourceId, titleId).then((p) => { if (alive) setProgress(p); }); };
    loadProgress();
    void novelApi().group(sourceId, titleId).then((g) => { if (alive) setGroup(g); });
    void novelApi().status(sourceId, titleId).then((s) => { if (alive) setStatus(s); });
    window.addEventListener("focus", loadProgress);
    // Progress, links and the list follow other devices.
    const stopSync = onNovelSync(() => {
      loadProgress();
      void novelApi().group(sourceId, titleId).then((g) => { if (alive) setGroup(g); });
      void novelApi().status(sourceId, titleId).then((s) => { if (alive) setStatus(s); });
    });
    void syncNovelReading().catch(() => {});
    return () => { alive = false; stopSync(); window.removeEventListener("focus", loadProgress); };
  }, [sourceId, titleId, attempt]);

  const list = chapters.state === "ready" ? chapters.list : [];
  const resume = useMemo(() => (sourceId ? novelResumeTarget(list, progress, sourceId) : null), [list, progress, sourceId]);
  const started = Object.keys(progress).length > 0;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^(chapter|ch\.?)\s*/, "");
    const matched = q ? list.filter((c) => c.label.toLowerCase().includes(q)) : list;
    return newestFirst ? [...matched].reverse() : matched;
  }, [list, query, newestFirst]);

  if (!sourceId) {
    return (
      <div className="px-8 pt-10">
        <EmptyState icon={TriangleAlert} tone="danger" title="Unknown source">This link doesn't point at a novel source AniTrack knows.</EmptyState>
      </div>
    );
  }

  const open = (chapter: NovelChapter, paragraph = 0, fraction: number | null = null) =>
    navigate(novelReaderPath(sourceId, titleId, chapter.id, paragraph, fraction));

  const mark = async (targets: NovelChapter[], read: boolean) => {
    if (!detail || !targets.length) return;
    await novelApi().markRead(sourceId, titleId, targets.map((c) => ({ id: c.id, order: c.order, label: c.label })), read, detail.title, detail.cover);
    if (read) novelReadingChanged(); else novelRemoved();
    setProgress(await novelApi().reading(sourceId, titleId));
  };

  const save = (targets: NovelChapter[]) => {
    if (!detail || !targets.length) return;
    void novelApi().download(detail, targets.map((c) => ({ id: c.id, order: c.order, label: c.label })));
  };

  /** Shows this novel on another source: its linked copy, or finds (and links) it first. */
  const switchTo = async (target: NovelSourceId) => {
    const member = group?.members.find((m) => m.sourceId === target);
    if (member) { navigate(novelTitlePath(member.sourceId, member.id), { replace: true }); return; }
    setFinding({ source: target, state: "searching" });
    const result = await novelApi().findOn(sourceId, titleId, target);
    if (!result.ok) { setFinding({ source: target, state: "error", text: result.error }); return; }
    const found = result.value;
    if (found.state === "linked") { navigate(novelTitlePath(found.member.sourceId, found.member.id), { replace: true }); return; }
    if (found.state === "candidates") { setFinding({ source: target, state: "pick", items: found.items }); return; }
    setFinding({ source: target, state: "none", text: `${novelSourceLabel(target)} doesn't seem to have this novel.` });
  };

  const linkTo = async (card: Card) => {
    await novelApi().link({ sourceId, id: titleId }, { sourceId: card.sourceId, id: card.id });
    novelReadingChanged();
    navigate(novelTitlePath(card.sourceId, card.id), { replace: true });
  };

  const unlink = async () => {
    await novelApi().unlink(sourceId, titleId);
    novelReadingChanged();
    setGroup(await novelApi().group(sourceId, titleId));
    setProgress(await novelApi().reading(sourceId, titleId));
  };

  if (!detail) {
    return detailError ? (
      <div className="px-8 pt-10">
        <EmptyState
          icon={TriangleAlert}
          tone="danger"
          title={`${novelSourceLabel(sourceId)} didn't answer`}
          action={
            <div className="flex gap-2">
              <button onClick={() => navigate(-1)} className="btn btn-secondary"><ArrowLeft size={16} /> Go back</button>
              <button onClick={() => setAttempt((n) => n + 1)} className="btn btn-primary"><RefreshCw size={16} /> Retry</button>
            </div>
          }
        >
          {detailError}
        </EmptyState>
      </div>
    ) : (
      <div className="pb-16">
        <div className="skeleton h-[40vh] max-h-[420px] min-h-[300px]" />
        <div className="relative -mt-40 flex items-end gap-8 px-8">
          <div className="skeleton h-[300px] w-[204px] rounded-2xl" />
          <div className="flex-1 space-y-3 pb-2">
            <div className="skeleton h-10 w-2/3 rounded-xl" />
            <div className="skeleton h-7 w-1/3 rounded-full" />
            <div className="skeleton h-12 w-64 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  const resumeIndex = resume ? list.findIndex((c) => c.id === resume.chapter.id) : -1;
  const queued = new Set(downloads.state?.queuedIds ?? []);
  const failed = new Set(downloads.state?.failedIds ?? []);
  const saveState = (id: string) =>
    downloads.saved.has(id) ? "saved" as const
      : downloads.state?.currentId === id ? "saving" as const
        : queued.has(id) ? "queued" as const
          : failed.has(id) ? "failed" as const : "none" as const;
  const linked = (group?.members.length ?? 1) > 1;
  const elsewhere = resume && resume.via !== "same" && resume.via !== "start"
    ? Object.values(progress).reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a)).sourceId
    : null;

  return (
    <div className="relative pb-16">
      <div className="relative h-[40vh] max-h-[420px] min-h-[300px] w-full overflow-hidden">
        {detail.cover && <img src={detail.cover} alt="" referrerPolicy="no-referrer" className="h-full w-full scale-125 object-cover object-center opacity-50 blur-2xl" />}
        <div className="absolute inset-0 bg-scrim-b" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_80%_at_18%_100%,rgb(var(--accent)/0.24),transparent_70%)]" />
        <button onClick={() => navigate(-1)} className="btn btn-secondary btn-icon absolute left-6 top-6 h-10 w-10 rounded-full" aria-label="Back">
          <ArrowLeft size={17} />
        </button>
      </div>

      <div className="relative -mt-40 flex flex-col items-start gap-8 px-8 md:flex-row md:items-end">
        <div className="h-[300px] w-[204px] flex-shrink-0 overflow-hidden rounded-2xl shadow-pop ring-1 ring-white/15">
          <NovelCover cover={detail.cover} title={detail.title} />
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight drop-shadow-[0_4px_24px_rgb(0_0_0/0.5)] xl:text-5xl">{detail.title}</h1>
          {(detail.author || detail.altNames.length > 0) && (
            <div className="mt-1.5 text-sm text-ink-2">
              {[detail.author ? `by ${detail.author}` : null, detail.altNames.slice(0, 3).join(" · ") || null].filter(Boolean).join("   ·   ")}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {detail.rating ? (
              <span className="chip border-amber-300/25 bg-amber-300/10 text-amber-200">
                <Star size={12} fill="currentColor" /> {detail.rating.toFixed(1)}
              </span>
            ) : null}
            {detail.status && (
              <span className="chip">
                <span className={`h-1.5 w-1.5 rounded-full ${detail.status === "ongoing" ? "bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153)]" : "bg-white/40"}`} />
                {detail.status === "ongoing" ? "Ongoing" : "Completed"}
              </span>
            )}
            {(list.length || detail.chapters) ? <span className="chip">{(list.length || detail.chapters)!.toLocaleString()} chapters</span> : null}
            {detail.mtl && <span className="chip border-amber-300/25 text-amber-200" title="Machine translation">MTL</span>}
          </div>
          {detail.genres.length > 0 && <div className="mt-3 text-sm font-medium text-ink-2">{detail.genres.join("  ·  ")}</div>}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {resume && (
              <button onClick={() => open(resume.chapter, resume.paragraph, resume.fraction)} className="btn btn-primary btn-lg">
                <BookOpen size={18} /> {started ? "Continue" : "Start reading"} · {resume.chapter.label}
              </button>
            )}
            <label className="relative">
              <Bookmark size={16} className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 ${status ? "fill-accent text-accent" : "text-white/80"}`} />
              <select
                value={status ?? ""}
                onChange={async (event) => {
                  const value = (event.target.value || null) as NovelStatus | null;
                  await novelApi().setStatus(sourceId, titleId, value, detail.title, detail.cover);
                  setStatus(value);
                  if (value) novelReadingChanged(); else novelRemoved();
                }}
                className="btn btn-secondary btn-lg cursor-pointer appearance-none pl-11 pr-10 [&>option]:bg-surface-2"
              >
                <option value="">{status ? "Remove from list" : "Add to list"}</option>
                {NOVEL_STATUSES.map((s) => <option key={s} value={s}>{NOVEL_STATUS_LABELS[s]}</option>)}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/60" />
            </label>
            {list.length > 0 && (
              <NovelDownloadButton
                chapters={list}
                startIndex={Math.max(0, resumeIndex)}
                saved={downloads.saved}
                state={downloads.state}
                onDownload={save}
                onStop={() => void novelApi().cancelDownloads(sourceId, titleId)}
                onRemoveAll={() => void novelApi().removeDownloads(sourceId, titleId)}
              />
            )}
          </div>
          {elsewhere && resume && (
            <p className="mt-3 text-xs text-ink-3">
              {resume.via === "label"
                ? `Picks up where you left off on ${novelSourceLabel(elsewhere)} (matched by chapter name).`
                : `${novelSourceLabel(elsewhere)}'s chapter isn't on ${novelSourceLabel(sourceId)}, so this continues from the next one here.`}
            </p>
          )}
        </div>
      </div>

      {detail.synopsis && (
        <div className="mt-8 max-w-4xl px-8">
          <p className={`whitespace-pre-line text-[15px] leading-relaxed text-ink-2 ${expanded ? "" : "line-clamp-4"}`}>{detail.synopsis}</p>
          {detail.synopsis.length > 320 && (
            <button onClick={() => setExpanded(!expanded)} className="btn btn-ghost btn-sm -ml-3 mt-1">
              {expanded ? "Show less" : "Show more"} <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      )}

      <section className="mt-10 px-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="mr-1 flex items-center gap-3">
            <span className="icon-tile h-8 w-8 rounded-lg"><ListOrdered size={16} strokeWidth={2.2} /></span>
            <h2 className="section-title">Chapters</h2>
          </div>
          {/* Sources: one novel, read from whichever copy works (progress follows by chapter name). */}
          <div className="flex flex-wrap items-center gap-1.5">
            {NOVEL_SOURCES.map((s) => {
              const on = s.id === sourceId;
              const has = on || group?.members.some((m) => m.sourceId === s.id);
              const busy = finding?.source === s.id && finding.state === "searching";
              return (
                <button
                  key={s.id}
                  onClick={() => { if (!on) void switchTo(s.id); }}
                  className={`chip ${on ? "chip-active" : ""}`}
                  title={on ? `Reading from ${s.label}` : has ? `Switch to ${s.label}` : `Find this novel on ${s.label}`}
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : has ? <Link2 size={12} className={on ? "text-accent" : ""} /> : <Search size={12} />}
                  {s.label}
                </button>
              );
            })}
            {linked && (
              <button onClick={() => void unlink()} className="ml-1 flex items-center gap-1 text-[11px] font-semibold text-ink-3 hover:text-white" title="Not the same novel? Keep this copy separate.">
                <Link2Off size={11} /> Unlink
              </button>
            )}
          </div>
          {chapters.state === "ready" && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                <input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE); }} placeholder="Find chapter" className="input h-9 w-40 pl-8 text-xs" />
              </div>
              <button onClick={() => setNewestFirst(!newestFirst)} className="btn btn-secondary btn-sm h-9" title="Change the order">
                <ArrowDownUp size={13} /> {newestFirst ? "Newest first" : "Oldest first"}
              </button>
            </div>
          )}
        </div>

        {finding && finding.state !== "searching" && (
          <div className="panel mb-4 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <Search size={14} className="text-accent" />
              {finding.state === "pick" ? `Which of these is "${detail.title}" on ${novelSourceLabel(finding.source)}?` : finding.text}
              <button onClick={() => setFinding(null)} className="ml-auto rounded-md p-1 text-ink-3 hover:text-white" aria-label="Close"><X size={14} /></button>
            </div>
            {finding.state === "pick" && (
              <>
                <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
                  {finding.items.map((c) => (
                    <button key={c.id} onClick={() => void linkTo(c)} className="flex w-64 flex-shrink-0 items-center gap-3 rounded-xl bg-white/[0.04] p-2 text-left transition hover:bg-white/[0.08]">
                      <div className="h-16 w-11 flex-shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10"><NovelCover cover={c.cover} title="" /></div>
                      <div className="min-w-0">
                        <div className="line-clamp-2 text-sm font-semibold leading-tight">{c.title}</div>
                        <div className="mt-0.5 text-[11px] text-ink-3">{[c.chapters ? `${c.chapters.toLocaleString()} ch` : null, c.status].filter(Boolean).join(" · ")}</div>
                      </div>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-ink-3">Picking one links it to this novel: your progress carries over by chapter name.</p>
              </>
            )}
          </div>
        )}

        {chapters.state === "loading" && (
          <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>
        )}
        {chapters.state === "failed" && (
          <div className="panel flex items-center gap-4 p-4 text-sm text-ink-2">
            <span className="icon-tile bg-amber-400/10 text-amber-300 ring-amber-300/20"><TriangleAlert size={17} /></span>
            <span className="flex-1">{chapters.text} {NOVEL_SOURCES.length > 1 ? "You can try the other source above." : ""}</span>
            <button onClick={() => setAttempt((n) => n + 1)} className="btn btn-secondary btn-sm"><RefreshCw size={13} /> Retry</button>
          </div>
        )}
        {chapters.state === "ready" && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-3 text-xs text-ink-3">
              <span>{list.length.toLocaleString()} chapters on {novelSourceLabel(sourceId)}</span>
              {downloads.saved.size > 0 && <span className="text-emerald-300/80">{downloads.saved.size.toLocaleString()} saved offline</span>}
              {chapters.stale && (
                <span className="flex items-center gap-2 text-amber-300/80">
                  Showing the list saved last time.
                  <button onClick={() => setAttempt((n) => n + 1)} className="font-semibold text-white/70 hover:text-white hover:underline">Refresh</button>
                </span>
              )}
            </div>
            {list.length === 0 ? (
              <div className="panel p-5 text-sm text-ink-3">This source lists no chapters for this title. Try the other source above.</div>
            ) : (
              <div className="panel grid grid-cols-1 gap-0.5 p-1.5 xl:grid-cols-2">
                {rows.slice(0, limit).map((chapter) => {
                  const state = progressFor(progress, chapter);
                  const done = state ? isChapterFinished(state) : false;
                  const current = !!state && !done;
                  const here = current && state.sourceId === sourceId && state.chapterId === chapter.id;
                  return (
                    <div key={chapter.id} className={`group flex items-center gap-3 rounded-xl px-2.5 py-1.5 transition hover:bg-white/[0.04] ${done ? "opacity-55 hover:opacity-90" : ""}`}>
                      <button
                        onClick={() => open(chapter, here ? state.paragraph : 0, current && !here && state.paragraphCount ? state.paragraph / state.paragraphCount : null)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span className={`grid h-8 min-w-[3rem] flex-shrink-0 place-items-center rounded-lg px-2 text-xs font-bold tabular-nums ring-1 ring-inset ${current ? "bg-accent/15 text-white ring-accent/40" : "bg-white/[0.05] text-ink-3 ring-white/[0.06] group-hover:text-white"}`}>
                          {chapter.order + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/85 group-hover:text-white">{chapter.label}</span>
                        {current && state.paragraphCount > 0 && (
                          <span className="flex flex-shrink-0 items-center gap-2 text-[11px] font-semibold text-accent">
                            <span className="h-1 w-12 overflow-hidden rounded-full bg-white/10">
                              <span className="block h-full rounded-full bg-accent-gradient" style={{ width: `${Math.round(((state.paragraph + 1) / state.paragraphCount) * 100)}%` }} />
                            </span>
                            {Math.round(((state.paragraph + 1) / state.paragraphCount) * 100)}%
                          </span>
                        )}
                      </button>
                      <ChapterSaveMark state={saveState(chapter.id)} onSave={() => save([chapter])} />
                      <button
                        onClick={() => mark([chapter], !done)}
                        title={done ? "Mark as unread" : "Mark as read"}
                        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition ${done ? "bg-emerald-400/10 text-emerald-400" : "text-white/25 hover:bg-white/[0.07] hover:text-white"}`}
                      >
                        <Check size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {rows.length > limit && (
                <button onClick={() => setLimit(limit + PAGE * 3)} className="btn btn-secondary">
                  Show more ({(rows.length - limit).toLocaleString()} left)
                </button>
              )}
              {resumeIndex > 0 && (
                <button
                  onClick={() => mark(list.slice(0, resumeIndex).filter((c) => { const s = progress[chapterKey(c.label)]; return !(s && isChapterFinished(s)); }), true)}
                  className="btn btn-ghost btn-sm"
                  title="Marks every chapter before the one you're on as read"
                >
                  <CheckCheck size={14} /> Mark everything before {resume!.chapter.label} read
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
