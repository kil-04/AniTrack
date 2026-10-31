
/**
 * The AniTrack logo: the brand art (renderer/assets/brand-logo.png) in a rounded tile.
 * The app icons come from the same art: build/icon.ico and the Android launcher icon
 * (res/mipmap-*). Regenerate all of them together when the art changes.
 */
export default function BrandMark({ size = 30, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 rounded-[28%] object-cover ring-1 ring-white/15 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** "AniTrack" set in Outfit, "Track" in the accent gradient (in Pixel mode, the pixel font: index.css). */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`wordmark font-extrabold tracking-tight text-white ${className}`}>
      Ani
      <span className="bg-accent-gradient bg-clip-text text-transparent">Track</span>
    </span>
  );
}
