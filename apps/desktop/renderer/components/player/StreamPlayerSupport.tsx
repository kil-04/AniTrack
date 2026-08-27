import { useEffect, useRef, type RefObject } from "react";

/** Stable negative id for provider-only shows that have no AniList id. */
export function providerSessionId(session: string): number {
  let hash = 5381;
  for (let index = 0; index < session.length; index += 1) {
    hash = (((hash << 5) + hash) ^ session.charCodeAt(index)) | 0;
  }
  return -(Math.abs(hash) || 1);
}

/** Correct a common AAC label mismatch at Chromium's MediaSource boundary. */
export function installMediaSourceCodecShim(): void {
  if (typeof MediaSource === "undefined") return;
  const prototype = MediaSource.prototype as typeof MediaSource.prototype & {
    __anitrackCodecShim?: boolean;
  };
  if (prototype.__anitrackCodecShim) return;
  const original = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (mime: string) {
    return original.call(this, mime.replace(/mp4a\.40\.1\b/g, "mp4a.40.2"));
  };
  prototype.__anitrackCodecShim = true;
}

/** rAF-driven mini-player progress that avoids React renders during playback. */
export function MiniProgressBar({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }) {
  const barRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      const bar = barRef.current;
      if (video && bar && video.duration && Number.isFinite(video.duration)) {
        bar.style.width = `${(video.currentTime / video.duration) * 100}%`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [videoRef]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
      <div ref={barRef} className="h-full bg-[#e50914]" style={{ width: "0%" }} />
    </div>
  );
}
