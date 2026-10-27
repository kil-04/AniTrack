/**
 * Pixel mode's banners: retrowave scenes in pixel art, drawn like City Pop's sunset
 * (city-pop-scene.ts, which "sunset" reuses) as rectangles on a grid of art pixels. Seeded and
 * in whole numbers only, so desktop's canvas and Android's (data/PixelScenes.kt mirrors this file
 * line for line) draw the very same pictures at any size; the tests on both sides pin checksums.
 */

import { cityPopHash as hash, cityPopScene, type CityPopPixel } from "./city-pop-scene.ts";

export type PixelSceneId =
  | "sunset" | "neon-city" | "fuji" | "sakura" | "shinkansen" | "starlight" | "library" | "ramen-stand" | "arcade"
  | "bedroom" | "cinema" | "tower" | "observatory" | "station" | "terminal" | "stage"
  | "jukebox" | "radio" | "hifi" | "night-drive" | "karaoke" | "rooftop-band" | "hologram";

export const PIXEL_SCENES: readonly PixelSceneId[] = [
  "sunset", "neon-city", "fuji", "sakura", "shinkansen", "starlight", "library", "ramen-stand", "arcade",
  "bedroom", "cinema", "tower", "observatory", "station", "terminal", "stage",
  "jukebox", "radio", "hifi", "night-drive", "karaoke", "rooftop-band", "hologram",
];

/** Integer division that rounds toward zero, as Kotlin's `/` does. */
const div = (a: number, b: number) => Math.trunc(a / b);
/** A seeded number below [m]. */
const mod = (n: number, m: number) => hash(n) % m;

/** The whole square root (floor), exact for any size used here. */
export function pixelIsqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

const STARS = ["#fff6d6", "#ff9be6", "#bff8ff"] as const;
const SIGNS = ["#ff2a9d", "#2ee6ff", "#ffd319", "#b44cff"] as const;
const SUNRISE = ["#fff2b0", "#ffe08a", "#ffc36b", "#ffa45c"] as const;
const CLOUD = ["#ffd0dc", "#ffa8c0", "#e77799"] as const;
const SUN_SEA = ["#fff27a", "#ffd319", "#ffab2e", "#ff7f3f"] as const;
const PLANET = ["#ffb3de", "#ff7ac6", "#e0529c", "#c74bd4", "#8a3bbf", "#5e2a99"] as const;
const BOOKS = ["#ff2a9d", "#2ee6ff", "#ffd319", "#c9a8ff", "#ff7f3f", "#5ce1a5", "#e0529c", "#4f7cff"] as const;
/** A cherry tree's branches from its crown: direction, length (in cells) and lift (tenths of a cell). */
const BRANCHES = [[-1, 9, 6], [1, 11, 5], [-1, 6, 12], [1, 7, 11], [1, 4, 16]] as const;
const DRINKS = ["#ff3d3d", "#2e6bff", "#ffd319", "#5ce1a5", "#ff7a59", "#ff2a9d"] as const;
const CABINETS = ["#ff2a9d", "#2ee6ff", "#ffd319", "#b44cff"] as const;
const SCREEN_DOTS = ["#2ee6ff", "#ff2a9d", "#ffd319"] as const;
/** The arcade's neon sign in a tiny 5-row font. */
const GAME = [
  [".###", "#...", "#.##", "#..#", ".###"],
  [".##.", "#..#", "####", "#..#", "#..#"],
  ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  ["####", "#...", "###.", "#...", "####"],
] as const;
const TAPES = ["#ff2a9d", "#2ee6ff", "#ffd319", "#5ce1a5", "#ff7f3f"] as const;
const SCREEN_SKY = ["#2e6bff", "#5b8bff", "#ff9fb8", "#ffc36b"] as const;
const EQUALIZER = ["#ff2a9d", "#b44cff", "#2ee6ff"] as const;
const LIGHT_STICKS = ["#2ee6ff", "#ff2a9d", "#ffd319", "#5ce1a5"] as const;
/** The stage's spotlights: where each hangs (percent of the width), its lean (tenths of a pixel a row) and colour. */
const SPOT_X = [44, 60, 76, 90] as const;
const SPOT_LEAN = [3, 1, -1, -3] as const;
const SPOT_GLOW = ["#4a1a4a", "#1a3a5a", "#4a3a1f", "#331a5a"] as const;
/** An eighth note, for music drifting up from the Songs scenes. */
const NOTE = ["..##.", "..#.#", "..#..", "..#..", "###..", "###.."] as const;
const NOTE_COLORS = ["#ff7ac6", "#2ee6ff", "#ffd319", "#c9a8ff"] as const;
const JUKE_ARCH = ["#ff2a9d", "#ff7f3f", "#ffd319", "#5ce1a5", "#2ee6ff", "#b44cff"] as const;
const BUTTONS = ["#ff3d3d", "#ffd319", "#2ee6ff", "#5ce1a5", "#ff7ad9"] as const;
const SLEEVES = ["#ff7f3f", "#ffd319", "#5ce1a5", "#ff2a9d", "#2e6bff", "#c9a8ff", "#ff3d3d"] as const;
const LYRIC_SKY = ["#2b1257", "#5a1f7a", "#a3307a", "#ff6a6a"] as const;
const EVENING = ["#3a1a66", "#7a2a7a", "#c8487a", "#ff7f6b", "#ffb36b"] as const;
const NIGHT_SKY = ["#0b0424", "#1a0838", "#3a0f55", "#7a1f6e", "#c8306e"] as const;
const DUSK = ["#2a1a66", "#5a2a8a", "#a3407a", "#ff7a6b", "#ffb36b"] as const;
const CITY_LIGHTS = ["#ffd36b", "#ffd36b", "#ffb36b", "#ff7ad9", "#2ee6ff"] as const;
/** A virtual singer with twin tails, her microphone in her hands. */
const IDOL = [
  ".....hhhh.....", "....hhhhhh....", "..rhhhhhhhhr..", "..hhffffffhh..", ".hhhfeffefhhh.", ".hh.ffffff.hh.",
  ".hh..rddr..hh.", ".hh.lddddl.hh.", ".hh.ldmmdl.hh.", ".hh..dddd..hh.", ".hh.dddddd.hh.", ".h.dddddddd.h.",
  ".h...l..l...h.", "h....l..l....h", ".....l..l.....", "....kk..kk....",
] as const;
const IDOL_COLORS: Readonly<Record<string, string>> = {
  h: "#2ee6ff", f: "#e8fdff", e: "#0a1036", r: "#ff7ad9", l: "#b8f6ff", d: "#7fb8ff", m: "#ffd319", k: "#3aa0e0",
};
const HEART = [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."] as const;
/** The hologram's floating screens: x, y, width and height (percent of the scene) and what each shows. */
const PANELS = [[4, 10, 18, 24, 0], [10, 44, 12, 18, 1], [26, 20, 10, 14, 3], [40, 40, 10, 14, 1], [86, 10, 12, 22, 2], [88, 46, 10, 16, 3]] as const;
const GLOW_STICKS = ["#2ee6ff", "#2ee6ff", "#7fe8ff", "#ff7ad9"] as const;
/** A cat sitting under the lamp ('#' fur, 'o' eyes). */
const CAT = ["#...#....", "##.##....", "#####....", "#o#o#....", "#####...#", ".####...#", ".######.#", ".#######.", ".#######."] as const;

/** The art-pixel grid a scene draws on. */
class Grid {
  readonly out: CityPopPixel[] = [];
  readonly w: number;
  readonly h: number;
  constructor(w: number, h: number) { this.w = w; this.h = h; }

  /** A rectangle, clipped to the grid. */
  px(x: number, y: number, rw: number, rh: number, color: string) {
    const left = Math.max(0, x), top = Math.max(0, y), right = Math.min(this.w, x + rw), bottom = Math.min(this.h, y + rh);
    if (right > left && bottom > top) this.out.push({ x: left, y: top, w: right - left, h: bottom - top, color });
  }

  /** Bands of [colors] from row [top] down to [bottom], each band's first row dithered with the one above. */
  gradient(top: number, bottom: number, colors: readonly string[]) {
    const span = Math.max(1, bottom - top);
    const band = (y: number) => Math.min(colors.length - 1, div((y - top) * colors.length, span));
    for (let y = top; y < bottom;) {
      let end = y + 1;
      while (end < bottom && band(end) === band(y)) end++;
      this.px(0, y, this.w, end - y, colors[band(y)]);
      y = end;
    }
    for (let y = top + 1; y < bottom; y++) {
      if (band(y) !== band(y - 1)) for (let x = y & 1; x < this.w; x += 2) this.px(x, y, 1, 1, colors[band(y) - 1]);
    }
  }

  /** A filled circle. */
  disc(cx: number, cy: number, r: number, color: string) {
    for (let y = cy - r; y <= cy + r; y++) {
      const half = pixelIsqrt(r * r - (y - cy) * (y - cy));
      this.px(cx - half, y, half * 2 + 1, 1, color);
    }
  }

  /** A ring [t] pixels thick. */
  ring(cx: number, cy: number, r: number, t: number, color: string) {
    const inner = r - t;
    for (let y = cy - r; y <= cy + r; y++) {
      const dy = y - cy;
      const half = pixelIsqrt(r * r - dy * dy);
      if (inner <= 0 || Math.abs(dy) >= inner) {
        this.px(cx - half, y, half * 2 + 1, 1, color);
      } else {
        const hole = pixelIsqrt(inner * inner - dy * dy);
        this.px(cx - half, y, half - hole, 1, color);
        this.px(cx + hole + 1, y, half - hole, 1, color);
      }
    }
  }

  /** A straight line in single-pixel steps (Bresenham), [size] pixels thick. */
  line(x0: number, y0: number, x1: number, y1: number, color: string, size = 1) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    for (;;) {
      this.px(x, y, size, size, color);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  /** A small picture from rows of letters ('.' clear), each letter's colour from [colors], in [cell]-pixel squares. */
  sprite(rows: readonly string[], x: number, y: number, cell: number, colors: Readonly<Record<string, string>>) {
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const color = colors[rows[r][c]];
        if (color) this.px(x + c * cell, y + r * cell, cell, cell, color);
      }
    }
  }

  /** Seeded stars between rows [top] and [bottom]; every eleventh one is a small cross. */
  stars(top: number, bottom: number, count: number, seed: number, colors: readonly string[] = STARS) {
    const span = Math.max(1, bottom - top);
    for (let i = 0; i < count; i++) {
      const x = mod(seed + i * 3 + 1, this.w), y = top + mod(seed + i * 3 + 2, span);
      const color = colors[mod(seed + i * 3 + 3, colors.length)];
      this.px(x, y, 1, 1, color);
      if (i % 11 === 0 && x > 0 && y > top) { this.px(x - 1, y, 3, 1, color); this.px(x, y - 1, 1, 3, color); }
    }
  }
}

/** A scene at [width] × [height] art pixels. */
export function pixelScene(id: PixelSceneId, width: number, height: number): CityPopPixel[] {
  const g = new Grid(Math.max(16, Math.floor(width)), Math.max(12, Math.floor(height)));
  switch (id) {
    case "sunset": return cityPopScene(g.w, g.h, { horizon: 680, sunX: 760, sun: 170 });
    case "neon-city": neonCity(g); break;
    case "fuji": fuji(g); break;
    case "sakura": sakura(g); break;
    case "shinkansen": shinkansen(g); break;
    case "starlight": starlight(g); break;
    case "library": library(g); break;
    case "ramen-stand": ramenStand(g); break;
    case "arcade": arcade(g); break;
    case "bedroom": bedroom(g); break;
    case "cinema": cinema(g); break;
    case "tower": tower(g); break;
    case "observatory": observatory(g); break;
    case "station": station(g); break;
    case "terminal": terminal(g); break;
    case "stage": stage(g); break;
    case "jukebox": jukebox(g); break;
    case "radio": radio(g); break;
    case "hifi": hifi(g); break;
    case "night-drive": nightDrive(g); break;
    case "karaoke": karaoke(g); break;
    case "rooftop-band": rooftopBand(g); break;
    case "hologram": hologram(g); break;
  }
  return g.out;
}

/** A city at night in the rain: a full moon, lit towers, neon signs shining on the wet street. */
function neonCity(g: Grid) {
  const { w, h } = g;
  const street = h - Math.max(3, div(h * 16, 100));
  g.gradient(0, street, ["#07021a", "#0d0430", "#170a45", "#24105a", "#3a1466", "#5a1a6e"]);
  g.stars(0, div(street * 45, 100), div(w * street, 160), 100);
  const mr = Math.max(3, div(h * 10, 100));
  const mx = div(w * 40, 100), my = div(h * 8, 100) + mr;
  g.disc(mx, my, mr, "#ffe9b0");
  g.disc(mx - div(mr, 3), my - div(mr, 4), Math.max(1, div(mr, 4)), "#f2cf86");
  g.disc(mx + div(mr, 3), my + div(mr, 3), Math.max(1, div(mr, 5)), "#f2cf86");
  g.px(0, street, w, h - street, "#0a0314");
  g.px(0, street, w, 1, "#3d1a6e");
  const lane = street + div(h - street, 2);
  for (let x = 1; x < w; x += 8) g.px(x, lane, 4, 1, "#33224f");
  // Far towers: dim blocks with a few windows.
  for (let x = 0, i = 0; x < w; i++) {
    const bw = 4 + mod(7000 + i, 7);
    const tall = div(street * (30 + mod(7100 + i, 32)), 100);
    g.px(x, street - tall, bw, tall, "#1c0b3a");
    for (let wy = street - tall + 2; wy < street - 1; wy += 3) {
      for (let wx = x + 1; wx < x + bw - 1; wx += 2) if (mod(wx * 97 + wy * 31 + 7, 9) === 0) g.px(wx, wy, 1, 1, "#4b3a8a");
    }
    x += bw;
  }
  // Near buildings: lit windows, rooftop beacons, and neon signs reflected in the street.
  for (let x = -2, i = 0; x < w; i++) {
    const bw = 6 + mod(8000 + i, 9);
    if (mod(8100 + i, 6) === 0) { x += 2 + mod(8200 + i, 3); continue; }
    const tall = div(street * (35 + mod(8300 + i, 42)), 100);
    const top = street - tall;
    g.px(x, top, bw, tall, "#0b0418");
    if (mod(8400 + i, 4) === 0) { g.px(x + div(bw, 2), top - 3, 1, 3, "#0b0418"); g.px(x + div(bw, 2), top - 4, 1, 1, "#ff3d6e"); }
    for (let wy = top + 2; wy < street - 2; wy += 3) {
      for (let wx = x + 1; wx < x + bw - 1; wx += 2) {
        const lit = hash(wx * 131 + wy * 17 + 3);
        if (lit % 5 === 0) g.px(wx, wy, 1, 1, lit % 4 === 0 ? "#2ee6ff" : "#ffd36b");
      }
    }
    if (mod(8500 + i, 3) === 0 && tall > 12) {
      const color = SIGNS[mod(8700 + i, SIGNS.length)];
      const sx = x + bw - 3, sy = top + 3;
      const sh = Math.min(tall - 6, 6 + mod(8600 + i, 8));
      g.px(sx, sy, 3, sh, color);
      for (let gy = sy + 1; gy < sy + sh - 1; gy += 2) g.px(sx + 1, gy, 1, 1, "#12051f");
      for (let ry = street + 1; ry < h; ry += 2) g.px(sx + mod(ry * 5 + sx * 3, 3), ry, 1, 1, color);
    }
    x += bw;
  }
  const drops = div(w * h, 70);
  for (let i = 0; i < drops; i++) g.px(mod(20000 + i * 2, w), mod(20001 + i * 2, h), 1, 2 + mod(20000 + i * 5, 2), "#5866c4");
}

/** Mount Fuji at dawn over a still lake, a torii gate standing in the water. */
function fuji(g: Grid) {
  const { w, h } = g;
  const horizon = div(h * 72, 100);
  g.gradient(0, horizon, ["#1b1446", "#2c1a5e", "#4b2a7a", "#7a3584", "#b0487f", "#e2667a", "#ff8f6b", "#ffb86b"]);
  g.stars(0, div(horizon * 30, 100), div(w * horizon, 260), 300);
  const sr = Math.max(3, div(h * 16, 100));
  const sx = div(w * 42, 100), sy = horizon - div(sr, 3);
  for (let y = sy - sr; y < horizon; y++) {
    const half = pixelIsqrt(sr * sr - (y - sy) * (y - sy));
    g.px(sx - half, y, half * 2 + 1, 1, SUNRISE[Math.min(SUNRISE.length - 1, div((y - sy + sr) * SUNRISE.length, sr * 2))]);
  }
  for (let k = 0; k < 3; k++) {
    const cy = div(horizon * (34 + k * 16), 100);
    const cw = div(w * (16 + mod(9100 + k, 12)), 100);
    const cx = mod(9000 + k, w);
    for (let r = 0; r < 3; r++) {
      const rw = div(cw * (2 + r), 4);
      g.px(cx - div(rw, 2), cy + r, rw, 1, CLOUD[r]);
    }
  }
  // The mountain: a broad cone with a flat crater, its right face in shade, a snow cap with a ragged hem.
  const peakX = div(w * 66, 100), peakY = div(h * 14, 100);
  const snow = peakY + div((horizon - peakY) * 30, 100);
  for (let y = peakY; y < horizon; y++) {
    const half = div((y - peakY) * 17, 10) + 1;
    g.px(peakX - half, y, half * 2 + 1, 1, "#3a2a6b");
    g.px(peakX + 1, y, half, 1, "#2e2159");
    if (y < snow) {
      g.px(peakX - half, y, half * 2 + 1, 1, "#f4eeff");
      g.px(peakX + 1, y, half, 1, "#c9b8f0");
    } else if (y < snow + 4) {
      for (let x = peakX - half; x <= peakX + half; x++) {
        if (mod(x * 29 + 5, 5) > y - snow) g.px(x, y, 1, 1, x > peakX ? "#c9b8f0" : "#f4eeff");
      }
    }
  }
  // The lake: the mountain's reflection broken by ripples, the sun's path, shimmer.
  g.px(0, horizon, w, h - horizon, "#1a1240");
  g.px(0, horizon, w, 1, "#ffb86b");
  for (let y = horizon + 1; y < h; y++) {
    const ry = horizon - (y - horizon) * 2;
    if (ry < peakY) continue;
    const half = div((ry - peakY) * 17, 10) + 1;
    for (let x = peakX - half; x <= peakX + half; x++) if (mod(x + y * 7, 3) !== 0) g.px(x, y, 1, 1, ry < snow ? "#6b5a9e" : "#2c1f57");
  }
  for (let y = horizon + 2; y < h; y += 2) {
    const half = Math.max(0, sr - (y - horizon) * 2);
    g.px(sx - half, y, half * 2 + 1, 1, "#ff9f6b");
  }
  for (let i = 0; i < div(w, 6); i++) g.px(mod(9300 + i, w), horizon + 2 + mod(9400 + i, Math.max(1, h - horizon - 2)), 2 + mod(9500 + i, 5), 1, "#2d2366");
  // A torii gate standing in the water, and its reflection.
  const s = Math.max(1, div(h, 40));
  const tx = div(w * 34, 100), th = Math.max(6, div(h * 24, 100));
  const base = horizon + div(h - horizon, 2);
  const tTop = base - th;
  for (let y = base + 1; y < h; y += 2) { g.px(tx, y, s, 1, "#7a2440"); g.px(tx + 7 * s, y, s, 1, "#7a2440"); }
  g.px(tx, tTop, s, th, "#ff3d3d");
  g.px(tx + 7 * s, tTop, s, th, "#ff3d3d");
  g.px(tx - 2 * s, tTop, 12 * s, s, "#ff3d3d");
  g.px(tx - 2 * s, tTop - s, s, s, "#ff3d3d");
  g.px(tx + 9 * s, tTop - s, s, s, "#ff3d3d");
  g.px(tx - s, tTop + 2 * s, 10 * s, s, "#d92f2f");
  g.px(tx + 3 * s, tTop + s, 2 * s, s, "#d92f2f");
  for (let i = 0; i < 3; i++) {
    const bx = div(w * (50 + i * 5), 100), by = div(horizon * (18 + mod(9600 + i, 12)), 100);
    g.px(bx, by, 1, 1, "#2a1650");
    g.px(bx + 1, by + 1, 1, 1, "#2a1650");
    g.px(bx + 2, by, 1, 1, "#2a1650");
  }
}

/** A cherry tree in bloom under a full moon, petals drifting over the hills. */
function sakura(g: Grid) {
  const { w, h } = g;
  const ground = div(h * 82, 100);
  g.gradient(0, h, ["#0b0420", "#140733", "#1e0b45", "#2a0f52", "#3a1460"]);
  g.stars(0, div(h * 60, 100), div(w * h, 150), 400);
  const mr = Math.max(4, div(h * 18, 100));
  const mx = div(w * 82, 100), my = div(h * 32, 100);
  for (let y = my - mr - 3; y <= my + mr + 3; y++) {
    for (let x = mx - mr - 3; x <= mx + mr + 3; x++) {
      const d = (x - mx) * (x - mx) + (y - my) * (y - my);
      if (d > mr * mr && d <= (mr + 3) * (mr + 3) && ((x + y) & 1) === 0) g.px(x, y, 1, 1, "#3d2370");
    }
  }
  g.disc(mx, my, mr, "#fff2c7");
  g.disc(mx - div(mr, 3), my - div(mr, 4), Math.max(1, div(mr, 5)), "#f2d99b");
  g.disc(mx + div(mr, 3), my + div(mr, 3), Math.max(1, div(mr, 6)), "#f2d99b");
  g.disc(mx + div(mr, 5), my - div(mr, 2), Math.max(1, div(mr, 8)), "#f2d99b");
  const peak = (k: number) => 1 + mod(9700 + k, 5);
  for (let x = 0; x < w; x++) {
    const k = div(x, 24);
    const hill = ground - (peak(k) + div((peak(k + 1) - peak(k)) * (x - k * 24), 24));
    g.px(x, hill, 1, h - hill, "#12072a");
    g.px(x, hill, 1, 1, "#2e1457");
  }
  // The tree: a leaning trunk, branches, then blossom in three layers (shade, bloom, highlights).
  const s = Math.max(1, div(h, 45));
  const baseX = div(w * 46, 100);
  const crownY = div(h * 38, 100);
  const rise = Math.max(1, ground - crownY);
  for (let y = crownY; y <= ground; y++) {
    const up = ground - y;
    g.px(baseX + div(5 * s * up * up, rise * rise), y, up < div(rise, 2) ? 3 * s : 2 * s, 1, "#2a0f2a");
  }
  const topX = baseX + 5 * s;
  for (const [dir, length, lift] of BRANCHES) {
    for (let t = 0; t <= length * s; t++) g.px(topX + dir * t, crownY - div(t * lift, 10), s, s, "#2a0f2a");
  }
  const radius = Math.max(6, div(h * 38, 100));
  const cy = crownY - div(radius, 4);
  for (let layer = 0; layer < 3; layer++) {
    for (let k = 0; k < 11; k++) {
      const ox = mod(600 + k, radius * 2 + 1) - radius;
      const oy = mod(700 + k, radius + 1) - div(radius, 2);
      const cr = Math.max(2, div(radius, 3) + mod(800 + k, Math.max(1, div(radius, 4))));
      if (layer === 0) g.disc(topX + ox, cy + oy, cr, "#b8256b");
      else if (layer === 1) g.disc(topX + ox - 1, cy + oy - 1, Math.max(1, cr - 2), "#ff4fa3");
      else g.disc(topX + ox - 2, cy + oy - 2, Math.max(1, div(cr, 2)), "#ff9fd0");
    }
  }
  const petals = div(w * h, 320);
  for (let i = 0; i < petals; i++) {
    g.px(mod(30000 + i * 2, w), mod(30001 + i * 2, h), i % 4 === 0 ? 2 : 1, 1, i % 3 === 0 ? "#ffb3de" : "#ff7ac6");
  }
}

/** A bullet train crossing a sea bridge at sunset. */
function shinkansen(g: Grid) {
  const { w, h } = g;
  const sea = div(h * 74, 100);
  g.gradient(0, sea, ["#1a0b3d", "#2d0f55", "#55166a", "#8c1f6e", "#c9336a", "#f25c5c", "#ff8a4c", "#ffb347"]);
  g.stars(0, div(sea * 35, 100), div(w * sea, 220), 500);
  const sr = Math.max(3, div(h * 20, 100));
  const sx = div(w * 74, 100), sy = sea - div(sr, 4);
  for (let y = sy - sr; y < sea; y++) {
    const half = pixelIsqrt(sr * sr - (y - sy) * (y - sy));
    g.px(sx - half, y, half * 2 + 1, 1, SUN_SEA[Math.min(SUN_SEA.length - 1, div((y - sy + sr) * SUN_SEA.length, sr * 2))]);
  }
  for (let k = 0; k < 2; k++) {
    const ix = div(w * (18 + k * 30), 100), iw = Math.max(4, div(w * (6 + k * 3), 100)), ih = Math.max(2, div(h * (8 - k * 3), 100));
    for (let x = ix - iw; x <= ix + iw; x++) {
      const tall = ih - div(ih * (x - ix) * (x - ix), iw * iw);
      if (tall > 0) g.px(x, sea - tall, 1, tall, "#3a1046");
    }
  }
  g.px(0, sea, w, h - sea, "#1b0a3a");
  g.px(0, sea, w, 1, "#ff8a4c");
  for (let y = sea + 2; y < h; y += 2) {
    const half = Math.max(1, sr - (y - sea));
    g.px(sx - half, y, half * 2 + 1, 1, y % 4 === 0 ? "#ffab2e" : "#ff7f3f");
  }
  for (let i = 0; i < div(w, 5); i++) g.px(mod(31000 + i, w), sea + 2 + mod(31100 + i, Math.max(1, h - sea - 2)), 2 + mod(31200 + i, 5), 1, "#3b1c66");
  // The bridge: piers into the sea and a deck.
  const s = Math.max(1, div(h, 40));
  const deck = div(h * 66, 100);
  const span = Math.max(12, div(w, 9));
  for (let x = div(span, 2); x < w; x += span) g.px(x, deck, 2 * s, h - deck, "#120526");
  g.px(0, deck, w, 2 * s, "#120526");
  g.px(0, deck - s, w, 1, "#2a0f45");
  // The train: white cars with a blue stripe, windows, a long sloping nose and a headlight.
  const th = Math.max(4, div(h * 14, 100));
  const ty = deck - th;
  const length = div(w * 58, 100);
  const x0 = div(w * 6, 100);
  const nose = th * 3;
  g.px(x0, ty, length, th, "#f4f2ff");
  for (let i = 0; i < th; i++) g.px(x0 + length, ty + i, div(nose * (i + 1), th), 1, "#f4f2ff");
  g.px(x0, ty + div(th * 62, 100), length + nose, Math.max(1, div(th, 5)), "#2e6bff");
  const wy = ty + Math.max(1, div(th * 22, 100)), wh = Math.max(1, div(th, 5));
  for (let x = x0 + 2; x < x0 + length - 2; x += 3) g.px(x, wy, 2, wh, mod(x * 7 + 11, 5) === 0 ? "#ffd36b" : "#1b2a5a");
  const car = Math.max(14, div(length, 4));
  for (let x = x0 + car; x < x0 + length; x += car) g.px(x, ty, 1, th, "#b9b4d9");
  g.px(x0 + length + 1, wy, Math.max(1, div(nose * (wy - ty + 1), th) - 2), wh, "#1b2a5a");
  g.px(x0 + length + nose - 3, ty + th - 2, 2, 1, "#fff27a");
  for (let i = 0; i < 6; i++) g.px(x0 - 4 - mod(31300 + i, Math.max(1, div(w, 12))), ty + mod(31400 + i, th), 3 + mod(31500 + i, 6), 1, "#ff8fb1");
}

/** Deep space: nebulae, a ringed planet, a small moon and a shooting star. */
function starlight(g: Grid) {
  const { w, h } = g;
  g.gradient(0, h, ["#04010d", "#0a0320", "#130632", "#1d0a45", "#2a0d55"]);
  for (let k = 0; k < 4; k++) {
    const nx = mod(40000 + k, w), ny = mod(40100 + k, h), nr = Math.max(4, div(h * (20 + mod(40200 + k, 20)), 100));
    for (let y = ny - nr; y <= ny + nr; y++) {
      const half = pixelIsqrt(nr * nr - (y - ny) * (y - ny));
      for (let x = nx - half; x <= nx + half; x++) {
        if (((x + y) & 1) === 0 && mod(x * 7 + y * 13 + k, 3) !== 0) g.px(x, y, 1, 1, k % 2 === 0 ? "#3a1060" : "#0f2a55");
      }
    }
  }
  g.stars(0, h, div(w * h, 45), 600, ["#fff6d6", "#ff9be6", "#bff8ff", "#ffd319"]);
  // The planet: the ring's far half, the banded globe shaded on the right, the ring's near half.
  const pr = Math.max(4, div(h * 26, 100));
  const pcx = div(w * 70, 100), pcy = div(h * 55, 100);
  const rx = pr * 2, ry = Math.max(1, div(pr, 3));
  for (let x = -rx; x <= rx; x++) g.px(pcx + x, pcy - div(ry * pixelIsqrt(rx * rx - x * x), rx), 1, 1, "#1a8fa6");
  for (let y = pcy - pr; y <= pcy + pr; y++) {
    const half = pixelIsqrt(pr * pr - (y - pcy) * (y - pcy));
    g.px(pcx - half, y, half * 2 + 1, 1, PLANET[Math.min(PLANET.length - 1, div((y - pcy + pr) * PLANET.length, pr * 2 + 1))]);
    const lit = div(half * 45, 100);
    g.px(pcx + lit, y, half - lit + 1, 1, "#4a1f7a");
  }
  for (let x = -rx; x <= rx; x++) g.px(pcx + x, pcy + div(ry * pixelIsqrt(rx * rx - x * x), rx), 1, 1, "#2ee6ff");
  const mr = Math.max(2, div(h * 7, 100));
  const mx = div(w * 40, 100), my = div(h * 30, 100);
  g.disc(mx, my, mr, "#c9a8ff");
  g.disc(mx + div(mr, 3), my - div(mr, 3), Math.max(1, div(mr, 3)), "#a98ae0");
  const tail = Math.max(6, div(w * 12, 100));
  const hx = div(w * 52, 100), hy = div(h * 30, 100);
  for (let t = 0; t <= tail; t++) g.px(hx + t, hy - div(t, 3), 1, 1, t < 2 ? "#ffffff" : t < div(tail, 2) ? "#2ee6ff" : "#1a6f8f");
}

/** A bookshop at night: full shelves, a window on the city, a lamp's warm light and a cat. */
function library(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  const floor = h - Math.max(2, div(h * 10, 100));
  g.gradient(0, floor, ["#1a0d30", "#1f1038", "#241242"]);
  for (let x = 3; x < w; x += 8) for (let y = x & 1; y < floor; y += 2) g.px(x, y, 1, 1, "#22123e");
  // The window: night sky, a moon, the city's lights, the frame's cross.
  const wx = div(w * 74, 100), wy = div(h * 12, 100), ww = Math.max(8, div(w * 18, 100)), wh = Math.max(8, div(h * 48, 100));
  g.px(wx - s, wy - s, ww + 2 * s, wh + 2 * s, "#3b1d63");
  g.px(wx, wy, ww, wh, "#0b0420");
  g.px(wx, wy + wh - div(wh, 4), ww, div(wh, 4), "#1e0b45");
  for (let i = 0; i < div(ww * wh, 30); i++) g.px(wx + mod(50000 + i, ww), wy + mod(50100 + i, Math.max(1, wh - div(wh, 4))), 1, 1, "#fff6d6");
  g.disc(wx + div(ww * 70, 100), wy + div(wh * 28, 100), Math.max(1, div(wh, 7)), "#fff2c7");
  for (let x = wx; x < wx + ww; x += 2) {
    const t = 1 + mod(50200 + x, Math.max(1, div(wh, 4)));
    g.px(x, wy + wh - t, 2, t, "#0d0520");
    if (mod(50300 + x, 3) === 0) g.px(x, wy + wh - t + 1, 1, 1, "#ffd36b");
  }
  g.px(wx + div(ww, 2), wy, s, wh, "#3b1d63");
  g.px(wx, wy + div(wh, 2), ww, s, "#3b1d63");
  // The bookcase.
  const left = div(w * 4, 100), right = wx - Math.max(6, div(w * 10, 100));
  const top = div(h * 8, 100);
  const rows = Math.max(2, div(floor - top, 16));
  const gap = div(floor - top, rows);
  g.px(left - 2 * s, top - s, 2 * s, floor - top + s, "#6b3a22");
  g.px(right, top - s, 2 * s, floor - top + s, "#6b3a22");
  g.px(left - 2 * s, top - 2 * s, right - left + 4 * s, 2 * s, "#7d4628");
  for (let r = 0; r < rows; r++) {
    const board = top + (r + 1) * gap - s;
    g.px(left, board - gap + s, right - left, gap - s, "#140a24");
    for (let x = left + 1, i = r * 500; x < right - 1; i++) {
      const bw = (1 + mod(51000 + i, 3)) * s;
      if (mod(51100 + i, 11) === 0) { x += bw + s; continue; }
      const bh = gap - s - 1 - mod(51200 + i, Math.max(1, div(gap, 3)));
      g.px(x, board - bh, Math.min(bw, right - 1 - x), bh, BOOKS[mod(51300 + i, BOOKS.length)]);
      if (mod(51400 + i, 4) === 0) g.px(x, board - bh + div(bh, 3), Math.min(bw, right - 1 - x), 1, "#f4eeff");
      x += bw;
    }
    g.px(left, board, right - left, s, "#6b3a22");
  }
  // The floor, the lamp's light and the lamp, the cat under it.
  g.px(0, floor, w, h - floor, "#2b1626");
  g.px(0, floor, w, 1, "#4a2a3a");
  for (let x = 5; x < w; x += 9) g.px(x, floor + 1, 1, h - floor - 1, "#22111e");
  const lx = right + div(wx - right, 2);
  const shade = div(h * 30, 100);
  const widest = Math.max(s, div(wx - right, 2) - 2);
  for (let y = shade; y < floor; y++) {
    const half = Math.min(widest, div((y - shade) * 2, 3) + s);
    for (let x = lx - half; x <= lx + half; x++) if (((x + y) & 1) === 0) g.px(x, y, 1, 1, "#3a2346");
  }
  g.px(lx, shade, s, floor - shade, "#3b1d63");
  for (let i = 0; i < 3 * s; i++) {
    const sw = 3 * s + i;
    g.px(lx + div(s, 2) - div(sw, 2), shade - 3 * s + i, sw, 1, "#ffd319");
  }
  const catX = lx + 2 * s, catY = floor - CAT.length * s;
  for (let y = 0; y < CAT.length; y++) {
    for (let x = 0; x < CAT[y].length; x++) {
      const c = CAT[y][x];
      if (c !== ".") g.px(catX + x * s, catY + y * s, s, s, c === "o" ? "#ffd319" : "#07010f");
    }
  }
}

/** A ramen stall at night: power lines, a glowing vending machine, red lanterns, steam and warm light on the street. */
function ramenStand(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  const ground = h - Math.max(3, div(h * 20, 100));
  g.gradient(0, ground, ["#0b0420", "#120632", "#1a0a40", "#24104d", "#2f1258"]);
  g.stars(0, div(ground * 50, 100), div(w * ground, 200), 700);
  const mr = Math.max(3, div(h * 9, 100));
  g.disc(div(w * 90, 100), div(h * 10, 100) + mr, mr, "#fff2c7");
  // Houses behind, a few windows still lit.
  for (let x = 0, i = 0; x < w; i++) {
    const bw = 6 + mod(71000 + i, 10);
    const tall = div(ground * (25 + mod(71100 + i, 30)), 100);
    g.px(x, ground - tall, bw, tall, "#170b30");
    for (let wy = ground - tall + 2; wy < ground - 1; wy += 3) {
      for (let wx = x + 1; wx < x + bw - 1; wx += 3) if (mod(wx * 53 + wy * 29 + 1, 11) === 0) g.px(wx, wy, 1, 1, "#ffcf7a");
    }
    x += bw;
  }
  // The street, and the light the machine and the stall throw on it.
  g.px(0, ground, w, h - ground, "#120726");
  g.px(0, ground, w, 1, "#2a1650");
  const vmW = Math.max(8, div(h * 26, 100)), vmH = Math.max(12, div(h * 46, 100));
  const vmX = div(w * 36, 100), vmY = ground - vmH;
  const stW = Math.max(24, div(w * 28, 100)), stX = div(w * 56, 100);
  for (let y = ground + 1; y < h; y++) {
    const spread = div((y - ground) * 3, 2) + 2;
    for (let x = vmX - spread; x < vmX + vmW + spread; x++) if (((x + y) & 1) === 0) g.px(x, y, 1, 1, "#173a58");
    for (let x = stX - spread; x < stX + stW + spread; x++) if (((x + y) & 1) === 0) g.px(x, y, 1, 1, "#4a2a1a");
  }
  // A pole on the left and two wires sagging across the sky.
  const poleX = div(w * 8, 100), wireY = div(h * 14, 100);
  g.px(poleX, wireY - 2 * s, 2 * s, ground - wireY + 2 * s, "#2a1a4d");
  g.px(poleX - 3 * s, wireY, 8 * s, s, "#2a1a4d");
  const span = Math.max(1, w - poleX), sag = Math.max(2, div(h * 12, 100));
  for (let k = 0; k < 2; k++) {
    for (let x = poleX; x < w; x++) {
      const t = x - poleX;
      g.px(x, wireY + k * 3 * s + div(4 * sag * t * (span - t), span * span), 1, 1, "#3a2466");
    }
  }
  // The vending machine: blue casing, a lit window of drinks, the slot.
  g.px(vmX, vmY, vmW, vmH, "#2e6bff");
  g.px(vmX + vmW - s, vmY, s, vmH, "#1b2a8a");
  const winX = vmX + s, winY = vmY + s, winW = vmW - 3 * s, winH = div(vmH * 60, 100);
  g.px(winX, winY, winW, winH, "#d6f6ff");
  for (let r = 0; winY + 1 + r * 3 + 2 <= winY + winH - 1; r++) {
    for (let x = winX + 1, j = 0; x + 1 < winX + winW; x += 2, j++) g.px(x, winY + 1 + r * 3, 1, 2, DRINKS[mod(72000 + r * 31 + j, DRINKS.length)]);
  }
  g.px(vmX + s, vmY + vmH - 4 * s, vmW - 3 * s, 2 * s, "#140726");
  // The stall: posts, a red roof, the noren curtain, warm light inside, the counter.
  const roofY = div(h * 34, 100);
  const counterY = ground - div(h * 24, 100);
  g.px(stX + s, roofY, s, ground - roofY, "#5a2d1a");
  g.px(stX + stW - 2 * s, roofY, s, ground - roofY, "#5a2d1a");
  const norenH = Math.max(3 * s, div(h * 16, 100));
  g.px(stX + 2 * s, roofY + norenH, stW - 4 * s, Math.max(1, counterY - roofY - norenH), "#ffcf7a");
  g.px(stX - s, roofY - 3 * s, stW + 2 * s, s, "#8a1f2e");
  g.px(stX - 3 * s, roofY - 2 * s, stW + 6 * s, 2 * s, "#8a1f2e");
  g.px(stX - 3 * s, roofY - 2 * s, stW + 6 * s, s, "#b8263b");
  const pw = Math.max(2, div(stW, 4));
  for (let k = 0; k < 4; k++) {
    g.px(stX + k * pw, roofY, pw - s, norenH, k % 2 === 0 ? "#ff3d6e" : "#e8325f");
    g.px(stX + k * pw + div(pw, 2) - s, roofY + div(norenH, 3), s, Math.max(1, div(norenH, 3)), "#fff6e8");
  }
  g.px(stX - s, counterY, stW + 2 * s, s, "#c27a45");
  g.px(stX, counterY + s, stW, ground - counterY - s, "#9a5a35");
  for (let x = stX + 2; x < stX + stW - 1; x += 4) g.px(x, counterY + s, 1, ground - counterY - s, "#7a4426");
  for (let k = 0; k < 3; k++) g.px(stX + div(stW * (30 + k * 22), 100), counterY - s, 2 * s, s, "#fff6e8");
  // A pot with its steam curling up past the curtain.
  const potX = stX + 2 * s;
  g.px(potX, counterY - 2 * s, 3 * s, 2 * s, "#7d7896");
  for (let t = 0; t < 4; t++) g.px(potX + (t % 2) * s, counterY - 3 * s - t * 2 * s, s, s, "#c9c3d9");
  // Red lanterns at the corners of the roof.
  for (const lx of [stX - 2 * s, stX + stW + s]) {
    const r = Math.max(2, 2 * s);
    const top = roofY + s;
    g.px(lx - s, top - s, 2 * s + 1, s, "#140726");
    g.disc(lx, top + r, r, "#ff3d3d");
    g.disc(lx, top + r, Math.max(1, r - s), "#ff7a59");
    g.px(lx - s, top + 2 * r + 1, 2 * s + 1, s, "#140726");
  }
  // Stools before the counter.
  for (let k = 0; k < 3; k++) {
    const sx = stX + div(stW * (18 + k * 28), 100);
    g.px(sx, ground - 3 * s, 3 * s, s, "#ff2a9d");
    g.px(sx + s, ground - 2 * s, s, 2 * s, "#3b1d63");
  }
}

/** Inside a game centre: a neon GAME sign, a row of glowing cabinets, a checkered floor. */
function arcade(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  const floor = h - Math.max(3, div(h * 18, 100));
  g.gradient(0, floor, ["#0b0420", "#120632", "#170838", "#1c0a3f"]);
  for (let x = 3; x < w; x += 12) g.px(x, s, 3 * s, s, "#ffd36b");
  g.px(0, floor, w, h - floor, "#140a2e");
  for (let y = floor, r = 0; y < h; y += 2, r++) {
    for (let x = (r % 2) * 4; x < w; x += 8) g.px(x, y, 4, 2, "#21124a");
  }
  g.px(0, floor, w, 1, "#3b1d63");
  // The cabinets, from a third of the way across: trim, marquee, screen with a game on it, controls.
  const cabW = Math.max(10, div(h * 34, 100));
  const gap = Math.max(3, div(cabW, 3));
  const cabH = div(h * 64, 100);
  const top = floor - cabH;
  for (let x = div(w * 32, 100), i = 0; x + cabW < w - 2; x += cabW + gap, i++) {
    const accent = CABINETS[mod(73000 + i, CABINETS.length)];
    for (let y = floor + 1; y < h; y++) {
      for (let gx = x; gx < x + cabW; gx++) if (((gx + y) & 1) === 0 && mod(gx * 7 + y, 3) === 0) g.px(gx, y, 1, 1, accent);
    }
    g.px(x, top, cabW, cabH, "#1a0f33");
    g.px(x, top, s, cabH, accent);
    g.px(x + cabW - s, top, s, cabH, accent);
    const mqH = Math.max(2, div(cabH, 8));
    g.px(x + s, top + s, cabW - 2 * s, mqH, accent);
    const scY = top + s + mqH + s, scH = Math.max(4, div(cabH * 34, 100));
    g.px(x + 2 * s, scY, cabW - 4 * s, scH, "#0a1840");
    for (let k = 0; k < 6; k++) {
      g.px(x + 3 * s + mod(74000 + i * 7 + k, Math.max(1, cabW - 6 * s)), scY + 1 + mod(75000 + i * 7 + k, Math.max(1, scH - 2)), 1, 1, SCREEN_DOTS[k % 3]);
    }
    const cpY = scY + scH + s;
    g.px(x - s, cpY, cabW + 2 * s, 2 * s, "#2a1650");
    g.px(x + 3 * s, cpY - s, s, s, "#ff3d3d");
    g.px(x + div(cabW, 2), cpY, s, s, "#ffd319");
    g.px(x + div(cabW, 2) + 2 * s, cpY, s, s, "#ff2a9d");
    g.px(x + div(cabW, 2) - s, cpY + 4 * s, 2 * s, 2 * s, "#ff7a59");
  }
  // The neon sign over them, with a dithered glow.
  const letter = 6 * s;
  const signX = div(w * 62, 100), signY = Math.max(2 * s, top - 7 * s);
  for (let gy = signY - s; gy < signY + 6 * s; gy++) {
    for (let gx = signX - 2 * s; gx < signX + letter * 4 + s; gx++) if (((gx + gy) & 1) === 0) g.px(gx, gy, 1, 1, "#3d0a3a");
  }
  for (let c = 0; c < GAME.length; c++) {
    const rows = GAME[c];
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) if (rows[y][x] === "#") g.px(signX + c * letter + x * s, signY + y * s, s, s, "#ff2a9d");
    }
  }
}

/** A bedroom at night with everything saved for later: an episode on the CRT, a cabinet of tapes, floppies, the city outside. */
function bedroom(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  const floor = h - Math.max(3, div(h * 16, 100));
  g.gradient(0, floor, ["#1c0f33", "#221139", "#291545"]);
  for (let x = 2; x < w; x += 6) {
    for (let y = 1 + (div(x, 6) % 2); y < floor; y += 3) g.px(x, y, 1, 1, "#2e1a52");
  }
  // The window between drawn curtains: night sky, a moon, the city's lights.
  const wx = div(w * 40, 100), wy = div(h * 14, 100);
  const ww = Math.max(10, div(w * 15, 100)), wh = Math.max(10, div(h * 46, 100));
  g.px(wx - s, wy - s, ww + 2 * s, wh + 2 * s, "#4a2a6b");
  g.px(wx, wy, ww, wh, "#0e1440");
  const lower = div(wh * 62, 100);
  g.px(wx, wy + lower, ww, wh - lower, "#1d1650");
  for (let i = 0; i < div(ww * wh, 40); i++) g.px(wx + mod(80000 + i, ww), wy + mod(80100 + i, Math.max(1, lower)), 1, 1, "#fff6d6");
  g.disc(wx + div(ww * 72, 100), wy + div(wh * 24, 100), Math.max(1, div(wh, 8)), "#fff2c7");
  for (let x = wx; x < wx + ww; x += 2) {
    const t = 1 + mod(80200 + x, Math.max(1, div(wh, 3)));
    g.px(x, wy + wh - t, 2, t, "#0b0620");
    if (mod(80300 + x, 3) === 0) g.px(x, wy + wh - t + 1, 1, 1, "#ffd36b");
  }
  g.px(wx + div(ww, 2), wy, s, wh, "#4a2a6b");
  g.px(wx, wy + div(wh, 2), ww, s, "#4a2a6b");
  g.px(wx - 4 * s, wy - 2 * s, 3 * s, wh + 5 * s, "#d92f5c");
  g.px(wx + ww + s, wy - 2 * s, 3 * s, wh + 5 * s, "#d92f5c");
  g.px(wx - 3 * s, wy - 2 * s, s, wh + 5 * s, "#a3203f");
  g.px(wx + ww + 2 * s, wy - 2 * s, s, wh + 5 * s, "#a3203f");
  // The floor.
  g.px(0, floor, w, h - floor, "#3a2030");
  g.px(0, floor, w, 1, "#5a3448");
  for (let x = 4; x < w; x += 10) g.px(x, floor + 1, 1, h - floor - 1, "#2c1825");
  // The cabinet of tapes and the TV on it, glowing on the wall behind.
  const standW = Math.max(20, div(w * 24, 100)), standX = div(w * 64, 100);
  const standH = Math.max(5, div(h * 16, 100)), standY = floor - standH;
  const tvW = Math.max(12, div(h * 48, 100)), tvH = Math.max(9, div(h * 36, 100));
  const tvX = standX + div(standW - tvW, 2), tvY = standY - tvH;
  for (let y = tvY - 3 * s; y < standY; y++) {
    for (let x = tvX - 4 * s; x < tvX + tvW + 4 * s; x++) if (((x + y) & 1) === 0) g.px(x, y, 1, 1, "#253a66");
  }
  g.px(standX, standY, standW, standH, "#5a2d1a");
  g.px(standX, standY, standW, s, "#7d4628");
  for (let x = standX + 2 * s, i = 0; x + 2 * s <= standX + standW - 2 * s; x += 3 * s, i++) {
    g.px(x, standY + 2 * s, 2 * s, standH - 3 * s, "#141019");
    g.px(x, standY + 3 * s, 2 * s, s, TAPES[mod(81000 + i, TAPES.length)]);
  }
  g.px(tvX, tvY, tvW, tvH, "#3a3247");
  g.px(tvX, tvY, tvW, s, "#544a66");
  const scW = tvW - 6 * s, scH = tvH - 4 * s;
  // On the screen, paused on a nice frame: a sunset over the sea.
  g.px(tvX + 2 * s, tvY + 2 * s, scW, div(scH, 2), "#ff9fb8");
  g.disc(tvX + 2 * s + div(scW, 2), tvY + 2 * s + div(scH, 2), Math.max(1, div(scH, 4)), "#ffd319");
  g.px(tvX + 2 * s, tvY + 2 * s + div(scH, 2), scW, scH - div(scH, 2), "#2e6bff");
  g.px(tvX + 2 * s, tvY + 2 * s + div(scH, 2), scW, s, "#bff8ff");
  g.px(tvX + tvW - 3 * s, tvY + 2 * s, 2 * s, s, "#ff2a9d");
  g.px(tvX + tvW - 3 * s, tvY + 4 * s, 2 * s, s, "#ffd319");
  for (let t = 1; t <= 4 * s; t++) {
    g.px(tvX + div(tvW, 2) - t, tvY - t, 1, 1, "#a9a3c2");
    g.px(tvX + div(tvW, 2) + t, tvY - t, 1, 1, "#a9a3c2");
  }
  // A stack of floppies on the floor, a plant in the corner.
  for (let k = 0; k < 3; k++) {
    const fx = div(w * 54, 100) + k * s, fy = h - 2 * s - k * 2 * s;
    g.px(fx, fy, 6 * s, 2 * s, TAPES[k]);
    g.px(fx + 2 * s, fy, 2 * s, s, "#c9c3d9");
  }
  const potX = div(w * 93, 100);
  g.px(potX, floor - 4 * s, 4 * s, 4 * s, "#c27a45");
  for (let k = 0; k < 7; k++) {
    g.px(potX - 2 * s + mod(82000 + k, 8 * s), floor - 6 * s - mod(82100 + k, 6 * s), 2 * s, s, k % 2 === 0 ? "#5ce1a5" : "#1f8a5a");
  }
}

/** A little cinema: the projector's beam over the seats, an episode on the screen between red curtains. */
function cinema(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  g.gradient(0, h, ["#0b0420", "#10052a", "#150732"]);
  const sx = div(w * 40, 100), sy = div(h * 8, 100), sw = div(w * 54, 100), sh = div(h * 48, 100);
  for (let y = 0; y < sh; y++) g.px(sx, sy + y, sw, 1, SCREEN_SKY[Math.min(SCREEN_SKY.length - 1, div(y * SCREEN_SKY.length, Math.max(1, sh)))]);
  g.disc(sx + div(sw * 70, 100), sy + div(sh * 62, 100), Math.max(2, div(sh, 6)), "#fff27a");
  for (let x = sx; x < sx + sw; x++) {
    const hill = div(sh * (18 + mod(83000 + div(x - sx, 6), 10)), 100);
    g.px(x, sy + sh - hill, 1, hill, "#1f8a5a");
  }
  const fx = sx + div(sw * 30, 100), fy = sy + sh - div(sh * 22, 100);
  g.px(fx, fy - 4 * s, 2 * s, 4 * s, "#140726");
  g.px(fx + 4 * s, fy - 5 * s, 2 * s, 5 * s, "#140726");
  // Curtains and their valance.
  g.px(sx - 5 * s, sy - s, 5 * s, sh + 3 * s, "#a3182e");
  g.px(sx + sw, sy - s, 5 * s, sh + 3 * s, "#a3182e");
  for (let k = 1; k < 5; k += 2) {
    g.px(sx - 5 * s + k * s, sy - s, s, sh + 3 * s, "#7a1224");
    g.px(sx + sw + k * s, sy - s, s, sh + 3 * s, "#7a1224");
  }
  g.px(sx - 5 * s, sy - 3 * s, sw + 10 * s, 2 * s, "#7a1224");
  // The projector's beam from the back of the hall.
  const bx = div(w * 8, 100), by = div(h * 6, 100);
  const reach = Math.max(1, sx - bx);
  for (let x = bx; x < sx; x++) {
    const t = x - bx;
    const top = by + div((sy - by) * t, reach), bottom = by + div((sy + sh - by) * t, reach);
    for (let y = top; y <= bottom; y++) if (((x + y) & 1) === 0 && mod(x * 3 + y, 4) === 0) g.px(x, y, 1, 1, "#4a3f7a");
  }
  g.px(bx - 2 * s, by - s, 3 * s, 2 * s, "#d7d0e8");
  // Rows of seats, a few heads watching.
  const rowH = Math.max(3, div(h * 10, 100));
  for (let r = 0; r < 3; r++) {
    const y = h - (3 - r) * rowH;
    g.px(0, y + s, w, rowH - s, r % 2 === 0 ? "#4a0f1f" : "#3a0c19");
    for (let x = (r % 2) * 3 * s, i = 0; x < w; x += 6 * s, i++) {
      g.px(x, y, 4 * s, 2 * s, "#5a1426");
      if (mod(84000 + r * 97 + i, 4) === 0) g.disc(x + 2 * s, y - 2 * s, Math.max(1, s + div(s, 2)), "#07010f");
    }
  }
  for (let x = 2; x < w; x += 16) g.px(x, h - s, s, s, "#ffd36b");
}

/** A broadcast tower over the town at night, the newest episodes going out on its waves. */
function tower(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  const ground = h - Math.max(3, div(h * 18, 100));
  g.gradient(0, ground, ["#08031c", "#0f0630", "#1a0b45", "#2a1158"]);
  g.stars(0, div(ground * 60, 100), div(w * ground, 180), 800);
  // The tower: flaring legs in red and white bands, lattice, a lit deck, the antenna and its waves.
  const cx = div(w * 66, 100);
  const top = div(h * 12, 100), base = ground + div(h - ground, 2);
  const span = Math.max(1, base - top);
  const baseHalf = Math.max(4, div(h * 24, 100));
  const band = Math.max(2, div(span, 8));
  for (let y = top; y < base; y++) {
    const half = div(baseHalf * (y - top) * (y - top), span * span) + s;
    const color = div(y - top, band) % 2 === 0 ? "#ff5a36" : "#fff6e8";
    g.px(cx - half, y, s, 1, color);
    g.px(cx + half, y, s, 1, color);
    const step = (y - top) - div(y - top, band) * band;
    const off = div(2 * half * step, band);
    g.px(cx - half + off, y, 1, 1, color);
    g.px(cx + half - off, y, 1, 1, color);
    if (step === 0) g.px(cx - half, y, half * 2 + s, 1, color);
  }
  const deckY = top + div(span * 35, 100);
  const deckHalf = div(baseHalf * (deckY - top) * (deckY - top), span * span) + 3 * s;
  g.px(cx - deckHalf, deckY, deckHalf * 2 + s, 3 * s, "#2a1650");
  for (let x = cx - deckHalf + s; x < cx + deckHalf; x += 2) g.px(x, deckY + s, 1, s, "#ffd36b");
  const antenna = Math.max(3, div(h * 9, 100));
  g.px(cx, top - antenna, s, antenna, "#d7d0e8");
  g.px(cx, top - antenna - s, s, s, "#ff3d3d");
  for (let k = 1; k <= 3; k++) {
    const r = k * 4 * s;
    const reach = div(r * 6, 10);
    for (let dy = -reach; dy <= reach; dy++) {
      const dx = pixelIsqrt(r * r - dy * dy);
      if (((dy + k) & 1) === 0) {
        g.px(cx + dx, top - antenna + dy, 1, 1, "#2ee6ff");
        g.px(cx - dx, top - antenna + dy, 1, 1, "#2ee6ff");
      }
    }
  }
  // The town in front, its windows lit.
  for (let x = 0, i = 0; x < w; i++) {
    const bw = 4 + mod(85000 + i, 7);
    const tall = Math.max(2, div(h * (8 + mod(85100 + i, 18)), 100));
    g.px(x, ground - tall, bw, h - ground + tall, "#120826");
    for (let wy = ground - tall + 1; wy < h - 1; wy += 2) {
      for (let wx = x + 1; wx < x + bw - 1; wx += 2) if (mod(wx * 41 + wy * 13 + 5, 6) === 0) g.px(wx, wy, 1, 1, mod(wx + wy, 3) === 0 ? "#ff7ad9" : "#ffd36b");
    }
    x += bw;
  }
}

/** An observatory on a hill under the Milky Way, its telescope out, a comet passing. */
function observatory(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  g.gradient(0, h, ["#030414", "#07082a", "#0d0d3d", "#16114d"]);
  const half = Math.max(2, div(h * 12, 100));
  for (let x = 0; x < w; x++) {
    const cy = div(h * 70, 100) - div(x * h * 55, 100 * w);
    for (let y = cy - half; y <= cy + half; y++) {
      const d = Math.abs(y - cy);
      if (((x + y) & 1) === 0 && mod(x * 31 + y * 17, half + 1) >= d) g.px(x, y, 1, 1, d * 2 < half ? "#2c2470" : "#1f1a58");
    }
  }
  g.stars(0, h, div(w * h, 50), 900, ["#fff6d6", "#bff8ff", "#ffd319", "#c9a8ff"]);
  const kx = div(w * 50, 100), ky = div(h * 18, 100), tail = Math.max(6, div(w * 10, 100));
  for (let t = 0; t <= tail; t++) g.px(kx + t, ky - div(t, 4), 1, 1, t < 2 ? "#ffffff" : t < div(tail, 2) ? "#bff8ff" : "#4f7cff");
  // The hill.
  const peakX = div(w * 74, 100), peakY = div(h * 64, 100);
  const flat = Math.max(1, div(w * w, 6));
  for (let x = 0; x < w; x++) {
    const d = x - peakX;
    const top = Math.min(h, peakY + div((h - peakY) * d * d, flat));
    g.px(x, top, 1, h - top, "#0a0718");
  }
  // The observatory: a white drum and dome, the slit open, the telescope out, a lit door.
  const bw = Math.max(8, div(h * 30, 100)), bh = Math.max(4, div(h * 14, 100));
  const bx = peakX - div(bw, 2), by = peakY - bh;
  g.px(bx, by, bw, bh, "#cfc8e2");
  g.px(bx + div(bw * 60, 100), by, bw - div(bw * 60, 100), bh, "#9a93b8");
  g.px(bx + div(bw, 2) - s, by + div(bh, 2), 2 * s, bh - div(bh, 2), "#ffd36b");
  const r = div(bw, 2);
  for (let y = by - r; y < by; y++) {
    const dome = pixelIsqrt(r * r - (y - by) * (y - by));
    g.px(peakX - dome, y, dome * 2 + 1, 1, "#e8e2f5");
    g.px(peakX + div(dome, 3), y, dome - div(dome, 3) + 1, 1, "#b7b0cf");
  }
  g.px(peakX - s, by - r, 2 * s, r, "#14102e");
  for (let t = 0; t < Math.max(4, div(r * 3, 2)); t++) g.px(peakX - t, by - div(r, 2) - t, 2 * s, 2 * s, "#7d7896");
}

/** A station at night: the departure board's next trains, the clock, the yellow line, the town across the tracks. */
function station(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  const roofH = Math.max(3, div(h * 14, 100));
  const platform = div(h * 76, 100);
  const tracks = platform - 4 * s;
  g.gradient(0, platform, ["#0b0420", "#140733", "#1f0b45", "#2c1157"]);
  g.stars(roofH, div(platform * 60, 100), div(w * platform, 260), 1000);
  // The town across the tracks.
  for (let x = 0, i = 0; x < w; i++) {
    const bw = 5 + mod(86000 + i, 8);
    const tall = Math.max(2, div(h * (6 + mod(86100 + i, 14)), 100));
    g.px(x, tracks - tall, bw, tall, "#170b30");
    for (let wy = tracks - tall + 1; wy < tracks - 1; wy += 2) {
      for (let wx = x + 1; wx < x + bw - 1; wx += 3) if (mod(wx * 29 + wy * 7 + 3, 7) === 0) g.px(wx, wy, 1, 1, "#ffd36b");
    }
    x += bw;
  }
  // The tracks.
  g.px(0, tracks, w, platform - tracks, "#1a1228");
  g.px(0, tracks + s, w, 1, "#7d7896");
  g.px(0, platform - s, w, 1, "#7d7896");
  for (let x = 1; x < w; x += 5) g.px(x, tracks + s + 1, 2, platform - tracks - 2 * s - 1, "#2a1f3d");
  // The roof, its lamps and pillars.
  g.px(0, 0, w, roofH, "#120a26");
  g.px(0, roofH, w, s, "#2a1650");
  for (let x = 6; x < w; x += 14) g.px(x, roofH + s, 3 * s, s, "#ffd36b");
  const pillarStep = Math.max(24, div(w * 22, 100));
  for (let x = div(w * 10, 100); x < w; x += pillarStep) g.px(x, roofH, 2 * s, platform - roofH, "#1c1238");
  // The departure board: the next train in cyan, the rest in amber.
  const bx = div(w * 44, 100), bwid = Math.max(16, div(w * 32, 100));
  const by = roofH + 2 * s, bhgt = Math.max(8, div(h * 28, 100));
  g.px(bx + div(bwid, 4), roofH, s, 2 * s, "#2a1650");
  g.px(bx + div(bwid * 3, 4), roofH, s, 2 * s, "#2a1650");
  g.px(bx, by, bwid, bhgt, "#07040f");
  g.px(bx, by, bwid, s, "#3b2a52");
  for (let r = 0; by + 2 * s + r * 3 * s + s <= by + bhgt - s; r++) {
    const y = by + 2 * s + r * 3 * s;
    const color = r === 0 ? "#2ee6ff" : "#ffb02e";
    g.px(bx + 2 * s, y, 5 * s, s, color);
    const end = Math.min(bx + bwid - 2 * s, bx + 9 * s + div(bwid * (30 + mod(87000 + r, 35)), 100));
    for (let x = bx + 9 * s; x < end; x += 2 * s) g.px(x, y, s, s, color);
  }
  // The clock.
  const cr = Math.max(3, div(h * 9, 100)), ccx = div(w * 88, 100), ccy = roofH + cr + 2 * s;
  g.px(ccx, roofH, s, 2 * s, "#2a1650");
  g.disc(ccx, ccy, cr, "#fff6e8");
  g.px(ccx, ccy - cr + s, s, cr - s, "#140726");
  g.px(ccx, ccy, div(cr * 2, 3), s, "#140726");
  // The platform, its yellow line, a bench.
  g.px(0, platform, w, h - platform, "#2a1f3d");
  g.px(0, platform, w, s, "#ffd319");
  for (let x = 2; x < w; x += 8) g.px(x, platform + 2 * s, 4, s, "#352a4d");
  const benchX = div(w * 62, 100);
  g.px(benchX, platform - 3 * s, 8 * s, s, "#9a5a35");
  g.px(benchX + s, platform - 2 * s, s, 2 * s, "#5a2d1a");
  g.px(benchX + 6 * s, platform - 2 * s, s, 2 * s, "#5a2d1a");
}

/** A desk at night: a beige computer's green prompt, the keyboard, a lamp, a mug, books and floppies on the shelf. */
function terminal(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  const desk = div(h * 72, 100);
  g.gradient(0, desk, ["#0e0820", "#130a2a", "#180c33"]);
  // The shelf over the desk.
  const shelfY = div(h * 24, 100), shelfX = div(w * 38, 100), shelfW = Math.max(12, div(w * 20, 100));
  g.px(shelfX, shelfY, shelfW, s, "#7d4628");
  for (let x = shelfX + s, i = 0; x < shelfX + shelfW - 2 * s; i++) {
    const bw = (2 + mod(88000 + i, 2)) * s;
    const bh = Math.max(3, div(h * (8 + mod(88100 + i, 6)), 100));
    g.px(x, shelfY - bh, bw, bh, BOOKS[mod(88200 + i, BOOKS.length)]);
    x += bw + (mod(88300 + i, 4) === 0 ? s : 0);
  }
  // The desk.
  const deskX = div(w * 34, 100);
  g.px(0, desk, w, h - desk, "#24121e");
  g.px(deskX, desk, w - deskX, h - desk, "#5a2d1a");
  g.px(deskX, desk, w - deskX, s, "#9a5a35");
  // The monitor's green glow on the wall, then the monitor: beige, a green prompt, the cursor.
  const mw = Math.max(14, div(h * 54, 100)), mh = Math.max(10, div(h * 42, 100));
  const mx = div(w * 58, 100), my = desk - mh - 2 * s;
  for (let y = my - 3 * s; y < desk; y++) {
    for (let x = mx - 4 * s; x < mx + mw + 4 * s; x++) if (((x + y) & 1) === 0) g.px(x, y, 1, 1, "#17392a");
  }
  g.px(mx, my, mw, mh, "#d8cdb8");
  g.px(mx + mw - 2 * s, my, 2 * s, mh, "#b0a690");
  const scX = mx + 2 * s, scY = my + 2 * s, scW = mw - 5 * s, scH = mh - 5 * s;
  g.px(scX, scY, scW, scH, "#08140e");
  let lastY = scY + s, lastEnd = scX + s;
  for (let r = 0; scY + s + r * 2 * s + s <= scY + scH - s; r++) {
    const y = scY + s + r * 2 * s;
    const len = Math.max(2, mod(89000 + r, Math.max(1, scW - 3 * s)));
    g.px(scX + s, y, len, s, "#5ce1a5");
    lastY = y; lastEnd = scX + s + len;
  }
  g.px(Math.min(lastEnd + s, scX + scW - 2 * s), lastY, s, s, "#bff8ff");
  g.px(mx + div(mw, 2) - 2 * s, my + mh, 4 * s, 2 * s, "#b0a690");
  // The keyboard.
  g.px(mx - 2 * s, desk + s, mw + 4 * s, 2 * s, "#d8cdb8");
  for (let x = mx - s; x < mx + mw + 2 * s; x += 2) g.px(x, desk + s, 1, 1, "#8f8a7a");
  // The computer: a beige tower with its lights and a floppy slot.
  const tx = mx + mw + 3 * s, tw = Math.max(4, 5 * s), th = mh + 2 * s;
  g.px(tx, desk - th, tw, th, "#d8cdb8");
  g.px(tx + s, desk - th + 2 * s, tw - 2 * s, s, "#5a5348");
  g.px(tx + s, desk - th + 4 * s, s, s, "#5ce1a5");
  g.px(tx + 3 * s, desk - th + 4 * s, s, s, "#ff3d3d");
  // A desk lamp's warm light, a mug with steam.
  const lx = deskX + 4 * s, ly = desk - div(h * 30, 100);
  for (let y = ly + 2 * s; y < desk; y++) {
    const spread = div((y - ly) * 2, 3);
    for (let x = lx - spread; x <= lx + spread; x++) if (((x + y) & 1) === 0) g.px(x, y, 1, 1, "#4a2a1f");
  }
  g.px(lx, ly, s, desk - ly, "#3b1d63");
  g.px(lx - 2 * s, ly, 5 * s, 2 * s, "#ffd319");
  const cupX = mx - 6 * s;
  g.px(cupX, desk - 3 * s, 3 * s, 3 * s, "#ff2a9d");
  g.px(cupX + 3 * s, desk - 2 * s, s, s, "#ff2a9d");
  for (let t = 0; t < 3; t++) g.px(cupX + s + (t % 2) * s, desk - 4 * s - t * 2 * s, s, s, "#8f88ad");
}

/** A concert stage: spotlights, an equalizer glowing behind the band, light sticks up in the crowd. */
function stage(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  const deckY = div(h * 70, 100);
  const deckH = Math.max(3, div(h * 7, 100));
  const stageX = div(w * 34, 100);
  g.gradient(0, deckY, ["#07021a", "#0d0428", "#140633", "#1d0940"]);
  // The rig and the soft cones of its spotlights.
  const rigY = div(h * 4, 100);
  g.px(stageX, rigY, w - stageX, s, "#2a1650");
  for (let k = 0; k < SPOT_X.length; k++) {
    const lx = div(w * SPOT_X[k], 100), ly = rigY + s;
    for (let y = ly + s; y < deckY; y++) {
      const spread = div((y - ly) * 2, 5);
      const mid = lx + div((y - ly) * SPOT_LEAN[k], 10);
      for (let x = mid - spread; x <= mid + spread; x++) if (((x + y) & 1) === 0) g.px(x, y, 1, 1, SPOT_GLOW[k]);
    }
    g.px(lx - s, ly - s, 2 * s, 2 * s, "#fff6e8");
  }
  // The equalizer down to the deck: columns of segments, pink at the bottom to cyan at the top.
  const ex = div(w * 38, 100), eTop = div(h * 12, 100), eBottom = deckY - s;
  const eSpan = Math.max(1, eBottom - eTop);
  for (let x = ex, i = 0; x + 2 * s <= w - 2 * s; x += 3 * s, i++) {
    const tall = Math.max(2 * s, div(eSpan * (30 + mod(76000 + i, 71)), 100));
    for (let y = eBottom - tall; y < eBottom; y += 2 * s) {
      g.px(x, y, 2 * s, s, EQUALIZER[Math.min(EQUALIZER.length - 1, div((eBottom - y) * EQUALIZER.length, eSpan))]);
    }
  }
  // The deck, its footlights, an amp at each side.
  g.px(stageX, deckY, w - stageX, deckH, "#2a1650");
  g.px(stageX, deckY, w - stageX, s, "#4a2a7a");
  for (let x = stageX + 2; x < w; x += 6) g.px(x, deckY + deckH - s, 2, s, "#ffd36b");
  const ampW = 6 * s, ampH = 8 * s;
  for (const ax of [stageX + 2 * s, w - 3 * s - ampW]) {
    g.px(ax, deckY - ampH, ampW, ampH, "#07010f");
    g.px(ax + s, deckY - ampH + s, ampW - 2 * s, ampH - 2 * s, "#1a0f2a");
  }
  // The band against the glow: a guitarist with a pink guitar, the singer at the microphone, the drummer.
  const tall = Math.max(10, div(h * 36, 100));
  for (const fx of [div(w * 52, 100), div(w * 66, 100)]) {
    g.disc(fx + s, deckY - tall + 2 * s, Math.max(1, 2 * s), "#07010f");
    g.px(fx - s, deckY - tall + 4 * s, 5 * s, tall - 7 * s, "#07010f");
    g.px(fx - s, deckY - 3 * s, 2 * s, 3 * s, "#07010f");
    g.px(fx + 2 * s, deckY - 3 * s, 2 * s, 3 * s, "#07010f");
  }
  const guitarX = div(w * 52, 100);
  for (let t = 0; t < 8 * s; t++) g.px(guitarX - 3 * s + t, deckY - div(tall, 2) + div(t, 2), s, s, "#ff2a9d");
  g.px(guitarX - 4 * s, deckY - div(tall, 2) - s, 2 * s, 2 * s, "#ff2a9d");
  const micX = div(w * 66, 100) - 3 * s;
  g.px(micX, deckY - div(tall * 3, 4), s, div(tall * 3, 4), "#c9c3d9");
  g.px(micX - s, deckY - div(tall * 3, 4) - s, 2 * s, 2 * s, "#fff6e8");
  const drumX = div(w * 82, 100), drum = Math.max(3, 4 * s);
  g.disc(drumX, deckY - 2 * drum - 2 * s, Math.max(1, 2 * s), "#07010f");
  g.px(drumX - 2 * s, deckY - 2 * drum, 5 * s, drum, "#07010f");
  g.disc(drumX, deckY - drum, drum, "#07010f");
  g.disc(drumX, deckY - drum, Math.max(1, drum - s), "#ff2a9d");
  g.px(drumX + drum + s, deckY - 2 * drum - 3 * s, 5 * s, s, "#ffd319");
  g.px(drumX + drum + 3 * s, deckY - 2 * drum - 2 * s, s, 2 * drum + 2 * s, "#c9c3d9");
  // The crowd in the light off the stage, light sticks up.
  const crowdTop = deckY + deckH;
  g.px(0, crowdTop, w, h - crowdTop, "#24104d");
  for (let y = crowdTop; y < h; y++) {
    for (let x = y & 1; x < w; x += 2) g.px(x, y, 1, 1, "#33166a");
  }
  for (let x = -s, i = 0; x < w; x += 4 * s, i++) {
    const hy = crowdTop + 2 * s + mod(77000 + i, 3) * s;
    g.disc(x + 2 * s, hy, Math.max(1, s + div(s, 2)), "#07010f");
    g.px(x, hy + s, 4 * s, h - hy - s, "#07010f");
    if (mod(77100 + i, 3) === 0) {
      g.px(x + 3 * s, hy - 4 * s, s, 4 * s, "#07010f");
      g.px(x + 3 * s, hy - 8 * s, s, 4 * s, LIGHT_STICKS[mod(77200 + i, LIGHT_STICKS.length)]);
    }
  }
}

/** Music notes drifting up and to the left of ([x], [y]), seeded by [seed]. */
function notes(g: Grid, x: number, y: number, count: number, s: number, seed: number) {
  for (let k = 0; k < count; k++) {
    const color = NOTE_COLORS[mod(seed + k, NOTE_COLORS.length)];
    g.sprite(NOTE, x - k * 7 * s - mod(seed + 10 + k, 4) * s, y - k * 5 * s - mod(seed + 20 + k, 3) * s, s, { "#": color });
  }
}

/** All time: a jukebox glowing in a diner at night, its arch of colours, records and buttons, notes rising. */
function jukebox(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  const floor = h - Math.max(4, div(h * 20, 100));
  g.gradient(0, floor, ["#0c0420", "#140733", "#1b0a40", "#24104d"]);
  for (let x = 6; x < w; x += 12) g.px(x, 0, 1, floor, "#1d0b3a");
  // The checkered floor and a neon strip along the wall.
  g.px(0, floor, w, h - floor, "#1a0f2e");
  const tile = Math.max(2, 3 * s);
  for (let y = floor, r = 0; y < h; y += tile, r++) {
    for (let x = (r % 2) * tile; x < w; x += tile * 2) g.px(x, y, tile, tile, "#3b2a5a");
  }
  g.px(0, floor - s, w, s, "#ff2a9d");
  // The diner's counter and stools on the left.
  const counterW = div(w * 42, 100), counterY = floor - div(h * 22, 100);
  g.px(0, counterY, counterW, 2 * s, "#ff3d6e");
  g.px(0, counterY + 2 * s, counterW, floor - counterY - 3 * s, "#2a1650");
  for (let x = div(w * 5, 100); x < counterW - 2 * s; x += Math.max(8 * s, div(w * 9, 100))) {
    g.px(x - 2 * s, floor - 9 * s, 6 * s, 2 * s, "#ff3d6e");
    g.px(x, floor - 7 * s, 2 * s, 7 * s, "#c9c3d9");
  }
  // The jukebox, glowing on the wall behind it.
  const jw = Math.max(16, div(h * 50, 100)), jh = Math.max(22, div(h * 66, 100));
  const r = div(jw, 2), acx = div(w * 74, 100), jx = acx - r;
  const acy = floor - jh + r;
  for (let y = acy - r - 4 * s; y < floor; y++) {
    for (let x = jx - 6 * s; x < jx + jw + 6 * s; x++) if (((x + y) & 1) === 0 && mod(x * 7 + y * 3, 3) === 0) g.px(x, y, 1, 1, "#4a1a5a");
  }
  for (let band = 0; band < JUKE_ARCH.length; band++) {
    const rr = r - band * s;
    if (rr <= 0) break;
    for (let y = acy - rr; y <= acy; y++) {
      const half = pixelIsqrt(rr * rr - (y - acy) * (y - acy));
      g.px(acx - half, y, half * 2 + 1, 1, JUKE_ARCH[band]);
    }
  }
  const inner = r - JUKE_ARCH.length * s;
  if (inner > 2) {
    for (let y = acy - inner; y <= acy; y++) {
      const half = pixelIsqrt(inner * inner - (y - acy) * (y - acy));
      g.px(acx - half, y, half * 2 + 1, 1, "#140726");
    }
    g.disc(acx, acy - div(inner, 3), Math.max(2, div(inner, 2)), "#07010f");
    g.disc(acx, acy - div(inner, 3), Math.max(1, div(inner, 6)), "#ff2a9d");
    g.line(acx + div(inner * 2, 3), acy - div(inner * 2, 3), acx + div(inner, 6), acy - div(inner, 3), "#c9c3d9", s);
  }
  g.px(jx, acy, jw, floor - acy, "#8a1f3a");
  g.px(jx, acy, 2 * s, floor - acy, "#d7d0e8");
  g.px(jx + jw - 2 * s, acy, 2 * s, floor - acy, "#9a93b8");
  const panelY = acy + 2 * s, panelH = Math.max(4 * s, div(floor - acy, 3));
  g.px(jx + 3 * s, panelY, jw - 6 * s, panelH, "#d7d0e8");
  for (let y = panelY + s, row = 0; y + s < panelY + panelH; y += 2 * s, row++) {
    for (let x = jx + 4 * s, col = 0; x + s < jx + jw - 4 * s; x += 2 * s, col++) g.px(x, y, s, s, BUTTONS[mod(90000 + row * 13 + col, BUTTONS.length)]);
  }
  const grilleY = panelY + panelH + 2 * s;
  g.px(jx + 3 * s, grilleY, jw - 6 * s, Math.max(s, floor - grilleY - 3 * s), "#2a0f1f");
  for (let y = grilleY + s; y < floor - 3 * s; y += 2 * s) g.px(jx + 4 * s, y, jw - 8 * s, s, "#ff7f3f");
  g.px(jx + s, floor - 2 * s, 3 * s, 2 * s, "#c9c3d9");
  g.px(jx + jw - 4 * s, floor - 2 * s, 3 * s, 2 * s, "#c9c3d9");
  for (let x = jx - 4 * s; x < jx + jw + 4 * s; x++) if ((x & 1) === 0) g.px(x, floor, 1, s, "#ff7ad9");
  notes(g, jx - 3 * s, floor - div(jh, 2), 4, s, 90100);
}

/** The 1960s: a valve radio on the chest of drawers, its dial aglow, the evening sun through the window, the clock on the wall. */
function radio(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  const floor = h - Math.max(4, div(h * 14, 100));
  g.gradient(0, floor, ["#1e0b2a", "#271033", "#30153a"]);
  for (let x = 5; x < w; x += 10) g.px(x, 0, s, floor, "#2a1236");
  g.px(0, floor, w, h - floor, "#2a1420");
  for (let x = 7; x < w; x += 14) g.px(x, floor + s, 1, h - floor - s, "#1e0e18");
  g.px(0, floor, w, s, "#4a2430");
  // The window on the evening: the sun going down behind the roofs, a TV aerial, the power lines.
  const wx = div(w * 8, 100), wy = div(h * 12, 100), ww = Math.max(16, div(w * 26, 100)), wh = div(h * 50, 100);
  g.px(wx - s, wy - s, ww + 2 * s, wh + 2 * s, "#5a2d1a");
  for (let y = 0; y < wh; y++) g.px(wx, wy + y, ww, 1, EVENING[Math.min(EVENING.length - 1, div(y * EVENING.length, Math.max(1, wh)))]);
  const sr = Math.max(2, div(Math.min(ww, wh), 4)), scx = wx + div(ww * 64, 100), scy = wy + div(wh * 56, 100);
  for (let y = scy - sr; y <= scy + sr; y++) {
    if (y >= scy && (y - scy) % (2 * s + 1) < s) continue;
    const half = pixelIsqrt(sr * sr - (y - scy) * (y - scy));
    g.px(scx - half, y, half * 2 + 1, 1, "#ffd36b");
  }
  g.line(wx, wy + div(wh * 30, 100), wx + ww - 1, wy + div(wh * 40, 100), "#2a1236");
  g.line(wx, wy + div(wh * 36, 100), wx + ww - 1, wy + div(wh * 46, 100), "#2a1236");
  const roofs = wy + wh;
  for (let x = wx, k = 0; x < wx + ww; k++) {
    const bw = Math.min((4 + mod(92000 + k, 4)) * s, wx + ww - x);
    const top = roofs - div(wh * (16 + mod(92100 + k, 14)), 100);
    g.px(x, top, bw, roofs - top, "#2a1236");
    g.px(x, top, bw, s, "#1a0a26");
    if (mod(92200 + k, 3) === 0 && bw > 2 * s && top + 3 * s < roofs) g.px(x + s, top + 2 * s, s, s, "#ffd36b");
    if (k === 1) {
      const ax = x + div(bw, 2), pole = Math.max(1, div(s, 2));
      g.px(ax, top - 5 * s, pole, 5 * s, "#1a0a26");
      g.px(ax - 2 * s, top - 5 * s, 4 * s + pole, pole, "#1a0a26");
      g.px(ax - s, top - 3 * s, 2 * s + pole, pole, "#1a0a26");
    }
    x += bw;
  }
  g.px(wx + div(ww, 2), wy, s, wh, "#5a2d1a");
  g.px(wx - 2 * s, wy + wh + s, ww + 4 * s, s, "#7a4426");
  g.px(wx - 4 * s, wy - 3 * s, ww + 8 * s, s, "#c9a070");
  for (const cx of [wx - 3 * s, wx + ww]) {
    g.px(cx, wy - 2 * s, 3 * s, wh + 4 * s, "#a3307a");
    g.px(cx + s, wy - 2 * s, 1, wh + 4 * s, "#7a2060");
  }
  // The chest of drawers, and a standing lamp beside it when there's room.
  const chestX = div(w * 50, 100), chestW = div(w * 40, 100), chestH = Math.max(8, div(h * 26, 100));
  const chestY = floor - chestH;
  const gap = chestX - (wx + ww + 3 * s);
  if (gap > 12 * s) {
    const lx = wx + ww + 3 * s + div(gap, 2), lt = div(h * 26, 100);
    for (let y = lt + 4 * s; y < floor; y++) {
      const spread = 3 * s + div((y - lt) * 2, 5);
      for (let x = lx - spread; x <= lx + spread; x++) if (((x + y) & 1) === 0 && mod(x * 5 + y * 3, 3) === 0) g.px(x, y, 1, 1, "#4a2440");
    }
    g.px(lx, lt + 4 * s, Math.max(1, div(s, 2)), floor - lt - 4 * s, "#c9a070");
    for (let y = 0; y < 4 * s; y++) {
      const half = 2 * s + div(y, 2);
      g.px(lx - half, lt + y, half * 2 + 1, 1, "#ff9e6b");
    }
    g.px(lx - 2 * s, floor - s, 4 * s + 1, s, "#c9a070");
  }
  g.px(chestX, chestY, chestW, chestH, "#5a2d1a");
  g.px(chestX, chestY, chestW, s, "#7a4426");
  for (let k = 1; k < 3; k++) g.px(chestX + s, chestY + div(chestH * k, 3), chestW - 2 * s, s, "#3a1d10");
  for (let k = 0; k < 3; k++) {
    const ky = chestY + div(chestH * k, 3) + div(chestH, 6);
    g.px(chestX + div(chestW, 4), ky, s, s, "#c9a070");
    g.px(chestX + div(chestW * 3, 4), ky, s, s, "#c9a070");
  }
  // The radio: a wooden case, the woven grille, the lit dial with its red needle, two knobs.
  const rh = Math.max(12, div(h * 30, 100)), rw = div(rh * 17, 10);
  const rx = chestX + div(chestW - rw, 2), ry = chestY - rh;
  for (let y = ry - 5 * s; y < chestY; y++) {
    for (let x = rx - 5 * s; x < rx + rw + 5 * s; x++) if (((x + y) & 1) === 0 && mod(x * 7 + y * 3, 3) === 0) g.px(x, y, 1, 1, "#4a2a3a");
  }
  g.px(rx + 2 * s, ry, rw - 4 * s, s, "#b86a3a");
  g.px(rx + s, ry + s, rw - 2 * s, s, "#9a5a35");
  g.px(rx, ry + 2 * s, rw, rh - 2 * s, "#8a4a28");
  g.px(rx, chestY - s, rw, s, "#5a2d1a");
  const gx = rx + 2 * s, gy = ry + 3 * s, gw = div(rw * 50, 100), gh = rh - 5 * s;
  g.px(gx, gy, gw, gh, "#d9b07a");
  for (let y = gy; y < gy + gh; y++) for (let x = gx + (y & 1); x < gx + gw; x += 2) g.px(x, y, 1, 1, "#b88a58");
  for (let x = gx + 2 * s; x < gx + gw - s; x += 3 * s) g.px(x, gy, s, gh, "#8a4a28");
  const dx = gx + gw + 2 * s, dw = rx + rw - 2 * s - dx, dh = Math.max(3 * s, div(gh, 2));
  g.px(dx, gy, dw, dh, "#ffe9a8");
  for (let x = dx + s; x < dx + dw - s; x += 2 * s) g.px(x, gy + dh - 2 * s, 1, s, "#8a5a2a");
  g.px(dx + div(dw * 62, 100), gy + s, Math.max(1, div(s, 2)), dh - 2 * s, "#ff3d3d");
  const ky = gy + dh + div(gh - dh, 2), kr = Math.max(1, div(dw, 5));
  g.disc(dx + div(dw, 4), ky, kr, "#f0e0c0");
  g.disc(dx + div(dw * 3, 4), ky, kr, "#f0e0c0");
  // The clock on the wall and its pendulum.
  const cw = Math.max(6, 5 * s), ch = Math.max(12, 11 * s), clx = div(w * 88, 100) - div(cw, 2), cly = div(h * 8, 100);
  g.px(clx, cly, cw, ch, "#5a2d1a");
  g.px(clx, cly, cw, s, "#7a4426");
  const fr = Math.max(2, div(cw, 2) - s), fcx = clx + div(cw, 2), fcy = cly + 2 * s + fr;
  g.disc(fcx, fcy, fr, "#f0e0c0");
  g.px(fcx, fcy - fr + s, 1, fr - s, "#2a1420");
  g.px(fcx, fcy, div(fr, 2) + 1, 1, "#2a1420");
  const pendTop = fcy + fr + s;
  g.px(clx + s, pendTop, cw - 2 * s, cly + ch - s - pendTop, "#2a1420");
  g.px(fcx, pendTop, 1, Math.max(1, cly + ch - 3 * s - pendTop), "#c9a070");
  g.disc(fcx, cly + ch - 3 * s, Math.max(1, s), "#ffd36b");
  notes(g, rx - 2 * s, ry - 2 * s, 3, s, 92300);
}

/** The 1970s: a turntable spinning on the sideboard between wooden speakers, a crate of records, a lava lamp. */
function hifi(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  const floor = h - Math.max(4, div(h * 16, 100));
  g.gradient(0, floor, ["#1e0d14", "#2a1218", "#36181c"]);
  // Seventies wallpaper: rows of brown and orange rings.
  const ring = Math.max(3, 4 * s);
  for (let y = ring, row = 0; y < floor - ring; y += ring * 3, row++) {
    for (let x = ring + (row % 2) * ring * 2, k = 0; x < w; x += ring * 4, k++) {
      g.disc(x, y, ring, k % 2 === 0 ? "#4a2418" : "#5a2a14");
      g.disc(x, y, Math.max(1, ring - s), "#2a1218");
    }
  }
  g.px(0, floor, w, h - floor, "#3a1f12");
  for (let x = 3; x < w; x += 9) g.px(x, floor + s, 1, h - floor - s, "#2c170d");
  g.px(0, floor, w, s, "#5a2d1a");
  // The sideboard and the speakers on either side.
  const boardX = div(w * 50, 100), boardW = div(w * 38, 100), boardH = Math.max(6, div(h * 24, 100));
  const boardY = floor - boardH;
  g.px(boardX, boardY, boardW, boardH, "#7a4426");
  g.px(boardX, boardY, boardW, s, "#9a5a35");
  for (let x = boardX + div(boardW, 4); x < boardX + boardW - s; x += div(boardW, 4)) g.px(x, boardY + 2 * s, s, boardH - 3 * s, "#5a2d1a");
  const spW = Math.max(6, Math.min(div(h * 22, 100), div(w * 9, 100))), spH = Math.max(14, div(h * 46, 100));
  for (const sx of [boardX - spW - s, boardX + boardW + s]) {
    g.px(sx, floor - spH, spW, spH, "#5a2d1a");
    g.px(sx + s, floor - spH + s, spW - 2 * s, spH - 2 * s, "#3a1d10");
    const cx = sx + div(spW, 2);
    g.disc(cx, floor - spH + div(spH, 3), Math.max(2, div(spW, 3)), "#1a0c08");
    g.disc(cx, floor - spH + div(spH, 3), Math.max(1, div(spW, 6)), "#9a5a35");
    g.disc(cx, floor - div(spH, 4), Math.max(1, div(spW, 5)), "#1a0c08");
  }
  // The turntable: wooden plinth, a black record with an orange label, the silver tonearm.
  const ttW = Math.max(16, div(boardW * 46, 100)), ttX = boardX + div(boardW, 8), ttH = Math.max(4, 4 * s);
  g.px(ttX, boardY - ttH, ttW, ttH, "#c27a45");
  g.px(ttX, boardY - ttH, ttW, s, "#d89a65");
  const rr = Math.max(3, div(ttW * 34, 100)), rcx = ttX + div(ttW * 40, 100), rcy = boardY - ttH - s;
  for (let y = rcy - div(rr, 3); y <= rcy; y++) {
    const half = pixelIsqrt(rr * rr - (y - rcy) * (y - rcy) * 9);
    g.px(rcx - half, y, half * 2 + 1, 1, (y & 1) === 0 ? "#07010f" : "#1a1420");
  }
  g.px(rcx - 2 * s, rcy - s, 4 * s, s, "#ff7f3f");
  g.line(ttX + ttW - 2 * s, boardY - ttH - 4 * s, rcx + div(rr, 2), rcy - s, "#d7d0e8", s);
  // A lava lamp on the sideboard.
  const lx = boardX + div(boardW * 78, 100), lh = Math.max(8, div(h * 26, 100));
  g.px(lx, boardY - 2 * s, 4 * s, 2 * s, "#c9c3d9");
  for (let y = boardY - lh; y < boardY - 2 * s; y++) {
    const half = s + div((y - (boardY - lh)) * s, Math.max(1, lh));
    g.px(lx + 2 * s - half, y, half * 2, 1, "#ff7f3f");
  }
  g.disc(lx + 2 * s, boardY - div(lh * 2, 3), s, "#ffd319");
  g.disc(lx + 2 * s, boardY - div(lh, 3), Math.max(1, s + div(s, 2)), "#ff2a9d");
  g.px(lx + s, boardY - lh - s, 2 * s, 2 * s, "#c9c3d9");
  // A crate of records on the floor, their sleeves in every colour.
  const crateX = div(w * 40, 100), crateW = Math.max(12, div(w * 10, 100)), crateH = Math.max(5, div(h * 14, 100));
  for (let x = crateX + s, k = 0; x < crateX + crateW - s; x += 2 * s, k++) g.px(x, h - crateH - 2 * s, s * 2 - 1, crateH, SLEEVES[mod(90200 + k, SLEEVES.length)]);
  g.px(crateX, h - div(crateH * 2, 3), crateW, div(crateH * 2, 3), "#9a5a35");
  notes(g, rcx - 2 * s, rcy - 6 * s, 3, s, 90300);
}

/** The 1980s: a night drive, a cassette in the deck, the highway's lights running in to the city. */
function nightDrive(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  const dash = h - Math.max(6, div(h * 30, 100));
  const horizon = div(h * 44, 100);
  g.gradient(0, horizon, NIGHT_SKY);
  g.stars(0, div(horizon * 2, 3), Math.max(4, div(w * horizon, 260)), 93000);
  g.disc(div(w * 66, 100), div(h * 16, 100), Math.max(2, div(h * 7, 100)), "#ffe9c8");
  // The city ahead, its windows lit.
  const tallest = Math.max(2 * s, horizon - div(h * 16, 100));
  for (let x = 0, k = 0; x < w; k++) {
    const bw = (4 + mod(93100 + k, 6)) * s, bh = Math.max(2 * s, div(tallest * (25 + mod(93200 + k, 76)), 100));
    g.px(x, horizon - bh, bw, bh, "#140630");
    for (let yy = horizon - bh + s; yy < horizon - s; yy += 2 * s) {
      for (let xx = x + s; xx < x + bw - s; xx += 2 * s) if (mod(xx * 3 + yy * 7 + 93300, 5) === 0) g.px(xx, yy, s, s, CITY_LIGHTS[mod(xx + yy, CITY_LIGHTS.length)]);
    }
    x += bw;
  }
  // The highway: lane marks dashed by distance, lamps along both sides, a car's tail lights ahead.
  const vx = div(w, 2), depth = Math.max(1, dash - horizon);
  g.px(0, horizon, w, dash - horizon, "#0d0420");
  for (let y = horizon; y < dash; y++) {
    const dy = y - horizon + 1;
    const half = div(dy * w * 7, depth * 10);
    g.px(vx - half, y, half * 2, 1, "#1c0e33");
    const edge = Math.max(1, div(half, 30));
    g.px(vx - half, y, edge, 1, "#ff7ad9");
    g.px(vx + half - edge, y, edge, 1, "#ff7ad9");
    if (div(div(depth * 24, dy), 6) % 2 === 0) {
      const mark = Math.max(1, div(half, 24));
      g.px(vx - div(half, 3) - div(mark, 2), y, mark, 1, "#fff6e8");
      g.px(vx + div(half, 3) - div(mark, 2), y, mark, 1, "#fff6e8");
    }
  }
  for (const z of [26, 34, 46, 62, 86, 120, 170]) {
    const dy = Math.max(1, div(depth * 24, z)), y = horizon + dy - 1;
    const half = div(dy * w * 7, depth * 10), pole = div(dy * 3, 2), size = Math.max(1, div(dy, 6));
    for (const side of [-1, 1]) {
      const px = vx + side * div(half * 12, 10);
      g.px(px, y - pole, Math.max(1, div(dy, 14)), pole, "#2a1650");
      g.px(side < 0 ? px : px - div(dy, 4), y - pole, div(dy, 4) + 1, Math.max(1, div(dy, 16)), "#2a1650");
      g.px(px - side * div(dy, 4) - div(size, 2), y - pole, size, size, "#ffb36b");
    }
  }
  const cdy = Math.max(2, div(depth * 24, 60)), cy = horizon + cdy;
  const cw = Math.max(4 * s, div(div(cdy * w * 7, depth * 10) * 2, 5)), ch = Math.max(2 * s, div(cw, 4));
  const cl = vx - div(cw, 2), roofIn = div(cw, 6), cabH = Math.max(s, div(ch * 2, 3)), lamp = Math.max(1, div(cw, 6));
  g.px(cl, cy - ch, cw, ch, "#07010f");
  g.px(cl + roofIn, cy - ch - cabH, cw - 2 * roofIn, cabH, "#07010f");
  g.px(cl + roofIn + s, cy - ch - cabH + s, cw - 2 * roofIn - 2 * s, Math.max(1, cabH - s), "#2a1650");
  g.px(cl, cy - ch + s, lamp, s, "#ff3d3d");
  g.px(cl + cw - lamp, cy - ch + s, lamp, s, "#ff3d3d");
  g.px(vx - div(lamp, 2), cy - div(ch, 2), lamp, s, "#c9c3d9");
  // The windshield's frame, the mirror and the dice hanging from it.
  g.px(0, 0, w, 2 * s, "#07010f");
  for (let y = 0; y < dash; y++) {
    const pw = div(w * 3, 100) + div((dash - y) * w * 5, Math.max(1, dash) * 100);
    g.px(0, y, pw, 1, "#07010f");
    g.px(w - pw, y, pw, 1, "#07010f");
  }
  const mw = Math.max(8 * s, div(w * 12, 100)), mx = vx - div(mw, 2);
  g.px(vx - s, 2 * s, 2 * s, 2 * s, "#07010f");
  g.px(mx, 4 * s, mw, 3 * s, "#07010f");
  g.px(mx + s, 5 * s, mw - 2 * s, s, "#3a1f6e");
  const dice = mx + div(mw, 3);
  g.px(dice, 7 * s, Math.max(1, div(s, 2)), 3 * s, "#c9c3d9");
  g.px(dice - 2 * s, 10 * s, 2 * s, 2 * s, "#ff7ad9");
  g.px(dice, 11 * s, 2 * s, 2 * s, "#fff6e8");
  // The dashboard: the deck with its cassette in the middle, the gauges behind the wheel on the right.
  g.px(0, dash, w, h - dash, "#0d0618");
  g.px(0, dash, w, s, "#2a1650");
  const deckW = Math.max(14 * s, Math.min(div(w * 24, 100), 30 * s)), deckH = Math.max(6 * s, div((h - dash) * 64, 100));
  const deckX = vx - div(deckW, 2), deckY = dash + 2 * s;
  for (let y = deckY - 2 * s; y < h; y++) {
    for (let x = deckX - 4 * s; x < deckX + deckW + 4 * s; x++) if (((x + y) & 1) === 0 && mod(x * 7 + y * 5, 3) === 0) g.px(x, y, 1, 1, "#24164a");
  }
  const ventW = 6 * s, ventH = 4 * s;
  for (const ventX of [deckX - 3 * s - ventW, deckX + deckW + 3 * s]) {
    g.px(ventX, deckY, ventW, ventH, "#07010f");
    for (let y = deckY + s; y < deckY + ventH; y += 2 * s) g.px(ventX + s, y, ventW - 2 * s, Math.max(1, div(s, 2)), "#2a1650");
  }
  g.px(deckX - s, deckY - s, deckW + 2 * s, deckH + 2 * s, "#2a1650");
  g.px(deckX, deckY, deckW, deckH, "#07010f");
  const ledH = Math.max(1, s), winH = Math.max(2 * s, deckH - 3 * s - ledH);
  const cassH = winH, cassW = Math.min(deckW - 6 * s, div(cassH * 16, 10)), cassX = vx - div(cassW, 2), cassY = deckY + s;
  g.px(cassX, cassY, cassW, cassH, "#d7d0e8");
  g.px(cassX + s, cassY + s, cassW - 2 * s, Math.max(1, div(cassH, 2) - s), "#ff7ac6");
  g.px(cassX + s, cassY + s, cassW - 2 * s, Math.max(1, div(s, 2)), "#ffd319");
  const tapeY = cassY + div(cassH, 2), tapeH = Math.max(1, div(cassH, 4));
  g.px(cassX + div(cassW, 4), tapeY, div(cassW, 2), tapeH, "#2a1420");
  g.px(cassX + div(cassW, 4), tapeY, Math.max(1, s), tapeH, "#fff6e8");
  g.px(cassX + div(cassW * 3, 4) - Math.max(1, s), tapeY, Math.max(1, s), tapeH, "#fff6e8");
  for (const kx of [deckX + 2 * s, deckX + deckW - 2 * s]) g.disc(kx, cassY + div(cassH, 2), Math.max(1, div(s * 3, 4)), "#9a93b8");
  for (let x = deckX + 2 * s, i = 0; x < deckX + deckW - 2 * s; x += 2 * s, i++) {
    const bar = 1 + mod(93500 + i, ledH + 1);
    g.px(x, deckY + deckH - s - bar, s, bar, i % 3 === 0 ? "#ff2a9d" : "#2ee6ff");
  }
  const wheelX = div(w * 80, 100), wheelR = Math.max(8 * s, div(h * 40, 100)), wheelY = h + div(h * 8, 100);
  const gaugeR = Math.max(2 * s, div(h * 7, 100));
  g.px(wheelX - 3 * gaugeR, dash - 2 * s, 6 * gaugeR, 3 * s, "#0d0618");
  g.px(wheelX - 3 * gaugeR, dash - 2 * s, 6 * gaugeR, s, "#2a1650");
  for (const side of [-1, 1]) {
    const gxc = wheelX + side * (gaugeR + s), gyc = dash + gaugeR;
    g.disc(gxc, gyc, gaugeR, "#0a1a2a");
    g.ring(gxc, gyc, gaugeR, Math.max(1, div(s, 2)), "#2ee6ff");
    g.line(gxc, gyc, gxc - side * div(gaugeR * 2, 3), gyc - div(gaugeR * 2, 3), "#ff2a9d");
  }
  g.ring(wheelX, wheelY, wheelR, 2 * s, "#07010f");
  g.ring(wheelX, wheelY, wheelR - 2 * s, Math.max(1, div(s, 2)), "#1f1238");
  g.line(wheelX, wheelY, wheelX - wheelR, wheelY - div(wheelR, 3), "#07010f", 2 * s);
  g.line(wheelX, wheelY, wheelX + wheelR, wheelY - div(wheelR, 3), "#07010f", 2 * s);
  notes(g, vx - div(w * 14, 100), dash - 6 * s, 2, s, 93400);
}

/** The 1990s: a karaoke box, lyrics lighting up on the screen, the disco ball's sparkles, two microphones. */
function karaoke(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  const floor = h - Math.max(4, div(h * 14, 100));
  g.gradient(0, floor, ["#12052e", "#1a0838", "#230b45"]);
  for (let x = -h, k = 0; x < w; x += 10 * s, k++) g.line(x, floor, x + floor, 0, k % 2 === 0 ? "#2a0f52" : "#1f0a42");
  g.px(0, floor, w, h - floor, "#2a1145");
  g.px(0, floor, w, s, "#ff2a9d");
  // The screen: a video sky and the lyrics, the sung part lit cyan.
  const tx = div(w * 50, 100), ty = div(h * 24, 100), tw = div(w * 34, 100), th = div(h * 44, 100);
  g.px(tx - 2 * s, ty - 2 * s, tw + 4 * s, th + 4 * s, "#07010f");
  for (let y = 0; y < th; y++) g.px(tx, ty + y, tw, 1, LYRIC_SKY[Math.min(LYRIC_SKY.length - 1, div(y * LYRIC_SKY.length, Math.max(1, th)))]);
  g.disc(tx + div(tw * 72, 100), ty + div(th * 46, 100), Math.max(2, div(th, 6)), "#ffd319");
  for (let line = 0; line < 2; line++) {
    const ly = ty + th - (2 - line) * 4 * s;
    const lx = tx + 3 * s;
    const len = tw - 6 * s - line * 4 * s;
    const sung = line === 0 ? div(len * 60, 100) : 0;
    for (let x = lx; x < lx + len; x += 3 * s) g.px(x, ly, 2 * s, 2 * s, x < lx + sung ? "#2ee6ff" : "#fff6e8");
  }
  // The karaoke machine and its song number, the microphones in their stand.
  const mY = ty + th + 4 * s, mH = Math.max(4, floor - mY - 2 * s);
  g.px(tx + div(tw, 4), mY, div(tw, 2), mH, "#1a0f2a");
  g.px(tx + div(tw, 4) + s, mY + s, 7 * s, 2 * s, "#ff3d3d");
  for (let x = tx + div(tw, 4) + 10 * s; x < tx + div(tw * 3, 4) - s; x += 2 * s) g.px(x, mY + s, s, s, BUTTONS[mod(x, BUTTONS.length)]);
  for (let k = 0; k < 2; k++) {
    const mx = tx + tw + 4 * s + k * 4 * s;
    g.px(mx, floor - 12 * s, s, 12 * s, "#7d7896");
    g.disc(mx, floor - 13 * s, Math.max(1, s + div(s, 2)), k === 0 ? "#c9c3d9" : "#ff2a9d");
  }
  // The disco ball and its sparkles over everything.
  const bx = tx + div(tw, 2), by = div(h * 10, 100), br = Math.max(3, div(h * 8, 100));
  g.px(bx, 0, s, by - br, "#7d7896");
  for (let y = by - br; y <= by + br; y++) {
    const half = pixelIsqrt(br * br - (y - by) * (y - by));
    for (let x = bx - half; x <= bx + half; x++) g.px(x, y, 1, 1, ((div(x, s) + div(y, s)) & 1) === 0 ? "#d7d0e8" : "#7fe8ff");
  }
  for (let i = 0; i < div(w * h, 160 * s * s); i++) {
    const color = NOTE_COLORS[mod(91000 + i, NOTE_COLORS.length)];
    g.px(mod(91100 + i, w), mod(91200 + i, floor), s, s, color);
  }
  // A sofa on the left and the table of drinks.
  const sofaY = floor - div(h * 18, 100);
  g.px(0, sofaY, div(w * 34, 100), floor - sofaY, "#8a1f3a");
  g.px(0, sofaY, div(w * 34, 100), 2 * s, "#b8263b");
  const tableX = div(w * 38, 100);
  g.px(tableX, floor - 5 * s, 10 * s, s, "#c9c3d9");
  g.px(tableX + 4 * s, floor - 4 * s, 2 * s, 4 * s, "#7d7896");
  g.px(tableX + s, floor - 8 * s, 2 * s, 3 * s, "#ffd319");
  g.px(tableX + 6 * s, floor - 9 * s, 2 * s, 4 * s, "#2ee6ff");
}

/** The 2000s: the after-school band on the school roof at sunset, the town past the fence, the water tank up on the stairwell. */
function rooftopBand(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  const roof = h - Math.max(5, div(h * 20, 100));
  g.gradient(0, roof, DUSK);
  g.disc(div(w * 20, 100), div(h * 48, 100), Math.max(3, div(h * 16, 100)), "#ffe08a");
  for (let k = 0; k < 3; k++) {
    const cx = div(w * (12 + k * 30 + mod(94300 + k, 10)), 100), cy = div(h * (10 + mod(94400 + k, 18)), 100), cw = div(w * (10 + mod(94500 + k, 8)), 100);
    g.px(cx, cy, cw, s, "#ff9fb8");
    g.px(cx + 2 * s, cy - s, cw - 6 * s, s, "#ffc3d0");
  }
  // The town beyond the fence, its lights coming on.
  const townTop = roof - div(h * 24, 100);
  for (let x = 0, k = 0; x < w; k++) {
    const bw = (3 + mod(94000 + k, 6)) * s, top = townTop + mod(94100 + k, Math.max(1, div(h * 14, 100)));
    g.px(x, top, bw, roof - top, k % 2 === 0 ? "#3a1a5a" : "#33174f");
    for (let yy = top + s; yy < roof - s; yy += 2 * s) {
      for (let xx = x + s; xx < x + bw - s; xx += 2 * s) if (mod(xx * 5 + yy * 3 + 94200, 7) === 0) g.px(xx, yy, s, s, "#ffd36b");
    }
    x += bw;
  }
  // The fence: chain-link between posts, rails along the top and the bottom.
  const fenceTop = roof - div(h * 34, 100), link = 4 * s;
  for (let y = fenceTop; y < roof; y++) {
    for (let x = 0; x < w; x++) if ((x + y) % link === 0 || ((x - y) % link + link) % link === 0) g.px(x, y, 1, 1, "#9a7aa8");
  }
  for (let x = 2 * s; x < w; x += 22 * s) g.px(x, fenceTop - s, s, roof - fenceTop + s, "#c9b3d0");
  g.px(0, fenceTop - s, w, s, "#c9b3d0");
  g.px(0, roof - 2 * s, w, s, "#8a6a98");
  // The stairwell with the water tank on its stand.
  const sx = div(w * 84, 100), sTop = roof - div(h * 40, 100);
  g.px(sx, sTop, w - sx, roof - sTop, "#b8869a");
  g.px(sx, sTop, 2 * s, roof - sTop, "#d8a0a8");
  g.px(sx, sTop, w - sx, s, "#8a5a78");
  const doorW = Math.max(3 * s, div(w - sx, 3));
  g.px(sx + 3 * s, roof - div(h * 22, 100), doorW, div(h * 22, 100), "#5a3a5a");
  g.px(sx + 4 * s, roof - div(h * 20, 100), doorW - 2 * s, 3 * s, "#ffb36b");
  const tankW = Math.max(6 * s, div((w - sx) * 60, 100)), tankH = Math.max(5 * s, div(h * 14, 100)), tankX = sx + 3 * s;
  const tankY = sTop - 3 * s - tankH;
  for (const lx of [tankX + s, tankX + tankW - 2 * s]) g.px(lx, tankY + tankH, s, 3 * s, "#5a3a5a");
  g.px(tankX, tankY + s, tankW, tankH - s, "#e8c8c0");
  g.px(tankX + s, tankY, tankW - 2 * s, s, "#e8c8c0");
  g.px(tankX + tankW - 2 * s, tankY + s, 2 * s, tankH - s, "#b8909a");
  g.px(tankX, tankY + div(tankH, 2), tankW, s, "#b8909a");
  // The rooftop's concrete.
  g.px(0, roof, w, h - roof, "#5a4068");
  for (let x = 4; x < w; x += 12) g.px(x, roof + s, 1, h - roof - s, "#4a3058");
  g.px(0, roof, w, s, "#7a5a88");
  // The band in the low sun, long shadows behind them: a guitarist, the singer at the microphone, the drummer, an amp.
  const tall = Math.max(10, div(h * 36, 100));
  const person = (fx: number) => {
    g.px(fx + 2 * s, roof + s, div(tall * 2, 3), s, "#3a2848");
    g.disc(fx + s, roof - tall + 2 * s, Math.max(1, 2 * s), "#1f0d33");
    g.px(fx - s, roof - tall + 4 * s, 5 * s, tall - 7 * s, "#1f0d33");
    g.px(fx - s, roof - tall + 4 * s, s, tall - 7 * s, "#ff9e6b");
    g.px(fx - s, roof - 3 * s, 2 * s, 3 * s, "#1f0d33");
    g.px(fx + 2 * s, roof - 3 * s, 2 * s, 3 * s, "#1f0d33");
  };
  const guitarist = div(w * 42, 100), singer = div(w * 54, 100);
  person(guitarist);
  person(singer);
  g.disc(guitarist + 3 * s, roof - div(tall * 2, 5), Math.max(2, 2 * s), "#ff3d3d");
  g.line(guitarist + 3 * s, roof - div(tall * 2, 5), guitarist - 3 * s, roof - div(tall * 3, 4), "#c9a070", Math.max(1, div(s, 2)));
  g.px(singer - 3 * s, roof - div(tall * 3, 4), Math.max(1, div(s, 2)), div(tall * 3, 4), "#c9c3d9");
  g.px(singer - 4 * s, roof - div(tall * 3, 4) - s, 2 * s, 2 * s, "#fff6e8");
  const drumX = div(w * 68, 100), drum = Math.max(3, 4 * s);
  g.disc(drumX, roof - 2 * drum - 2 * s, Math.max(1, 2 * s), "#1f0d33");
  g.px(drumX - 2 * s, roof - 2 * drum, 5 * s, drum, "#1f0d33");
  g.disc(drumX, roof - drum, drum, "#1f0d33");
  g.disc(drumX, roof - drum, Math.max(1, drum - s), "#fff6e8");
  g.px(drumX - div(drum, 2), roof - drum, drum, s, "#ff3d3d");
  g.px(drumX + drum + s, roof - 2 * drum - 3 * s, 5 * s, s, "#ffd319");
  g.px(drumX + drum + 3 * s, roof - 2 * drum - 2 * s, s, 2 * drum + 2 * s, "#c9c3d9");
  const ampX = div(w * 77, 100), ampW = Math.max(5 * s, div(h * 12, 100)), ampH = Math.max(6 * s, div(h * 16, 100));
  g.px(ampX, roof - ampH, ampW, ampH, "#1f0d33");
  g.px(ampX + s, roof - ampH + 2 * s, ampW - 2 * s, ampH - 3 * s, "#3a2a4a");
  g.px(ampX + s, roof - ampH + s, ampW - 2 * s, Math.max(1, div(s, 2)), "#ffd36b");
}

/** From 2020: a virtual singer live as a hologram, the projector's light under her, floating screens and a sea of light sticks. */
function hologram(g: Grid) {
  const { w, h } = g;
  const s = Math.max(1, div(h, 40));
  const deckY = div(h * 74, 100);
  g.gradient(0, deckY, ["#02030f", "#050a24", "#0a1036", "#0e1648"]);
  for (let x = 4 * s; x < w; x += 8 * s) g.px(x, 0, 1, deckY, "#0c1a44");
  for (let y = 6 * s; y < deckY; y += 8 * s) g.px(0, y, w, 1, "#0c1a44");
  // Lasers fanning up from both ends of the stage.
  for (let k = 0; k < 4; k++) {
    g.line(div(w * 6, 100), deckY - 1, div(w * (18 + k * 14), 100), 0, k % 2 === 0 ? "#3a1a6a" : "#123a6a");
    g.line(div(w * 94, 100), deckY - 1, div(w * (82 - k * 14), 100), 0, k % 2 === 0 ? "#123a6a" : "#3a1a6a");
  }
  const cx = div(w * 68, 100), cell = Math.max(1, div(h * 56, 1600));
  const fw = IDOL[0].length * cell, fh = IDOL.length * cell;
  const fx = cx - div(fw, 2), fy = deckY - 2 * s - fh;
  g.ring(cx, fy + div(fh, 2), div(fh * 7, 10), Math.max(1, div(s, 2)), "#1a3a7a");
  g.ring(cx, fy + div(fh, 2), div(fh * 9, 10), 1, "#132a62");
  // The floating screens: a waveform, hearts, a song playing, a level meter.
  for (let k = 0; k < PANELS.length; k++) {
    const [ppx, ppy, ppw, pph, kind] = PANELS[k];
    const x0 = div(w * ppx, 100), y0 = div(h * ppy, 100), pw = Math.max(6 * s, div(w * ppw, 100)), ph = Math.max(5 * s, div(h * pph, 100));
    if (x0 + pw > fx - 2 * s && x0 < fx + fw + 2 * s) continue;
    g.px(x0, y0, pw, ph, "#0a2050");
    g.px(x0, y0, pw, 1, "#2ee6ff");
    g.px(x0, y0 + ph - 1, pw, 1, "#2ee6ff");
    g.px(x0, y0, 1, ph, "#2ee6ff");
    g.px(x0 + pw - 1, y0, 1, ph, "#2ee6ff");
    const mid = y0 + div(ph, 2);
    if (kind === 0) {
      const amp = Math.max(1, div(ph, 4)), period = Math.max(4, 8 * s), halfP = div(period, 2);
      for (let x = x0 + s; x < x0 + pw - s; x++) {
        const t = (x - x0) % period, v = t < halfP ? t : period - t;
        g.px(x, mid - amp + div(v * 2 * amp, halfP), 1, Math.max(1, div(s, 2)), "#7fe8ff");
      }
    } else if (kind === 1) {
      const hc = Math.max(1, div(Math.min(pw, ph), 9));
      g.sprite(HEART, x0 + div(pw - 7 * hc, 2), mid - 3 * hc, hc, { "#": "#ff7ad9" });
    } else if (kind === 2) {
      for (let l = 0; l < 2; l++) g.px(x0 + 2 * s, y0 + 2 * s + l * 2 * s, div((pw - 4 * s) * (80 - l * 30), 100), s, l === 0 ? "#d8fbff" : "#7fe8ff");
      const by = y0 + ph - 3 * s;
      g.px(x0 + 2 * s, by, pw - 4 * s, Math.max(1, div(s, 2)), "#1a4a8a");
      g.px(x0 + 2 * s, by, div((pw - 4 * s) * 60, 100), Math.max(1, div(s, 2)), "#ff7ad9");
      g.disc(x0 + 2 * s + div((pw - 4 * s) * 60, 100), by, Math.max(1, div(s, 2)), "#fff6e8");
    } else {
      for (let x = x0 + s, i = 0; x < x0 + pw - s; x += 2 * s, i++) {
        const bar = Math.max(1, div((ph - 2 * s) * (20 + mod(95400 + k * 31 + i, 81)), 100));
        g.px(x, y0 + ph - s - bar, s, bar, i % 4 === 3 ? "#ff7ad9" : "#2ee6ff");
      }
    }
  }
  // The projector's light, then the singer in scanlines (every third row dark), one row slipping sideways.
  for (let y = fy - 2 * s; y < deckY - s; y++) {
    const spread = div(fw, 2) + 2 * s + div(deckY - y, 5);
    for (let x = cx - spread; x <= cx + spread; x++) if (((x + y) & 1) === 0 && mod(x * 3 + y * 5, 4) === 0) g.px(x, y, 1, 1, "#1a4a8a");
  }
  for (let y = 0; y < fh; y++) {
    if (y % 3 === 2) continue;
    const r = div(y, cell), slip = r === 9 ? cell : 0;
    for (let c = 0; c < IDOL[r].length; c++) {
      const color = IDOL_COLORS[IDOL[r][c]];
      if (color) g.px(fx + c * cell + slip, fy + y, cell, 1, color);
    }
  }
  const padW = fw + 6 * s, padX = cx - div(padW, 2);
  const crowdTop = deckY + Math.max(2, div(h * 6, 100));
  g.px(0, deckY, w, h - deckY, "#0c1650");
  g.px(0, deckY, w, crowdTop - deckY, "#101c5c");
  g.px(0, deckY, w, s, "#2a5aa8");
  for (let x = 2 * s; x < w; x += 6 * s) g.px(x, deckY + s, s, s, "#2ee6ff");
  g.px(padX + 2 * s, deckY - 2 * s, padW - 4 * s, s, "#7fe8ff");
  g.px(padX, deckY - s, padW, s, "#2ee6ff");
  g.px(padX + 2 * s, deckY, padW - 4 * s, s, "#1a6a9a");
  // The crowd, light sticks up.
  for (let x = -s, i = 0; x < w; x += 4 * s, i++) {
    const hy = crowdTop + 2 * s + mod(95000 + i, 3) * s;
    g.disc(x + 2 * s, hy, Math.max(1, s + div(s, 2)), "#01020a");
    g.px(x, hy + s, 4 * s, h - hy - s, "#01020a");
    if (mod(95100 + i, 2) === 0) {
      g.px(x + 3 * s, hy - 4 * s, s, 4 * s, "#01020a");
      g.px(x + 3 * s, hy - 8 * s, s, 4 * s, GLOW_STICKS[mod(95300 + i, GLOW_STICKS.length)]);
    }
  }
}

/**
 * The scene for a year (the Time Machine's backdrop): the bullet train for the 1960s, Fuji for the
 * '70s, City Pop's sunset for the '80s, the arcade for the '90s, the neon city for the 2000s, the
 * ramen stand for the 2010s and starlight from 2020.
 */
export function pixelSceneForYear(year: number): PixelSceneId {
  if (year < 1970) return "shinkansen";
  if (year < 1980) return "fuji";
  if (year < 1990) return "sunset";
  if (year < 2000) return "arcade";
  if (year < 2010) return "neon-city";
  if (year < 2020) return "ramen-stand";
  return "starlight";
}

/**
 * The Songs page's scene for a chart (null for all time): the jukebox for all time, the valve radio
 * for the 1960s, the hi-fi for the '70s, the night drive for the '80s, karaoke for the '90s, the
 * rooftop band for the 2000s, the stage for the 2010s and the hologram singer from 2020.
 */
export function pixelSongScene(year: number | null): PixelSceneId {
  if (year === null) return "jukebox";
  if (year < 1970) return "radio";
  if (year < 1980) return "hifi";
  if (year < 1990) return "night-drive";
  if (year < 2000) return "karaoke";
  if (year < 2010) return "rooftop-band";
  if (year < 2020) return "stage";
  return "hologram";
}

/**
 * The sprite id for a row's title from the sheet's `sections` map: lower-case titles, or prefixes
 * ending in " *" ("new in *" matches "New in 2015").
 */
export function pixelSectionSprite(sections: Readonly<Record<string, string>>, title: string): string | null {
  const key = title.trim().toLowerCase();
  if (sections[key]) return sections[key];
  for (const [pattern, id] of Object.entries(sections)) {
    if (pattern.endsWith(" *") && key.startsWith(pattern.slice(0, -1))) return id;
  }
  return null;
}

/** A sprite (rows of palette letters, '.' clear) as runs of one colour along each row. */
export function pixelSpriteRects(rows: readonly string[], palette: Readonly<Record<string, string>>): CityPopPixel[] {
  const out: CityPopPixel[] = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length;) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      const color = palette[ch];
      if (ch !== "." && color) out.push({ x, y, w: end - x, h: 1, color });
      x = end;
    }
  }
  return out;
}

const SKYLINE_WINDOWS = ["#ffd36b", "#ff7ad9", "#2ee6ff"] as const;

/**
 * The animated background's skyline: building silhouettes with lit windows and rooftop beacons
 * on a clear sky, so the page shows through above them. [frame] 0 or 1 switches some windows and
 * the beacons; showing the two frames in turn makes the city twinkle.
 */
export function pixelSkyline(width: number, height: number, frame: number): CityPopPixel[] {
  const g = new Grid(Math.max(16, Math.floor(width)), Math.max(8, Math.floor(height)));
  const { w, h } = g;
  for (let x = 0, i = 0; x < w; i++) {
    const bw = 5 + mod(60000 + i, 8);
    if (mod(60100 + i, 7) === 0) { x += 2 + mod(60200 + i, 4); continue; }
    const tall = Math.max(3, div(h * (30 + mod(60300 + i, 66)), 100));
    const top = h - tall;
    g.px(x, top, bw, tall, i % 2 === 0 ? "#0e0720" : "#130a2a");
    if (mod(60400 + i, 3) === 0 && top > 4) {
      g.px(x + div(bw, 2), top - 3, 1, 3, "#0e0720");
      if ((i + frame) % 2 === 0) g.px(x + div(bw, 2), top - 4, 1, 1, "#ff3d6e");
    }
    for (let wy = top + 2; wy < h - 1; wy += 3) {
      for (let wx = x + 1; wx < x + bw - 1; wx += 2) {
        const lit = hash(wx * 131 + wy * 17 + 9);
        const on = lit % 9 === 0 || (lit % 9 === 1 && Math.floor(lit / 16) % 2 === frame);
        if (on) g.px(wx, wy, 1, 1, SKYLINE_WINDOWS[Math.floor(lit / 64) % SKYLINE_WINDOWS.length]);
      }
    }
    x += bw;
  }
  return g.out;
}
