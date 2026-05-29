import { FastForward } from "lucide-react";

interface SkipOverlayProps {
  duration: number;
  position: number;
  skipTimes: {
    op?: { start: number; end: number };
    ed?: { start: number; end: number };
  };
  showControls: boolean;
  onSkip: (endTime: number) => void;
}

export function SkipOverlay({
  duration,
  position,
  skipTimes,
  showControls,
  onSkip
}: SkipOverlayProps) {
  if (!duration) return null;
  
  let skipTarget: { label: string; end: number } | null = null;
  
  if (skipTimes.op && position >= skipTimes.op.start && position < skipTimes.op.end) {
    skipTarget = { label: "Skip Intro", end: skipTimes.op.end };
  } else if (skipTimes.ed && position >= skipTimes.ed.start && position < skipTimes.ed.end) {
    skipTarget = { label: "Skip Outro", end: skipTimes.ed.end };
  }
  
  if (!skipTarget) return null;

  return (
    <div className={`absolute bottom-28 right-8 z-30 transition-all duration-300 ${showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"}`}>
      <button 
        onClick={(e) => { e.stopPropagation(); onSkip(skipTarget!.end); }}
        className="flex items-center gap-2 rounded-md border border-white/20 bg-black/60 px-4 py-2 font-medium text-white backdrop-blur-md hover:bg-black/80 hover:scale-105 transition-all"
      >
        {skipTarget.label} <FastForward size={16} />
      </button>
    </div>
  );
}
