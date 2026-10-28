import test from "node:test";
import assert from "node:assert/strict";
import { cityPopSceneChecksum } from "../packages/shared/city-pop-scene.ts";
import { readFileSync } from "node:fs";
import { PIXEL_SCENES, pixelActorAt, pixelIsqrt, pixelScene, pixelSceneForYear, pixelSceneParts, pixelSectionSprite, pixelSkyline, pixelSongScene, pixelSpriteRects } from "../packages/shared/pixel-scenes.ts";

/** Pinned on both sides: PixelScenesTest.kt holds the same numbers. */
const CHECKSUMS = {
  "sunset": [3983455783, 689284172],
  "neon-city": [3751162301, 1694655822],
  "fuji": [2235187136, 4184302794],
  "sakura": [1760840131, 493047608],
  "shinkansen": [3602053026, 635608212],
  "starlight": [364579144, 3853267797],
  "library": [3923208247, 3367147208],
  "ramen-stand": [3623555654, 718294855],
  "arcade": [1030637147, 1110591396],
  "bedroom": [3719754049, 1829028358],
  "cinema": [4254042179, 3318332427],
  "tower": [3912397822, 2965689985],
  "observatory": [2797300941, 1714709199],
  "station": [1299516121, 2673488787],
  "terminal": [1127530421, 1254410123],
  "stage": [3567191245, 2104692273],
  "jukebox": [3464146703, 1248485428],
  "radio": [3212693734, 238659376],
  "hifi": [460228807, 2757760491],
  "night-drive": [1399552475, 1790107267],
  "karaoke": [638356739, 301354734],
  "rooftop-band": [2033624042, 1070236582],
  "hologram": [3336172354, 1952171754],
  "manga-street": [3106852768, 4089046443],
  "moon-bench": [2946658215, 889182777],
  "dusk-line": [1097479821, 1596604861],
  "green-shop": [3221283960, 3873517376],
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
  assert.equal(cityPopSceneChecksum(all), 3773798882);
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

/** An actor's pixels, then its motion as one more entry (PixelScenesTest.kt flattens the same way). */
const actorPixels = (actors) => actors.flatMap((a) => [...a.rects, { x: a.dx, y: a.dy, w: a.period, h: a.delay, color: `on${a.on}rest${a.rest}` }]);

test("Pixel scenes: the moving parts match Android's twin", () => {
  assert.equal(cityPopSceneChecksum(PIXEL_SCENES.flatMap((id) => actorPixels(pixelSceneParts(id, 420, 64).actors))), 4186961257);
  assert.equal(cityPopSceneChecksum(PIXEL_SCENES.flatMap((id) => actorPixels(pixelSceneParts(id, 120, 44).actors))), 635668932);
  for (const id of PIXEL_SCENES) {
    for (const a of pixelSceneParts(id, 120, 44).actors) {
      assert.ok(a.rects.length > 0 && a.period > 0 && a.on > 0 && a.on <= a.period, `${id}: ${JSON.stringify({ ...a, rects: a.rects.length })}`);
    }
  }
  // Every scene but City Pop's sunset moves.
  assert.deepEqual(PIXEL_SCENES.filter((id) => pixelSceneParts(id, 420, 64).actors.length === 0), ["sunset"]);
});

test("Pixel scenes: an actor's place and visibility over time", () => {
  const actor = { rects: [], dx: 30, dy: 9, period: 10, delay: 4, on: 6, rest: 0 };
  assert.deepEqual(pixelActorAt(actor, 0), { x: 12, y: 3, shown: true });
  assert.deepEqual(pixelActorAt(actor, 2), { x: 18, y: 5, shown: false });
  assert.deepEqual(pixelActorAt(actor, 6), { x: 0, y: 0, shown: true });
  assert.deepEqual(pixelActorAt(actor, -3), { x: 3, y: 0, shown: true });
});
