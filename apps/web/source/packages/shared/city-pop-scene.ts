/**
 * City Pop's banner: a retrowave sunset in pixel art (a striped sun over a neon grid, a lit
 * skyline, mountains, a palm and stars), as rectangles on a grid of art pixels. Seeded and in
 * whole numbers only, so desktop's canvas and Android's (data/CityPopScene.kt mirrors this file)
 * draw the very same picture at any size.
 */

import type { CityPopMood } from "./city-pop";

/** One rectangle of art pixels and its colour ("#rrggbb"). */
export interface CityPopPixel { x: number; y: number; w: number; h: number; color: string }

/** The stations' icons as 9 × 9 pixel sprites ('#' lit): a crescent moon, a sun, waves. */
export const CITY_POP_ICONS: Readonly<Record<CityPopMood, readonly string[]>> = Object.freeze({
  "night-drive": [".......#.", "...###...", "..##.....", ".##......", ".##......", ".##......", ".##......", "..##.....", "...###..."],
  sunset: ["....#....", ".#.....#.", "...###...", "..#####..", "#.#####.#", "..#####..", "...###...", ".#.....#.", "....#...."],
  "after-hours": [".........", ".##...##.", "#..###..#", ".........", ".##...##.", "#..###..#", ".........", ".##...##.", "#..###..#"],
});

export interface CityPopSceneOptions {
  /** Where the horizon sits, in thousandths of the height. */
  horizon: number;
  /** The sun's centre, in thousandths of the width. */
  sunX: number;
  /** The sun's radius, in thousandths of the width (kept within the sky). */
  sun: number;
}

/** Night at the top to the sunset glow at the horizon. */
export const CITY_POP_SKY = ["#0b0420", "#150836", "#22094c", "#3a0c5e", "#5e1068", "#8c1a6c", "#c22b6b", "#f04f62", "#ff7f4d"] as const;
/** The sun, top to bottom. */
export const CITY_POP_SUN = ["#fff27a", "#ffd319", "#ffab2e", "#ff7f3f", "#ff4f5e", "#ff2a7f", "#e81fa0"] as const;
/** The bands cut out of the sun, in thousandths of its height from the top: wider toward the horizon. */
const SUN_GAPS = [[330, 350], [410, 440], [490, 530], [570, 620], [650, 710], [730, 800], [810, 890]] as const;
/** A palm's fronds in cells from its crown: direction, length, then rise and droop (tenths of a cell). */
const FRONDS = [[-1, 11, 12, 16], [1, 11, 12, 16], [-1, 8, 16, 10], [1, 8, 16, 12], [-1, 5, 18, 4], [1, 5, 18, 6]] as const;
const GROUND = "#0d0221";
const MOUNTAIN = "#250c45";
const RIDGE = "#ff3d9a";
const BUILDING = "#140726";
const WINDOW = "#ffd36b";
const WINDOW_PINK = "#ff7ad9";
const HORIZON = "#ff6ad5";
const GRID_FAR = "#5c1659";
const GRID_MID = "#a12384";
const GRID_NEAR = "#ff2a9d";
const PALM = "#07010f";
const STAR = "#fff6d6";
const STAR_PINK = "#ff9be6";

/** A 32-bit integer hash: the same numbers in TypeScript and Kotlin. */
export function cityPopHash(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Integer division that rounds toward zero, as Kotlin's `/` does. */
const div = (a: number, b: number) => Math.trunc(a / b);

export function cityPopScene(width: number, height: number, options: CityPopSceneOptions): CityPopPixel[] {
  const w = Math.max(16, Math.floor(width));
  const h = Math.max(12, Math.floor(height));
  const horizon = Math.min(h - 3, Math.max(4, div(h * options.horizon, 1000)));
  const out: CityPopPixel[] = [];
  /** A rectangle, clipped to the grid (a palm's frond can reach past the edge). */
  const px = (x: number, y: number, rw: number, rh: number, color: string) => {
    const left = Math.max(0, x), top = Math.max(0, y), right = Math.min(w, x + rw), bottom = Math.min(h, y + rh);
    if (right > left && bottom > top) out.push({ x: left, y: top, w: right - left, h: bottom - top, color });
  };

  // Sky: bands from night to glow, then each band's first row dithered with the one above.
  const bandOf = (y: number) => Math.min(CITY_POP_SKY.length - 1, div(y * CITY_POP_SKY.length, horizon));
  for (let y = 0; y < horizon;) {
    let end = y + 1;
    while (end < horizon && bandOf(end) === bandOf(y)) end++;
    px(0, y, w, end - y, CITY_POP_SKY[bandOf(y)]);
    y = end;
  }
  for (let y = 1; y < horizon; y++) {
    if (bandOf(y) !== bandOf(y - 1)) for (let x = y & 1; x < w; x += 2) px(x, y, 1, 1, CITY_POP_SKY[bandOf(y) - 1]);
  }

  // The sun: centre a little above the horizon, so about two thirds of it shows.
  const radius = Math.max(4, Math.min(div(horizon * 4, 5), div(w * options.sun, 1000)));
  const cx = div(w * options.sunX, 1000);
  const cy = horizon - div(radius * 35, 100);
  const top = cy - radius;

  // Stars in the upper sky, clear of the sun.
  const stars = div(w * horizon, 70);
  const starBand = Math.max(1, div(horizon * 62, 100));
  for (let i = 0; i < stars; i++) {
    const x = cityPopHash(i * 3 + 1) % w;
    const y = cityPopHash(i * 3 + 2) % starBand;
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy <= (radius + 2) * (radius + 2)) continue;
    const color = cityPopHash(i * 3 + 3) % 4 === 0 ? STAR_PINK : STAR;
    px(x, y, 1, 1, color);
    if (i % 9 === 0 && x > 0 && y > 0) { px(x - 1, y, 3, 1, color); px(x, y - 1, 1, 3, color); }
  }

  for (let y = Math.max(0, top); y < horizon; y++) {
    const dy = y - cy;
    if (dy * dy > radius * radius) continue;
    const half = Math.floor(Math.sqrt(radius * radius - dy * dy));
    const along = div((y - top) * 1000, radius * 2);
    if (SUN_GAPS.some(([from, to]) => along >= from && along < to)) continue;
    px(cx - half, y, half * 2 + 1, 1, CITY_POP_SUN[Math.min(CITY_POP_SUN.length - 1, div((y - top) * CITY_POP_SUN.length, radius * 2))]);
  }

  // Mountains: hashed peaks every 12 pixels, joined by straight slopes, with a neon ridge.
  const tallest = Math.max(2, div(horizon * 16, 100));
  const peak = (k: number) => div(tallest * (35 + cityPopHash(5000 + k) % 66), 100);
  for (let x = 0; x < w; x++) {
    const k = div(x, 12);
    const height = peak(k) + div((peak(k + 1) - peak(k)) * (x - k * 12), 12);
    if (height <= 0) continue;
    px(x, horizon - height, 1, height, MOUNTAIN);
    px(x, horizon - height, 1, 1, RIDGE);
  }

  // The skyline: buildings of hashed widths and heights, with lit windows.
  for (let x = 0, i = 0; x < w; i++) {
    const width = 3 + cityPopHash(1000 + i) % 6;
    if (cityPopHash(3000 + i) % 5 === 0) { x += 1 + cityPopHash(4000 + i) % 2; continue; }
    const tall = Math.max(2, div(horizon * (6 + cityPopHash(2000 + i) % 14), 100));
    px(x, horizon - tall, width, tall, BUILDING);
    for (let wy = horizon - tall + 1; wy < horizon - 1; wy += 2) {
      for (let wx = x + 1; wx < x + width - 1; wx += 2) {
        const lit = cityPopHash(wx * 131 + wy * 17);
        if (lit % 7 === 0) px(wx, wy, 1, 1, lit % 3 === 0 ? WINDOW_PINK : WINDOW);
      }
    }
    x += width;
  }

  // The horizon glows; under it, dark ground with a neon grid running to the sun.
  px(0, horizon, w, 1, HORIZON);
  const ground = h - horizon - 1;
  px(0, horizon + 1, w, ground, GROUND);
  for (let k = 1; ; k++) {
    const y = horizon + k + div(k * k, 3);
    if (y >= h) break;
    px(0, y, w, 1, k <= 2 ? GRID_FAR : k <= 4 ? GRID_MID : GRID_NEAR);
  }
  const spacing = Math.max(8, div(w, 12));
  const reach = div(w, spacing) + 2;
  for (let j = -reach; j <= reach; j++) {
    // Right at the horizon the lines would only blur together.
    for (let y = horizon + 2; y < h; y++) {
      const x = cx + div(j * spacing * 2 * (y - horizon), Math.max(1, ground));
      if (x < 0 || x >= w) continue;
      const depth = y - horizon;
      px(x, y, 1, 1, depth <= 6 ? GRID_MID : GRID_NEAR);
    }
  }

  // A palm on the right, rooted at the bottom edge, drawn in cells of `scale` pixels: a leaning
  // trunk, and fronds that rise and droop with leaflets hanging under them.
  const scale = Math.min(3, Math.max(1, div(h, 40)));
  const cell = (x: number, y: number, cw = 1, ch = 1) => px(x, y, cw * scale, ch * scale, PALM);
  const trunk = Math.min(22, Math.max(6, div(h * 6, 10 * scale)));
  const baseX = w - 5 * scale;
  for (let t = 0; t < trunk; t++) cell(baseX - div(4 * t * t, trunk * trunk) * scale, h - (t + 1) * scale, t < div(trunk, 3) ? 2 : 1);
  const crownX = baseX - 4 * scale;
  const crownY = h - trunk * scale;
  for (const [dir, length, rise, droop] of FRONDS) {
    for (let t = 0; t <= length; t++) {
      const dy = div(-rise * t, 10) + div(droop * t * t, 10 * length);
      const x = crownX + dir * t * scale;
      cell(x, crownY + dy * scale);
      if (t >= 2 && t % 2 === 0) cell(x, crownY + (dy + 1) * scale, 1, 1 + div(length - t, 4));
    }
  }
  cell(crownX - scale, crownY - scale, 2, 2);
  return out;
}

/** FNV-1a over every rectangle: the Android twin must give the same number. */
export function cityPopSceneChecksum(pixels: readonly CityPopPixel[]): number {
  let hash = 0x811c9dc5;
  for (const p of pixels) {
    for (const ch of `${p.x},${p.y},${p.w},${p.h},${p.color};`) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}
