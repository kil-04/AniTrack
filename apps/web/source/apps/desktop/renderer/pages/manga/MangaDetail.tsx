import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDownUp, ArrowLeft, BookOpen, Bookmark, Check, CheckCheck, ChevronDown, Download, Link2, ListOrdered, RefreshCw, Search, Star, TriangleAlert, Tv } from "lucide-react";
import type { AnimeMeta } from "../../../../../packages/shared/types";
import {
  chapterGroups,
  chapterLabel,
  chapterListing,
  downloadKey,
  heldChapters,
  isFinished,
  MANGA_STATUS_LABELS,
  MANGA_STATUSES,
  mangaKind,
  normalizeChapters,
  publishLabel,
  rangeStartGroup,
  resumeTarget,
  uploadedLabel,
  type DownloadManga,
  type MangaChapter,
  type MangaMeta,
  type MangaSourceInfo,
  type MangaStatus,
  type ReadState,
  type SourceTitle,
} from "../../../../../packages/shared/manga";
import { ChapterDownloadButton, DownloadRangeDialog } from "../../components/manga/MangaDownloadUi";
import EmptyState from "../../components/EmptyState";
import SectionHeader from "../../components/SectionHeader";
import SelectField from "../../components/SelectField";
import { mangaApi, setTitlePref, titlePref } from "../../lib/manga-api";
import { followMangaDownloads, useMangaDownloads } from "../../store/useMangaDownloads";
import { useMangaReader } from "../../store/useMangaReader";
import { mangaReadingChanged, onMangaSync, syncMangaReading, unmarkMangaChapters } from "../../lib/manga-sync";

type Load =
  | { state: "loading" }
  | { state: "message"; text: string }
  | {
      state: "ready";
      source: MangaSourceInfo;
      title: SourceTitle;
      uploads: MangaChapter[];
      /** Set while the list shown is the one saved at this time (epoch ms). */
      saved?: number;
      /** "loading" while a fresh list loads; otherwise why it couldn't. */
      refresh?: "loading" | string;
    };

/** "5m ago", "3h ago", "6d ago", then "Sep 19". */
const ago = (ms: number) => {
  const label = uploadedLabel(ms);
  return /\d[mhd]$/.test(label) ? `${label} ago` : label;
};

const PAGE = 60;

const forDownload = (manga: MangaMeta): DownloadManga => ({ id: manga.id, title: manga.title, cover: manga.cover, country: manga.country });

export default function MangaDetail() {
  const { id } = useParams();
  const mangaId = Number(id);
  const navigate = useNavigate();
  const [manga, setManga] = useState<MangaMeta | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<MangaStatus | null>(null);
  const [adaptations, setAdaptations] = useState<AnimeMeta[]>([]);
  const [expanded, setExpanded] = useState(false);

  const [sources, setSources] = useState<MangaSourceInfo[]>([]);
  const [chosen, setChosen] = useState<string | null>(() => titlePref(mangaId, "source"));
  const [group, setGroup] = useState<string | null>(() => titlePref(mangaId, "group"));
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [needsConnect, setNeedsConnect] = useState<MangaSourceInfo[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState<Record<string, ReadState>>({});
  const [query, setQuery] = useState("");
  const [newestFirst, setNewestFirst] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const downloads = useMangaDownloads((s) => s.items);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => followMangaDownloads(), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    let alive = true;
    setManga(null);
    setFailed(false);
    mangaApi().get(mangaId).then((m) => { if (!alive) return; if (m) setManga(m); else setFailed(true); }).catch(() => { if (alive) setFailed(true); });
    mangaApi().status(mangaId).then((s) => { if (alive) setStatus(s); }).catch(() => {});
    mangaApi().adaptations(mangaId).then((list) => { if (alive) setAdaptations(list); }).catch(() => {});
    mangaApi().reading(mangaId).then((p) => { if (alive) setProgress(p); }).catch(() => {});
    mangaApi().sources().then((list) => { if (alive) setSources(list); }).catch(() => {});
    // Positions read on another device arrive with the next reconcile.
    const stop = onMangaSync(() => {
      mangaApi().reading(mangaId).then((p) => { if (alive) setProgress(p); }).catch(() => {});
    });
    void syncMangaReading().catch(() => {});
    return () => { alive = false; stop(); };
  }, [mangaId]);

  // Chapters: the chosen source only, or the first source that has the title.
  useEffect(() => {
    if (!manga || !sources.length) return;
    let alive = true;
    setLoad({ state: "loading" });
    setLimit(PAGE);
    (async () => {
      const order = chosen ? sources.filter((s) => s.id === chosen) : sources;
      const needing: MangaSourceInfo[] = [];
      let lastError: string | null = null;
      // A list saved by the last visit paints at once while the fresh one loads,
      // and stays (saying so) when no source answers, e.g. offline.
      let shown: { source: MangaSourceInfo; title: SourceTitle; at: number; list: MangaChapter[] } | null = null;
      for (const source of order) {
        const found = await mangaApi().find(source.id, manga.id);
        if (!found.ok) {
          if (found.verify) needing.push(source);
          lastError = found.error;
          continue;
        }
        if (!found.value) continue;
        if (!shown) {
          const saved = await mangaApi().savedChapters(found.value).catch(() => null);
          if (saved && alive) {
            shown = { source, title: found.value, at: saved.at, list: saved.list };
            setLoad({ state: "ready", source, title: found.value, uploads: saved.list, saved: saved.at, refresh: "loading" });
          }
        }
        const chapters = await mangaApi().chapters(found.value);
        if (!chapters.ok) {
          if (chapters.verify) needing.push(source);
          lastError = chapters.error;
          continue;
        }
        if (chapters.value.length) {
          if (!alive) return;
          setNeedsConnect(needing);
          setLoad({ state: "ready", source, title: found.value, uploads: chapters.value });
          return;
        }
      }
      if (!alive) return;
      setNeedsConnect(needing);
      if (shown) {
        setLoad({
          state: "ready", source: shown.source, title: shown.title, uploads: shown.list, saved: shown.at,
          refresh: lastError ?? "No source answered.",
        });
        return;
      }
      const only = order.length === 1 ? order[0] : null;
      setLoad({
        state: "message",
        text: lastError ?? (only && sources.length > 1 ? `${only.label} doesn't have this title. Try another source.` : "No chapters found for this title on the reading sources."),
      });
    })().catch(() => { if (alive) setLoad({ state: "message", text: "Couldn't load chapters. Try again." }); });
    return () => { alive = false; };
  }, [manga, sources, chosen, attempt]);

  const ready = load.state === "ready" ? load : null;
  const groups = useMemo(() => (ready ? chapterGroups(ready.uploads) : []), [ready]);
  const activeGroup = group && groups.some(([g]) => g === group) ? group : null;
  const rows = useMemo(() => (ready ? chapterListing(ready.uploads, activeGroup, query, newestFirst) : []), [ready, activeGroup, query, newestFirst]);
  const reading = useMemo(() => (ready ? normalizeChapters(ready.uploads, activeGroup) : []), [ready, activeGroup]);
  const next = useMemo(() => resumeTarget(reading, progress), [reading, progress]);
  const started = Object.keys(progress).length > 0;
  const saved = useMemo(() => new Map(downloads.filter((d) => d.mangaId === mangaId).map((d) => [d.key, d])), [downloads, mangaId]);
  const held = useMemo(() => heldChapters(downloads, mangaId), [downloads, mangaId]);
  const offline = useMemo(() => [...saved.values()].filter((d) => d.status === "done").length, [saved]);

  function open(chapter: MangaChapter) {
    if (!ready || !manga) return;
    const list = reading.map((c) => (c.number === chapter.number ? chapter : c));
    const index = list.findIndex((c) => c.id === chapter.id);
    const state = progress[String(chapter.number)];
    useMangaReader.getState().open({
      manga,
      title: ready.title,
      chapters: list,
      index: Math.max(0, index),
      startPage: state && !isFinished(state) ? state.page : 0,
    });
    navigate("/manga/read");
  }

  async function mark(chapters: MangaChapter[], read: boolean) {
    if (!ready || !manga) return;
    await mangaApi().markRead(
      manga.id,
      chapters.map((c) => ({ number: c.number, id: c.id, pageCount: c.pageCount ?? 1 })),
      read,
      manga.title,
      manga.cover,
      ready.source.id,
    );
    if (read) mangaReadingChanged();
    else unmarkMangaChapters(manga.id, chapters.map((c) => c.number));
    setProgress(await mangaApi().reading(manga.id));
  }

  function download(chapter: MangaChapter) {
    if (!ready || !manga) return;
    mangaApi().download(forDownload(manga), ready.title, chapter).catch(() => setNotice("Couldn't start that download. Try again."));
  }

  async function downloadRange(chapters: MangaChapter[]) {
    setRangeOpen(false);
    if (!ready || !manga) return;
    const added = await mangaApi().downloadRange(forDownload(manga), ready.title, chapters).catch(() => -1);
    setNotice(
      added < 0 ? "Couldn't start those downloads. Try again."
        : added === 0 ? "Those chapters are already downloaded or queued."
          : `Downloading ${added} chapter${added === 1 ? "" : "s"}. Progress is in Downloads.`,
    );
  }

  async function connect(source: MangaSourceInfo) {
    setConnecting(true);
    const ok = await mangaApi().connect(source.id).catch(() => false);
    setConnecting(false);
    if (ok) setAttempt((n) => n + 1);
  }

  if (!manga) {
    return failed ? (
      <div className="px-8 py-16">
        <EmptyState
          icon={TriangleAlert}
          tone="danger"
          title="Couldn't load this title"
          action={<button onClick={() => navigate(-1)} className="btn btn-secondary"><ArrowLeft size={16} /> Go back</button>}
        >
          AniList didn't answer. Check your connection and try again.
        </EmptyState>
      </div>
    ) : (
      <div className="pb-16">
        <div className="skeleton h-[46vh] max-h-[480px] min-h-[320px]" />
        <div className="relative -mt-44 flex items-end gap-8 px-8">
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

  const releasing = manga.status === "RELEASING";

  return (
    <div className="relative pb-16">
      {/* Banner (a blurred cover when the title has none) */}
      <div className="relative h-[46vh] max-h-[480px] min-h-[320px] w-full overflow-hidden">
        {(manga.banner || manga.cover) && (
          <img
            src={manga.banner ?? manga.cover!}
            alt=""
            className={`h-full w-full object-cover object-center ${manga.banner ? "scale-105" : "scale-125 opacity-60 blur-2xl"}`}
          />
        )}
        <div className="absolute inset-0 bg-scrim-b" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_80%_at_18%_100%,rgb(var(--accent)/0.22),transparent_70%)]" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-bg/70 to-transparent" />
        <button onClick={() => navigate(-1)} className="btn btn-secondary btn-icon absolute left-6 top-6 h-10 w-10 rounded-full" aria-label="Back">
          <ArrowLeft size={17} />
        </button>
      </div>

      {/* Cover + info */}
      <div className="relative -mt-44 flex flex-col items-start gap-8 px-8 md:flex-row md:items-end">
        {manga.cover && <img src={manga.cover} alt="" className="h-[300px] w-[204px] flex-shrink-0 rounded-2xl object-cover shadow-pop ring-1 ring-white/15" />}
        <div className="min-w-0 flex-1 pb-1">
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight drop-shadow-[0_4px_24px_rgb(0_0_0/0.5)] xl:text-5xl">{manga.title}</h1>
          {manga.titleRomaji && manga.titleRomaji !== manga.title && <div className="mt-1.5 text-sm text-ink-2">{manga.titleRomaji}</div>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {manga.score ? (
              <span className="chip border-amber-300/25 bg-amber-300/10 text-amber-200">
                <Star size={12} fill="currentColor" /> {(manga.score / 10).toFixed(1)}
              </span>
            ) : null}
            {[mangaKind(manga), manga.year].filter(Boolean).map((label) => <span key={String(label)} className="chip">{label}</span>)}
            {manga.status && (
              <span className="chip">
                <span className={`h-1.5 w-1.5 rounded-full ${releasing ? "bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153)]" : "bg-white/40"}`} />
                {publishLabel(manga.status)}
              </span>
            )}
            {manga.chapters ? <span className="chip">{manga.chapters} chapters</span> : null}
            {manga.volumes ? <span className="chip">{manga.volumes} volumes</span> : null}
          </div>
          {manga.genres.length > 0 && <div className="mt-3 text-sm font-medium text-ink-2">{manga.genres.join("  ·  ")}</div>}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {next && (
              <button onClick={() => open(next)} className="btn btn-primary btn-lg">
                <BookOpen size={18} /> {started ? "Continue" : "Start reading"} · Ch {chapterLabel(next.number)}
              </button>
            )}
            <label className="relative">
              <Bookmark size={16} className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 ${status ? "fill-accent text-accent" : "text-white/80"}`} />
              <select
                value={status ?? ""}
                onChange={async (event) => {
                  const value = (event.target.value || null) as MangaStatus | null;
                  await mangaApi().setStatus(manga.id, value, manga.title, manga.cover);
                  setStatus(value);
                }}
                className="btn btn-secondary btn-lg cursor-pointer appearance-none pl-11 pr-10 [&>option]:bg-surface-2"
              >
                <option value="">{status ? "Remove from list" : "Add to list"}</option>
                {MANGA_STATUSES.map((s) => <option key={s} value={s}>{MANGA_STATUS_LABELS[s]}</option>)}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/60" />
            </label>
            {ready && ready.source.web?.downloads !== false && (
              <button onClick={() => setRangeOpen(true)} className="btn btn-secondary btn-lg" title="Save several chapters to read offline">
                <Download size={17} /> Download range
              </button>
            )}
          </div>
          {notice && (
            <div className="glass mt-4 inline-flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-ink-2">
              <span>{notice}</span>
              <Link to="/manga/downloads" className="font-semibold text-accent hover:underline">Open Downloads</Link>
            </div>
          )}
        </div>
      </div>

      {manga.synopsis && (
        <div className="mt-8 max-w-4xl px-8">
          <p className={`whitespace-pre-line text-[15px] leading-relaxed text-ink-2 ${expanded ? "" : "line-clamp-4"}`}>{manga.synopsis}</p>
          {manga.synopsis.length > 320 && (
            <button onClick={() => setExpanded(!expanded)} className="btn btn-ghost btn-sm -ml-3 mt-1">
              {expanded ? "Show less" : "Show more"} <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      )}

      {adaptations.length > 0 && (
        <section className="mt-10 px-8">
          <SectionHeader icon={Tv} title="Watch the anime" />
          <div className="no-scrollbar flex gap-4 overflow-x-auto pb-3 pt-1">
            {adaptations.map((anime) => (
              <Link key={anime.id} to={`/anime/${anime.id}`} state={{ anime }} className="group w-32 flex-shrink-0">
                <div className="relative overflow-hidden rounded-xl shadow-card ring-1 ring-white/[0.06] transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-glow group-hover:ring-2 group-hover:ring-accent/60">
                  {anime.coverImage ? <img src={anime.coverImage} alt="" className="h-48 w-32 object-cover transition duration-700 ease-out group-hover:scale-[1.06]" /> : <div className="h-48 w-32 bg-white/5" />}
                  {anime.format && <span className="badge badge-glass absolute left-1.5 top-1.5">{anime.format.replace("_", " ")}</span>}
                </div>
                <p className="mt-2 line-clamp-2 text-xs font-medium leading-tight text-ink-2 transition group-hover:text-white">{anime.title}</p>
                <p className="mt-0.5 text-[10px] text-ink-3">{[anime.year, anime.episodes ? `${anime.episodes} eps` : null].filter(Boolean).join(" · ")}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 px-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="mr-1 flex items-center gap-3">
            <span className="icon-tile h-8 w-8 rounded-lg">
              <ListOrdered size={16} strokeWidth={2.2} />
            </span>
            <h2 className="section-title">Chapters</h2>
          </div>
          {sources.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {[{ id: "", label: "Auto" }, ...sources].map((s) => (
                <button
                  key={s.id}
                  onClick={() => { const value = s.id || null; setChosen(value); setTitlePref(mangaId, "source", value); }}
                  className={`chip ${(chosen ?? "") === s.id ? "chip-active" : ""}`}
                >
                  {s.label}{!s.id && ready ? ` (${ready.source.label})` : ""}
                </button>
              ))}
            </div>
          )}
          {needsConnect.filter((s) => s.web?.state !== "native-required").map((s) => (
            <button
              key={s.id}
              onClick={() => connect(s)}
              disabled={connecting}
              className="btn btn-primary btn-sm"
              title={`Opens ${s.label} so you can complete its one-time check`}
            >
              <Link2 size={13} /> {connecting ? "Waiting for the check…" : `Connect ${s.label}`}
            </button>
          ))}
          {ready && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {groups.length > 1 && (
                <SelectField
                  value={activeGroup ?? ""}
                  onChange={(value) => { const g = value || null; setGroup(g); setTitlePref(mangaId, "group", g); }}
                  className="w-[200px] [&_select]:h-9 [&_select]:text-xs"
                >
                  <option value="">All groups</option>
                  {groups.map(([g, count]) => <option key={g} value={g}>{g} ({count})</option>)}
                </SelectField>
              )}
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find chapter" className="input h-9 w-40 pl-8 text-xs" />
              </div>
              <button onClick={() => setNewestFirst(!newestFirst)} className="btn btn-secondary btn-sm h-9" title="Change the order">
                <ArrowDownUp size={13} /> {newestFirst ? "Newest first" : "Oldest first"}
              </button>
            </div>
          )}
        </div>

        {(ready?.source.web || chosen) && (() => {
          const source = ready?.source ?? sources.find((item) => item.id === chosen);
          return source?.web && source.web.state !== "available" ? (
            <div className="panel mb-4 p-4 text-sm leading-relaxed text-ink-2">
              <p>{source.web.description}</p>
              <a href={source.web.website} target="_blank" rel="noreferrer" className="mt-2 inline-block font-semibold text-accent hover:underline">Open {source.label}</a>
            </div>
          ) : null;
        })()}

        {load.state === "loading" && (
          <>
            <p className="mb-3 text-xs text-ink-3">Finding this title on the reading sources… long series can take a few seconds.</p>
            <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>
          </>
        )}
        {load.state === "message" && (
          <div className="panel flex items-center gap-4 p-4 text-sm text-ink-2">
            <span className="icon-tile bg-amber-400/10 text-amber-300 ring-amber-300/20">
              <TriangleAlert size={17} />
            </span>
            <span className="flex-1">{load.text}</span>
            <button onClick={() => setAttempt((n) => n + 1)} className="btn btn-secondary btn-sm">
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        )}
        {ready && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
              <span>{reading.length} chapters on {ready.source.label}{activeGroup ? ` · ${activeGroup}` : ""}{offline ? ` · ${offline} downloaded` : ""}</span>
              {ready.saved != null && ready.refresh === "loading" && (
                <span className="flex items-center gap-1.5"><RefreshCw size={11} className="animate-spin" /> Refreshing (list from {ago(ready.saved)})</span>
              )}
              {ready.saved != null && ready.refresh != null && ready.refresh !== "loading" && (
                <span className="flex items-center gap-2 text-amber-300/80">
                  Couldn't refresh, showing the list from {ago(ready.saved)}.
                  <button onClick={() => setAttempt((n) => n + 1)} className="font-semibold text-white/70 underline-offset-2 hover:text-white hover:underline">Retry</button>
                </span>
              )}
            </div>
            <div className="panel flex flex-col gap-0.5 p-1.5">
              {rows.slice(0, limit).map((chapter) => {
                const state = progress[String(chapter.number)];
                const done = state ? isFinished(state) : false;
                const current = !!state && !done;
                return (
                  <div key={chapter.id} className={`group flex items-center gap-3 rounded-xl px-2.5 py-2 transition hover:bg-white/[0.04] ${done ? "opacity-55 hover:opacity-90" : ""}`}>
                    <button onClick={() => open(chapter)} className="flex min-w-0 flex-1 items-center gap-4 text-left">
                      <span
                        className={`grid h-10 min-w-[3.5rem] flex-shrink-0 place-items-center rounded-xl px-2 text-sm font-bold tabular-nums ring-1 ring-inset transition ${
                          current
                            ? "bg-accent/15 text-white ring-accent/40"
                            : "bg-white/[0.05] text-ink-2 ring-white/[0.06] group-hover:text-white"
                        }`}
                      >
                        {chapterLabel(chapter.number)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-white/85 group-hover:text-white">{chapter.title ?? `Chapter ${chapterLabel(chapter.number)}`}</span>
                        <span className="block truncate text-[11px] text-ink-3">
                          {[chapter.group, chapter.uploadedAt ? uploadedLabel(chapter.uploadedAt) : null, chapter.pageCount ? `${chapter.pageCount} pages` : null].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {current && (
                        <span className="flex flex-shrink-0 items-center gap-2 text-xs font-semibold text-accent">
                          <span className="h-1 w-14 overflow-hidden rounded-full bg-white/10">
                            <span className="block h-full rounded-full bg-accent-gradient" style={{ width: `${Math.round(((state.page + 1) / Math.max(1, state.pageCount)) * 100)}%` }} />
                          </span>
                          Page {state.page + 1}/{state.pageCount}
                        </span>
                      )}
                    </button>
                    {(ready.source.web?.downloads !== false || saved.get(downloadKey(manga.id, chapter.id))?.status === "done") && <ChapterDownloadButton item={saved.get(downloadKey(manga.id, chapter.id))} onDownload={() => download(chapter)} />}
                    <button
                      onClick={() => mark([chapter], !done)}
                      title={done ? "Mark as unread" : "Mark as read"}
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition ${done ? "bg-emerald-400/10 text-emerald-400" : "text-white/25 hover:bg-white/[0.07] hover:text-white"}`}
                    >
                      <Check size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {rows.length > limit && (
                <button onClick={() => setLimit(limit + PAGE * 2)} className="btn btn-secondary">
                  Show more ({rows.length - limit} left)
                </button>
              )}
              {next && next.number > (reading[0]?.number ?? 0) && (
                <button
                  onClick={() => mark(reading.filter((c) => c.number < next.number), true)}
                  className="btn btn-ghost btn-sm"
                  title="Marks every chapter before the one you're on as read"
                >
                  <CheckCheck size={14} /> Mark everything before Ch {chapterLabel(next.number)} read
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {rangeOpen && ready && (
        <DownloadRangeDialog
          uploads={ready.uploads}
          groups={groups}
          initialGroup={rangeStartGroup(held.values(), groups, activeGroup)}
          start={next}
          held={held}
          onClose={() => setRangeOpen(false)}
          onDownload={(chapters) => void downloadRange(chapters)}
        />
      )}
    </div>
  );
}
