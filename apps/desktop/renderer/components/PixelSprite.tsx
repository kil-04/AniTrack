import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { pixelSprite, pixelSpriteSize, type PixelSpriteId } from "../../../../packages/shared/pixel-sprites";

/** A sprite from the shared sheet (packages/catalogs/pixel-sprites.json) as crisp squares, [scale] px per art pixel. */
export const PixelSprite = memo(function PixelSprite({ id, scale = 2, className = "" }: { id: PixelSpriteId; scale?: number; className?: string }) {
  const { width, height } = pixelSpriteSize(id);
  return (
    <svg
      className={`pixel-sprite shrink-0 ${className}`}
      width={width * scale}
      height={height * scale}
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {pixelSprite(id).map((p, i) => <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.color} />)}
    </svg>
  );
});

/** Pixel mode's dog, sitting on a panel's top edge and wagging its tail: two frames taking turns (Android: PixelDog). */
export function PixelDog() {
  return (
    <span className="pixel-dog" aria-hidden="true">
      <PixelSprite id="dog-sit-1" scale={2} />
      <PixelSprite id="dog-sit-2" scale={2} className="pixel-frame-b" />
    </span>
  );
}

/** A cat wandering across the gap between two of Home's rows: 20 s across, once a minute (Android: RowWalker). */
export function PixelWalker() {
  return (
    <div className="pixel-walker" aria-hidden="true">
      <span className="pixel-walker-cat">
        <PixelSprite id="cat-walk-1" scale={2} />
        <PixelSprite id="cat-walk-2" scale={2} className="pixel-frame-b" />
      </span>
    </div>
  );
}

/** Empty states' sprites in Pixel mode, by the icon the page chose (lucide names, as Android maps Material's). */
const ICON_SPRITES: Readonly<Record<string, PixelSpriteId>> = {
  Play: "tv",
  Clock: "tv",
  History: "tv",
  HardDriveDownload: "floppy",
  Download: "floppy",
  TriangleAlert: "ghost",
  CloudOff: "ghost",
  SearchX: "ufo",
  Search: "ufo",
  CalendarX2: "moon",
  CalendarClock: "moon",
  BookMarked: "book",
  BookOpenCheck: "book",
  BookOpen: "book",
  Sparkles: "star",
};

export function pixelSpriteForIcon(icon: LucideIcon | undefined): PixelSpriteId {
  return ICON_SPRITES[icon?.displayName ?? ""] ?? "cat";
}
