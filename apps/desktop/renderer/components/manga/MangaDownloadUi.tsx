import { useEffect, useMemo, useState } from "react";
import { Download, HardDriveDownload, Loader2, RotateCcw, X } from "lucide-react";
import {
  chapterLabel,
  normalizeChapters,
  rangeChoice,
  rangePresets,
  type MangaChapter,
  type MangaDownload,
} from "../../../../../packages/shared/manga";

const CONTROL = "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition";

function ProgressRing({ value }: { value: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90 text-accent">
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))} />
    </svg>
  );
}

/** A chapter row's download control: download, queued, progress, downloaded, or retry. */
export function ChapterDownloadButton({ item, onDownload }: { item: MangaDownload | undefined; onDownload: () => void }) {
  switch (item?.status) {
    case undefined:
      return (
        <button onClick={onDownload} title="Download chapter" className={`${CONTROL} text-white/25 hover:bg-white/10 hover:text-white`}>
          <Download size={16} />
        </button>
      );
    case "queued":
      return <span className={`${CONTROL} text-white/40`} title="Queued"><Loader2 size={15} className="animate-spin" /></span>;
    case "downloading":
      return <span className={CONTROL} title={`Downloading ${item.done}/${item.total}`}><ProgressRing value={item.total ? item.done / item.total : 0} /></span>;
    case "done":
      return <span className={`${CONTROL} text-emerald-400`} title="Downloaded: reads offline"><HardDriveDownload size={16} /></span>;
    case "failed":
      return (
        <button onClick={onDownload} title={`${item.error ?? "Download failed"} Click to retry.`} className={`${CONTROL} text-red-400 hover:bg-white/10`}>
          <RotateCcw size={15} />
        </button>
      );
  }
}

const parseNumber = (text: string) => (/^\d+(?:\.\d+)?$/.test(text.trim()) ? Number(text.trim()) : null);
const numeric = (text: string) => text.replace(/[^\d.]/g, "").slice(0, 7);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function chapterList(chapters: MangaChapter[]): string {
  return `Ch. ${chapters.slice(0, 6).map((c) => chapterLabel(c.number)).join(", ")}${chapters.length > 6 ? ` and ${chapters.length - 6} more` : ""}`;
}

/**
 * Download a range of chapters from one group. Numbers come from the From/To
 * fields (half chapters like 140.5 too) or presets from the next unread chapter.
 * Each number downloads once: the chosen group's upload, or another group's where
 * it has none and "Fill gaps" is on. Numbers already downloaded or queued, from any
 * group, are skipped.
 */
export function DownloadRangeDialog({
  uploads,
  groups,
  initialGroup,
  start,
  held,
  onClose,
  onDownload,
}: {
  uploads: MangaChapter[];
  groups: [string, number][];
  initialGroup: string | null;
  start: MangaChapter | null;
  held: Map<number, MangaDownload>;
  onClose: () => void;
  onDownload: (chapters: MangaChapter[]) => void;
}) {
  const numbers = useMemo(() => normalizeChapters(uploads), [uploads]);
  const presets = useMemo(() => rangePresets(numbers, start), [numbers, start]);
  const [fromText, setFromText] = useState(() => (presets[0] ? chapterLabel(presets[0][1]) : ""));
  const [toText, setToText] = useState(() => (presets[0] ? chapterLabel(presets[0][2]) : ""));
  const [group, setGroup] = useState<string | null>(initialGroup);
  const [fillGaps, setFillGaps] = useState(true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const from = parseNumber(fromText);
  const to = parseNumber(toText) ?? from;
  const choice = from != null && to != null ? rangeChoice(uploads, group, from, to, fillGaps) : null;
  const inRange = new Set([...(choice?.chapters ?? []), ...(choice?.gaps ?? [])].map((c) => c.number));
  const fresh = (choice?.chapters ?? []).filter((c) => !held.has(c.number));
  const have = [...inRange].flatMap((n) => held.get(n) ?? []);
  // Numbers the chosen group never uploaded (ones already saved don't matter).
  const gaps = (choice?.gaps ?? []).filter((c) => !held.has(c.number));
  const pages = fresh.reduce((sum, c) => sum + (c.pageCount ?? 0), 0);
  const others = [...new Set(have.map((item) => item.chapter.group).filter((g): g is string => !!g && g !== group))];

  const summary = !inRange.size
    ? "No chapters in that range."
    : !fresh.length && have.length === inRange.size
      ? "You already have every chapter in this range."
      : !fresh.length
        ? `Nothing to download from ${group ?? "this source"} in this range.`
        : `${plural(fresh.length, "chapter")}${pages > 0 ? ` · about ${pages} pages` : ""}`;

  const input = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-accent focus:outline-none";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-range-title"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-surface-1 p-5 text-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="download-range-title" className="text-lg font-bold">Download chapters</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>

        {presets.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {presets.map(([label, low, high]) => {
              const chosen = from === low && to === high;
              return (
                <button
                  key={label}
                  onClick={() => { setFromText(chapterLabel(low)); setToText(chapterLabel(high)); }}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${chosen ? "bg-white text-black" : "bg-white/10 text-white/75 hover:text-white"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="text-xs text-white/50">
            From chapter
            <input value={fromText} onChange={(event) => setFromText(numeric(event.target.value))} inputMode="decimal" className={`${input} mt-1`} />
          </label>
          <label className="text-xs text-white/50">
            To chapter
            <input value={toText} onChange={(event) => setToText(numeric(event.target.value))} inputMode="decimal" className={`${input} mt-1`} />
          </label>
        </div>

        {groups.length > 1 ? (
          <label className="mb-3 flex items-center gap-3 text-sm text-white/60">
            Group
            <select
              value={group ?? ""}
              onChange={(event) => setGroup(event.target.value || null)}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white"
            >
              {groups.map(([g, count]) => <option key={g} value={g} className="bg-surface-1">{g} ({count})</option>)}
            </select>
          </label>
        ) : group ? (
          <p className="mb-3 text-xs text-white/50">Group: {group}</p>
        ) : null}

        {group != null && gaps.length > 0 && (
          <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-white/85">
            <input type="checkbox" checked={fillGaps} onChange={(event) => setFillGaps(event.target.checked)} className="h-4 w-4 accent-accent" />
            Fill gaps from other groups
          </label>
        )}

        <div className="space-y-1 rounded-xl bg-white/[0.04] p-3">
          <p className="text-sm text-white/85">{summary}</p>
          {have.length > 0 && have.length < inRange.size && (
            <p className="text-xs text-white/50">
              Skipping {have.length} you already have{others.length === 1 ? ` (from ${others[0]}).` : others.length > 1 ? " (from other groups)." : "."}
            </p>
          )}
          {group != null && gaps.length > 0 && (
            <p className="text-xs text-white/50">
              {chapterList(gaps)} {gaps.length === 1 ? "isn't" : "aren't"} uploaded by {group}
              {fillGaps ? `, so ${gaps.length === 1 ? "it comes" : "they come"} from other groups.` : " and will be left out."}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm font-semibold text-white/60 hover:text-white">Cancel</button>
          <button
            onClick={() => onDownload(fresh)}
            disabled={!fresh.length}
            className="flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download size={15} /> {fresh.length ? `Download ${fresh.length}` : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}
