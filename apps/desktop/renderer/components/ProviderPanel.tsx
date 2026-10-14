import { useEffect, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, ChevronLeft, ChevronRight, Loader2, Captions, Mic, Download, Check, Trash2, ListVideo } from "lucide-react";
import type { PlaybackProgress } from "../../../../packages/shared/types";
import type { ProviderDescriptor } from "../../../../packages/shared/provider-types";
import { orderProviderIds, providerClient, providerName } from "../lib/provider-api";
import { useProviderMatches } from "./provider/useProviderMatches";
import {
  downloadsSupported,
  subscribeDownloads,
  getDownloads,
  enqueueDownload,
  enqueueBatch,
  removeDownload,
} from "../lib/downloads";

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

export default function ProviderPanel({ animeTitle, animeTitleAlt, animeTitleRomaji, animeId, animeMalId, animeYear, animeEpisodes, animeStatus, inline = false, resumeEpisode }: Props) {
  const navigate = useNavigate();

  const [providerDescriptors, setProviderDescriptors] = useState<ProviderDescriptor[]>([]);
  const {
    results,
    selected,
    setSelected,
    searching,
    error,
    setError,
    manualQuery,
    setManualQuery,
    showManualSearch,
    searchManually: doManualSearch,
  } = useProviderMatches({
    animeTitle,
    animeTitleAlt,
    animeTitleRomaji,
    animeId,
    animeMalId,
    animeYear,
    animeEpisodes,
    animeStatus,
    showManualWhenEmpty: inline,
  });
  const manualInputRef = useRef<HTMLInputElement>(null);

  const [episodes, setEpisodes] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [loadingEps, setLoadingEps] = useState(false);

  // Watched episode indicators — keyed by episode number, value is percent watched
  const [watchedEps, setWatchedEps] = useState<Map<number, number>>(new Map());
  const [epOffset, setEpOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    providerClient.list().then((providers) => {
      if (!cancelled) setProviderDescriptors(providers);
    });
    return () => { cancelled = true; };
  }, []);

  // Optional legacy decoration for AnimePahe. Connector identity comes from
  // the provider registry above, not from this configured URL.
  const [paheBaseUrl, setPaheBaseUrl] = useState<string>("https://animepahe.pw");
  useEffect(() => { window.api.pahe.getUrl().then(setPaheBaseUrl).catch(() => {}); }, []);

  const getProviderName = (providerId: string) => providerName(providerDescriptors, providerId);
  const getResultProviderIds = () => orderProviderIds(
    Array.from(new Set(results.map((result: any) => result.providerId ?? "animepahe"))) as string[],
    providerDescriptors,
  );

  // Offline downloads are available only when both the current platform and
  // the selected connector explicitly support them. This keeps new providers
  // opt-in while their download transports are being validated.
  const selectedProviderId = selected?.providerId ?? "animepahe";
  const selectedProvider = providerDescriptors.find((provider) => provider.id === selectedProviderId);
  const canDownload = downloadsSupported() && selectedProvider?.capabilities.downloads === true;
  const [, forceDownloads] = useReducer((x) => x + 1, 0);
  useEffect(() => (canDownload ? subscribeDownloads(forceDownloads) : undefined), [canDownload]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");


  useEffect(() => {
    setEpOffset(0);
    setPage(1);
    setEpisodes([]);
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    setLoadingEps(true);
    setError(null);
    providerClient.episodes(selected.providerId ?? "animepahe", selected.id, page).then(async (r) => {
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
          const p1 = await providerClient.episodes(selected.providerId ?? "animepahe", selected.id, 1);
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
        const r = await providerClient.episodes(provider, selected.id, pg);
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
          <span className="icon-tile h-8 w-8 rounded-lg"><ListVideo size={16} strokeWidth={2.2} /></span>
          <h2 className="section-title">Episodes</h2>
          {selected && selected.title !== animeTitle && (
            <span className="ml-1 text-sm text-ink-3">· {selected.title}</span>
          )}
          {/* Real per-provider availability (from the search the panel already ran — no extra request). */}
          {selected && (selected.subCount != null || selected.dubCount != null || selected.episodes != null) && (
            <div className="ml-1 flex items-center gap-1.5">
              {selected.subCount != null ? (
                <span className="badge gap-1 bg-emerald-400/90 px-2 py-1 text-[11px] text-[#04150d]">
                  <Captions size={12} /> SUB {selected.subCount}
                </span>
              ) : selected.episodes != null ? (
                <span className="badge gap-1 bg-emerald-400/90 px-2 py-1 text-[11px] text-[#04150d]">
                  <Captions size={12} /> {selected.episodes} eps
                </span>
              ) : null}
              {selected.dubCount != null && selected.dubCount > 0 && (
                <span className="badge gap-1 bg-sky-400/90 px-2 py-1 text-[11px] text-[#03111c]">
                  <Mic size={12} /> DUB {selected.dubCount}
                </span>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
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
              Not found on the available streaming providers automatically. Try a manual search:
            </p>
            <div className="flex gap-2">
              <input
                ref={manualInputRef}
                autoFocus
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doManualSearch()}
                placeholder={animeTitle}
                className="input flex-1"
              />
              <button
                onClick={doManualSearch}
                className="btn btn-primary"
              >
                Search
              </button>
            </div>
          </div>
        )}

        {selected && (
          <>
            {(() => {
              const providers = getResultProviderIds();
              if (providers.length < 2) return null;
              return (
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-white/50">Server</span>
                  {providers.map((pid) => {
                    const isActive = (selected.providerId ?? "animepahe") === pid;
                    const name = getProviderName(pid);
                    return (
                      <button
                        key={pid}
                        onClick={() => {
                          if (isActive) return;
                          const chosen = results.find((r: any) => (r.providerId ?? "animepahe") === pid);
                          if (chosen) setSelected(chosen);
                        }}
                        className={`chip ${isActive ? "chip-active" : ""}`}
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
                className="btn btn-primary"
              >
                <Play size={14} fill="currentColor" /> Open Player
              </button>
              {canDownload && (
                <>
                  <button
                    onClick={() => runBatch(resumeEpisode ?? 1, Number.MAX_SAFE_INTEGER)}
                    disabled={batchBusy}
                    className="btn btn-secondary"
                    title="Download the next 100 episodes from your resume point"
                  >
                    {batchBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    Download 100
                  </button>
                  <button
                    onClick={() => setRangeOpen((o) => !o)}
                    disabled={batchBusy}
                    className="btn btn-secondary"
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
                  className="input h-9 w-24"
                />
                <span className="text-white/40">–</span>
                <input
                  type="number"
                  min={1}
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  placeholder="to"
                  className="input h-9 w-24"
                />
                <button
                  onClick={() => {
                    const f = Math.max(1, Math.floor(Number(rangeFrom)));
                    const t = Math.max(f, Math.floor(Number(rangeTo)));
                    if (f && t) runBatch(f, t);
                  }}
                  disabled={batchBusy || !rangeFrom || !rangeTo}
                  className="btn btn-primary btn-sm"
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
                <div className="panel flex flex-col divide-y divide-white/[0.05] overflow-hidden">
                  {episodes.map((ep) => {
                    const epNum = ep.episodeNumber ?? ep.episode;
                    const pct = watchedEps.get(epNum) ?? 0;
                    const watched = pct >= 85;
                    const inProgress = pct > 5 && !watched;
                    const dl = canDownload && animeId ? getDownloads().get(`${animeId}:${epNum}`) : undefined;
                    const st = dl?.status;
                    return (
                      <div key={ep.id ?? ep.session} className="group flex items-center gap-4 px-4 py-2.5 transition hover:bg-white/[0.04]">
                        <button onClick={() => openStreamPlayer(ep)} className="flex min-w-0 flex-1 items-center gap-4 text-left">
                          <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10 transition group-hover:ring-accent/50">
                            {ep.snapshot && (
                              <img
                                src={ep.snapshot}
                                alt=""
                                loading="lazy"
                                className="h-full w-full object-cover"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                              />
                            )}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                              <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-gradient shadow-glow"><Play size={14} className="ml-0.5 text-white" fill="currentColor" /></span>
                            </div>
                            {inProgress && (
                              <div className="absolute bottom-0 left-0 h-1 bg-accent-gradient" style={{ width: `${pct}%` }} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-semibold ${watched ? "text-ink-3" : "text-white"}`}>Episode {epNum}</span>
                              {ep.filler ? (
                                <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-400/90">Filler</span>
                              ) : null}
                              {watched ? <Check size={14} className="text-emerald-400" /> : null}
                            </div>
                            <div className="text-xs text-ink-3">
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
                              className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                                st === "done" ? "bg-emerald-400/10 text-emerald-300"
                                : st === "failed" ? "border border-red-400/20 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                                : "border border-white/[0.08] bg-white/[0.05] text-ink-2 hover:bg-white/[0.1] hover:text-white"
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
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 transition hover:bg-red-500/10 hover:text-red-300"
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
                  <div className="mt-4 flex items-center justify-center gap-1.5">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="btn btn-ghost btn-sm disabled:opacity-30"
                    >
                      <ChevronLeft size={13} /> Prev
                    </button>
                    <span className="flex h-8 items-center rounded-lg bg-white/[0.06] px-3 text-xs font-semibold tabular-nums text-ink-2">Page {page} / {lastPage}</span>
                    <button
                      onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                      disabled={page === lastPage}
                      className="btn btn-ghost btn-sm disabled:opacity-30"
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
    <div className="panel p-4">
      <div className="mb-3 flex items-center gap-2.5">
        {(selected?.providerId ?? "") === "animepahe" && (
          <img
            src={`${paheBaseUrl}/favicon.ico`}
            className="h-4 w-4"
            alt=""
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        )}
        <span className="text-sm font-bold">
          Stream via {selected
            ? getProviderName(selected.providerId ?? "animepahe")
            : (providerDescriptors.map((provider) => provider.name).join("/") || "streaming providers")}
        </span>
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {!selected && (
        <div>
          {searching ? (
            <div className="flex items-center gap-2 text-xs text-ink-3">
              <Loader2 size={12} className="animate-spin text-accent" /> Searching providers...
            </div>
          ) : results.length === 0 ? (
            <div className="text-xs text-ink-3">No results found on the available providers.</div>
          ) : (
            <div className="space-y-1">
              <div className="mb-2 text-xs font-semibold text-ink-2">Select the correct title:</div>
              {results.map((r) => (
                <button
                  key={r.id ?? r.session}
                  onClick={() => setSelected(r)}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-left text-sm transition hover:border-accent/30 hover:bg-white/[0.07]"
                >
                  {r.poster && (
                    <img src={r.poster} className="h-10 w-7 rounded-md object-cover ring-1 ring-white/10" alt="" loading="lazy" decoding="async" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">{r.title}</div>
                    <div className="text-xs text-ink-3">{getProviderName(r.providerId ?? "animepahe")} · {r.year || '?'} · {r.episodes || '?'} eps</div>
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
              <span className="truncate text-xs text-ink-2">{selected.title}</span>
              <button onClick={() => { setSelected(null); setEpisodes([]); }} className="btn btn-ghost btn-sm">Change</button>
            </div>
          )}
          {results.some(r => (r.providerId ?? "animepahe") !== (selected.providerId ?? "animepahe")) && (
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-ink-3">Source</span>
              <select 
                value={selected.providerId ?? "animepahe"}
                onChange={e => {
                  const chosen = results.find(r => (r.providerId ?? "animepahe") === e.target.value);
                  if (chosen) setSelected(chosen);
                }}
                className="input h-8 w-auto cursor-pointer rounded-lg px-2.5 text-xs [&>option]:bg-surface-2"
              >
                {getResultProviderIds().map(pid => (
                  <option key={pid} value={pid}>
                    {getProviderName(pid)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {loadingEps ? (
            <div className="flex items-center gap-2 py-2 text-xs text-ink-3">
              <Loader2 size={12} className="animate-spin text-accent" /> Loading episodes...
            </div>
          ) : (
            <>
              <button
                onClick={() => openStreamPlayer()}
                className="btn btn-primary mb-3 w-full"
              >
                <Play size={14} fill="currentColor" /> Open Player
              </button>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                {episodes.map((ep) => (
                  <button
                    key={ep.id ?? ep.session}
                    onClick={() => openStreamPlayer(ep)}
                    className="flex h-10 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.04] text-xs font-semibold tabular-nums text-ink-2 transition hover:border-accent/40 hover:bg-accent/15 hover:text-white"
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
                    className="btn btn-ghost btn-sm disabled:opacity-30"
                  >
                    <ChevronLeft size={12} /> Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                    disabled={page === lastPage}
                    className="btn btn-ghost btn-sm disabled:opacity-30"
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
