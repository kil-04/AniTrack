import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

interface Props {
  animeTitle: string;
  animeTitleAlt?: string;
  animeId?: number;
  animeMalId?: number;
  animeYear?: number;
  inline?: boolean;
  /** Episode to jump to when "Open Player" is clicked without a specific ep selected */
  resumeEpisode?: number;
}

function scoreMatch(candidate: any, targetTitle: string, targetYear?: number): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const t = norm(targetTitle);
  const c = norm(candidate.title ?? "");
  let score = 0;
  if (c === t) {
    score += 100;
  } else if (c.includes(t) || t.includes(c)) {
    const ratio = Math.min(c.length, t.length) / Math.max(c.length, t.length);
    score += Math.round(40 * ratio);
  } else {
    const tw = new Set(t.split(/\s+/));
    const cw = c.split(/\s+/);
    const overlap = cw.filter((w: string) => tw.has(w)).length;
    score += Math.round((overlap / Math.max(tw.size, cw.length)) * 30);
  }
  if (targetYear && candidate.year) {
    if (Number(candidate.year) === targetYear) score += 8;
    else if (Math.abs(Number(candidate.year) - targetYear) <= 1) score += 2;
    else score -= 5;
  }
  return score;
}

export default function PahePanel({ animeTitle, animeTitleAlt, animeId, animeMalId, animeYear, inline = false, resumeEpisode }: Props) {
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

  function pickByTitle(res: any[], title: string): any | null {
    if (res.length === 0) return null;
    if (res.length === 1) return res[0];
    const scored = res
      .map((r: any) => ({ r, score: scoreMatch(r, title, animeYear) }))
      .sort((a: any, b: any) => b.score - a.score);
    return scored[0].score >= 20 ? scored[0].r : null;
  }

  async function pickByIds(res: any[]): Promise<any | null> {
    if (res.length === 0) return null;
    const realAnilistId = animeId && animeId < 1_000_000_000 ? animeId : undefined;
    const realMalId = animeMalId
      ?? (animeId && animeId >= 1_000_000_000 ? animeId - 1_000_000_000 : undefined);
    if (!realAnilistId && !realMalId) return null;
    const top = [...res]
      .sort((a, b) => scoreMatch(b, animeTitle, animeYear) - scoreMatch(a, animeTitle, animeYear))
      .slice(0, 3);
    for (const candidate of top) {
      try {
        const ids = await window.api.pahe.getIds(candidate.id, candidate.session);
        if (realAnilistId && ids.anilistId === realAnilistId) return candidate;
        if (realMalId && ids.malId === realMalId) return candidate;
      } catch { /* skip */ }
    }
    return null;
  }

  useEffect(() => {
    if (!animeTitle) return;
    setSelected(null);
    setResults([]);
    setShowManualSearch(false);
    setSearching(true);
    setError(null);

    async function runSearch() {
      async function tryQuery(query: string, scoreAgainst: string): Promise<boolean> {
        const r: any[] = await window.api.pahe.search(query);
        let b = pickByTitle(r, scoreAgainst);
        if (!b && (animeId || animeMalId) && r.length > 0) b = await pickByIds(r);
        if (b) { setResults(r); setSelected(b); return true; }
        return false;
      }

      const PARTICLES = new Set(["no", "na", "wa", "ga", "wo", "ni", "de", "to", "mo", "ya", "ka", "mo"]);
      function meaningfulWords(title: string, n: number): string {
        return title.split(/\s+/).filter(w => !PARTICLES.has(w.toLowerCase())).slice(0, n).join(" ");
      }

      if (await tryQuery(animeTitle, animeTitle)) return;
      if (animeTitleAlt && await tryQuery(animeTitleAlt, animeTitleAlt)) return;

      const twoWords = meaningfulWords(animeTitle, 2);
      if (twoWords !== animeTitle && twoWords.length > 3) {
        if (await tryQuery(twoWords, animeTitle)) return;
      }

      if (animeTitleAlt) {
        const twoWordsAlt = meaningfulWords(animeTitleAlt, 2);
        if (twoWordsAlt !== animeTitleAlt && twoWordsAlt.length > 3) {
          if (await tryQuery(twoWordsAlt, animeTitleAlt)) return;
        }
      }

      const oneWord = meaningfulWords(animeTitle, 1);
      if (oneWord.length > 3) {
        const r: any[] = await window.api.pahe.search(oneWord);
        if (r.length > 0) {
          let b = pickByTitle(r, animeTitle);
          if (!b && (animeId || animeMalId)) b = await pickByIds(r);
          if (b) { setResults(r); setSelected(b); return; }
        }
      }

      {
        const realAnilistId = animeId && animeId < 1_000_000_000 ? animeId : undefined;
        const realMalId = animeMalId
          ?? (animeId && animeId >= 1_000_000_000 ? animeId - 1_000_000_000 : undefined);
        if (realAnilistId || realMalId) {
          try {
            const found = await window.api.pahe.findById(realAnilistId, realMalId);
            if (found) { setResults([found]); setSelected(found); return; }
          } catch { /* swallow */ }
        }
      }

      setResults([]);
      setManualQuery(animeTitle);
      if (inline) setShowManualSearch(true);
    }

    runSearch().catch((e: any) => setError(String(e))).finally(() => setSearching(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeTitle, animeTitleAlt, animeId]);

  async function doManualSearch() {
    if (!manualQuery.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await window.api.pahe.search(manualQuery.trim());
      setResults(res);
      const best = pickByTitle(res, manualQuery.trim());
      if (best) { setSelected(best); setShowManualSearch(false); }
      else if (res.length > 0) {
        setSelected(res[0]);
        setShowManualSearch(false);
      }
    } catch (e: any) {
      setError(String(e));
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (!selected) return;
    setLoadingEps(true);
    setError(null);
    window.api.pahe.episodes(selected.session, page).then((r) => {
      setEpisodes(r.data);
      setLastPage(r.lastPage);
    }).catch((e: any) => setError(String(e))).finally(() => setLoadingEps(false));
  }, [selected, page]);

  function openStreamPlayer(ep?: any) {
    const p = new URLSearchParams({
      session: selected.session,
      title: selected.title,
    });
    // Specific ep clicked → use it; otherwise jump to resume point if known
    const targetEp = ep?.episode ?? resumeEpisode;
    if (targetEp) p.set("episode", String(targetEp));
    if (animeId) p.set("animeId", String(animeId));
    if (selected.poster) p.set("coverUrl", selected.poster);
    navigate(`/stream-player?${p.toString()}`);
  }

  if (inline) {
    return (
      <div>
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-lg font-semibold">Episodes</h2>
          {selected && selected.title !== animeTitle && (
            <span className="ml-2 text-sm text-white/40">— {selected.title}</span>
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
            <button
              onClick={() => openStreamPlayer()}
              className="mb-4 flex items-center gap-2 rounded-lg bg-[#4a9eff] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3a8eef] transition"
            >
              <Play size={14} fill="currentColor" /> Open Player
            </button>

            {loadingEps ? (
              <div className="flex items-center gap-2 py-4 text-sm text-white/40">
                <Loader2 size={14} className="animate-spin" /> Loading episodes…
              </div>
            ) : (
              <>
                <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10 md:grid-cols-12 lg:grid-cols-14 xl:grid-cols-16">
                  {episodes.map((ep) => (
                    <button
                      key={ep.session}
                      onClick={() => openStreamPlayer(ep)}
                      title={`Episode ${ep.episode}${ep.filler ? " (Filler)" : ""}`}
                      className={`flex h-10 items-center justify-center rounded text-xs font-medium transition
                        hover:bg-[#4a9eff] hover:text-white
                        ${ep.filler ? "bg-yellow-500/10 text-yellow-400/80" : "bg-white/5 text-white/70"}`}
                    >
                      {ep.episode}
                    </button>
                  ))}
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
          src="https://animepahe.pw/favicon.ico"
          className="h-4 w-4"
          alt=""
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
        <span className="text-sm font-semibold">Stream via AnimePahe</span>
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
                  key={r.session}
                  onClick={() => setSelected(r)}
                  className="flex w-full items-center gap-2 rounded-md bg-bg-elev px-3 py-2 text-left text-sm hover:bg-white/10"
                >
                  {r.poster && (
                    <img src={r.poster} className="h-8 w-6 rounded object-cover" alt="" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{r.title}</div>
                    <div className="text-xs text-muted">{r.year} · {r.episodes} eps</div>
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

          {loadingEps ? (
            <div className="flex items-center gap-2 text-xs text-muted py-2">
              <Loader2 size={12} className="animate-spin" /> Loading episodes...
            </div>
          ) : (
            <>
              <button
                onClick={() => openStreamPlayer()}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-md bg-[#4a9eff] px-3 py-2 text-sm font-semibold text-white hover:bg-[#3a8eef] transition"
              >
                <Play size={14} fill="currentColor" /> Open Player
              </button>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                {episodes.map((ep) => (
                  <button
                    key={ep.session}
                    onClick={() => openStreamPlayer(ep)}
                    className="flex h-10 items-center justify-center rounded bg-bg-elev text-xs font-medium hover:bg-[#4a9eff]/30 hover:text-white transition"
                  >
                    <Play size={9} className="mr-0.5 opacity-50" fill="currentColor" />
                    {ep.episode}
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
