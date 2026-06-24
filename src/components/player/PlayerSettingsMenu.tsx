import React, { useState } from "react";
import { Check, ChevronRight, ChevronLeft, Gauge, RectangleHorizontal, Captions } from "lucide-react";

// Shared settings popup used by both the desktop bar (YouTubeControls) and the
// mobile/tablet overlay (MobileControls). Renders the styled box + the
// main / speed / quality / subtitles sub-views. The caller positions it.

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

type MenuView = "main" | "speed" | "quality" | "subtitles";

export interface SettingsMenuProps {
  links: any[];
  selectedLink: number;
  providerId?: string;
  hlsLevels?: any[];
  currentHlsLevel?: number;
  playbackRate: number;
  autoPlay: boolean;
  autoNext: boolean;
  subtitlesEnabled?: boolean;
  availableSubtitles?: any[];
  onChangePlaybackRate: (rate: number) => void;
  onChangeQuality: (idx: number) => void;
  onChangeHlsLevel?: (idx: number) => void;
  onToggleAutoPlay: () => void;
  onToggleAutoNext: () => void;
  onToggleSubtitles?: () => void;
  cueFontSize?: string;
  setCueFontSize?: (size: string) => void;
  cueFontFamily?: string;
  setCueFontFamily?: (font: string) => void;
  cueBgOpacity?: number;
  setCueBgOpacity?: (op: number) => void;
  cueColor?: string;
  setCueColor?: (color: string) => void;
  className?: string;
}

export function SettingsMenuContent(props: SettingsMenuProps) {
  const {
    links, selectedLink, providerId = "", hlsLevels = [], currentHlsLevel = -1, playbackRate,
    autoPlay, autoNext, subtitlesEnabled = true, availableSubtitles = [],
    onChangePlaybackRate, onChangeQuality, onChangeHlsLevel, onToggleAutoPlay, onToggleAutoNext, onToggleSubtitles,
    cueFontSize = "16px", setCueFontSize, cueFontFamily = "'Outfit', 'Inter', sans-serif", setCueFontFamily,
    cueBgOpacity = 0.85, setCueBgOpacity, cueColor = "#f5f5f7", setCueColor, className = "",
  } = props;

  const [view, setView] = useState<MenuView>("main");

  const hasLinkChoice = links.length > 1 && providerId !== "anikoto";
  const hasHls = hlsLevels.length > 1;
  const speedLabel = playbackRate === 1 ? "Normal" : `${playbackRate}×`;
  const qualityLabel = hasHls
    ? currentHlsLevel === -1
      ? "Auto"
      : `${hlsLevels.find((l) => l.index === currentHlsLevel)?.quality ?? "Auto"}p`
    : hasLinkChoice
    ? links[selectedLink]?.quality ?? "Source"
    : "Source";

  return (
    <div
      className={`max-h-[60vh] w-64 overflow-y-auto rounded-xl border border-white/10 bg-[#1f1f1f]/97 py-1.5 text-sm text-white shadow-2xl backdrop-blur-xl ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {view === "main" && (
        <>
          <MenuRow label="Playback speed" value={speedLabel} chevron onClick={() => setView("speed")} icon={<Gauge size={16} />} />
          {(hasHls || hasLinkChoice) && (
            <MenuRow label="Quality" value={qualityLabel} chevron onClick={() => setView("quality")} icon={<RectangleHorizontal size={16} />} />
          )}
          {availableSubtitles.length > 0 && (
            <MenuRow label="Subtitles" value={subtitlesEnabled ? "On" : "Off"} chevron onClick={() => setView("subtitles")} icon={<Captions size={16} />} />
          )}
          <div className="my-1 h-px bg-white/10" />
          <ToggleRow label="Autoplay" on={autoPlay} onClick={onToggleAutoPlay} />
          <ToggleRow label="Auto-next episode" on={autoNext} onClick={onToggleAutoNext} />
        </>
      )}

      {view === "speed" && (
        <>
          <MenuHeader title="Playback speed" onBack={() => setView("main")} />
          {SPEEDS.map((sp) => (
            <button key={sp} onClick={() => onChangePlaybackRate(sp)} className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/10">
              <span className="w-4">{playbackRate === sp && <Check size={15} />}</span>
              <span>{sp === 1 ? "Normal" : `${sp}×`}</span>
            </button>
          ))}
        </>
      )}

      {view === "quality" && (
        <>
          <MenuHeader title="Quality" onBack={() => setView("main")} />
          {hasHls && (
            <>
              <button onClick={() => onChangeHlsLevel && onChangeHlsLevel(-1)} className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/10">
                <span className="w-4">{currentHlsLevel === -1 && <Check size={15} />}</span>
                <span>Auto</span>
              </button>
              {hlsLevels.map((lvl) => (
                <button key={lvl.index} onClick={() => onChangeHlsLevel && onChangeHlsLevel(lvl.index)} className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/10">
                  <span className="w-4">{currentHlsLevel === lvl.index && <Check size={15} />}</span>
                  <span>{lvl.quality}p</span>
                </button>
              ))}
            </>
          )}
          {hasLinkChoice && (
            <>
              {hasHls && <div className="my-1 h-px bg-white/10" />}
              {hasHls && <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">Source</div>}
              {links.map((l, i) => (
                <button key={i} onClick={() => onChangeQuality(i)} className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/10">
                  <span className="w-4">{selectedLink === i && <Check size={15} />}</span>
                  <span>{l.quality}</span>
                  {l.audio && l.audio !== "jpn" && (
                    <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider">{l.audio}</span>
                  )}
                </button>
              ))}
            </>
          )}
        </>
      )}

      {view === "subtitles" && (
        <>
          <MenuHeader title="Subtitles" onBack={() => setView("main")} />
          <ToggleRow label="Show subtitles" on={!!subtitlesEnabled} onClick={() => onToggleSubtitles && onToggleSubtitles()} />
          {subtitlesEnabled && (
            <div className="px-3 pb-2 pt-1">
              <SubLabel>Font size</SubLabel>
              <Grid cols={4}>
                {[["S", "12px"], ["M", "16px"], ["L", "20px"], ["XL", "24px"]].map(([lbl, val]) => (
                  <Chip key={val} active={cueFontSize === val} onClick={() => { setCueFontSize && setCueFontSize(val); localStorage.setItem("ap-cue-size", val); }}>{lbl}</Chip>
                ))}
              </Grid>
              <SubLabel>Font</SubLabel>
              <Grid cols={2}>
                {[["Outfit", "'Outfit', 'Inter', sans-serif"], ["Sans", "sans-serif"], ["Mono", "monospace"], ["Serif", "'Times New Roman', serif"]].map(([lbl, val]) => (
                  <Chip key={val} active={cueFontFamily === val} onClick={() => { setCueFontFamily && setCueFontFamily(val); localStorage.setItem("ap-cue-font", val); }}>{lbl}</Chip>
                ))}
              </Grid>
              <SubLabel>Background</SubLabel>
              <Grid cols={5}>
                {[["0", 0], ["25", 0.25], ["50", 0.5], ["85", 0.85], ["100", 1]].map(([lbl, val]) => (
                  <Chip key={String(val)} active={cueBgOpacity === val} onClick={() => { setCueBgOpacity && setCueBgOpacity(val as number); localStorage.setItem("ap-cue-opacity", String(val)); }}>{lbl}</Chip>
                ))}
              </Grid>
              <SubLabel>Color</SubLabel>
              <div className="flex gap-2">
                {["#f5f5f7", "#ffeb3b", "#4caf50", "#00bcd4"].map((val) => (
                  <button
                    key={val}
                    onClick={() => { setCueColor && setCueColor(val); localStorage.setItem("ap-cue-color", val); }}
                    className={`h-6 w-6 rounded-full border border-white/20 transition-all ${cueColor === val ? "ring-2 ring-[#e50914] scale-110" : "opacity-80 hover:opacity-100"}`}
                    style={{ background: val }}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MenuRow({ label, value, chevron, onClick, icon }: { label: string; value?: string; chevron?: boolean; onClick: () => void; icon?: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/10">
      {icon && <span className="text-white/70">{icon}</span>}
      <span className="flex-1">{label}</span>
      {value && <span className="text-white/50">{value}</span>}
      {chevron && <ChevronRight size={15} className="text-white/40" />}
    </button>
  );
}

function MenuHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <button onClick={onBack} className="mb-1 flex w-full items-center gap-2 border-b border-white/10 px-2 py-2 text-left font-semibold transition-colors hover:bg-white/5">
      <ChevronLeft size={17} />
      <span>{title}</span>
    </button>
  );
}

function ToggleRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/10">
      <span className="flex-1">{label}</span>
      <span className={`relative h-4 w-8 rounded-full transition-colors ${on ? "bg-[#e50914]" : "bg-white/25"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 mt-2 text-[10px] font-medium uppercase tracking-wider text-white/40">{children}</div>;
}
function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  return <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols},minmax(0,1fr))` }}>{children}</div>;
}
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded px-1.5 py-1 text-[11px] font-semibold transition ${active ? "bg-[#e50914] text-white" : "bg-white/5 text-white/70 hover:bg-white/10"}`}>
      {children}
    </button>
  );
}
