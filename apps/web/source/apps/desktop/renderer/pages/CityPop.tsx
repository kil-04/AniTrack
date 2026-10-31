import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Disc3, Heart, Library, Music2, Power, Search, Sunset, Tv, X } from "lucide-react";
import {
  CITY_POP_STATIONS,
  CITY_POP_TRACKS,
  cityPopCanonical,
  cityPopFavorites,
  cityPopPlayOrder,
  filterCityPop,
  parseCityPopSavedTracks,
  type CityPopMood,
  type CityPopTrack,
} from "../../../../packages/shared/city-pop";
import { CITY_POP_ICONS } from "../../../../packages/shared/city-pop-scene";
import { useThemePlayer } from "../store/useThemePlayer";
import CityPopArchive from "./CityPopArchive";
import { CityPopPixelIcon, CityPopPixelScene } from "./CityPopPixel";
import CityPopTrackCard from "./CityPopTrackCard";
import "./CityPop.css";

const ENABLED_KEY = "anitrack.cityPop.enabled";
const FAVORITES_KEY = "anitrack.cityPop.favorites";
const SAVED_TRACKS_KEY = "anitrack.cityPop.savedTracks";

function savedEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === "true"; } catch { return false; }
}

/** Saved search favorites; one for a curated video is that curated track, kept under its catalog id. */
function savedOnlineTracks(): CityPopTrack[] {
  try {
    return parseCityPopSavedTracks(JSON.parse(localStorage.getItem(SAVED_TRACKS_KEY) ?? "[]")).filter((track) => cityPopCanonical(track) === track);
  } catch { return []; }
}

function savedFavorites(): string[] {
  try {
    return cityPopFavorites(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]"), savedOnlineTracks());
  } catch { return []; }
}

function save(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Keep this session usable when storage is unavailable. */ }
}

/** Optional catalogue pack. All playback stays in the visible YouTube player window. */
export default function CityPop() {
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(savedEnabled);
  const [favorites, setFavorites] = useState(savedFavorites);
  const [savedTracks, setSavedTracks] = useState(savedOnlineTracks);
  const [mood, setMood] = useState<CityPopMood | "all">("all");
  const [query, setQuery] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [opening, setOpening] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [onlineTracks, setOnlineTracks] = useState<CityPopTrack[] | null>(null);
  const [onlineQuery, setOnlineQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [packTab, setPackTab] = useState<"archive" | "classics">("archive");
  const searchGeneration = useRef(0);

  useEffect(() => () => { searchGeneration.current++; }, []);

  useEffect(() => {
    if (!window.api.cityPop) return;
    let alive = true;
    void window.api.cityPop.status().then((open) => { if (alive) setPlayerOpen(open); }).catch(() => {});
    // A player closed by its own window, an episode or a theme song leaves no "opened" message behind.
    const off = window.api.cityPop.onPlaybackChanged((open) => { if (!alive) return; setPlayerOpen(open); if (!open) setNotice(null); });
    return () => { alive = false; off(); };
  }, []);

  const tracks = useMemo(() => filterCityPop(onlyFavorites ? [...CITY_POP_TRACKS, ...savedTracks] : onlineTracks ?? CITY_POP_TRACKS, onlineTracks && !onlyFavorites ? "" : query, mood, onlyFavorites ? favorites : null), [query, mood, onlyFavorites, favorites, savedTracks, onlineTracks]);
  const artists = useMemo(() => [...new Set(CITY_POP_TRACKS.map((track) => track.artist))], []);
  // Hearts match by video: a search result for a curated song shows that song's favorite.
  const favoriteVideos = useMemo(() => {
    const ids = new Set(favorites);
    return new Set([...CITY_POP_TRACKS, ...savedTracks].filter((track) => ids.has(track.id)).map((track) => track.videoId));
  }, [favorites, savedTracks]);
  const selectedStation = CITY_POP_STATIONS.find((station) => station.id === mood);

  function enable() {
    save(ENABLED_KEY, "true");
    setEnabled(true);
  }

  async function disable() {
    try {
      await window.api.cityPop?.close();
      save(ENABLED_KEY, "false");
      setEnabled(false);
      setPlayerOpen(false);
      setProblem(null);
      setNotice(null);
      searchGeneration.current++;
      setSearching(false);
    } catch { setProblem("Couldn't close the City Pop player. Close its window and try again."); }
  }

  function toggleFavorite(result: CityPopTrack) {
    // A search result for a curated song is favorited as the curated track, so it is saved once.
    const track = cityPopCanonical(result);
    const id = track.id;
    let availableTracks = savedTracks;
    if (id.startsWith("youtube-")) {
      availableTracks = favorites.includes(id) ? savedTracks.filter((item) => item.id !== id) : [...savedTracks.filter((item) => item.id !== id), track].slice(-100);
      save(SAVED_TRACKS_KEY, JSON.stringify(availableTracks));
      setSavedTracks(availableTracks);
    }
    const availableIds = new Set([...CITY_POP_TRACKS, ...availableTracks].map((item) => item.id));
    setFavorites((current) => {
      const next = (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]).filter((item) => availableIds.has(item));
      save(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function searchOnline() {
    const wanted = query.trim();
    if (wanted.length < 2 || wanted.length > 200) return;
    const generation = ++searchGeneration.current;
    setProblem(null);
    setNotice(null);
    if (!window.api.cityPop?.search) { setProblem("Online song search is available in the updated desktop app."); return; }
    setSearching(true);
    setMood("all");
    setOnlyFavorites(false);
    try {
      const results = await window.api.cityPop.search(wanted);
      if (generation !== searchGeneration.current) return;
      setOnlineTracks(results);
      setOnlineQuery(wanted);
    } catch {
      if (generation === searchGeneration.current) setProblem("Couldn't search YouTube. Check your connection and try again.");
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  }

  function browseCollection() {
    searchGeneration.current++;
    setSearching(false);
    setOnlineTracks(null);
    setQuery("");
    setMood("all");
    setOnlyFavorites(false);
  }

  /** Plays once from `startId` (the first by default) round to the track before it, as on Android. */
  async function play(tracks: readonly CityPopTrack[], mode: "listen" | "watch", label: string, startId?: string) {
    const queue = cityPopPlayOrder(tracks, startId);
    if (opening || !queue.length) return;
    setProblem(null);
    setNotice(null);
    if (!window.api.cityPop) {
      setProblem("City Pop playback is available in the updated desktop app.");
      return;
    }
    setOpening(true);
    // Theme audio uses a private audio element; episode videos live in the document.
    useThemePlayer.getState().pause();
    document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => media.pause());
    try {
      const ids = new Set(queue.map((track) => track.id));
      const result = await window.api.cityPop.open([...ids], mode, savedTracks.filter((track) => ids.has(track.id)));
      if (!result.ok) throw new Error("The player did not open.");
      setPlayerOpen(true);
      setNotice(`${label} opened in the City Pop player.`);
    } catch {
      setProblem("Couldn't open the City Pop player. Please try again.");
    } finally { setOpening(false); }
  }

  async function closePlayer() {
    try {
      await window.api.cityPop?.close();
      setPlayerOpen(false);
      setNotice(null);
    } catch { setProblem("Couldn't close the player. You can close its window directly."); }
  }

  return (
    <div className="city-pop mx-auto max-w-[1600px] px-5 pb-12 pt-5 md:px-8" data-testid="city-pop-page">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="city-pop-pixel flex items-center gap-2.5 text-white/60"><Sunset size={19} className="text-pink-300" /><button type="button" onClick={() => navigate("/songs")} className="hover:text-[#2ee6ff]" title="Back to Songs">Songs</button><span className="text-white/20">/</span><span className="text-white">City Pop</span></nav>
        <div className="flex items-center gap-3">
          <span className="city-pop-pill"><span className="h-1.5 w-1.5 rounded-full bg-teal-300" />Optional music pack</span>
          {enabled && <button type="button" onClick={() => void disable()} disabled={opening} className="city-pop-text-button" title="Disable City Pop; keep your favorites"><Power size={14} /> Disable pack</button>}
        </div>
      </header>

      {/* The full banner invites; once the pack is on, a short one leaves the music in view. */}
      <section className={`city-pop-hero ${enabled ? "city-pop-hero-compact" : ""}`} aria-labelledby="city-pop-title">
        <CityPopPixelScene horizon={enabled ? 620 : 720} sunX={enabled ? 760 : 720} sun={170} />
        <div className="city-pop-hero-shade" />
        <div className="city-pop-hero-copy">
          <div className="city-pop-kicker">AniTrack presents · Vol. 01</div>
          {!enabled && <p className="city-pop-japanese" aria-hidden="true">シティ・ポップ</p>}
          <h1 id="city-pop-title" className="city-pop-title">City Pop<span>After the sunset.</span></h1>
          {!enabled && <>
            <p className="mt-6 max-w-[430px] text-sm leading-6 text-white/80">Warm grooves, neon nights, and the sound of the Japanese coast. A little getaway inside AniTrack.</p>
            <button type="button" onClick={enable} className="city-pop-primary mt-6"><Sunset size={18} /> Enable City Pop <span className="ml-1 bg-black/15 px-1.5 py-0.5 text-[10px]">Free pack</span></button>
            <p className="mt-4 text-xs leading-5 text-white/65">Browse Internet Archive, save tracks offline, or explore YouTube classics. No account needed.</p>
          </>}
        </div>
        {!enabled && <div className="city-pop-hero-footer"><span>Japanese city pop collection</span><span>33 1/3 RPM <span className="mx-2 text-[#2ee6ff]">✦</span> Stereo</span></div>}
      </section>

      {enabled && <div id="city-pop-content" className="city-pop-pack-tabs" role="group" aria-label="City Pop collections"><button type="button" aria-pressed={packTab === "archive"} onClick={() => setPackTab("archive")} className={`city-pop-pack-tab ${packTab === "archive" ? "city-pop-pack-tab-active" : ""}`}><Library size={15} />Music &amp; Videos</button><button type="button" aria-pressed={packTab === "classics"} onClick={() => setPackTab("classics")} className={`city-pop-pack-tab ${packTab === "classics" ? "city-pop-pack-tab-active" : ""}`}><Disc3 size={15} />YouTube Classics</button></div>}

      {enabled && (problem || notice || playerOpen) && <div role={problem ? "alert" : "status"} className={`mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${problem ? "border-rose-400/25 bg-rose-400/10 text-rose-100" : "border-teal-200/15 bg-teal-200/5 text-teal-100/80"}`}><span>{problem ?? notice ?? "The City Pop player is open."}</span>{playerOpen && <button type="button" onClick={() => void closePlayer()} className="city-pop-text-button"><X size={14} />Close player</button>}</div>}

      {enabled && packTab === "archive" && <CityPopArchive beforePlay={() => useThemePlayer.getState().pause()} onPlayerOpened={(label) => { setPlayerOpen(true); setNotice(`${label} opened in the City Pop player.`); setProblem(null); }} opening={opening} favoriteVideos={favoriteVideos} onFavorite={toggleFavorite} onPlayYouTube={(track, results) => void play(results, "watch", track.title, track.id)} />}

      {(!enabled || packTab === "classics") && <>
      <div className="mb-7 mt-4 flex items-start gap-2.5 px-1 text-xs leading-5 text-white/45"><Tv size={15} className="mt-0.5 shrink-0 text-teal-200/70" /><p>YouTube Classics opens a visible player for listening or watching. These tracks stream online; downloads are available in the Internet Archive collection.</p></div>

      <section aria-labelledby="city-pop-stations">
        <div className="mb-3 flex items-center justify-between"><h2 id="city-pop-stations" className="text-lg font-semibold text-white">Find your frequency</h2><span className="text-xs text-white/40">Three ways to drift away</span></div>
        <div className="grid gap-3 md:grid-cols-3">
          {CITY_POP_STATIONS.map((station, index) => {
            const queue = CITY_POP_TRACKS.filter((track) => track.moods.includes(station.id));
            return <div key={station.id} className={`city-pop-station city-pop-station-${station.id} ${enabled && mood === station.id ? "city-pop-station-selected" : ""}`}>
              <div className="mb-4 flex items-start justify-between"><CityPopPixelIcon sprite={CITY_POP_ICONS[station.id]} /><span className="city-pop-station-number">0{index + 1}</span></div>
              <h3>{station.title}</h3><p className="mb-5 mt-2 min-h-[36px] text-xs leading-[18px] text-white/60">{station.subtitle}</p>
              {enabled ? <div className="flex items-center justify-between gap-2"><button type="button" onClick={() => { browseCollection(); setMood(station.id); }} className="city-pop-text-button">{mood === station.id ? <Check size={14} /> : <Music2 size={14} />}{queue.length} tracks</button><button type="button" disabled={opening} onClick={() => void play(queue, "listen", station.title)} className="city-pop-station-play" aria-label={`Play ${station.title}`}>▶ Play station</button></div> : <p className="city-pop-pixel text-[10px] text-white/45">Included with the pack</p>}
            </div>;
          })}
        </div>
      </section>

      {enabled && <>
        <section className="mt-8" aria-labelledby="city-pop-collection">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 id="city-pop-collection" className="text-xl font-semibold text-white">{onlyFavorites ? "Your favorites" : onlineTracks ? "YouTube search" : selectedStation?.title ?? "The collection"}</h2><p className="mt-1 text-xs text-white/45">{onlineTracks && !onlyFavorites ? `Results for “${onlineQuery}” · availability is set by YouTube.` : "A starting collection, plus online search for any song or artist."}</p></div><button type="button" disabled={!tracks.length || opening} onClick={() => void play(tracks, "listen", onlyFavorites ? "Your favorites" : selectedStation?.title ?? "The selection")} className="city-pop-outline">▶ Play selection</button></div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <form className="flex min-w-[210px] flex-1 flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void searchOnline(); }}><label className="city-pop-search"><Search size={16} /><input value={query} maxLength={200} onChange={(event) => { searchGeneration.current++; setSearching(false); setOnlineTracks(null); setQuery(event.target.value); }} placeholder="Search any song or artist" aria-label="Search songs or artists" />{query && <button type="button" onClick={browseCollection} aria-label="Clear search"><X size={14} /></button>}</label><button type="submit" disabled={searching || query.trim().length < 2} className="city-pop-outline"><Search size={14} />{searching ? "Searching…" : "Search YouTube"}</button></form>
            <button type="button" aria-pressed={mood === "all" && !onlyFavorites && !onlineTracks} onClick={browseCollection} className={`city-pop-filter ${mood === "all" && !onlyFavorites && !onlineTracks ? "city-pop-filter-active" : ""}`}>Collection</button>
            <button type="button" aria-pressed={onlyFavorites} onClick={() => { searchGeneration.current++; setSearching(false); setOnlyFavorites((on) => !on); setMood("all"); setQuery(""); }} className={`city-pop-filter ${onlyFavorites ? "city-pop-filter-active" : ""}`}><Heart size={13} fill={onlyFavorites ? "currentColor" : "none"} /> Favorites <span className="opacity-55">{favorites.length}</span></button>
            {mood !== "all" && <button type="button" onClick={() => setMood("all")} className="city-pop-filter city-pop-filter-active">{selectedStation?.title}<X size={12} /></button>}
          </div>
          <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs"><span className="text-white/35">Try an artist</span>{artists.map((artist) => <button type="button" key={artist} onClick={() => { browseCollection(); setQuery(artist); }} className={`city-pop-artist ${query === artist ? "text-pink-200" : "text-white/60"}`}>{artist}</button>)}</div>
          <div className="mb-3 text-[11px] text-white/40">{tracks.length} {tracks.length === 1 ? "track" : "tracks"}</div>
          {tracks.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{tracks.map((track) => <CityPopTrackCard key={track.id} track={track} favorite={favoriteVideos.has(track.videoId)} opening={opening} onFavorite={() => toggleFavorite(track)} onPlay={(mode) => void play(tracks, mode, track.title, track.id)} />)}</div> : <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-12 text-center"><Heart size={25} className="mx-auto mb-3 text-pink-200/50" /><p className="text-sm text-white/75">{onlyFavorites && !favorites.length ? "Keep a little collection of your own." : "No tracks match this selection."}</p><p className="mt-2 text-xs text-white/45">{onlyFavorites && !favorites.length ? "Tap a heart on any track to save it here." : onlineTracks ? "Try a different song or artist in Search YouTube." : "Search YouTube to go beyond the starting collection."}</p><button type="button" onClick={browseCollection} className="city-pop-text-button mx-auto mt-4">Browse the collection</button></div>}
        </section>
      </>}
      </>}
      <footer className="mt-9 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-4 text-[10px] uppercase tracking-[0.18em] text-white/30"><span>City Pop · Part of AniTrack Songs</span><span>{enabled ? "Pack enabled · Favorites stay on this device" : "Enable whenever you're in the mood"}</span></footer>
    </div>
  );
}

