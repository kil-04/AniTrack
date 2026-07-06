import { useEffect, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, ChevronLeft, ChevronRight, Loader2, Captions, Mic, Download, Check, Trash2 } from "lucide-react";
import type { PlaybackProgress } from "../../shared/types";
import { scoreMatch, pickVerifiedCandidate } from "../lib/match";
import {
  downloadsSupported,
  subscribeDownloads,
  getDownloads,
  enqueueDownload,
  enqueueBatch,
  removeDownload,
} from "../lib/downloads";

// Keyed by animeId (when a real AniList ID is known) or by title string.
// Survives navigation so re-opening a show detail page is instant.
const _searchCache = new Map<string | number, { results: any[]; selected: any }>();

interface Props {
  animeTitle: string;
  animeTitleAlt?: string;
  animeTitleRomaji?: string;
  animeId?: number;
  animeMalId?: number;
  animeYear?: number;
  animeEpisodes?: number;
  animeStatus?: string;
  inline?: boolean;
  /** Episode to jump to when "Open Player" is clicked without a specific ep selected */
  resumeEpisode?: number;
}

export default function PahePanel({ animeTitle, animeTitleAlt, animeTitleRomaji, animeId, animeMalId, animeYear, animeEpisodes, animeStatus, inline = false, resumeEpisode }: Props) {
  const navigate = useNavigate();

  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [searching, setSearching] = useState(false);

  const [episodes, setEpisodes] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [loadingEps, setLoadingEps] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState("");
  const [showManualSearch, setShowManualSearch] = useState(false);
  const manualInputRef = useRef<HTMLInputElement>(null);

  // Watched episode indicators — keyed by episode number, value is percent watched
  const [watchedEps, setWatchedEps] = useState<Map<number, number>>(new Map());
  const [epOffset, setEpOffset] = useState(0);

  // Favicon URL derived from the configured AnimePahe base URL so domain hops work.
  const [paheBaseUrl, setPaheBaseUrl] = useState<string>("https://animepahe.pw");
  useEffect(() => { window.api.pahe.getUrl().then(setPaheBaseUrl).catch(() => {}); }, []);

  // Offline downloads (Android only). Subscribe so episode tiles reflect status.
  const canDownload = downloadsSupported();
  const [, forceDownloads] = useReducer((x) => x + 1, 0);
  useEffect(() => (canDownload ? subscribeDownloads(forceDownloads) : undefined), [canDownload]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  function pickByTitle(res: any[], title: string): any | null {
    if (res.length === 0) return null;
    if (res.length === 1) return res[0];
    const scored = res
      .map((r: any) => ({ r, score: scoreMatch(r, title, animeYear, animeEpisodes, animeStatus) }))
      .sort((a: any, b: any) => b.score - a.score);
    return scored[0].score >= 20 ? scored[0].r : null;
  }

  useEffect(() => {
    if (!animeTitle) return;
    setShowManualSearch(false);
    setError(null);

    // Return immediately from cache — no network call, no spinner.
    const cacheKey: string | number =
      animeId && animeId < 1_000_000_000 ? animeId : animeTitle;
    const cached = _searchCache.get(cacheKey);
    if (cached) {
      setResults(cached.results);
      setSelected(cached.selected);
      return;
    }

    setSelected(null);
    setResults([]);
    setSearching(true);

    async function runSearch() {
      const searchQueries = [animeTitle];
      if (animeTitleAlt && !searchQueries.some(q => q.toLowerCase() === animeTitleAlt.toLowerCase())) {
        searchQueries.push(animeTitleAlt);
      }
      if (animeTitleRomaji && !searchQueries.some(q => q.toLowerCase() === animeTitleRomaji.toLowerCase())) {
        searchQueries.push(animeTitleRomaji);
      }

      const PARTICLES = new Set(["no", "na", "wa", "ga", "wo", "ni", "de", "to", "mo", "ya", "ka", "mo"]);
      function meaningfulWords(title: string, n: number): string {
        return title.split(/\s+/).filter(w => !PARTICLES.has(w.toLowerCase())).slice(0, n).join(" ");
      }

      const twoWords = meaningfulWords(animeTitle, 2);
      if (twoWords !== animeTitle && twoWords.length > 3 && !searchQueries.some(q => q.toLowerCase() === twoWords.toLowerCase())) {
        searchQueries.push(twoWords);
      }

      if (animeTitleAlt) {
        const twoWordsAlt = meaningfulWords(animeTitleAlt, 2);
        if (twoWordsAlt !== animeTitleAlt && twoWordsAlt.length > 3 && !searchQueries.some(q => q.toLowerCase() === twoWordsAlt.toLowerCase())) {
          searchQueries.push(twoWordsAlt);
        }
      }

      const oneWord = meaningfulWords(animeTitle, 1);
      if (oneWord.length > 3 && !searchQueries.some(q => q.toLowerCase() === oneWord.toLowerCase())) {
        searchQueries.push(oneWord);
      }

      // Fetch results for all queries in parallel
      const searchResultsList = await Promise.all(
        searchQueries.map(q => window.api.pahe.search(q).catch(() => []))
      );

      // Combine and deduplicate candidates
      const combinedMap = new Map<string, { candidate: any; matchedQuery: string }>();
      for (let idx = 0; idx < searchQueries.length; idx++) {
        const query = searchQueries[idx];
        const list = searchResultsList[idx];
        for (const item of list) {
          const key = `${item.providerId ?? "animepahe"}:${item.id}`;
          if (!combinedMap.has(key)) {
            combinedMap.set(key, { candidate: item, matchedQuery: query });
          }
        }
      }

      // ID fallback check
      const realAnilistId = animeId && animeId < 1_000_000_000 ? animeId : undefined;
      const realMalId = animeMalId
        ?? (animeId && animeId >= 1_000_000_000 ? animeId - 1_000_000_000 : undefined);
      if (realAnilistId || realMalId) {
        try {
          const found = await window.api.pahe.findById(realAnilistId, realMalId);
          if (found) {
            const key = `${found.providerId ?? "animepahe"}:${found.id}`;
            if (!combinedMap.has(key)) {
              combinedMap.set(key, { candidate: found, matchedQuery: animeTitle });
            }
          }
        } catch { /* swallow */ }
      }

      const allCandidates = Array.from(combinedMap.values());

      // Filter by year
      const filtered = allCandidates.filter(({ candidate }) => {
        if (animeYear && candidate.year) {
          return Math.abs(Number(candidate.year) - animeYear) <= 3;
        }
        return true;
      });

      // Score candidates
      const scored = await Promise.all(
        filtered.map(async ({ candidate, matchedQuery }) => {
          let score = scoreMatch(candidate, matchedQuery, animeYear, animeEpisodes, animeStatus);
          for (const otherQuery of searchQueries) {
            if (otherQuery !== matchedQuery) {
              const otherScore = scoreMatch(candidate, otherQuery, animeYear, animeEpisodes, animeStatus);
              if (otherScore > score) score = otherScore;
            }
          }
          return { candidate, score };
        })
      );

      // Filter and sort scored results
      const validResults = scored
        .filter(x => x.score >= 20)
        .sort((a, b) => b.score - a.score)
        .map(x => x.candidate);

      if (validResults.length > 0) {
        setResults(validResults);

        let best = null;
        if (realAnilistId || realMalId) {
          // Also verify title-plausible candidates the YEAR filter rejected:
          // a mislabeled provider entry parses the wrong year from its lying
          // title (anikoto's real City Hunter is titled "City Hunter '91"),
          // so the id check must get a look at those too.
          const normT = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
          const plausibleRejects = allCandidates
            .filter(({ candidate }) => animeYear && candidate.year && Math.abs(Number(candidate.year) - animeYear) > 3)
            .filter(({ candidate }) => {
              const c = normT(candidate.title ?? "");
              return searchQueries.some((q) => { const t = normT(q); return !!t && !!c && (c.includes(t) || t.includes(c)); });
            })
            .map(({ candidate }) => candidate)
            .slice(0, 3);

          // Serial, time-boxed verification (common case: ONE request) — see
          // pickVerifiedCandidate; parallel bursts trip provider anti-bot limits.
          const pool = [...validResults.slice(0, 3), ...plausibleRejects];
          best = await pickVerifiedCandidate(pool, realAnilistId, realMalId ?? undefined);
        }

        // A verified year-reject isn't in the visible results yet — surface it first.
        const finalResults = best && !validResults.includes(best) ? [best, ...validResults] : validResults;
        if (finalResults !== validResults) setResults(finalResults);

        if (!best) {
          best = validResults[0];
        }

        setSelected(best);
        // Bounded — evict the oldest entry once full (long browse sessions).
        if (_searchCache.size >= 100) {
          const oldest = _searchCache.keys().next().value;
          if (oldest !== undefined) _searchCache.delete(oldest);
        }
        _searchCache.set(cacheKey, { results: finalResults, selected: best });
      } else {
        setResults([]);
        setManualQuery(animeTitle);
        if (inline) setShowManualSearch(true);
      }
    }

    runSearch().catch((e: any) => setError(String(e))).finally(() => setSearching(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeTitle, animeTitleAlt, animeTitleRomaji, animeId, animeYear, animeEpisodes, animeStatus]);

  async function doManualSearch() {
    if (!manualQuery.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await window.api.pahe.search(manualQuery.trim());
      const filtered = res.filter(candidate => {
        if (animeYear && candidate.year) {
          return Math.abs(Number(candidate.year) - animeYear) <= 3;
        }
        return true;
      });
      setResults(filtered);
      const best = pickByTitle(filtered, manualQuery.trim());
      if (best) { setSelected(best); setShowManualSearch(false); }
      else if (filtered.length > 0) {
        setSelected(filtered[0]);
        setShowManualSearch(false);
      }
    } catch (e: any) {
      setError(String(e));
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    setEpOffset(0);
    setPage(1);
    setEpisodes([]);
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    setLoadingEps(true);
    setError(null);
    window.api.pahe.episodes(selected.providerId ?? "animepahe", selected.id, page).then(async (r) => {
      const rawData = [...(r.data || [])].sort((a: any, b: any) => {
        const aNum = a.episodeNumber ?? a.episode ?? 0;
        const bNum = b.episodeNumber ?? b.episode ?? 0;
        return aNum - bNum;
      });

      let currentOffset = epOffset;
      if (page === 1 && rawData.length > 0) {
        const firstEp = rawData[0].episodeNumber ?? rawData[0].episode ?? 1;
        currentOffset = Math.max(0, firstEp - 1);
        setEpOffset(currentOffset);
      } else if (page > 1 && currentOffset === 0) {
        try {
          const p1 = await window.api.pahe.episodes(selected.providerId ?? "animepahe", selected.id, 1);
          if (p1.data.length > 0) {
            const sortedP1 = [...p1.data].sort((a: any, b: any) => {
              const aNum = a.episodeNumber ?? a.episode ?? 0;
              const bNum = b.episodeNumber ?? b.episode ?? 0;
              return aNum - bNum;
            });
            const firstEp = sortedP1[0].episodeNumber ?? sortedP1[0].episode ?? 1;
            currentOffset = Math.max(0, firstEp - 1);
            setEpOffset(currentOffset);
          }
        } catch {}
      }

      const mapped = rawData.map((ep: any) => {
        const orig = ep.episodeNumber ?? ep.episode ?? 0;
        const relativeEp = Math.max(1, orig - currentOffset);
        return {
          ...ep,
          originalEpisodeNumber: orig,
          episodeNumber: relativeEp,
          episode: relativeEp,
        };
      });
      setEpisodes(mapped);
      setLastPage(r.lastPage);
    }).catch((e: any) => setError(String(e))).finally(() => setLoadingEps(false));
  }, [selected, page]);

  useEffect(() => {
    if (!selected || !animeId || animeId >= 1_000_000_000) return;
    window.api.progress.getForAnime(animeId).then((rows: PlaybackProgress[]) => {
      const m = new Map<number, number>();
      for (const r of rows) {
        if (r.durationSec > 0) m.set(r.episode, (r.positionSec / r.durationSec) * 100);
      }
      setWatchedEps(m);
    }).catch(() => {});
  }, [selected, animeId]);

  function openStreamPlayer(ep?: any) {
    const p = new URLSearchParams({
      providerId: selected.providerId ?? "animepahe",
      session: selected.id,
      title: selected.title,
    });
    const targetEp = ep?.episodeNumber ?? ep?.episode ?? resumeEpisode;
    if (targetEp) p.set("episode", String(targetEp));
    if (animeId) p.set("animeId", String(animeId));
    if (selected.poster) p.set("coverUrl", selected.poster);
    if (epOffset) p.set("episodeOffset", String(epOffset));
    if (animeEpisodes) p.set("episodes", String(animeEpisodes));
    if (animeStatus) p.set("status", animeStatus);
    navigate(`/stream-player?${p.toString()}`);
  }

  function downloadEp(ep: any) {
    if (!selected || !animeId) return;
    const epNum = ep.episodeNumber ?? ep.episode;
    enqueueDownload({
      id: `${animeId}:${epNum}`,
      animeId,
      episode: epNum,
      title: selected.title || animeTitle,
      coverUrl: selected.poster ?? null,
      providerId: selected.providerId ?? "animepahe",
      animeSession: selected.id,
      episodeSession: ep.session ?? ep.id,
    });
  }

  const BATCH_MAX = 100;

  // Queue up to 100 NEW episodes in [fromEp, toEp], skipping anything already
  // downloaded/queued — so "Download 100" repeated picks up the next 100, and a
  // range like 664–702 grabs exactly that span. Pages are pulled as needed.
  async function runBatch(fromEp: number, toEp: number) {
    if (!selected || !animeId || batchBusy) return;
    setBatchBusy(true);
    setBatchMsg(null);
    try {
      const provider = selected.providerId ?? "animepahe";
      const isHandled = (epNum: number) => {
        const d = getDownloads().get(`${animeId}:${epNum}`);
        return !!d && (d.status === "done" || d.status === "downloading" || d.status === "queued");
      };
      const collected: any[] = [];
      let pg = 1;
      let lp = lastPage || 1;
      while (collected.length < BATCH_MAX && pg <= lp) {
        const r = await window.api.pahe.episodes(provider, selected.id, pg);
        lp = r.lastPage ?? lp;
        const mapped = (r.data || [])
          .map((ep: any) => {
            const orig = ep.episodeNumber ?? ep.episode ?? 0;
            const rel = Math.max(1, orig - epOffset);
            return { ...ep, episodeNumber: rel, episode: rel };
          })
          .sort((a: any, b: any) => a.episodeNumber - b.episodeNumber);
        let beyond = false;
        for (const ep of mapped) {
          if (ep.episodeNumber > toEp) { beyond = true; continue; }
          if (ep.episodeNumber >= fromEp && !isHandled(ep.episodeNumber)) collected.push(ep);
        }
        if (beyond) break; // pages are ascending — we've passed the range end
        pg++;
      }
      const entries = collected.slice(0, BATCH_MAX).map((ep: any) => ({
        id: `${animeId}:${ep.episodeNumber}`,
        animeId: animeId!,
        episode: ep.episodeNumber,
        title: selected.title || animeTitle,
        coverUrl: selected.poster ?? null,
        providerId: provider,
        animeSession: selected.id,
        episodeSession: ep.session ?? ep.id,
      }));
      const n = enqueueBatch(entries, BATCH_MAX);
      const more = collected.length >= BATCH_MAX ? " (more remain — tap again for the next 100)" : "";
      setBatchMsg(n > 0 ? `Queued ${n} episode${n === 1 ? "" : "s"}${more}` : "Nothing new to download here");
    } catch (e: any) {
      setBatchMsg(`Batch failed: ${e?.message ?? e}`);
    } finally {
      setBatchBusy(false);
    }
  }

  if (inline) {
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Episodes</h2>
          {selected && selected.title !== animeTitle && (
            <span className="ml-1 text-sm text-white/40">— {selected.title}</span>
          )}
          {/* Real per-provider availability (from the search the panel already ran — no extra request). */}
          {selected && (selected.subCount != null || selected.dubCount != null || selected.episodes != null) && (
            <div className="ml-1 flex items-center gap-1.5">
              {selected.subCount != null ? (
                <span className="flex items-center gap-1 rounded-md bg-emerald-500/90 px-1.5 py-0.5 text-[11px] font-bold text-black">
                  <Captions size={12} /> SUB {selected.subCount}
                </span>
              ) : selected.episodes != null ? (
                <span className="flex items-center gap-1 rounded-md bg-emerald-500/90 px-1.5 py-0.5 text-[11px] font-bold text-black">
                  <Captions size={12} /> {selected.episodes} eps
                </span>
              ) : null}
              {selected.dubCount != null && selected.dubCount > 0 && (
                <span className="flex items-center gap-1 rounded-md bg-sky-500/90 px-1.5 py-0.5 text-[11px] font-bold text-black">
                  <Mic size={12} /> DUB {selected.dubCount}
                </span>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {!selected && searching && (
          <div className="flex items-center gap-2 py-4 text-sm text-white/40">
            <Loader2 size={14} className="animate-spin" /> Loading episodes…
          </div>
        )}

        {!selected && !searching && (showManualSearch || results.length === 0) && (
          <div className="py-4">
            <p className="mb-3 text-sm text-white/30">
              Not found on AnimePahe automatically. Try a manual search:
            </p>
            <div className="flex gap-2">
              <input
                ref={manualInputRef}
                autoFocus
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doManualSearch()}
                placeholder={animeTitle}
                className="flex-1 rounded-md border border-white/10 bg-bg-elev px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
              <button
                onClick={doManualSearch}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium hover:bg-accent-hover"
              >
                Search
              </button>
            </div>
          </div>
        )}

        {selected && (
          <>
            {(() => {
              const providers = Array.from(new Set(results.map((r: any) => r.providerId ?? "animepahe")));
              if (providers.length < 2) return null;
              return (
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-white/50">Server</span>
                  {providers.map((pid) => {
                    const isActive = (selected.providerId ?? "animepahe") === pid;
                    const name = pid === "anikoto" ? "Anikoto" : "AnimePahe";
                    return (
                      <button
                        key={pid}
                        onClick={() => {
                          if (isActive) return;
                          const chosen = results.find((r: any) => (r.providerId ?? "animepahe") === pid);
                          if (chosen) setSelected(chosen);
                        }}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                          isActive ? "bg-[#e50914] text-white" : "bg-white/5 text-white/70 hover:bg-white/15 hover:text-white"
                        }`}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => openStreamPlayer()}
                className="flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-white/80 transition"
              >
                <Play size={14} fill="currentColor" /> Open Player
              </button>
              {canDownload && (
                <>
                  <button
                    onClick={() => runBatch(resumeEpisode ?? 1, Number.MAX_SAFE_INTEGER)}
                    disabled={batchBusy}
                    className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/20 disabled:opacity-50 transition"
                    title="Download the next 100 episodes from your resume point"
                  >
                    {batchBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    Download 100
                  </button>
                  <button
                    onClick={() => setRangeOpen((o) => !o)}
                    disabled={batchBusy}
                    className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/20 disabled:opacity-50 transition"
                    title="Download a specific episode range"
                  >
                    <Download size={14} /> Range
                  </button>
                </>
              )}
              {batchMsg && <span className="text-xs text-white/50">{batchMsg}</span>}
            </div>

            {canDownload && rangeOpen && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="text-xs text-white/50">Episodes</span>
                <input
                  type="number"
                  min={1}
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  placeholder="from"
                  className="w-20 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white placeholder-white/30 focus:border-accent focus:outline-none"
                />
                <span className="text-white/40">–</span>
                <input
                  type="number"
                  min={1}
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  placeholder="to"
                  className="w-20 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white placeholder-white/30 focus:border-accent focus:outline-none"
                />
                <button
                  onClick={() => {
                    const f = Math.max(1, Math.floor(Number(rangeFrom)));
                    const t = Math.max(f, Math.floor(Number(rangeTo)));
                    if (f && t) runBatch(f, t);
                  }}
                  disabled={batchBusy || !rangeFrom || !rangeTo}
                  className="flex items-center gap-2 rounded-md bg-[#e50914] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#f6121d] disabled:opacity-50 transition"
                >
                  {batchBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download range
                </button>
                <span className="text-[11px] text-white/30">up to 100 at a time</span>
              </div>
            )}

            {loadingEps ? (
              <div className="flex items-center gap-2 py-4 text-sm text-white/40">
                <Loader2 size={14} className="animate-spin" /> Loading episodes…
              </div>
            ) : (
              <>
                <div className="flex flex-col divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10">
                  {episodes.map((ep) => {
                    const epNum = ep.episodeNumber ?? ep.episode;
                    const pct = watchedEps.get(epNum) ?? 0;
                    const watched = pct >= 85;
                    const inProgress = pct > 5 && !watched;
                    const dl = canDownload && animeId ? getDownloads().get(`${animeId}:${epNum}`) : undefined;
                    const st = dl?.status;
                    return (
                      <div key={ep.id ?? ep.session} className="group flex items-center gap-3 bg-white/[0.02] px-3 py-2 transition hover:bg-white/5">
                        <button onClick={() => openStreamPlayer(ep)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                          <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-white/5">
                            {ep.snapshot && (
                              <img
                                src={ep.snapshot}
                                alt=""
                                loading="lazy"
                                className="h-full w-full object-cover"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                              />
                            )}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition group-hover:opacity-100">
                              <Play size={16} className="text-white" fill="currentColor" />
                            </div>
                            {inProgress && (
                              <div className="absolute bottom-0 left-0 h-0.5 bg-[#e50914]" style={{ width: `${pct}%` }} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-medium ${watched ? "text-green-400" : "text-white"}`}>Episode {epNum}</span>
                              {ep.filler ? (
                                <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-400/90">Filler</span>
                              ) : null}
                              {watched ? <Check size={13} className="text-green-400" /> : null}
                            </div>
                            <div className="text-xs text-white/40">
                              {watched ? "Watched" : inProgress ? `${Math.round(pct)}% watched` : "Not watched"}
                            </div>
                          </div>
                        </button>
                        {canDownload && animeId && (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); if (!st || st === "failed") downloadEp(ep); }}
                              disabled={st === "done" || st === "downloading" || st === "queued"}
                              title={
                                st === "done" ? "Downloaded"
                                : st === "downloading" ? `Downloading ${dl?.progress ?? 0}%`
                                : st === "queued" ? "Queued"
                                : st === "failed" ? "Failed — tap to retry"
                                : "Download episode"
                              }
                              className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition ${
                                st === "done" ? "text-green-400"
                                : st === "failed" ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                                : "bg-white/5 text-white/70 hover:bg-white/15 hover:text-white"
                              }`}
                            >
                              {st === "done" ? <><Check size={13} /> Saved</>
                                : st === "downloading" ? <><Loader2 size={13} className="animate-spin" /> {dl?.progress ?? 0}%</>
                                : st === "queued" ? <><Loader2 size={13} className="animate-spin" /> Queued</>
                                : st === "failed" ? <><Download size={13} /> Retry</>
                                : <><Download size={13} /> Download</>}
                            </button>
                            {(st === "done" || st === "failed") && (
                              <button
                                onClick={(e) => { e.stopPropagation(); removeDownload(`${animeId}:${epNum}`); }}
                                title="Delete download"
                                className="flex h-8 w-8 items-center justify-center rounded-md text-white/40 hover:bg-white/10 hover:text-red-400 transition"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {lastPage > 1 && (
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                    >
                      <ChevronLeft size={13} /> Prev
                    </button>
                    <span className="text-xs text-white/40">Page {page} / {lastPage}</span>
                    <button
                      onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                      disabled={page === lastPage}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                    >
                      Next <ChevronRight size={13} />
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <img
          src={`${paheBaseUrl}/favicon.ico`}
          className="h-4 w-4"
          alt=""
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
        <span className="text-sm font-semibold">
          Stream via {selected ? (selected.providerId === 'anikoto' ? 'Anikoto' : 'AnimePahe') : 'AnimePahe/Anikoto'}
        </span>
      </div>

      {error && (
        <div className="mb-3 rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>
      )}

      {!selected && (
        <div>
          {searching ? (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" /> Searching AnimePahe...
            </div>
          ) : results.length === 0 ? (
            <div className="text-xs text-muted">No results found on AnimePahe.</div>
          ) : (
            <div className="space-y-1">
              <div className="mb-1 text-xs text-muted">Select the correct title:</div>
              {results.map((r) => (
                <button
                  key={r.id ?? r.session}
                  onClick={() => setSelected(r)}
                  className="flex w-full items-center gap-2 rounded-md bg-bg-elev px-3 py-2 text-left text-sm hover:bg-white/10"
                >
                  {r.poster && (
                    <img src={r.poster} className="h-8 w-6 rounded object-cover" alt="" loading="lazy" decoding="async" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{r.title}</div>
                    <div className="text-xs text-muted">{r.providerId === 'anikoto' ? 'Anikoto' : 'AnimePahe'} · {r.year || '?'} · {r.episodes || '?'} eps</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selected && (
        <div>
          {selected.title !== animeTitle && (
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-muted truncate">{selected.title}</span>
              <button onClick={() => { setSelected(null); setEpisodes([]); }} className="text-xs text-muted hover:text-white">Change</button>
            </div>
          )}
          {results.some(r => (r.providerId ?? "animepahe") !== (selected.providerId ?? "animepahe")) && (
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-muted">Source:</span>
              <select 
                value={selected.providerId ?? "animepahe"}
                onChange={e => {
                  const chosen = results.find(r => (r.providerId ?? "animepahe") === e.target.value);
                  if (chosen) setSelected(chosen);
                }}
                className="bg-bg-elev text-xs text-muted border border-white/10 rounded px-2 py-1 outline-none"
              >
                {Array.from(new Set(results.map(r => r.providerId ?? "animepahe"))).map(pid => (
                  <option key={pid} value={pid}>
                    {pid === 'anikoto' ? 'Anikoto' : 'AnimePahe'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {loadingEps ? (
            <div className="flex items-center gap-2 text-xs text-muted py-2">
              <Loader2 size={12} className="animate-spin" /> Loading episodes...
            </div>
          ) : (
            <>
              <button
                onClick={() => openStreamPlayer()}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-black hover:bg-white/80 transition"
              >
                <Play size={14} fill="currentColor" /> Open Player
              </button>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                {episodes.map((ep) => (
                  <button
                    key={ep.id ?? ep.session}
                    onClick={() => openStreamPlayer(ep)}
                    className="flex h-10 items-center justify-center rounded bg-bg-elev text-xs font-medium hover:bg-[#e50914]/30 hover:text-white transition"
                  >
                    <Play size={9} className="mr-0.5 opacity-50" fill="currentColor" />
                    {ep.episodeNumber ?? ep.episode}
                  </button>
                ))}
              </div>

              {lastPage > 1 && (
                <div className="mt-3 flex items-center justify-between">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted hover:text-white disabled:opacity-30"
                  >
                    <ChevronLeft size={12} /> Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                    disabled={page === lastPage}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted hover:text-white disabled:opacity-30"
                  >
                    Next <ChevronRight size={12} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
