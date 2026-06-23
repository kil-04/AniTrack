import { Volume2, VolumeX, Play, Pause, Rewind, FastForward, Maximize2, Minimize2, ChevronDown, Captions, Settings } from "lucide-react";
import { secondsToTimestamp } from "../../lib/format";
import React from "react";

interface VideoControlsProps {
  showControls: boolean;
  progressPct: number;
  position: number;
  duration: number;
  playing: boolean;
  muted: boolean;
  volume: number;
  autoPlay: boolean;
  autoNext: boolean;
  currentEp: any;
  links: any[];
  selectedLink: number;
  isMobile: boolean;
  qualityOpen: boolean;
  isFullscreen: boolean;
  onSeekToPct: (pct: number) => void;
  onSeekBy: (delta: number) => void;
  onSeekStart: () => void;
  onSeekEnd: (time: number) => void;
  onPositionChange: (time: number) => void;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onVolumeChange: (vol: number) => void;
  onToggleAutoPlay: () => void;
  onToggleAutoNext: () => void;
  onPlayPrev: () => void;
  onPlayNext: () => void;
  onToggleFullscreen: () => void;
  onToggleQualityMenu: () => void;
  onChangeQuality: (idx: number) => void;
  onCloseQualityMenu: () => void;

  // HLS Qualities and Subtitles
  hlsLevels?: any[];
  currentHlsLevel?: number;
  onChangeHlsLevel?: (idx: number) => void;
  subtitlesEnabled?: boolean;
  availableSubtitles?: any[];
  onToggleSubtitles?: () => void;
  providerId?: string;

  // Subtitle Settings props
  cueFontSize?: string;
  setCueFontSize?: (size: string) => void;
  cueFontFamily?: string;
  setCueFontFamily?: (font: string) => void;
  cueBgOpacity?: number;
  setCueBgOpacity?: (op: number) => void;
  cueColor?: string;
  setCueColor?: (color: string) => void;
}

export function VideoControls({
  showControls, progressPct, position, duration, playing, muted, volume,
  autoPlay, autoNext, currentEp, links, selectedLink, isMobile, qualityOpen, isFullscreen,
  onSeekToPct, onSeekBy, onSeekStart, onSeekEnd, onPositionChange,
  onTogglePlay, onToggleMute, onVolumeChange, onToggleAutoPlay, onToggleAutoNext,
  onPlayPrev, onPlayNext, onToggleFullscreen, onToggleQualityMenu, onChangeQuality, onCloseQualityMenu,

  // Destructured with defaults
  hlsLevels = [],
  currentHlsLevel = -1,
  onChangeHlsLevel,
  subtitlesEnabled = true,
  availableSubtitles = [],
  onToggleSubtitles,
  providerId = "",

  // Destructured Subtitle Settings
  cueFontSize = "16px",
  setCueFontSize,
  cueFontFamily = "'Outfit', 'Inter', sans-serif",
  setCueFontFamily,
  cueBgOpacity = 0.85,
  setCueBgOpacity,
  cueColor = "#f5f5f7",
  setCueColor
}: VideoControlsProps) {

  const [linksOpen, setLinksOpen] = React.useState(false);
  const [hlsOpen, setHlsOpen] = React.useState(false);
  const [subSettingsOpen, setSubSettingsOpen] = React.useState(false);

  React.useEffect(() => {
    function handleClickOutside() {
      setSubSettingsOpen(false);
    }
    if (subSettingsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [subSettingsOpen]);

  React.useEffect(() => {
    function handleClickOutside() {
      setLinksOpen(false);
    }
    if (linksOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [linksOpen]);

  React.useEffect(() => {
    function handleClickOutside() {
      setHlsOpen(false);
    }
    if (hlsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [hlsOpen]);



  return (
    <div className={`absolute inset-0 flex flex-col justify-end items-center pb-6 transition-all duration-300 pointer-events-none ${showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>
      {/* Floating Glassmorphic Pill */}
      <div className="relative w-[96%] max-w-5xl rounded-2xl border border-white/10 bg-black/20 px-5 pb-3 pt-4 backdrop-blur-none shadow-[0_8px_32px_rgba(0,0,0,0.15)] select-none pointer-events-auto">
        
        {/* Seek bar */}
        <div className="group mb-4 flex items-center gap-3">
          <div className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-white/20 transition-all group-hover:h-2"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              onSeekToPct(pct);
            }}
          >
            <div className="absolute inset-y-0 left-0 rounded-full bg-[#e50914] shadow-[0_0_10px_rgba(229, 9, 20,0.5)]" style={{ width: `${progressPct}%` }} />
            <div className="absolute top-1/2 h-4 w-4 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 transition-all group-hover:scale-110" style={{ left: `${progressPct}%` }} />
            <input
              type="range" min={0} max={duration || 1} step={0.5} value={position}
              disabled={!currentEp || !duration}
              onMouseDown={onSeekStart}
              onMouseUp={(e) => onSeekEnd(Number((e.target as HTMLInputElement).value))}
              onTouchStart={onSeekStart}
              onTouchEnd={(e) => onSeekEnd(Number((e.target as HTMLInputElement).value))}
              onChange={(e) => onPositionChange(Number(e.target.value))}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>
          <span className="min-w-[7.5rem] text-right text-xs font-medium tabular-nums text-white/80">
            {secondsToTimestamp(position)} <span className="text-white/40 mx-0.5">/</span> {secondsToTimestamp(duration)}
          </span>
        </div>

        {/* Button row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={onTogglePlay} disabled={!currentEp} className="flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-white/15 hover:scale-105 disabled:opacity-30 disabled:hover:scale-100 transition-all">
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-1" />}
          </button>
          <button onClick={() => onSeekBy(-10)} disabled={!currentEp} className="flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-30 transition-all">
            <Rewind size={14} /><span>{isMobile ? "10" : "5"}</span>
          </button>
          <button onClick={() => onSeekBy(isMobile ? 10 : 5)} disabled={!currentEp} className="flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-30 transition-all">
            <span>{isMobile ? "10" : "5"}</span><FastForward size={14} />
          </button>
          
          <div className="mx-2 h-5 w-px bg-white/10" />
          
          <button onClick={onToggleMute} className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white transition-all">
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          {!isMobile && (
            <input type="range" min={0} max={1} step={0.02} value={muted ? 0 : volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="w-24 accent-[#e50914] cursor-pointer hover:accent-[#5eb0ff] transition-all"
            />
          )}
          
          <div className="flex-1" />
          
          {!isMobile && (
            <div className="flex bg-black/40 rounded-full p-0.5 border border-white/5 mr-2">
              <button onClick={onToggleAutoPlay} className={`h-8 rounded-full px-3 text-xs font-medium transition-all ${autoPlay ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}>
                Auto Play
              </button>
              <button onClick={onToggleAutoNext} className={`h-8 rounded-full px-3 text-xs font-medium transition-all ${autoNext ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}>
                Auto Next
              </button>
            </div>
          )}
          
          <button onClick={onPlayPrev} disabled={!currentEp} className="h-9 rounded-full px-3 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition-all">⏮ Prev</button>
          <button onClick={onPlayNext} disabled={!currentEp} className="h-9 rounded-full px-3 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition-all">Next ⏭</button>
          
          {/* Subtitles Button */}
          {availableSubtitles.length > 0 && (
            <div className="relative flex items-center gap-1 z-30">
              <button 
                onClick={onToggleSubtitles} 
                className={`flex h-9 w-9 items-center justify-center rounded-full transition-all ${subtitlesEnabled ? "text-white bg-white/10" : "text-white/50 hover:text-white hover:bg-white/10"}`}
                title={subtitlesEnabled ? "Subtitles: On" : "Subtitles: Off"}
              >
                <Captions size={16} />
              </button>
              
              {subtitlesEnabled && (
                <div className="relative z-30">
                  <button 
                    onClick={() => setSubSettingsOpen(!subSettingsOpen)}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.nativeEvent.stopImmediatePropagation();
                    }}
                    className={`flex h-7 w-7 items-center justify-center rounded-full transition-all bg-white/5 ${subSettingsOpen ? "text-white bg-white/15" : "text-white/50 hover:text-white hover:bg-white/10"}`}
                    title="Subtitle Settings"
                  >
                    <Settings size={12} className={`transition-transform duration-300 ${subSettingsOpen ? "rotate-90" : ""}`} />
                  </button>
                  {subSettingsOpen && (
                    <div 
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.nativeEvent.stopImmediatePropagation();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute bottom-10 right-0 z-50 w-64 rounded-xl border border-white/10 bg-[#222222]/95 p-4 backdrop-blur-xl shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200 pointer-events-auto"
                    >
                        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-white/50">Subtitle Settings</div>
                        
                        {/* Font Size Selector */}
                        <div className="mb-3">
                          <label className="mb-1 block text-[10px] text-white/40 font-medium">Font Size</label>
                          <div className="grid grid-cols-4 gap-1">
                            {[
                              { label: "S", value: "12px" },
                              { label: "M", value: "16px" },
                              { label: "L", value: "20px" },
                              { label: "XL", value: "24px" }
                            ].map((sz) => (
                              <button
                                key={sz.value}
                                onClick={() => {
                                  setCueFontSize && setCueFontSize(sz.value);
                                  localStorage.setItem("ap-cue-size", sz.value);
                                }}
                                className={`rounded px-1.5 py-1 text-[10px] font-semibold transition ${cueFontSize === sz.value ? "bg-[#e50914] text-white" : "bg-white/5 text-white/70 hover:bg-white/10"}`}
                              >
                                {sz.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Font Family Selector */}
                        <div className="mb-3">
                          <label className="mb-1 block text-[10px] text-white/40 font-medium">Font Family</label>
                          <div className="grid grid-cols-2 gap-1">
                            {[
                              { label: "Outfit / Inter", value: "'Outfit', 'Inter', sans-serif" },
                              { label: "System Sans", value: "sans-serif" },
                              { label: "Monospace", value: "monospace" },
                              { label: "Serif", value: "'Times New Roman', serif" }
                            ].map((f) => (
                              <button
                                key={f.value}
                                onClick={() => {
                                  setCueFontFamily && setCueFontFamily(f.value);
                                  localStorage.setItem("ap-cue-font", f.value);
                                }}
                                className={`rounded px-1 py-1 text-[9px] font-semibold truncate transition ${cueFontFamily === f.value ? "bg-[#e50914] text-white" : "bg-white/5 text-white/70 hover:bg-white/10"}`}
                                title={f.label}
                              >
                                {f.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Background Opacity Selector */}
                        <div className="mb-3">
                          <label className="mb-1 block text-[10px] text-white/40 font-medium">Background Opacity</label>
                          <div className="grid grid-cols-5 gap-1">
                            {[
                              { label: "0%", value: 0.0 },
                              { label: "25%", value: 0.25 },
                              { label: "50%", value: 0.5 },
                              { label: "85%", value: 0.85 },
                              { label: "100%", value: 1.0 }
                            ].map((op) => (
                              <button
                                key={op.value}
                                onClick={() => {
                                  setCueBgOpacity && setCueBgOpacity(op.value);
                                  localStorage.setItem("ap-cue-opacity", String(op.value));
                                }}
                                className={`rounded py-1 text-[9px] font-semibold transition ${cueBgOpacity === op.value ? "bg-[#e50914] text-white" : "bg-white/5 text-white/70 hover:bg-white/10"}`}
                              >
                                {op.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Text Color Selector */}
                        <div>
                          <label className="mb-1 block text-[10px] text-white/40 font-medium">Text Color</label>
                          <div className="flex gap-2">
                            {[
                              { label: "White", value: "#f5f5f7", class: "bg-white border-white/20" },
                              { label: "Yellow", value: "#ffeb3b", class: "bg-[#ffeb3b] border-yellow-400/20" },
                              { label: "Green", value: "#4caf50", class: "bg-[#4caf50] border-green-500/20" },
                              { label: "Cyan", value: "#00bcd4", class: "bg-[#00bcd4] border-[#00bcd4]/20" }
                            ].map((c) => (
                              <button
                                key={c.value}
                                onClick={() => {
                                  setCueColor && setCueColor(c.value);
                                  localStorage.setItem("ap-cue-color", c.value);
                                }}
                                className={`flex h-6 w-6 items-center justify-center rounded-full border transition-all ${cueColor === c.value ? "ring-2 ring-[#e50914] scale-110" : "scale-100 opacity-80 hover:opacity-100"} ${c.class}`}
                                title={c.label}
                              >
                                {cueColor === c.value && (
                                  <span className="text-[10px] font-bold text-black drop-shadow">✓</span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>

                      </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Link / Subtitle Selector */}
          {links.length > 1 && providerId !== "anikoto" && (
            <div className="relative">
              <button 
                onClick={() => setLinksOpen(!linksOpen)} 
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                }}
                className="flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-all bg-white/5"
              >
                {links[selectedLink]?.quality ?? "Source"} <ChevronDown size={12} className={`transition-transform ${linksOpen ? "rotate-180" : ""}`} />
              </button>
              {linksOpen && (
                <div 
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.nativeEvent.stopImmediatePropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-12 right-0 z-20 min-w-[130px] overflow-hidden rounded-xl border border-white/10 bg-[#222222]/95 backdrop-blur-xl shadow-2xl"
                >
                    {links.map((l, i) => (
                      <button 
                        key={i} 
                        onClick={() => {
                          onChangeQuality(i);
                          setLinksOpen(false);
                        }} 
                        className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium transition-colors hover:bg-white/10 ${i === selectedLink ? "bg-white/5 text-white" : "text-white/80"}`}
                      >
                        {i === selectedLink && <span className="text-white">✓</span>}
                        <span className={i === selectedLink ? "" : "ml-4"}>
                          {l.quality}
                        </span>
                        {l.audio && l.audio !== "jpn" && (
                          <span className="ml-auto rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider">{l.audio}</span>
                        )}
                      </button>
                    ))}
                  </div>
              )}
            </div>
          )}

          {/* HLS Internal Qualities Selector */}
          {hlsLevels.length > 1 && (
            <div className="relative">
              <button 
                onClick={() => setHlsOpen(!hlsOpen)} 
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                }}
                className="flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-all bg-white/5"
              >
                {currentHlsLevel === -1 
                  ? "Auto" 
                  : `${hlsLevels.find(l => l.index === currentHlsLevel)?.quality ?? "Auto"}p`
                } <ChevronDown size={12} className={`transition-transform ${hlsOpen ? "rotate-180" : ""}`} />
              </button>
              {hlsOpen && (
                <div 
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.nativeEvent.stopImmediatePropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-12 right-0 z-20 min-w-[120px] max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-[#222222]/95 backdrop-blur-xl shadow-2xl"
                >
                    {/* Auto option */}
                    <button 
                      onClick={() => {
                        onChangeHlsLevel && onChangeHlsLevel(-1);
                        setHlsOpen(false);
                      }} 
                      className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium transition-colors hover:bg-white/10 ${currentHlsLevel === -1 ? "bg-white/5 text-white" : "text-white/80"}`}
                    >
                      {currentHlsLevel === -1 && <span className="text-white">✓</span>}
                      <span className={currentHlsLevel === -1 ? "" : "ml-4"}>Auto</span>
                    </button>
                    {/* Specific levels */}
                    {hlsLevels.map((lvl) => (
                      <button 
                        key={lvl.index} 
                        onClick={() => {
                          onChangeHlsLevel && onChangeHlsLevel(lvl.index);
                          setHlsOpen(false);
                        }} 
                        className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium transition-colors hover:bg-white/10 ${lvl.index === currentHlsLevel ? "bg-white/5 text-white" : "text-white/80"}`}
                      >
                        {lvl.index === currentHlsLevel && <span className="text-white">✓</span>}
                        <span className={lvl.index === currentHlsLevel ? "" : "ml-4"}>{lvl.quality}p</span>
                      </button>
                    ))}
                  </div>
              )}
            </div>
          )}
          
          <button onClick={onToggleFullscreen} className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white hover:scale-110 transition-all" title="Fullscreen (F)">
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
