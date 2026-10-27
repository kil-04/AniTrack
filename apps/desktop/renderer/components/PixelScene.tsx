import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { pixelScene, type PixelSceneId } from "../../../../packages/shared/pixel-scenes";

/**
 * A pixel-art scene (packages/shared/pixel-scenes.ts, the same pictures Android draws) filling
 * its box: drawn at art-pixel size and scaled up crisp, redrawn when the box changes size.
 */
export function PixelSceneCanvas({ scene, pixel = 3 }: { scene: PixelSceneId; pixel?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const box = element?.parentElement;
    if (!element || !box) return;
    let drawn = "";
    const draw = () => {
      const width = Math.max(16, Math.ceil(box.clientWidth / pixel));
      const height = Math.max(12, Math.ceil(box.clientHeight / pixel));
      if (drawn === `${width}x${height}`) return;
      drawn = `${width}x${height}`;
      element.width = width;
      element.height = height;
      const context = element.getContext("2d");
      if (!context) return;
      for (const p of pixelScene(scene, width, height)) {
        context.fillStyle = p.color;
        context.fillRect(p.x, p.y, p.w, p.h);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    return () => observer.disconnect();
  }, [scene, pixel]);
  return <canvas ref={canvas} className="pixel-scene" aria-hidden="true" />;
}

/** Pixel mode's page banner: a scene under scanlines, with the page's icon, title and subtitle. */
export function PixelBanner({ scene, icon: Icon, title, subtitle }: { scene: PixelSceneId; icon?: LucideIcon; title: string; subtitle?: ReactNode }) {
  return (
    <div className="pixel-banner">
      <PixelSceneCanvas scene={scene} />
      <div className="pixel-banner-shade" />
      <span className="pixel-roll" aria-hidden="true" />
      <div className="pixel-banner-copy">
        {Icon && <span className="pixel-banner-icon"><Icon size={22} strokeWidth={2.4} /></span>}
        <div className="min-w-0">
          <h1 className="pixel-banner-title truncate">{title}</h1>
          {subtitle && <div className="pixel-banner-sub truncate">{subtitle}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * Pixel mode's interlude between Home's rows (Android: PixelInterlude): a wide scene that opens
 * another part of the app (Schedule, Songs, the Time Machine, a reading list).
 */
export function PixelInterlude({ scene, title, subtitle, to }: { scene: PixelSceneId; title: string; subtitle: string; to: string }) {
  return (
    <Link to={to} className="pixel-interlude mx-8 mb-10">
      <PixelSceneCanvas scene={scene} />
      <div className="pixel-banner-shade" />
      <span className="pixel-roll" aria-hidden="true" />
      <div className="pixel-interlude-copy">
        <h2 className="pixel-interlude-title truncate">{title}</h2>
        <p className="pixel-interlude-sub">{subtitle}</p>
      </div>
      <span className="pixel-interlude-go">Go ▶</span>
    </Link>
  );
}

/**
 * Pixel mode's SVG filter (index.css `.hero-art`): samples one pixel in every 8 × 8 block and
 * spreads it over the block, so the Home hero's art turns into chunky pixel art.
 */
export function PixelFilters() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <filter id="pixelate-8" x="0" y="0" width="100%" height="100%">
        <feFlood x="4" y="4" height="1" width="1" />
        <feComposite width="8" height="8" />
        <feTile result="grid" />
        <feComposite in="SourceGraphic" in2="grid" operator="in" />
        <feMorphology operator="dilate" radius="4" />
      </filter>
    </svg>
  );
}
