import { useEffect, useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, HardDriveDownload, Play, Trash2, Loader2, AlertCircle, ChevronDown, RotateCcw } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import LegacyDownloadNotice from "../components/LegacyDownloadNotice";
import FileDownloadDestination from '../components/FileDownloadDestination';
import {exportEpisodeFiles} from '../../../../../lib/browser-downloads';
import {
  downloadsSupported,
  subscribeDownloads,
  getDownloads,
  removeDownload,
  enqueueDownload,
} from "../lib/downloads";
import type { DownloadItem } from "../../../../packages/shared/types";

function fmtSize(bytes?: number): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

export default function Downloads() {
  const navigate = useNavigate();
  const supported = downloadsSupported();
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => (supported ? subscribeDownloads(force) : undefined), [supported]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [saving,setSaving]=useState<string|null>(null),[saveMessage,setSaveMessage]=useState('');
  async function saveFiles(id:string){setSaving(id);setSaveMessage('');try{const result=await exportEpisodeFiles(id);setSaveMessage(result.kind==='folder'?`Saved in ${result.name}`:`Sent ${result.name} to browser downloads`);}catch(error){setSaveMessage(error instanceof Error?error.message:'The files could not be saved.');}finally{setSaving(null);}}
  const toggle = (id: number) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // Group downloads by show, newest first within each show.
  const items = Array.from(getDownloads().values());
  const groups = new Map<number, { title: string; coverUrl?: string | null; items: DownloadItem[] }>();
  for (const it of items) {
    let g = groups.get(it.animeId);
    if (!g) { g = { title: it.title, coverUrl: it.coverUrl, items: [] }; groups.set(it.animeId, g); }
    g.items.push(it);
  }
  for (const g of groups.values()) g.items.sort((a, b) => a.episode - b.episode);
  const groupList = Array.from(groups.entries());

  function play(it: DownloadItem) {
    const p = new URLSearchParams({
      download: it.id,
      animeId: String(it.animeId),
      episode: String(it.episode),
      title: it.title,
    });
    if (it.coverUrl) p.set("coverUrl", it.coverUrl);
    navigate(`/stream-player?${p.toString()}`);
  }

  function retry(it: DownloadItem) {
    enqueueDownload({
      id: it.id,
      animeId: it.animeId,
      episode: it.episode,
      title: it.title,
      coverUrl: it.coverUrl ?? null,
      providerId: it.providerId,
      animeSession: it.animeSession ?? "",
      episodeSession: it.episodeSession ?? "",
    });
  }

  const doneAll = items.filter((i) => i.status === "done");
  const bytesAll = doneAll.reduce((sum, i) => sum + (i.sizeBytes || 0), 0);

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <PageHeader scene="bedroom" icon={Download} title="Downloads" subtitle="Save episodes and subtitles in a folder for each title">
        {doneAll.length > 0 && (
          <span className="chip h-8 text-[13px]">
            {doneAll.length} episode{doneAll.length === 1 ? "" : "s"}
            {bytesAll ? ` · ${fmtSize(bytesAll)}` : ""}
          </span>
        )}
      </PageHeader>

      <FileDownloadDestination />
      {saveMessage&&<p role="status" className="mb-4 text-sm text-ink-2">{saveMessage}</p>}
      <LegacyDownloadNotice items={items} />

      {!supported && (
        <EmptyState icon={HardDriveDownload} title="Downloads live in the Android app">
          Save episodes on your tablet or phone and watch them offline there.
        </EmptyState>
      )}

      {supported && groupList.length === 0 && (
        <EmptyState icon={HardDriveDownload} title="No downloads yet">
          Use the download button on an episode (or &ldquo;Download 50&rdquo;) on a series page.
        </EmptyState>
      )}

      <div className="flex flex-col gap-3">
        {groupList.map(([animeId, g]) => {
          const isOpen = expanded.has(animeId);
          const done = g.items.filter((i) => i.status === "done");
          const activeItems = g.items.filter((i) => i.status === "downloading" || i.status === "queued");
          const active = activeItems.length;
          const activeProgress = active ? activeItems.reduce((sum, i) => sum + (i.progress || 0), 0) / active : 0;
          const totalBytes = done.reduce((s, i) => s + (i.sizeBytes || 0), 0);
          const summary =
            `${done.length} episode${done.length === 1 ? "" : "s"}` +
            (totalBytes ? ` · ${fmtSize(totalBytes)}` : "") +
            (active ? ` · ${active} downloading` : "");
          return (
            <section key={animeId} className="panel overflow-hidden">
              {/* Show header — tap row to expand/collapse, tap title/cover to open the series */}
              <div
                onClick={() => toggle(animeId)}
                className="flex w-full cursor-pointer items-center gap-4 p-3 pr-5 transition hover:bg-white/[0.03]"
              >
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(`/anime/${animeId}`); }}
                  className="shrink-0 rounded-xl"
                  title="Open series page"
                >
                  {g.coverUrl ? (
                    <img src={g.coverUrl} alt="" className="h-[72px] w-[52px] rounded-xl object-cover ring-1 ring-white/10 transition hover:ring-accent/60" loading="lazy" decoding="async" />
                  ) : (
                    <div className="h-[72px] w-[52px] rounded-xl bg-white/5" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/anime/${animeId}`); }}
                    className="block max-w-full truncate text-left text-[15px] font-semibold text-white transition hover:text-accent"
                  >
                    {g.title}
                  </button>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
                    {active > 0 && <Loader2 size={11} className="animate-spin text-accent" />}
                    {summary}
                  </div>
                  {active > 0 && (
                    <div className="mt-2 h-1 max-w-[260px] overflow-hidden rounded-full bg-white/[0.08]">
                      <div className="h-full rounded-full bg-accent-gradient transition-all" style={{ width: `${Math.round(activeProgress)}%` }} />
                    </div>
                  )}
                </div>
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-3 transition ${isOpen ? "bg-white/[0.07] text-white" : ""}`}>
                  <ChevronDown size={18} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </span>
              </div>

              {isOpen && (
                <div className="flex flex-col gap-1 border-t border-white/[0.06] p-2">
                  {g.items.map((it) => (
                    <div key={it.id} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/[0.03]">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-sm font-bold tabular-nums text-ink-2 ring-1 ring-inset ring-white/[0.06]">
                        {it.episode}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-white">Episode {it.episode}</div>
                        <div className={`text-xs ${it.status === "failed" ? "text-red-300" : "text-ink-3"}`}>
                          {it.status === "done" && ((it as any).webFiles?`${(it as any).webFiles.kind==='folder'?'Saved in':'ZIP sent to downloads:'} ${(it as any).webFiles.name}`:`${fmtSize(it.sizeBytes)} · saved in this browser`)}
                          {it.status === "downloading" && `Downloading… ${it.progress}%`}
                          {it.status === "queued" && "Queued"}
                          {it.status === "failed" && (it.error || "Failed")}
                        </div>
                        {it.status === "downloading" && (
                          <div className="mt-1.5 h-1 max-w-[220px] overflow-hidden rounded-full bg-white/[0.08]">
                            <div className="h-full rounded-full bg-accent-gradient transition-all" style={{ width: `${it.progress}%` }} />
                          </div>
                        )}
                      </div>

                      {it.status === "downloading" && (
                        <div className="flex items-center gap-1.5 text-xs font-semibold tabular-nums text-ink-2">
                          <Loader2 size={14} className="animate-spin text-accent" /> {it.progress}%
                        </div>
                      )}
                      {it.status === "queued" && <Loader2 size={14} className="animate-spin text-ink-3" />}
                      {it.status === "failed" && (
                        <>
                          <AlertCircle size={16} className="text-red-300" />
                          <button onClick={() => retry(it)} className="btn btn-secondary btn-sm">
                            <RotateCcw size={12} /> Retry
                          </button>
                        </>
                      )}
                      {it.status === "done" && !(it as any).webFiles && <button onClick={()=>void saveFiles(it.id)} disabled={saving!==null} className="btn btn-primary btn-sm">{saving===it.id?<Loader2 size={12} className="animate-spin"/>:<Download size={12}/>} Save files</button>}
                      {it.status === "done" && !(it as any).webFiles && (
                        <button onClick={() => play(it)} className="btn btn-secondary btn-sm">
                          <Play size={12} fill="currentColor" /> Play
                        </button>
                      )}
                      <button
                        onClick={() => removeDownload(it.id)}
                        className="btn btn-ghost btn-sm w-8 px-0 hover:bg-red-500/10 hover:text-red-300"
                        title={(it as any).webFiles?'Remove from history (keeps local files)':'Delete browser save'}
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
