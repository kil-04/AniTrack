import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Dices, Disc3, Flower2, Headphones, Leaf, ListMusic, Music2, Play, Search,
  Snowflake, Sparkles, Sun, Tv, Volume2, VolumeX, Waves,
} from "lucide-react";
import {
  ANISONGS,
  SEASONS,
  decadeLabel,
  decadeOf,
  previousSeason,
  rankSongs,
  seasonOf,
  songAudioUrl,
  songSlug,
  songVideoUrl,
  toThemeSong,
  type AniSong,
  type ChartOrder,
  type SeasonName,
  type SongCharts,
  type SongKind,
  type SongSearchBy,
} from "../../../../packages/shared/anisongs";
import { useThemePlayer } from "../store/useThemePlayer";
import { VideoPlayer, type VideoItem } from "../components/VideoPlayer";
import { safeImageSrc } from "../lib/image-guard";

/**
 * Songs as a jukebox: a spinning record for the chart's #1, a radio-style dial from 1960
 * to now (drag for a year, tap a decade), and tabs for the chart, seasons and search, so
 * nothing needs a long scroll. Hovering a song plays a few seconds of it; small UI sounds
 * follow the dial. Both can be switched off. Mirrors the Android SongsScreen.
 */

const GOLDEN = [1970, 1980, 1990];
const ERA_NOTE: Record<number, string> = {
  1960: "Astro Boy and the first TV anime themes.",
  1970: "Super robots, space operas and the first anisong stars.",
  1980: "City pop, idols and the golden age of TV anime.",
  1990: "Evangelion, Sailor Moon and the anisong boom.",
  2000: "J-rock openings and the late-night anime wave.",
  2010: "Idol units, viral openings and streaming.",
  2020: "Global hits and openings everyone covers.",
};
const PREFS = { order: "anitrack.songs.order", scope: "anitrack.songs.scope", sounds: "anitrack.songs.sounds", previews: "anitrack.songs.previews" };
const CHART_PREVIEW = 20;
const THIS_YEAR = new Date().getFullYear();
const PODIUM = ["#FCD34D", "#CBD5E1", "#D97706"];

type Scope = { type: "decade"; value: number } | { type: "year"; value: number } | { type: "all" };
type Tab = "chart" | "seasons" | "search";
type Watch = (songs: AniSong[], index: number, label: string) => void;

function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage off: not remembered */ }
}
function readScope(): Scope {
  const raw = read(PREFS.scope) ?? "";
  const m = /^(decade|year):(\d{4})$/.exec(raw);
  if (raw === "all") return { type: "all" };
  if (m && +m[2] >= ANISONGS.FIRST_YEAR && +m[2] <= THIS_YEAR) return { type: m[1] as "decade" | "year", value: +m[2] };
  return { type: "decade", value: 1980 };
}
const scopeKey = (s: Scope) => (s.type === "all" ? "all" : `${s.type}:${s.value}`);
const scopeTitle = (s: Scope) => (s.type === "all" ? "All time" : s.type === "decade" ? `The ${String(s.value).slice(2)}s` : String(s.value));

/** 2858 → "2.9K", 180283 → "180K". */
function compactCount(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

// ── Sound: tiny synthesized UI sounds, and hover previews of the songs themselves ──

let audioContext: AudioContext | null = null;
function blip(freq: number, ms: number, volume = 0.05, type: OscillatorType = "sine") {
  try {
    audioContext ??= new AudioContext();
    const ctx = audioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  } catch { /* no audio output: silent */ }
}
const SOUNDS = {
  tick: () => blip(1800, 25, 0.025, "square"),
  select: () => { blip(660, 70, 0.05); setTimeout(() => blip(990, 90, 0.05), 60); },
  tab: () => blip(520, 60, 0.04, "triangle"),
  dice: () => [0, 50, 100, 150].forEach((d, i) => setTimeout(() => blip(400 + i * 120, 40, 0.04, "square"), d)),
};

let previewAudio: HTMLAudioElement | null = null;
let previewTimer: number | undefined;
function stopPreview() {
  window.clearTimeout(previewTimer);
  const a = previewAudio;
  if (!a || a.paused) return;
  const fade = window.setInterval(() => {
    a.volume = Math.max(0, a.volume - 0.05);
    if (a.volume <= 0.01) { a.pause(); window.clearInterval(fade); }
  }, 30);
}
/** Plays about eight seconds of the song, faded in and out, unless a theme is already playing. */
function startPreview(song: AniSong, onState: (playing: boolean) => void) {
  const url = songAudioUrl(song);
  if (!url || useThemePlayer.getState().playing) return;
  previewAudio ??= new Audio();
  const a = previewAudio;
  a.src = url;
  a.volume = 0;
  a.currentTime = 0;
  a.onplaying = () => onState(true);
  a.onpause = () => onState(false);
  void a.play().catch(() => onState(false));
  const fadeIn = window.setInterval(() => { a.volume = Math.min(0.4, a.volume + 0.04); if (a.volume >= 0.4) window.clearInterval(fadeIn); }, 40);
  previewTimer = window.setTimeout(stopPreview, 8000);
}

/** Plays songs as audio through the shared theme player. */
function playAudio(songs: AniSong[], start: number, label: string) {
  stopPreview();
  const queue = songs.filter((s) => s.audio).map(toThemeSong);
  const first = songs[start];
  const index = Math.max(0, queue.findIndex((s) => first && s.title === first.title && s.animeTitle === first.anime));
  if (queue.length) useThemePlayer.getState().play(queue, index, label);
}

export default function Songs() {
  const [charts, setCharts] = useState<SongCharts | null>(null);
  const [scope, setScope] = useState<Scope>(readScope);
  const [kind, setKind] = useState<SongKind>("OP");
  const [order, setOrder] = useState<ChartOrder>(() => (read(PREFS.order) === "known" ? "known" : "best"));
  const [tab, setTab] = useState<Tab>("chart");
  const [sounds, setSounds] = useState(() => read(PREFS.sounds) !== "off");
  const [previews, setPreviews] = useState(() => read(PREFS.previews) !== "off");
  // The video player: docked beside the page, or full screen.
  const [player, setPlayer] = useState<{ songs: AniSong[]; index: number; label: string; full: boolean } | null>(null);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const themePlaying = useThemePlayer((s) => s.playing);

  useEffect(() => { window.api.songs.charts().then(setCharts).catch(() => setCharts(null)); }, []);
  useEffect(() => write(PREFS.order, order), [order]);
  useEffect(() => write(PREFS.scope, scopeKey(scope)), [scope]);
  useEffect(() => write(PREFS.sounds, sounds ? "on" : "off"), [sounds]);
  useEffect(() => write(PREFS.previews, previews ? "on" : "off"), [previews]);
  useEffect(() => () => stopPreview(), []);

  const sfx = useCallback((name: keyof typeof SOUNDS) => { if (sounds) SOUNDS[name](); }, [sounds]);
  const chart = useMemo(() => {
    if (!charts) return [];
    const set = scope.type === "all" ? charts.allTime : scope.type === "decade" ? charts.decades[String(scope.value)] : charts.years[String(scope.value)];
    return set?.[order][kind] ?? [];
  }, [charts, scope, order, kind]);
  const label = `${scopeTitle(scope)} · ${kind === "OP" ? "openings" : "endings"}`;
  const lead = chart[0];
  const playingId = player ? player.songs[player.index]?.id ?? null : null;
  const docked = !!player && !player.full;
  const watch: Watch = (songs, index, title) => {
    stopPreview();
    const playable = songs.filter((s) => s.video);
    const at = playable.indexOf(songs[index]);
    if (playable.length) setPlayer((p) => ({ songs: playable, index: Math.max(0, at), label: title, full: p?.full ?? false }));
  };
  const hover = useMemo(() => ({
    enter: (song: AniSong) => {
      if (!previews) return;
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(() => startPreview(song, (on) => setPreviewing(on ? song.id : null)), 450);
    },
    leave: () => { window.clearTimeout(previewTimer); stopPreview(); setPreviewing(null); },
  }), [previews]);
  const surprise = () => {
    if (!chart.length) return;
    sfx("dice");
    watch(chart, Math.floor(Math.random() * chart.length), `${label} · surprise`);
  };

  return (
    <div className={`mx-auto max-w-[1400px] px-8 pb-28 pt-6 transition-[padding] duration-300 ${docked ? "pr-[412px]" : ""}`}>
      <style>{`
        @keyframes songs-spin { to { transform: rotate(360deg); } }
        @keyframes songs-eq { 0%,100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }
        @keyframes songs-glow { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
        @keyframes songs-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes songs-pop { 0% { opacity: 0; transform: scale(.9) translateY(18px); } 70% { opacity: 1; transform: scale(1.02); } 100% { opacity: 1; transform: none; } }
        @keyframes songs-from-right { from { opacity: 0; transform: translateX(32px); } to { opacity: 1; transform: none; } }
        @keyframes songs-from-left { from { opacity: 0; transform: translateX(-32px); } to { opacity: 1; transform: none; } }
        @keyframes songs-dock { from { opacity: 0; transform: translateX(48px) scale(.96); } to { opacity: 1; transform: none; } }
        @keyframes songs-zoom { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
        .songs-rise { animation: songs-rise .35s ease-out both; }
        .songs-pop { animation: songs-pop .55s cubic-bezier(.2,.8,.2,1) both; }
      `}</style>

      {/* Jukebox */}
      <section className="relative mb-5 overflow-hidden rounded-3xl border border-white/10 bg-surface-1">
        {lead?.cover && <img src={safeImageSrc(lead.cover)} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-20 blur-2xl" />}
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-transparent" />
        <div className="relative flex items-center gap-8 p-7">
          {/* Docked player: the record steps aside until the window is wide. */}
          <div className={docked ? "hidden 2xl:block" : ""}><Vinyl song={lead} spinning={themePlaying || previewing != null || playingId != null} onClick={() => lead && watch(chart, 0, label)} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-accent"><Music2 size={14} /> AniTrack Jukebox</div>
            <h1 className="mt-1 text-5xl font-black tracking-tight">{scopeTitle(scope)}</h1>
            <p className="mt-1 text-sm text-white/55">{scope.type === "all" ? "Sixty years of openings and endings." : ERA_NOTE[decadeOf(scope.value)]}</p>
            {lead && (
              <p className="mt-4 truncate text-lg"><span className="font-black text-amber-300">#1 </span><span className="font-bold">{lead.title}</span><span className="text-white/50"> · {lead.artist} · {lead.anime}</span></p>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button disabled={!chart.length} onClick={() => { sfx("select"); watch(chart, 0, label); }} className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:scale-[1.03] hover:bg-white/90 disabled:opacity-40"><Tv size={16} /> Watch all</button>
              <button disabled={!chart.length} onClick={() => { sfx("select"); playAudio(chart, 0, label); }} className="flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold transition hover:bg-white/20 disabled:opacity-40"><Headphones size={16} /> Listen</button>
              <button disabled={!chart.length} onClick={surprise} className="group flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold transition hover:bg-white/20 disabled:opacity-40"><Dices size={16} className="transition group-hover:rotate-45" /> Surprise me</button>
              <span className="mx-2 h-6 w-px bg-white/10" />
              <Toggle value={order} onChange={(v) => { sfx("tab"); setOrder(v); }} options={[["best", "Best", "What people listen to as music"], ["known", "Most known", "What most fans recognise"]]} />
              <Toggle value={kind} onChange={(v) => { sfx("tab"); setKind(v); }} options={[["OP", "Openings", ""], ["ED", "Endings", ""]]} />
            </div>
          </div>
          <div className="flex flex-col gap-2 self-start">
            <IconSwitch on={sounds} onClick={() => setSounds((v) => !v)} onIcon={<Volume2 size={15} />} offIcon={<VolumeX size={15} />} label="UI sounds" />
            <IconSwitch on={previews} onClick={() => { setPreviews((v) => !v); stopPreview(); }} onIcon={<Waves size={15} />} offIcon={<Waves size={15} className="opacity-40" />} label="Hover previews" />
          </div>
        </div>
        <YearDial scope={scope} onScope={(s) => { setScope(s); setTab((t) => (t === "search" ? "chart" : t)); }} sfx={sfx} />
      </section>

      {/* Tabs */}
      <div className="sticky top-0 z-20 -mx-2 mb-4 flex items-center gap-1 bg-bg/90 px-2 py-2 backdrop-blur">
        {([["chart", "Chart", <ListMusic key="c" size={15} />], ["seasons", "Seasons", <Sparkles key="s" size={15} />], ["search", "Search", <Search key="q" size={15} />]] as const).map(([key, text, icon]) => (
          <button key={key} onClick={() => { sfx("tab"); setTab(key); }}
            className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold transition ${tab === key ? "bg-accent text-white shadow-[0_0_20px_rgb(var(--accent)/0.4)]" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>
            {icon}{text}
          </button>
        ))}
        <span className="ml-auto text-xs text-white/35">{previews ? "Hover a song to hear it" : "Previews off"}</span>
      </div>

      {/* Re-keyed when the chart or tab changes, so the new list rises in. */}
      <div key={tab === "chart" ? `chart:${scopeKey(scope)}:${order}:${kind}` : tab} className="songs-rise">
      {tab === "chart" && (
        !charts ? <Loading /> : chart.length
          ? <ChartView songs={chart} order={order} label={label} onWatch={watch} hover={hover} previewing={previewing} playingId={playingId} />
          : <Empty text="No chart for this year yet." />
      )}
      {tab === "seasons" && <SeasonsView year={scope.type === "year" ? scope.value : scope.type === "decade" ? scope.value + 5 : 1998} kind={kind} onWatch={watch} hover={hover} previewing={previewing} sfx={sfx} />}
      {tab === "search" && <SearchView onWatch={watch} hover={hover} previewing={previewing} />}
      </div>

      <p className="mt-6 text-[11px] text-white/30">
        {order === "best"
          ? "Best: ranked by how much people play each song: its views across everyone's YouTube uploads, or its Last.fm listeners, with kids' shows weighted down; songs neither knows use half their quiz score."
          : "Most known: ranked by the share of Anime Music Quiz players who recognise each song (AnisongDB)."}
        {" "}Videos and songs from AnisongDB. {charts ? `Charts updated ${new Date(charts.generatedAt).toLocaleDateString()}.` : ""}
      </p>

      {player && (
        <VideoPlayer
          label={player.label}
          index={player.index}
          full={player.full}
          items={player.songs.map(videoItem)}
          onSongStart={stopPreview}
          onIndex={(index) => { sfx("tick"); setPlayer((p) => p && { ...p, index: (index + p.songs.length) % p.songs.length }); }}
          onFull={(full) => { sfx("select"); setPlayer((p) => p && { ...p, full }); }}
          onClose={() => { sfx("tab"); setPlayer(null); }}
        />
      )}
    </div>
  );
}

type Hover = { enter: (song: AniSong) => void; leave: () => void };

// ── Jukebox pieces ──────────────────────────────────────────────────────────

function Vinyl({ song, spinning, onClick }: { song?: AniSong; spinning: boolean; onClick: () => void }) {
  const cover = safeImageSrc(song?.cover ?? undefined);
  return (
    <button onClick={onClick} title={song ? `Watch ${song.title}` : undefined} className="group relative h-52 w-52 flex-shrink-0 rounded-full shadow-[0_20px_60px_rgba(0,0,0,.6)]">
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: "repeating-radial-gradient(circle at center, #111 0 2px, #1c1c1c 2px 4px)",
          animation: "songs-spin 5s linear infinite",
          animationPlayState: spinning ? "running" : "paused",
        }}
      >
        <div className="absolute inset-[30%] overflow-hidden rounded-full border-4 border-black/60 bg-accent">
          {cover && <img src={cover} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black" />
        <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,rgba(255,255,255,.08)_40deg,transparent_80deg,transparent_180deg,rgba(255,255,255,.06)_220deg,transparent_260deg)]" />
      </div>
      <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition group-hover:opacity-100"><Play size={40} fill="white" /></span>
    </button>
  );
}

/** A radio tuner from 1960 to now: drag or click for a year, tap a decade label for the decade. */
function YearDial({ scope, onScope, sfx }: { scope: Scope; onScope: (s: Scope) => void; sfx: (n: keyof typeof SOUNDS) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const last = useRef<number | null>(null);
  const years = THIS_YEAR - ANISONGS.FIRST_YEAR + 1;
  const pos = (year: number) => ((year - ANISONGS.FIRST_YEAR + 0.5) / years) * 100;
  const yearAt = (clientX: number) => {
    const box = ref.current!.getBoundingClientRect();
    const t = Math.min(0.9999, Math.max(0, (clientX - box.left) / box.width));
    return ANISONGS.FIRST_YEAR + Math.floor(t * years);
  };
  const tune = (year: number) => {
    if (last.current !== year) { sfx("tick"); last.current = year; }
    onScope({ type: "year", value: year });
  };
  useEffect(() => {
    const move = (e: PointerEvent) => { if (dragging.current) tune(yearAt(e.clientX)); };
    const up = () => { if (dragging.current) sfx("select"); dragging.current = false; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  });
  const needle = scope.type === "year" ? pos(scope.value) : scope.type === "decade" ? pos(scope.value + 4.5) : null;
  return (
    <div className="relative border-t border-white/10 bg-black/30 px-7 pb-4 pt-3"
      onKeyDown={(e) => {
        const current = scope.type === "all" ? THIS_YEAR : scope.value;
        if (e.key === "ArrowLeft") { e.preventDefault(); tune(Math.max(ANISONGS.FIRST_YEAR, current - 1)); }
        if (e.key === "ArrowRight") { e.preventDefault(); tune(Math.min(THIS_YEAR, current + 1)); }
      }}>
      <div className="mb-2 flex items-center gap-2">
        {ANISONGS.DECADES.map((d) => {
          const active = scope.type === "decade" && scope.value === d;
          const golden = GOLDEN.includes(d);
          return (
            <button key={d} onClick={() => { sfx("select"); onScope({ type: "decade", value: d }); }}
              className={`relative rounded-full px-3 py-1 text-xs font-black transition ${active ? "bg-white text-black" : golden ? "text-amber-200 hover:bg-amber-300/10" : "text-white/50 hover:bg-white/5 hover:text-white"}`}>
              {golden && !active && <span className="absolute inset-0 rounded-full border border-amber-300/40" style={{ animation: "songs-glow 2.4s ease-in-out infinite" }} />}
              {decadeLabel(d)}
            </button>
          );
        })}
        <button onClick={() => { sfx("select"); onScope({ type: "all" }); }}
          className={`rounded-full px-3 py-1 text-xs font-black transition ${scope.type === "all" ? "bg-white text-black" : "text-white/50 hover:bg-white/5 hover:text-white"}`}>All time</button>
        <span className="ml-auto text-[11px] text-white/35">Drag the dial for any year · ← → to step</span>
      </div>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label="Year"
        aria-valuemin={ANISONGS.FIRST_YEAR}
        aria-valuemax={THIS_YEAR}
        aria-valuenow={scope.type === "year" ? scope.value : undefined}
        onPointerDown={(e) => { dragging.current = true; last.current = null; tune(yearAt(e.clientX)); }}
        className="relative h-12 cursor-ew-resize select-none rounded-xl bg-gradient-to-b from-white/[.04] to-transparent outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {/* The golden decades glow on the scale. */}
        <div className="absolute inset-y-0 rounded-lg bg-amber-300/[.07]" style={{ left: `${pos(1970) - 0.75}%`, width: `${(30 / years) * 100}%` }} />
        {Array.from({ length: years }, (_, i) => {
          const year = ANISONGS.FIRST_YEAR + i;
          const major = year % 10 === 0;
          const mid = year % 5 === 0;
          return (
            <div key={year} className="absolute bottom-3 w-px -translate-x-1/2" style={{ left: `${pos(year)}%`, height: major ? 22 : mid ? 14 : 8, background: major ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.2)" }}>
              {major && <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-white/40">{year}</span>}
            </div>
          );
        })}
        {needle != null && (
          <div className="pointer-events-none absolute inset-y-0 transition-[left] duration-150" style={{ left: `${needle}%` }}>
            <div className="absolute inset-y-1 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_12px_rgb(var(--accent))]" />
            {scope.type === "year" && <div className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-black text-white">{scope.value}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string, string])[] }) {
  return (
    <div className="flex rounded-full bg-white/5 p-1" role="radiogroup">
      {options.map(([key, text, hint]) => (
        <button key={key} role="radio" aria-checked={value === key} title={hint || undefined} onClick={() => onChange(key)}
          className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${value === key ? "bg-white text-black" : "text-white/60 hover:text-white"}`}>{text}</button>
      ))}
    </div>
  );
}

function IconSwitch({ on, onClick, onIcon, offIcon, label }: { on: boolean; onClick: () => void; onIcon: JSX.Element; offIcon: JSX.Element; label: string }) {
  return (
    <button onClick={onClick} title={`${label}: ${on ? "on" : "off"}`} aria-pressed={on}
      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${on ? "bg-white/10 text-white" : "bg-white/5 text-white/40"}`}>
      {on ? onIcon : offIcon}{label}
    </button>
  );
}

function Equalizer() {
  return (
    <span className="flex h-4 items-end gap-[2px]" aria-label="Playing">
      {[0, 150, 300, 80].map((delay, i) => (
        <span key={i} className="w-[3px] origin-bottom rounded-full bg-accent" style={{ height: "100%", animation: `songs-eq .7s ease-in-out ${delay}ms infinite` } as CSSProperties} />
      ))}
    </span>
  );
}

function Loading() {
  return <div className="flex items-center gap-2 py-10 text-sm text-white/40"><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" /> Loading songs…</div>;
}
function Empty({ text }: { text: string }) {
  return <p className="py-10 text-center text-sm text-white/40">{text}</p>;
}

// ── Chart ───────────────────────────────────────────────────────────────────

function ChartView({ songs, order, label, onWatch, hover, previewing, playingId }: { songs: AniSong[]; order: ChartOrder; label: string; onWatch: Watch; hover: Hover; previewing: number | null; playingId: number | null }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [songs]);
  const top = songs.slice(0, 3);
  const rest = songs.slice(3, expanded ? songs.length : CHART_PREVIEW);
  return (
    <div>
      {/* Podium: #2, #1, #3 */}
      <div className="mb-6 grid grid-cols-3 items-end gap-4">
        {[1, 0, 2].map((i, slot) => top[i] && (
          <div key={top[i].id} className="songs-pop" style={{ animationDelay: `${[110, 0, 220][slot]}ms` }}>
            <PodiumCard song={top[i]} rank={i + 1} tall={i === 0} order={order}
              onWatch={() => onWatch(songs, i, label)} hover={hover} playing={previewing === top[i].id || playingId === top[i].id} />
          </div>
        ))}
      </div>
      <SongRows songs={songs} start={3} shown={rest} order={order} label={label} onWatch={onWatch} hover={hover} previewing={previewing} playingId={playingId} />
      {songs.length > CHART_PREVIEW && (
        <button onClick={() => setExpanded((e) => !e)} className="mt-4 rounded-full bg-white/5 px-5 py-2 text-xs font-bold text-white/70 hover:bg-white/10">
          {expanded ? "Show the top 20" : `Show all ${songs.length}`}
        </button>
      )}
    </div>
  );
}

function PodiumCard({ song, rank, tall, order, onWatch, hover, playing }: { song: AniSong; rank: number; tall: boolean; order: ChartOrder; onWatch: () => void; hover: Hover; playing: boolean }) {
  const cover = safeImageSrc(song.cover ?? undefined);
  const color = PODIUM[rank - 1];
  return (
    <button onClick={onWatch} onMouseEnter={() => hover.enter(song)} onMouseLeave={hover.leave}
      className={`group relative w-full overflow-hidden rounded-2xl border text-left transition duration-300 hover:-translate-y-1 ${tall ? "h-72" : "h-60"}`}
      style={{ borderColor: `${color}66`, boxShadow: playing ? `0 0 40px ${color}55` : undefined }}>
      {cover ? <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : <div className="absolute inset-0 bg-surface-2" />}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
      <div className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-full text-lg font-black text-black shadow-lg" style={{ background: color }}>{rank}</div>
      {playing && <div className="absolute right-3 top-3 rounded-full bg-black/60 p-2"><Equalizer /></div>}
      <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100"><span className="rounded-full bg-white/90 p-3 text-black"><Play size={22} fill="black" /></span></span>
      <div className="absolute inset-x-0 bottom-0 p-4">
        <div className="truncate text-lg font-black">{song.title}</div>
        <div className="truncate text-xs text-white/60">{song.artist}</div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-white/45">
          <span className="truncate">{song.anime} · {songSlug(song)}{song.year ? ` · ${song.year}` : ""}</span>
          <Score song={song} order={order} compact />
        </div>
      </div>
    </button>
  );
}

function Score({ song, order, compact = false }: { song: AniSong; order: ChartOrder; compact?: boolean }) {
  if (order === "best") {
    if (song.licensed) return <span className="whitespace-nowrap text-white/40" title="Its plays aren't anime fans' (a licensed western song, or an artist name shared with another act), so it's ranked by its quiz score">not counted</span>;
    if (song.views) return <span className="whitespace-nowrap font-semibold text-white/70" title={`${song.views.toLocaleString()} views across everyone's YouTube uploads of it`}>▶ {compactCount(song.views)}{compact ? "" : " views"}</span>;
    return song.listeners != null
      ? <span className="whitespace-nowrap font-semibold text-white/70" title={`${song.listeners.toLocaleString()} people play it on Last.fm`}>♫ {compactCount(song.listeners)}{compact ? "" : " listeners"}</span>
      : <span className="whitespace-nowrap text-white/35" title="Not on Last.fm: ranked by its quiz score">—</span>;
  }
  return song.recognition != null
    ? <span className="whitespace-nowrap font-semibold text-white/70" title={`${Math.round(song.recognition)}% of quiz players recognise it`}>{Math.round(song.recognition)}%{compact ? "" : " know it"}</span>
    : null;
}

/** Rows of songs; `start` numbers them after a podium. */
function SongRows({ songs, start = 0, shown, order, label, onWatch, hover, previewing, playingId = null, ranked = true }: {
  songs: AniSong[]; start?: number; shown?: AniSong[]; order: ChartOrder | null; label: string; onWatch: Watch; hover: Hover; previewing: number | null; playingId?: number | null; ranked?: boolean;
}) {
  const navigate = useNavigate();
  const list = shown ?? songs;
  return (
    <ol className="grid gap-x-6 gap-y-1 lg:grid-cols-2">
      {list.map((song, i) => {
        const index = songs.indexOf(song);
        const cover = safeImageSrc(song.cover ?? undefined);
        const playing = previewing === song.id || playingId === song.id;
        return (
          <li key={song.id} onMouseEnter={() => hover.enter(song)} onMouseLeave={hover.leave} style={{ animationDelay: `${Math.min(i, 24) * 16}ms` }}
            className={`songs-rise group flex items-center gap-3 rounded-xl px-2 py-1.5 transition ${playing ? "bg-accent/15" : "hover:bg-white/5"}`}>
            {ranked && <span className="w-7 flex-shrink-0 text-right text-sm font-black tabular-nums text-white/35">{(index >= 0 ? index : start + i) + 1}</span>}
            <button onClick={() => onWatch(songs, index, label)} disabled={!song.video} title="Watch the video" className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-white/5 disabled:cursor-default">
              {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : <Disc3 className="m-auto h-full text-white/20" size={22} />}
              {song.video && <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100"><Play size={18} fill="white" /></span>}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 truncate text-sm font-bold">{song.title}{playing && <Equalizer />}</div>
              <div className="truncate text-xs text-white/50">
                {song.artist} ·{" "}
                {song.anilistId ? <button onClick={() => navigate(`/anime/${song.anilistId}`)} className="hover:text-white hover:underline">{song.anime}</button> : song.anime}
                {" "}· {songSlug(song)}{song.season ? ` · ${song.season}` : ""}
              </div>
            </div>
            {order && <div className="hidden w-24 flex-shrink-0 text-right text-xs sm:block"><Score song={song} order={order} /></div>}
            <button onClick={() => playAudio(songs, index, label)} disabled={!song.audio} title="Listen" className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-20">
              <Headphones size={15} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ── Seasons ─────────────────────────────────────────────────────────────────

const SEASON_LOOK: Record<SeasonName, { icon: JSX.Element; tint: string }> = {
  Winter: { icon: <Snowflake size={22} />, tint: "from-sky-500/30" },
  Spring: { icon: <Flower2 size={22} />, tint: "from-pink-500/30" },
  Summer: { icon: <Sun size={22} />, tint: "from-amber-500/30" },
  Fall: { icon: <Leaf size={22} />, tint: "from-orange-600/30" },
};

/** One season of the dial's year, fetched live (no listening data, so ranked by quiz score). */
function SeasonsView({ year: initial, kind, onWatch, hover, previewing, sfx }: { year: number; kind: SongKind; onWatch: Watch; hover: Hover; previewing: number | null; sfx: (n: keyof typeof SOUNDS) => void }) {
  const latest = seasonOf(new Date());
  const [year, setYear] = useState(Math.min(initial, THIS_YEAR));
  const [season, setSeason] = useState<SeasonName | "latest">("latest");
  const [state, setState] = useState<{ label: string; songs: AniSong[] } | "loading" | "failed">("loading");
  useEffect(() => setYear(Math.min(initial, THIS_YEAR)), [initial]);
  useEffect(() => {
    let alive = true;
    setState("loading");
    (async () => {
      if (season === "latest") {
        let { season: s, year: y } = latest;
        for (let tries = 0; tries < 3; tries++) {
          const songs = await window.api.songs.season(s, y).catch(() => null);
          if (!alive) return;
          if (songs === null) { setState("failed"); return; }
          if (songs.length) { setState({ label: `${s} ${y}`, songs }); return; }
          ({ season: s, year: y } = previousSeason(s, y));
        }
        setState("failed");
        return;
      }
      const songs = await window.api.songs.season(season, year).catch(() => null);
      if (alive) setState(songs ? { label: `${season} ${year}`, songs } : "failed");
    })();
    return () => { alive = false; };
  }, [season, year]);
  const ranked = typeof state === "object" ? rankSongs(state.songs, kind, 60) : [];
  return (
    <div>
      <div className="mb-5 grid grid-cols-5 gap-3">
        <button onClick={() => { sfx("select"); setSeason("latest"); }}
          className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${season === "latest" ? "border-accent bg-accent/15" : "border-white/10 bg-surface-1 hover:bg-white/5"}`}>
          <Sparkles size={22} className="text-accent" />
          <div className="mt-2 text-sm font-black">Latest</div>
          <div className="text-[11px] text-white/45">Newest songs in</div>
        </button>
        {SEASONS.map((s) => (
          <button key={s} onClick={() => { sfx("select"); setSeason(s); }}
            className={`rounded-2xl border bg-gradient-to-br to-transparent p-4 text-left transition hover:-translate-y-0.5 ${SEASON_LOOK[s].tint} ${season === s ? "border-white/70" : "border-white/10"}`}>
            {SEASON_LOOK[s].icon}
            <div className="mt-2 text-sm font-black">{s}</div>
            <div className="text-[11px] text-white/45">{year}</div>
          </button>
        ))}
      </div>
      {season !== "latest" && (
        <div className="mb-4 flex items-center gap-2">
          <button onClick={() => { sfx("tick"); setYear((y) => Math.max(ANISONGS.FIRST_YEAR, y - 1)); }} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 hover:bg-white/10" title="Previous year"><ChevronLeft size={16} /></button>
          <span className="w-14 text-center text-lg font-black tabular-nums">{year}</span>
          <button onClick={() => { sfx("tick"); setYear((y) => Math.min(THIS_YEAR, y + 1)); }} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 hover:bg-white/10" title="Next year"><ChevronRight size={16} /></button>
          <span className="text-xs text-white/40">Seasons are fetched live and ranked by how many fans know them.</span>
        </div>
      )}
      {state === "loading" ? <Loading /> : state === "failed" ? <Empty text="Couldn't reach AnisongDB. Try again later." />
        : ranked.length ? <>
          <h3 className="mb-2 text-sm font-bold text-white/60">{state.label} · {kind === "OP" ? "openings" : "endings"}</h3>
          <SongRows songs={ranked} order={season === "latest" ? null : "known"} label={state.label} onWatch={onWatch} hover={hover} previewing={previewing} />
        </> : <Empty text={`No ${kind === "OP" ? "openings" : "endings"} with videos for ${state.label}.`} />}
    </div>
  );
}

// ── Search ──────────────────────────────────────────────────────────────────

function SearchView({ onWatch, hover, previewing }: { onWatch: Watch; hover: Hover; previewing: number | null }) {
  const [query, setQuery] = useState("");
  const [by, setBy] = useState<SongSearchBy>("song");
  const [songs, setSongs] = useState<AniSong[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (query.trim().length < 2) return;
    setBusy(true);
    const found = await window.api.songs.search(query, by).catch(() => []);
    setSongs(rankSongs(found, null, 60).concat(found.filter((s) => s.recognition == null && s.video).slice(0, 20)));
    setBusy(false);
  };
  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="mb-5 flex flex-wrap gap-2">
        <div className="relative min-w-[280px] flex-1">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={by === "song" ? "Song title, e.g. Tank!" : by === "artist" ? "Artist, e.g. LiSA" : "Anime, e.g. Cowboy Bebop"}
            className="w-full rounded-full border border-white/10 bg-surface-1 py-3 pl-11 pr-4 text-sm outline-none focus:border-accent" />
        </div>
        <Toggle value={by} onChange={setBy} options={[["song", "Song", ""], ["artist", "Artist", ""], ["anime", "Anime", ""]]} />
        <button type="submit" disabled={busy} className="rounded-full bg-accent px-6 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? "Searching…" : "Search"}</button>
      </form>
      {songs && (songs.length ? <SongRows songs={songs} order="known" ranked={false} label={`“${query.trim()}”`} onWatch={onWatch} hover={hover} previewing={previewing} /> : <Empty text="No songs found." />)}
    </div>
  );
}

/** A song as the video player takes it. */
function videoItem(song: AniSong): VideoItem {
  return {
    key: String(song.id),
    title: song.title,
    byline: `${song.artist} — ${song.anime} · ${songSlug(song)}${song.year ? ` · ${song.year}` : ""}`,
    cover: song.cover,
    src: songVideoUrl(song) ?? "",
  };
}
