import test from "node:test";
import assert from "node:assert/strict";
import { CITY_POP_ICONS, CITY_POP_SKY, CITY_POP_SUN, cityPopHash, cityPopScene, cityPopSceneChecksum } from "../packages/shared/city-pop-scene.ts";

test("City Pop scene: the same picture as Android's twin (CityPopSceneTest pins the same numbers)", () => {
  assert.equal(cityPopHash(0), 2462723854);
  assert.equal(cityPopHash(12345), 4067997445);
  assert.equal(cityPopSceneChecksum(cityPopScene(160, 60, { horizon: 680, sunX: 720, sun: 170 })), 1860387395);
  assert.equal(cityPopSceneChecksum(cityPopScene(116, 173, { horizon: 870, sunX: 640, sun: 330 })), 1129678847);
});

test("City Pop scene: stays inside its grid at any size, sky above and a grid below the horizon", () => {
  for (const [w, h] of [[16, 12], [40, 20], [387, 37], [387, 102], [116, 173], [700, 60]]) {
    const pixels = cityPopScene(w, h, { horizon: 700, sunX: 720, sun: 170 });
    assert.ok(pixels.length > 50, `${w}x${h} draws a scene`);
    for (const p of pixels) {
      assert.ok(p.w > 0 && p.h > 0, "no empty rectangles");
      assert.match(p.color, /^#[0-9a-f]{6}$/);
      assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= w && p.y + p.h <= h, `${w}x${h}: ${JSON.stringify(p)} stays on the grid`);
    }
    // The first rectangle is the night at the top; the sun's colours all come from its palette.
    assert.equal(pixels[0].color, CITY_POP_SKY[0]);
    assert.ok(pixels.some((p) => CITY_POP_SUN.includes(p.color)), "the sun shows");
  }
});

test("City Pop scene: the station icons are 9 x 9 sprites", () => {
  for (const sprite of Object.values(CITY_POP_ICONS)) {
    assert.equal(sprite.length, 9);
    for (const row of sprite) assert.match(row, /^[.#]{9}$/);
  }
});
