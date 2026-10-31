import { useEffect, useRef } from "react";
import { cityPopScene } from "../../../../packages/shared/city-pop-scene";

/**
 * The banner's pixel-art sunset (packages/shared/city-pop-scene.ts, the same picture Android
 * draws): drawn at art-pixel size and scaled up crisp, redrawn when the banner changes size.
 */
export function CityPopPixelScene({ horizon, sunX, sun, pixel = 4 }: { horizon: number; sunX: number; sun: number; pixel?: number }) {
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
      for (const p of cityPopScene(width, height, { horizon, sunX, sun })) {
        context.fillStyle = p.color;
        context.fillRect(p.x, p.y, p.w, p.h);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    return () => observer.disconnect();
  }, [horizon, sunX, sun, pixel]);
  return <canvas ref={canvas} className="city-pop-pixel-scene" aria-hidden="true" />;
}

/** A pixel sprite ('#' lit) as crisp squares in the current text colour. */
export function CityPopPixelIcon({ sprite, size = 27 }: { sprite: readonly string[]; size?: number }) {
  return (
    <svg className="city-pop-pixel-icon" width={size} height={size} viewBox={`0 0 ${sprite[0].length} ${sprite.length}`} shapeRendering="crispEdges" aria-hidden="true">
      {sprite.flatMap((row, y) => [...row].map((cell, x) => (cell === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" /> : null)))}
    </svg>
  );
}
