/**
 * Pixel mode's sprites (packages/catalogs/pixel-sprites.json, which Android reads as an asset):
 * 16 × 16 pictures for empty states, row headers, the Home footer and the animated background.
 */
import sheet from "../catalogs/pixel-sprites.json";
import type { CityPopPixel } from "./city-pop-scene.ts";
import { pixelSectionSprite, pixelSpriteRects } from "./pixel-scenes.ts";

export type PixelSpriteId = keyof typeof sheet.sprites;

const SPRITES: Readonly<Record<string, readonly string[]>> = sheet.sprites;
const SECTIONS: Readonly<Record<string, string>> = sheet.sections;
const cache = new Map<string, CityPopPixel[]>();

/** A sprite's pixels, cached. */
export function pixelSprite(id: PixelSpriteId): CityPopPixel[] {
  let rects = cache.get(id);
  if (!rects) {
    rects = pixelSpriteRects(SPRITES[id] ?? [], sheet.palette);
    cache.set(id, rects);
  }
  return rects;
}

export function pixelSpriteSize(id: PixelSpriteId): { width: number; height: number } {
  const rows = SPRITES[id] ?? [];
  return { width: rows[0]?.length ?? 0, height: rows.length };
}

/** The sprite beside a row's title ("Continue Watching": the TV; "New in 2015": the star), if it has one. */
export function pixelSpriteForSection(title: string): PixelSpriteId | null {
  const id = pixelSectionSprite(SECTIONS, title);
  return id && id in SPRITES ? (id as PixelSpriteId) : null;
}
