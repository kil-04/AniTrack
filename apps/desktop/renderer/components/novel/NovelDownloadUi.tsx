import { useEffect, useRef, useState } from "react";
import { Download, HardDriveDownload, Loader2, RotateCcw, Square, Trash2, X } from "lucide-react";
import type { NovelChapter, NovelDownloadTitle } from "../../../../../packages/shared/novel";
import { humanBytes } from "../../lib/novel-api";

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/** ↓ to save one chapter offline; queued, saving, saved, or failed (click to retry) — like manga's rows. */
export function ChapterSaveMark({ state, onSave }: { state: "none" | "queued" | "saving" | "saved" | "failed"; onSave: () => void }) {
  const box = "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition";
  switch (state) {
    case "saved":
      return <span className={`${box} text-emerald-400`} title="Saved: reads offline"><HardDriveDownload size={16} /></span>;
    case "saving":
      return <span className={`${box} text-accent`} title="Saving now"><Loader2 size={16} className="animate-spin" /></span>;
    case "queued":
      return <span className={`${box} text-white/40`} title="Waiting to save"><Loader2 size={15} className="animate-spin" /></span>;
    case "failed":
      return (
        <button onClick={onSave} className={`${box} text-red-400 hover:bg-white/10`} title="Couldn't save this chapter. Click to retry.">
          <RotateCcw size={15} />
        </button>
      );
    default:
      return (
        <button onClick={onSave} className={`${box} text-white/25 hover:bg-white/10 hover:text-white`} title="Save this chapter offline">
          <Download size={16} />
        </button>
      );
  }
}

/**
 * The title page's download control: quick picks from the chapter you're on, a
 * position range, live progress with Stop, and what's saved with Remove.
 */
export function NovelDownloadButton({
  chapters,
  startIndex,
  saved,
  state,
  onDownload,
  onStop,
  onRemoveAll,
}: {
  chapters: NovelChapter[];
  /** Where "next" starts: the chapter Continue would open. */
  startIndex: number;
  saved: Set<string>;
  state: NovelDownloadTitle | null;
  onDownload: (chapters: NovelChapter[]) => void;
  onStop: () => void;
  onRemoveAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(String(startIndex + 1));
  const [to, setTo] = useState(String(Math.min(chapters.length, startIndex + 50)));
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { setFrom(String(startIndex + 1)); setTo(String(Math.min(chapters.length, startIndex + 50))); }, [startIndex, chapters.length]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const unsaved = (list: NovelChapter[]) => list.filter((c) => !saved.has(c.id));
  const pick = (list: NovelChapter[]) => { onDownload(list); setOpen(false); };
  const next = (n: number) => chapters.slice(startIndex, startIndex + n);
  const range = (() => {
    const a = Number(from);
    const b = Number(to);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return [];
    const lo = Math.max(1, Math.min(a, b));
    const hi = Math.min(chapters.length, Math.max(a, b));
    return chapters.slice(lo - 1, hi);
  })();
  const busy = !!state && state.queued > 0;

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)} className="btn btn-secondary btn-lg" title="Save chapters to read offline">
        {busy ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
        {busy ? `Saving · ${state!.queued.toLocaleString()} left` : state?.saved ? `${state.saved.toLocaleString()} offline` : "Download"}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[340px] rounded-2xl border border-white/10 bg-surface-1/95 p-3 shadow-pop backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-ink-3">Save offline</span>
            <button onClick={() => setOpen(false)} className="rounded-md p-1 text-ink-3 hover:text-white" aria-label="Close"><X size={14} /></button>
          </div>
          {busy && (
            <div className="mb-3 rounded-xl bg-accent/10 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-ink-2">{state!.current ? `Saving ${state!.current}` : "Waiting…"}</span>
                <button onClick={onStop} className="btn btn-ghost btn-sm h-7 px-2 text-xs"><Square size={11} /> Stop</button>
              </div>
              <div className="mt-1 text-xs text-ink-3">{plural(state!.queued, "chapter")} left · {plural(state!.saved, "chapter")} saved</div>
            </div>
          )}
          {state?.error && !busy && <p className="mb-3 rounded-xl bg-amber-400/10 px-3 py-2 text-xs text-amber-200">{state.error}</p>}
          <div className="grid gap-1">
            {[10, 50].map((n) => {
              const list = unsaved(next(n));
              return (
                <button key={n} disabled={!list.length} onClick={() => pick(list)} className="flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white/[0.06] disabled:opacity-40">
                  <span>Next {n} from {chapters[startIndex]?.label ?? "here"}</span>
                  <span className="text-xs text-ink-3">{list.length ? `+${list.length}` : "saved"}</span>
                </button>
              );
            })}
            {(() => {
              const rest = unsaved(chapters.slice(startIndex));
              const all = unsaved(chapters);
              return (
                <>
                  <button disabled={!rest.length} onClick={() => pick(rest)} className="flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white/[0.06] disabled:opacity-40">
                    <span>Everything from here</span>
                    <span className="text-xs text-ink-3">{rest.length ? `+${rest.length.toLocaleString()}` : "saved"}</span>
                  </button>
                  <button disabled={!all.length} onClick={() => pick(all)} className="flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white/[0.06] disabled:opacity-40">
                    <span>Every chapter</span>
                    <span className="text-xs text-ink-3">{all.length ? `+${all.length.toLocaleString()}` : "saved"}</span>
                  </button>
                </>
              );
            })()}
          </div>
          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <div className="mb-2 px-1 text-xs text-ink-3">Or by position in the list (1–{chapters.length.toLocaleString()})</div>
            <div className="flex items-center gap-2">
              <input value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, "").slice(0, 6))} className="input h-9 w-20 text-center text-sm" aria-label="From" />
              <span className="text-ink-3">–</span>
              <input value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, "").slice(0, 6))} className="input h-9 w-20 text-center text-sm" aria-label="To" />
              <button disabled={!unsaved(range).length} onClick={() => pick(unsaved(range))} className="btn btn-primary btn-sm ml-auto h-9">
                Save {unsaved(range).length ? `+${unsaved(range).length.toLocaleString()}` : ""}
              </button>
            </div>
          </div>
          {!!state?.saved && (
            <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] px-1 pt-3 text-xs text-ink-3">
              <span>{plural(state.saved, "chapter")} saved · {humanBytes(state.sizeBytes)}</span>
              <button onClick={() => { onRemoveAll(); setOpen(false); }} className="flex items-center gap-1 font-semibold text-red-300 hover:text-red-200">
                <Trash2 size={12} /> Remove all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
