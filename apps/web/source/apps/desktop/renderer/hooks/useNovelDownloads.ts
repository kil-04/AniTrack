import { useEffect, useRef, useState } from "react";
import { novelTitleKey, type NovelDownloadTitle, type NovelSourceId } from "../../../../packages/shared/novel";
import { novelApi } from "../lib/novel-api";

/** Every title with offline chapters, kept current from the main process's events. */
export function useNovelDownloads(): NovelDownloadTitle[] | null {
  const [titles, setTitles] = useState<NovelDownloadTitle[] | null>(null);
  useEffect(() => {
    let alive = true;
    void novelApi().downloads().then((list) => { if (alive) setTitles(list); });
    const stop = novelApi().onDownload((event) => {
      setTitles((list) => {
        const rest = (list ?? []).filter((t) => ("removed" in event ? novelTitleKey(t.sourceId, t.titleId) !== event.removed : !(t.sourceId === event.sourceId && t.titleId === event.titleId)));
        return "removed" in event ? rest : [event, ...rest];
      });
    });
    return () => { alive = false; stop(); };
  }, []);
  return titles;
}

/** One title's download state and its saved chapter ids. */
export function useNovelTitleDownloads(sourceId: NovelSourceId | null, titleId: string) {
  const [state, setState] = useState<NovelDownloadTitle | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const last = useRef<NovelDownloadTitle | null>(null);
  useEffect(() => {
    if (!sourceId) return;
    let alive = true;
    let timer: number | null = null;
    const refreshSaved = () => { void novelApi().downloaded(sourceId, titleId).then((ids) => { if (alive) setSaved(new Set(ids)); }); };
    setState(null);
    setSaved(new Set());
    last.current = null;
    refreshSaved();
    void novelApi().downloads().then((list) => {
      if (!alive) return;
      last.current = list.find((t) => t.sourceId === sourceId && t.titleId === titleId) ?? null;
      setState(last.current);
    });
    const stop = novelApi().onDownload((event) => {
      if ("removed" in event) {
        if (event.removed === novelTitleKey(sourceId, titleId)) { last.current = null; setState(null); setSaved(new Set()); }
        return;
      }
      if (event.sourceId !== sourceId || event.titleId !== titleId) return;
      // The chapter that just finished counts as saved at once (the id list below catches up).
      const before = last.current;
      const finished = before?.currentId;
      if (before && finished && event.currentId !== finished && event.saved > before.saved && !event.failedIds.includes(finished)) {
        setSaved((ids) => (ids.has(finished) ? ids : new Set([...ids, finished])));
      }
      last.current = event;
      setState(event);
      // Saved ids are re-read at most a couple of times a second during a long download.
      if (timer == null) timer = window.setTimeout(() => { timer = null; refreshSaved(); }, 600);
    });
    return () => { alive = false; stop(); if (timer != null) window.clearTimeout(timer); };
  }, [sourceId, titleId]);
  return { state, saved };
}
