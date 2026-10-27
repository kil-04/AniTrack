import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Disc3, Download, Headphones, Library, Loader2, Music2, RefreshCw, Search, Trash2, Tv, WifiOff, X } from "lucide-react";
import { CITY_POP_ARCHIVE_PAGE_SIZE, type ArchiveItem, type ArchiveSearchResult, type ArchiveTrack, type CityPopDownload } from "../../../../packages/shared/city-pop-archive";
import type { CityPopTrack } from "../../../../packages/shared/city-pop";
import CityPopYouTubeVideos from "./CityPopYouTubeVideos";

function requireApi() {
  const api = window.api.cityPop;
  if (!api) throw new Error("City Pop is available in the updated desktop app.");
  return api;
}

function sizeLabel(bytes: number | null | undefined): string {
  if (bytes == null || bytes < 0) return "";
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function pausePageMedia() {
  document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => media.pause());
}

/** Archive metadata and original files are resolved in main; the page never submits remote URLs. */
export default function CityPopArchive({ beforePlay, onPlayerOpened, opening, favoriteVideos, onFavorite, onPlayYouTube }: { beforePlay: () => void; onPlayerOpened: (label: string) => void; opening: boolean; favoriteVideos: ReadonlySet<string>; onFavorite: (track: CityPopTrack) => void; onPlayYouTube: (track: CityPopTrack, results: readonly CityPopTrack[]) => void }) {
  const [tab, setTab] = useState<"browse" | "videos" | "downloads">("browse");
  const [videoSource, setVideoSource] = useState<"youtube" | "archive">("youtube");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ArchiveSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ArchiveItem | null>(null);
  const [files, setFiles] = useState<ArchiveTrack[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [downloads, setDownloads] = useState<CityPopDownload[]>([]);
  const [downloadsProblem, setDownloadsProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const searchGeneration = useRef(0);
  const itemGeneration = useRef(0);
  const alive = useRef(true);
  const operationBusy = useRef(false);
  const browseMedia = useRef<"all" | "video">("all");
  const showingYouTube = tab === "videos" && videoSource === "youtube";

  const refreshDownloads = useCallback(async () => {
    try {
      const rows = await requireApi().downloads();
      if (alive.current) { setDownloads(rows); setDownloadsProblem(null); }
    } catch { if (alive.current) setDownloadsProblem("Couldn't load your City Pop downloads."); }
  }, []);

  const search = useCallback(async (wanted: string, targetPage = 1) => {
    const generation = ++searchGeneration.current;
    itemGeneration.current++;
    setSelected(null);
    setFiles([]);
    setLoadingFiles(false);
    setResult(null);
    setSubmitted(wanted);
    setPage(targetPage);
    setProblem(null);
    setNotice(null);
    setSearching(true);
    try {
      const found = await requireApi().archiveSearch(wanted, targetPage, browseMedia.current);
      if (!alive.current || generation !== searchGeneration.current) return;
      setResult(found);
      setSubmitted(wanted);
      setPage(found.page);
    } catch {
      if (alive.current && generation === searchGeneration.current) setProblem("Couldn't reach Internet Archive. Check your connection and try again.");
    } finally {
      if (alive.current && generation === searchGeneration.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void search("");
    void refreshDownloads();
    const timer = window.setInterval(() => { void refreshDownloads(); }, 2000);
    return () => { alive.current = false; searchGeneration.current++; itemGeneration.current++; window.clearInterval(timer); };
  }, [search, refreshDownloads]);

  const downloadByFile = useMemo(() => new Map(downloads.map((download) => [`${download.itemId}\n${download.fileName}`, download])), [downloads]);
  const completed = downloads.filter((download) => download.status === "completed").length;
  const active = downloads.filter((download) => download.status === "queued" || download.status === "downloading").length;
  const visibleFiles = useMemo(() => tab === "videos" ? files.filter((track) => track.mediaType === "video") : files, [files, tab]);

  async function openItem(item: ArchiveItem) {
    const generation = ++itemGeneration.current;
    setSelected(item);
    setFiles([]);
    setLoadingFiles(true);
    setProblem(null);
    setNotice(null);
    try {
      const tracks = await requireApi().archiveItem(item.id);
      if (alive.current && generation === itemGeneration.current) setFiles(tracks);
    } catch { if (alive.current && generation === itemGeneration.current) setProblem("Couldn't load this item's playable files. Please try again."); }
    finally { if (alive.current && generation === itemGeneration.current) setLoadingFiles(false); }
  }

  async function perform(key: string, action: () => Promise<unknown>) {
    if (operationBusy.current) return;
    operationBusy.current = true;
    setWorking(key);
    setProblem(null);
    try { await action(); }
    catch (error) {
      if (alive.current) setProblem(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "That action couldn't finish. Please try again.");
    } finally {
      operationBusy.current = false;
      if (alive.current) setWorking(null);
      await refreshDownloads();
    }
  }

  /** The album from `index`, as on Android: Previous goes back up it, and saved files play offline. */
  async function play(index: number, mode: "listen" | "watch") {
    const item = selected;
    const queue = visibleFiles;
    if (!item || !queue[index]) return;
    await perform(`play:${item.id}:${index}`, async () => {
      beforePlay();
      pausePageMedia();
      const opened = await requireApi().playArchive(item.id, queue.map((track) => track.fileName), index, mode);
      if (!opened.ok) throw new Error("Couldn't open the player. Please try again.");
      if (alive.current) onPlayerOpened(queue[index].title);
    });
  }

  /** Every file of the album not already saved or on its way. */
  async function downloadAll() {
    const wanted = visibleFiles.filter((track) => {
      const saved = downloadByFile.get(`${track.itemId}\n${track.fileName}`);
      return !saved || saved.status === "error";
    });
    await perform(`download-all:${selected?.id ?? ""}`, async () => {
      for (const track of wanted) await requireApi().downloadArchive(track.itemId, track.fileName);
      if (alive.current) setNotice(wanted.length ? `${wanted.length} ${wanted.length === 1 ? "track" : "tracks"} added to downloads.` : "Already in your download queue.");
    });
  }

  function showCollection(next: "browse" | "videos") {
    if (tab === next) return;
    browseMedia.current = next === "videos" ? "video" : "all";
    setTab(next);
    if (next === "videos" && videoSource === "youtube") {
      cancelArchiveSearch();
    } else void search(query.trim());
  }

  function cancelArchiveSearch() {
    searchGeneration.current++;
    itemGeneration.current++;
    setSearching(false);
    setLoadingFiles(false);
    setSelected(null);
    setFiles([]);
    setProblem(null);
  }

  function chooseVideoSource(source: "youtube" | "archive") {
    if (source === videoSource) return;
    setVideoSource(source);
    if (source === "youtube") cancelArchiveSearch();
    else {
      browseMedia.current = "video";
      void search(query.trim());
    }
  }

  function showDownloads() {
    searchGeneration.current++;
    itemGeneration.current++;
    setSearching(false);
    setLoadingFiles(false);
    setSelected(null);
    setFiles([]);
    setTab("downloads");
    setProblem(null);
    setNotice(null);
    void refreshDownloads();
  }

  return <section id="city-pop-archive" className="mt-7" aria-labelledby="city-pop-archive-title">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h2 id="city-pop-archive-title" className="text-xl font-semibold text-white">{tab === "videos" ? "City Pop videos" : "The City Pop archive"}</h2><p className="mt-1 max-w-[640px] text-xs leading-5 text-white/50">{tab === "videos" ? "Find song videos, live performances, and music videos on YouTube or Internet Archive." : "Explore audio and video from Internet Archive. Open an album to choose a track, or save files for offline listening and viewing."}</p></div>
      <div className="city-pop-subtabs flex flex-wrap gap-1" role="group" aria-label="Music and video collections"><button type="button" aria-pressed={tab === "browse"} onClick={() => showCollection("browse")} className={`city-pop-filter ${tab === "browse" ? "city-pop-filter-active" : "border-transparent"}`}><Library size={13} />Browse</button><button type="button" aria-pressed={tab === "videos"} onClick={() => showCollection("videos")} className={`city-pop-filter ${tab === "videos" ? "city-pop-filter-active" : "border-transparent"}`}><Tv size={13} />Videos</button><button type="button" aria-pressed={tab === "downloads"} onClick={showDownloads} className={`city-pop-filter ${tab === "downloads" ? "city-pop-filter-active" : "border-transparent"}`}><Download size={13} />Downloads{downloads.length > 0 && <span className="opacity-60">{downloads.length}</span>}</button></div>
    </div>

    {tab === "videos" && <div className="mb-5 flex flex-wrap items-center gap-3"><label className="city-pop-source-picker"><span>Video source</span><select aria-label="City Pop video source" value={videoSource} onChange={(event) => chooseVideoSource(event.target.value as "youtube" | "archive")}><option value="youtube">YouTube</option><option value="archive">Internet Archive</option></select></label><span className="text-[11px] text-white/40">{videoSource === "youtube" ? "Song videos, performances, and music videos · Streaming only" : "Community video archive · Watch and download"}</span></div>}

    <CityPopYouTubeVideos active={showingYouTube} query={query} onQueryChange={setQuery} opening={opening || working !== null} favoriteVideos={favoriteVideos} onFavorite={onFavorite} onPlay={onPlayYouTube} />

    {problem && <div role="alert" className="mb-4 rounded-xl border border-rose-300/20 bg-rose-300/[0.07] px-4 py-3 text-xs text-rose-100">{problem}</div>}
    {notice && !problem && <div role="status" className="mb-4 rounded-xl border border-teal-200/15 bg-teal-200/5 px-4 py-3 text-xs text-teal-100/80">{notice}</div>}

    {showingYouTube ? null : tab !== "downloads" ? <>
      <form onSubmit={(event) => { event.preventDefault(); void search(query.trim()); }} className="mb-5 flex flex-wrap gap-2"><label className="city-pop-search !max-w-[520px]"><Search size={16} /><input value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "videos" ? "City pop, an artist, or a performance" : "City pop, an artist, or an album"} aria-label={tab === "videos" ? "Search Internet Archive for City Pop videos" : "Search Internet Archive for City Pop"} />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear archive search"><X size={14} /></button>}</label><button type="submit" disabled={searching} className="city-pop-outline">{searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}{searching ? "Searching…" : "Search Archive"}</button>{submitted && <button type="button" onClick={() => { setQuery(""); void search(""); }} className="city-pop-text-button px-2">{tab === "videos" ? "Browse city pop videos" : "Browse city pop"}</button>}</form>

      {selected ? <div className="city-pop-album-files">
        <button type="button" onClick={() => { itemGeneration.current++; setSelected(null); setFiles([]); setLoadingFiles(false); setProblem(null); setNotice(null); }} className="city-pop-text-button mb-5"><ArrowLeft size={14} />Back to results</button>
        <div className="mb-5 flex items-center gap-4"><div className="city-pop-album-cover h-20 w-20 shrink-0 rounded-lg"><img src={selected.coverUrl} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} /></div><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-teal-200/65">{selected.mediaType === "video" ? "Video collection" : "Audio collection"}{selected.year ? ` · ${selected.year}` : ""}</p><h3 className="mt-1 text-xl font-semibold text-white">{selected.title}</h3><p className="mt-1 text-xs text-white/45">{selected.creator || "Internet Archive"}</p></div></div>
        {!loadingFiles && visibleFiles.length > 0 && <div className="mb-4 flex flex-wrap gap-2"><button type="button" disabled={working !== null} onClick={() => void play(0, tab === "videos" ? "watch" : "listen")} className="city-pop-primary">{tab === "videos" ? <Tv size={16} /> : "▶"}{tab === "videos" ? "Watch videos" : "Play album"}</button><button type="button" disabled={working !== null} onClick={() => void downloadAll()} className="city-pop-outline city-pop-file-download"><Download size={14} />Download all</button></div>}
        {loadingFiles ? <div className="city-pop-empty"><Loader2 size={22} className="animate-spin text-pink-200/60" /><p>{tab === "videos" ? "Finding playable videos…" : "Finding playable files…"}</p></div> : visibleFiles.length ? <div className="divide-y divide-white/[0.06]">{visibleFiles.map((track, index) => {
          const saved = downloadByFile.get(`${track.itemId}\n${track.fileName}`);
          const downloading = saved?.status === "queued" || saved?.status === "downloading";
          return <div key={track.fileName} className="city-pop-file-row"><span className="w-5 shrink-0 text-center text-xs tabular-nums text-white/30">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-white" title={track.title}>{track.title}</p><p className="mt-1 truncate text-[10px] text-white/40">{track.artist || selected.creator || "Internet Archive"}{track.size ? ` · ${sizeLabel(track.size)}` : ""}{saved?.status === "completed" ? " · Saved offline" : downloading ? ` · ${saved.status === "queued" ? "Queued" : "Downloading"}` : ""}</p></div><div className="flex shrink-0 flex-wrap justify-end gap-2">{tab !== "videos" && <button type="button" disabled={working !== null} onClick={() => void play(index, "listen")} className="city-pop-file-action"><Headphones size={14} />Listen</button>}{track.mediaType === "video" && <button type="button" disabled={working !== null} onClick={() => void play(index, "watch")} className="city-pop-file-action"><Tv size={14} />Watch</button>}{saved?.status === "completed" ? <span className="city-pop-file-saved"><WifiOff size={13} />Offline</span> : <button type="button" disabled={working !== null || downloading} onClick={() => void perform(`download:${track.fileName}`, () => requireApi().downloadArchive(track.itemId, track.fileName))} className="city-pop-file-action city-pop-file-download"><Download size={14} />{downloading ? "Saving…" : saved?.status === "error" ? "Retry" : "Download"}</button>}</div></div>;
        })}</div> : <div className="city-pop-empty">{tab === "videos" ? <Tv size={25} className="text-pink-200/60" /> : <Music2 size={25} className="text-pink-200/60" />}<p>{tab === "videos" ? "No supported video files are available for this item." : "No supported audio or video files are available for this item."}</p><button type="button" onClick={() => void openItem(selected)} className="city-pop-text-button"><RefreshCw size={13} />Try again</button></div>}
      </div> : searching && !result ? <div className="city-pop-empty"><Loader2 size={26} className="animate-spin text-pink-200/60" /><p>Tuning into the archive…</p></div> : result?.items.length ? <>
        <div className="mb-3 flex items-center justify-between text-[11px] text-white/40"><span>{result.total.toLocaleString()} {tab === "videos" ? "archive videos" : "archive items"}{!submitted ? " for city pop" : ""}</span><span>Page {page}</span></div>
        <div className={`grid grid-cols-2 gap-3 ${tab === "videos" ? "xl:grid-cols-3 2xl:grid-cols-4" : "lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"}`}>{result.items.map((item) => <button type="button" key={item.id} onClick={() => void openItem(item)} className="city-pop-archive-card" aria-label={`Open ${item.title}`}><div className={`city-pop-album-cover ${tab === "videos" ? "city-pop-video-cover" : ""}`}>{item.mediaType === "video" ? <Tv className="city-pop-album-placeholder" size={43} /> : <Disc3 className="city-pop-album-placeholder" size={43} />}<img src={item.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} /><span className="city-pop-archive-type">{item.mediaType === "video" ? <Tv size={12} /> : <Headphones size={12} />}{item.mediaType === "video" ? "Video" : "Audio"}</span></div><div className="p-3"><h3 className="line-clamp-2 min-h-[36px] text-xs font-semibold leading-[18px] text-white">{item.title}</h3><p className="mt-2 truncate text-[10px] text-white/40">{item.creator || "Internet Archive"}{item.year ? ` · ${item.year}` : ""}</p></div></button>)}</div>
        <div className="mt-5 flex items-center justify-center gap-4"><button type="button" disabled={searching || page <= 1} onClick={() => void search(submitted, page - 1)} className="city-pop-outline"><ChevronLeft size={14} />Previous</button><span className="text-xs text-white/45">Page {page}</span><button type="button" disabled={searching || page >= 1000 || page * CITY_POP_ARCHIVE_PAGE_SIZE >= result.total} onClick={() => void search(submitted, page + 1)} className="city-pop-outline">Next<ChevronRight size={14} /></button></div>
      </> : <div className="city-pop-empty"><Search size={25} className="text-pink-200/60" /><p>{problem ? "The archive couldn't load right now." : tab === "videos" ? "No videos found. Try an artist or a different performance." : "No archive items found. Try an artist or a different album."}</p><button type="button" onClick={() => void search(submitted, page)} className="city-pop-text-button"><RefreshCw size={13} />Try again</button></div>}
    </> : <>
      <div className="mb-4 flex items-center justify-between gap-3"><p className="text-xs text-white/45">{completed} saved offline{active ? ` · ${active} in queue` : ""}. Downloads stay on this device.</p><button type="button" onClick={() => void refreshDownloads()} className="city-pop-text-button"><RefreshCw size={13} />Refresh</button></div>
      {downloadsProblem && <p role="alert" className="mb-3 text-xs text-rose-200">{downloadsProblem}</p>}
      {downloads.length ? <div className="city-pop-downloads-list">{downloads.map((download) => {
        const percent = download.totalBytes && download.totalBytes > 0 ? Math.min(100, Math.round(download.bytes / download.totalBytes * 100)) : null;
        return <article key={download.key} className="city-pop-download-row"><span className="city-pop-download-icon">{download.mediaType === "video" ? <Tv size={18} /> : <Music2 size={18} />}</span><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold text-white">{download.title}</h3><p className="mt-1 truncate text-[10px] text-white/45">{download.artist}{download.artist ? " · " : ""}{download.status === "completed" ? `Saved offline${download.bytes ? ` · ${sizeLabel(download.bytes)}` : ""}` : download.status === "downloading" ? `Downloading ${sizeLabel(download.bytes)}${download.totalBytes ? ` / ${sizeLabel(download.totalBytes)}` : ""}${percent !== null ? ` · ${percent}%` : ""}` : download.status === "queued" ? "Waiting in queue" : "Download failed"}</p>{(download.status === "downloading" || download.status === "queued") && <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-teal-200/70 transition-[width]" style={{ width: `${percent ?? 0}%` }} /></div>}{download.error && <p className="mt-2 text-[10px] text-rose-200/75">{download.error}</p>}</div><div className="flex shrink-0 flex-wrap justify-end gap-2">{download.status === "completed" ? <><button type="button" disabled={working !== null} onClick={() => void perform(`play:${download.key}`, async () => { beforePlay(); pausePageMedia(); const opened = await requireApi().playDownload(download.key, download.mediaType === "video" ? "watch" : "listen"); if (!opened.ok) throw new Error("Couldn't open the offline player."); onPlayerOpened(download.title); })} className="city-pop-file-action">{download.mediaType === "video" ? <Tv size={14} /> : <Headphones size={14} />}Play offline</button><button type="button" disabled={working !== null} onClick={() => void perform(`remove:${download.key}`, () => requireApi().removeDownload(download.key))} className="city-pop-file-action" aria-label={`Remove download ${download.title}`}><Trash2 size={14} /></button></> : download.status === "error" ? <><button type="button" disabled={working !== null} onClick={() => void perform(`retry:${download.key}`, () => requireApi().downloadArchive(download.itemId, download.fileName))} className="city-pop-file-action"><RefreshCw size={14} />Retry</button><button type="button" disabled={working !== null} onClick={() => void perform(`remove:${download.key}`, () => requireApi().removeDownload(download.key))} className="city-pop-file-action" aria-label={`Remove failed download ${download.title}`}><Trash2 size={14} /></button></> : <button type="button" disabled={working !== null} onClick={() => void perform(`cancel:${download.key}`, () => requireApi().cancelDownload(download.key))} className="city-pop-file-action"><X size={14} />Cancel</button>}</div></article>;
      })}</div> : <div className="city-pop-empty"><Download size={27} className="text-pink-200/60" /><p>Your offline collection starts here.</p><p className="max-w-[360px] text-xs leading-5 text-white/40">Open an archive album or video collection and download a file. Completed downloads play without an internet connection.</p><button type="button" onClick={() => showCollection("browse")} className="city-pop-outline">Explore the archive</button></div>}
    </>}
    {!showingYouTube && <p className="mt-5 text-[10px] leading-5 text-white/35">Internet Archive is a community archive. Availability, descriptions, and file quality vary by upload.</p>}
  </section>;
}
