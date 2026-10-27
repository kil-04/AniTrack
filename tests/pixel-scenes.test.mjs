import test from "node:test";
import assert from "node:assert/strict";
import { cityPopSceneChecksum } from "../packages/shared/city-pop-scene.ts";
import { readFileSync } from "node:fs";
import { PIXEL_SCENES, pixelIsqrt, pixelScene, pixelSceneForYear, pixelSectionSprite, pixelSkyline, pixelSongScene, pixelSpriteRects } from "../packages/shared/pixel-scenes.ts";

/** Pinned on both sides: PixelScenesTest.kt holds the same numbers. */
const CHECKSUMS = {
  "sunset": [3983455783, 689284172],
  "neon-city": [890333625, 2150705285],
  "fuji": [2693223344, 596089318],
  "sakura": [2132904203, 2822175471],
  "shinkansen": [3785893167, 249138501],
  "starlight": [364579144, 3853267797],
  "library": [3923208247, 3367147208],
  "ramen-stand": [2833917191, 368533171],
  "arcade": [1756015128, 688910680],
  "bedroom": [3719754049, 1829028358],
  "cinema": [4254042179, 3318332427],
  "tower": [828731159, 2124205917],
  "observatory": [2797300941, 1714709199],
  "station": [1299516121, 2673488787],
  "terminal": [3664655267, 2610576800],
  "stage": [3567191245, 2104692273],
  "jukebox": [3580116438, 4191282131],
  "radio": [2512797039, 1801240239],
  "hifi": [2637510729, 3016147115],
  "night-drive": [1694478858, 3756449637],
  "karaoke": [638356739, 301354734],
  "rooftop-band": [2881704570, 3775540109],
  "hologram": [3336172354, 1952171754],
};

test("Pixel scenes: the same pictures as Android's twin", () => {
  assert.deepEqual([...PIXEL_SCENES].sort(), Object.keys(CHECKSUMS).sort());
  for (const id of PIXEL_SCENES) {
    assert.equal(cityPopSceneChecksum(pixelScene(id, 420, 64)), CHECKSUMS[id][0], `${id} at 420 x 64`);
    assert.equal(cityPopSceneChecksum(pixelScene(id, 120, 44)), CHECKSUMS[id][1], `${id} at 120 x 44`);
  }
});

test("Pixel scenes: every scene stays inside its grid at any size", () => {
  for (const id of PIXEL_SCENES) {
    for (const [w, h] of [[16, 12], [60, 30], [120, 44], [420, 64], [640, 120], [90, 200]]) {
      const pixels = pixelScene(id, w, h);
      assert.ok(pixels.length > 40, `${id} ${w}x${h} draws a scene`);
      for (const p of pixels) {
        assert.ok(p.w > 0 && p.h > 0, "no empty rectangles");
        assert.match(p.color, /^#[0-9a-f]{6}$/);
        assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= w && p.y + p.h <= h, `${id} ${w}x${h}: ${JSON.stringify(p)} stays on the grid`);
      }
    }
  }
});

test("Pixel scenes: whole square roots", () => {
  assert.deepEqual([0, 1, 3, 4, 8, 9, 15, 16, 99999999].map(pixelIsqrt), [0, 1, 1, 2, 2, 3, 3, 4, 9999]);
  assert.equal(pixelIsqrt(-5), 0);
});

test("Pixel skyline: both twinkle frames match Android's twin and stay on the grid", () => {
  assert.equal(cityPopSceneChecksum(pixelSkyline(420, 30, 0)), 1058255262);
  assert.equal(cityPopSceneChecksum(pixelSkyline(420, 30, 1)), 4145227621);
  assert.equal(cityPopSceneChecksum(pixelSkyline(140, 28, 0)), 505561681);
  assert.equal(cityPopSceneChecksum(pixelSkyline(140, 28, 1)), 2454633099);
  for (const [w, h] of [[16, 8], [90, 20], [700, 40]]) {
    for (const frame of [0, 1]) {
      for (const p of pixelSkyline(w, h, frame)) {
        assert.ok(p.w > 0 && p.h > 0 && p.x >= 0 && p.y >= 0 && p.x + p.w <= w && p.y + p.h <= h, `${w}x${h}: ${JSON.stringify(p)}`);
      }
    }
  }
  assert.notEqual(cityPopSceneChecksum(pixelSkyline(420, 30, 0)), cityPopSceneChecksum(pixelSkyline(420, 30, 1)), "the frames differ");
});

test("Pixel sprites: the shared sheet is well formed and draws as Android's twin does", () => {
  const sheet = JSON.parse(readFileSync(new URL("../packages/catalogs/pixel-sprites.json", import.meta.url), "utf8"));
  for (const [ch, color] of Object.entries(sheet.palette)) {
    assert.equal(ch.length, 1);
    assert.match(color, /^#[0-9a-f]{6}$/);
  }
  for (const [id, rows] of Object.entries(sheet.sprites)) {
    assert.ok(rows.length >= 8 && rows.length <= 16, `${id} is 8 to 16 rows`);
    for (const row of rows) {
      assert.equal(row.length, 16, `${id}: ${row}`);
      for (const ch of row) assert.ok(ch === "." || ch in sheet.palette, `${id}: ${ch} is in the palette`);
    }
  }
  for (const [title, id] of Object.entries(sheet.sections)) {
    assert.equal(title, title.toLowerCase());
    assert.ok(id in sheet.sprites, `${title} -> ${id}`);
  }
  // PixelScenesTest.kt pins the same number over the same file.
  const all = Object.keys(sheet.sprites).sort().flatMap((id) => pixelSpriteRects(sheet.sprites[id], sheet.palette));
  assert.equal(cityPopSceneChecksum(all), 1831068148);
  assert.deepEqual(pixelSpriteRects([".ab", "bb."], { a: "#000001", b: "#000002" }), [
    { x: 1, y: 0, w: 1, h: 1, color: "#000001" },
    { x: 2, y: 0, w: 1, h: 1, color: "#000002" },
    { x: 0, y: 1, w: 2, h: 1, color: "#000002" },
  ]);
});

test("Pixel scenes: a scene per decade for the Time Machine and for Songs, and row titles by name or prefix (as Android's twin)", () => {
  assert.deepEqual(
    [1960, 1969, 1970, 1985, 1999, 2000, 2015, 2020, 2026].map(pixelSceneForYear),
    ["shinkansen", "shinkansen", "fuji", "sunset", "arcade", "neon-city", "ramen-stand", "starlight", "starlight"],
  );
  assert.deepEqual(
    [null, 1960, 1969, 1970, 1985, 1999, 2000, 2015, 2020, 2026].map(pixelSongScene),
    ["jukebox", "radio", "radio", "hifi", "night-drive", "karaoke", "rooftop-band", "stage", "hologram", "hologram"],
  );
  const sections = { "top 10": "trophy", "new in *": "star" };
  assert.equal(pixelSectionSprite(sections, " Top 10 "), "trophy");
  assert.equal(pixelSectionSprite(sections, "New in 2015"), "star");
  assert.equal(pixelSectionSprite(sections, "New"), null);
  assert.equal(pixelSectionSprite(sections, "Brand new in town"), null);
});
