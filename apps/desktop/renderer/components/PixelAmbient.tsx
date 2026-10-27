import { useEffect, useMemo, useRef } from "react";
import { pixelSkyline } from "../../../../packages/shared/pixel-scenes";
import { pixelSprite, pixelSpriteSize } from "../../../../packages/shared/pixel-sprites";
import { usePalette } from "../lib/skin";

const CELL = 3;

/** Both twinkle frames of the skyline (packages/shared/pixel-scenes.ts), drawn to fit the strip. */
function Skyline() {
  const box = useRef<HTMLDivElement>(null);
  const lit = useRef<HTMLCanvasElement>(null);
  const blink = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let drawn = "";
    const draw = () => {
      const width = Math.max(16, Math.ceil(element.clientWidth / CELL));
      const height = Math.max(8, Math.ceil(element.clientHeight / CELL));
      if (drawn === `${width}x${height}`) return;
      drawn = `${width}x${height}`;
      [lit, blink].forEach((ref, frame) => {
        const canvas = ref.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        canvas.width = width;
        canvas.height = height;
        for (const p of pixelSkyline(width, height, frame)) {
          context.fillStyle = p.color;
          context.fillRect(p.x, p.y, p.w, p.h);
        }
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="pixel-skyline">
      <canvas ref={lit} />
      <canvas ref={blink} className="pixel-skyline-blink" />
    </div>
  );
}

/** The walking cat: both frames side by side in one image, stepped through by CSS. */
function WalkingCat() {
  const sheet = useMemo(() => {
    const { width, height } = pixelSpriteSize("cat-walk-1");
    const canvas = document.createElement("canvas");
    canvas.width = width * 2 * CELL;
    canvas.height = height * CELL;
    const context = canvas.getContext("2d");
    if (!context) return null;
    (["cat-walk-1", "cat-walk-2"] as const).forEach((id, frame) => {
      for (const p of pixelSprite(id)) {
        context.fillStyle = p.color;
        context.fillRect((frame * width + p.x) * CELL, p.y * CELL, p.w * CELL, p.h * CELL);
      }
    });
    return { url: canvas.toDataURL(), width: width * CELL, height: height * CELL };
  }, []);
  if (!sheet) return null;
  return (
    <div className="pixel-cat-path">
      <div
        className="pixel-cat"
        style={{ width: sheet.width, height: sheet.height, backgroundImage: `url(${sheet.url})`, backgroundSize: `${sheet.width * 2}px ${sheet.height}px` }}
      />
    </div>
  );
}

/**
 * Pixel mode's night behind the pages (Android: ui/PixelAmbient.kt): stars that twinkle, a skyline
 * whose windows and rooftop beacons blink, a cat walking the street, shooting stars now and then
 * and, in the blue palette, rain. Pure CSS animation on composited layers, in pixel steps; with
 * [motion] off (the setting, the player open, or reduced motion) only the still night stays.
 */
export default function PixelAmbient({ motion }: { motion: boolean }) {
  const blue = usePalette() === "blue";
  return (
    <div className={`pixel-ambient ${motion ? "" : "pixel-still"}`} aria-hidden="true">
      <div className="pixel-twinkle pixel-twinkle-a" />
      <div className="pixel-twinkle pixel-twinkle-b" />
      {blue && motion && <div className="pixel-rain" />}
      {motion && <div className="pixel-shooting pixel-shooting-1" />}
      {motion && <div className="pixel-shooting pixel-shooting-2" />}
      <Skyline />
      {motion && <WalkingCat />}
    </div>
  );
}
