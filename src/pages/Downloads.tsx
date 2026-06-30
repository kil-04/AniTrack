import { useEffect, useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Play, Trash2, Loader2, AlertCircle, ChevronDown, RotateCcw } from "lucide-react";
import {
  downloadsSupported,
  subscribeDownloads,
  getDownloads,
  removeDownload,
  enqueueDownload,
} from "../lib/downloads";
import type { DownloadItem } from "../../shared/types";

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

  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <div className="mb-1 flex items-center gap-2">
        <Download size={22} className="text-[#e50914]" />
        <h1 className="text-2xl font-bold text-white">Downloads</h1>
      </div>
      <p className="mb-6 text-sm text-white/40">Watch downloaded episodes offline, in the app.</p>

      {!supported && (
        <div className="rounded-lg border border-white/10 bg-white/5 px-5 py-12 text-center text-sm text-white/40">
          Downloads are available in the Android app.
        </div>
      )}

      {supported && groupList.length === 0 && (
        <div className="rounded-lg border border-white/10 bg-white/5 px-5 py-12 text-center text-sm text-white/40">
          No downloads yet. Tap the download icon on an episode (or “Download 50”) on a series page.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {groupList.map(([animeId, g]) => {
          const isOpen = expanded.has(animeId);
          const done = g.items.filter((i) => i.status === "done");
          const active = g.items.filter((i) => i.status === "downloading" || i.status === "queued").length;
          const totalBytes = done.reduce((s, i) => s + (i.sizeBytes || 0), 0);
          const summary =
            `${done.length} episode${done.length === 1 ? "" : "s"}` +
            (totalBytes ? ` · ${fmtSize(totalBytes)}` : "") +
            (active ? ` · ${active} downloading` : "");
          return (
            <section key={animeId} className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
              {/* Show header — tap row to expand/collapse, tap title/cover to open the series */}
              <div
                onClick={() => toggle(animeId)}
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 transition hover:bg-white/5"
              >
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(`/anime/${animeId}`); }}
                  className="shrink-0"
                  title="Open series page"
                >
                  {g.coverUrl ? (
                    <img src={g.coverUrl} alt="" className="h-12 w-9 rounded object-cover" loading="lazy" decoding="async" />
                  ) : (
                    <div className="h-12 w-9 rounded bg-white/5" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/anime/${animeId}`); }}
                    className="block max-w-full truncate text-left text-sm font-semibold text-white hover:underline"
                  >
                    {g.title}
                  </button>
                  <div className="flex items-center gap-1.5 text-xs text-white/40">
                    {active > 0 && <Loader2 size={11} className="animate-spin" />}
                    {summary}
                  </div>
                </div>
                <ChevronDown size={18} className={`shrink-0 text-white/40 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </div>

              {isOpen && (
                <div className="flex flex-col divide-y divide-white/5 border-t border-white/10">
                  {g.items.map((it) => (
                    <div key={it.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-white">Episode {it.episode}</div>
                        <div className="text-xs text-white/45">
                          {it.status === "done" && fmtSize(it.sizeBytes)}
                          {it.status === "downloading" && `Downloading… ${it.progress}%`}
                          {it.status === "queued" && "Queued"}
                          {it.status === "failed" && (it.error || "Failed")}
                        </div>
                      </div>

                      {it.status === "downloading" && (
                        <div className="flex items-center gap-1.5 text-xs text-white/60">
                          <Loader2 size={14} className="animate-spin" /> {it.progress}%
                        </div>
                      )}
                      {it.status === "queued" && <Loader2 size={14} className="animate-spin text-white/40" />}
                      {it.status === "failed" && (
                        <>
                          <AlertCircle size={16} className="text-red-400" />
                          <button
                            onClick={() => retry(it)}
                            className="flex h-8 items-center gap-1.5 rounded bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/20 transition"
                          >
                            <RotateCcw size={12} /> Retry
                          </button>
                        </>
                      )}
                      {it.status === "done" && (
                        <button
                          onClick={() => play(it)}
                          className="flex h-8 items-center gap-1.5 rounded bg-[#e50914] px-3 text-xs font-semibold text-white hover:bg-[#f6121d] transition"
                        >
                          <Play size={12} fill="currentColor" /> Play
                        </button>
                      )}
                      <button
                        onClick={() => removeDownload(it.id)}
                        className="flex h-8 w-8 items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-red-400 transition"
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
