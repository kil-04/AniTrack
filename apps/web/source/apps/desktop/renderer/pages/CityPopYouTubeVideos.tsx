import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Search, Tv, X } from "lucide-react";
import type { CityPopTrack } from "../../../../packages/shared/city-pop";
import CityPopTrackCard from "./CityPopTrackCard";

const SUGGESTIONS = ["city pop music video", "Miki Matsubara Stay With Me", "Mariya Takeuchi Plastic Love", "Tatsuro Yamashita live"];

/**
 * Real YouTube results share the existing visible player and favourites with Classics. Watch
 * plays the results from that video on, as on Android.
 */
export default function CityPopYouTubeVideos({ active, query, onQueryChange, opening, favoriteVideos, onFavorite, onPlay }: { active: boolean; query: string; onQueryChange: (value: string) => void; opening: boolean; favoriteVideos: ReadonlySet<string>; onFavorite: (track: CityPopTrack) => void; onPlay: (track: CityPopTrack, results: readonly CityPopTrack[]) => void }) {
  const [results, setResults] = useState<CityPopTrack[] | null>(null);
  const [submitted, setSubmitted] = useState("");
  const [requested, setRequested] = useState("");
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => { if (!active) { generation.current++; setSearching(false); } }, [active]);

  async function search(value: string) {
    const wanted = value.trim();
    if (wanted.length < 2 || wanted.length > 200) return;
    const request = ++generation.current;
    onQueryChange(value);
    setRequested(wanted);
    setProblem(null);
    setSearching(true);
    try {
      if (!window.api.cityPop?.search) throw new Error("Unavailable");
      const found = await window.api.cityPop.search(wanted);
      if (!alive.current || request !== generation.current) return;
      setResults(found);
      setSubmitted(wanted);
    } catch {
      if (alive.current && request === generation.current) setProblem("Couldn't search YouTube. Check your connection and try again.");
    } finally {
      if (alive.current && request === generation.current) setSearching(false);
    }
  }

  function changeQuery(value: string) {
    generation.current++;
    setSearching(false);
    setProblem(null);
    onQueryChange(value);
  }

  return <div hidden={!active}>
    <form onSubmit={(event) => { event.preventDefault(); void search(query); }} className="mb-3 flex flex-wrap gap-2"><label className="city-pop-search !max-w-[620px]"><Search size={16} /><input value={query} maxLength={200} onChange={(event) => changeQuery(event.target.value)} placeholder="Search YouTube for any song, artist, or music video" aria-label="Search YouTube videos" />{query && <button type="button" onClick={() => changeQuery("")} aria-label="Clear YouTube search"><X size={14} /></button>}</label><button type="submit" disabled={searching || query.trim().length < 2} className="city-pop-outline">{searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}{searching ? "Searching…" : "Search YouTube"}</button></form>
    <p className="mb-4 text-[11px] leading-5 text-white/45">Search YouTube's online catalogue by song or artist. Videos play in the visible City Pop player.</p>
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs"><span className="text-white/35">Try a search</span>{SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => void search(suggestion)} className="city-pop-artist text-white/60">{suggestion}</button>)}</div>
    {problem && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-300/20 bg-rose-300/[0.07] px-4 py-3 text-xs text-rose-100"><span>{problem}</span><button type="button" onClick={() => void search(requested)} className="city-pop-text-button"><RefreshCw size={13} />Try again</button></div>}
    {searching ? <div className="city-pop-empty" role="status"><Loader2 size={26} className="animate-spin text-pink-200/60" /><p>Searching YouTube…</p></div> : results?.length ? <><p className="mb-3 text-[11px] text-white/40">{results.length} videos for “{submitted}” · YouTube</p><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{results.map((track) => <CityPopTrackCard key={track.id} track={track} watchOnly favorite={favoriteVideos.has(track.videoId)} opening={opening} onFavorite={() => onFavorite(track)} onPlay={() => onPlay(track, results)} />)}</div></> : <div className="city-pop-empty"><Tv size={27} className="text-pink-200/60" /><p>{results ? `No YouTube videos found for “${submitted}”.` : "Find the video you have in mind."}</p><p className="max-w-[440px] text-xs leading-5 text-white/45">{results ? "Try another song title, artist, or performance." : "Type a song title or artist and press Enter, or choose a search above. Results come from YouTube, beyond the starter collection."}</p></div>}
    <p className="mt-5 text-[10px] leading-5 text-white/35">YouTube videos stream online. Choose Internet Archive for downloadable videos; availability varies by upload.</p>
  </div>;
}
