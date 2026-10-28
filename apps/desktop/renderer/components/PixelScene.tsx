import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { pixelActorAt, pixelSceneParts, type PixelActor, type PixelSceneId } from "../../../../packages/shared/pixel-scenes";

/**
 * A pixel-art scene (packages/shared/pixel-scenes.ts, the same pictures Android draws) filling
 * its box: drawn at art-pixel size and scaled up crisp, redrawn when the box changes size. Its
 * moving parts are small canvases on top, moved and shown by CSS animations of `transform` and
 * `opacity` in steps, which the compositor runs (still under reduced motion or with motion off).
 */
export function PixelSceneCanvas({ scene, pixel = 3 }: { scene: PixelSceneId; pixel?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = canvas.current, actors = layer.current;
    const box = element?.parentElement;
    if (!element || !box || !actors) return;
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
      const parts = pixelSceneParts(scene, width, height);
      for (const p of parts.rects) {
        context.fillStyle = p.color;
        context.fillRect(p.x, p.y, p.w, p.h);
      }
      actors.replaceChildren(...parts.actors.map((actor) => actorCanvas(actor, width, height)));
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    return () => observer.disconnect();
  }, [scene, pixel]);
  return (
    <>
      <canvas ref={canvas} className="pixel-scene" aria-hidden="true" />
      <div ref={layer} className="pixel-actors" aria-hidden="true" />
    </>
  );
}

/** One moving part: its own canvas, placed in percent of the scene so it scales with it. */
function actorCanvas(actor: PixelActor, width: number, height: number): HTMLCanvasElement {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of actor.rects) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h);
  }
  const bw = maxX - minX, bh = maxY - minY;
  const element = document.createElement("canvas");
  element.width = bw;
  element.height = bh;
  const context = element.getContext("2d");
  if (context) {
    for (const p of actor.rects) {
      context.fillStyle = p.color;
      context.fillRect(p.x - minX, p.y - minY, p.w, p.h);
    }
  }
  const style = element.style;
  style.left = `${(minX / width) * 100}%`;
  style.top = `${(minY / height) * 100}%`;
  style.width = `${(bw / width) * 100}%`;
  style.height = `${(bh / height) * 100}%`;
  // Where it rests when nothing moves; the animations override this while they run.
  const rest = pixelActorAt(actor, actor.rest);
  style.transform = `translate(${(rest.x / bw) * 100}%, ${(rest.y / bh) * 100}%)`;
  style.opacity = rest.shown ? "1" : "0";
  const seconds = actor.period / 10, start = -actor.delay / 10;
  const animations: string[] = [];
  if (actor.dx || actor.dy) {
    style.setProperty("--dx", `${(actor.dx / bw) * 100}%`);
    style.setProperty("--dy", `${(actor.dy / bh) * 100}%`);
    animations.push(`pixel-actor-move ${seconds}s steps(${Math.max(1, Math.abs(actor.dx), Math.abs(actor.dy))}, end) ${start}s infinite`);
  }
  if (actor.on < actor.period) animations.push(`${shownFor(actor.on / actor.period)} ${seconds}s step-end ${start}s infinite`);
  style.animation = animations.join(", ");
  return element;
}

/** A keyframes rule that shows a part for the first [share] of its cycle (made once per share). */
const shares = new Set<number>();
function shownFor(share: number): string {
  const percent = Math.min(99, Math.max(1, Math.round(share * 100)));
  const name = `pixel-actor-on-${percent}`;
  if (!shares.has(percent)) {
    shares.add(percent);
    const sheet = document.createElement("style");
    sheet.textContent = `@keyframes ${name} { 0% { opacity: 1; } ${percent}% { opacity: 0; } 100% { opacity: 0; } }`;
    document.head.appendChild(sheet);
  }
  return name;
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
