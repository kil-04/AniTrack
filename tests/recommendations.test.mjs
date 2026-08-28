import test from "node:test";
import assert from "node:assert/strict";
import {
  classicEraBoost,
  classicEraLabel,
  selectRecommendationSeedIds,
} from "../packages/shared/recommendations.ts";

test("boosts the requested classic decades with strongest 1980s weight", () => {
  assert.equal(classicEraBoost(1975), 2.5);
  assert.equal(classicEraBoost(1986), 3);
  assert.equal(classicEraBoost(1999), 2.5);
  assert.equal(classicEraBoost(1969), 0);
  assert.equal(classicEraBoost(2000), 0);
  assert.equal(classicEraLabel(1987), "Classic 1980s match");
});

test("reserves strong 1970s, 1980s, and 1990s seeds before filling", () => {
  const seeds = selectRecommendationSeedIds([
    { id: 1, status: "completed", score: 10, year: 2022 },
    { id: 2, status: "completed", score: 8, year: 1978 },
    { id: 3, status: "completed", score: 9, year: 1988 },
    { id: 4, status: "watching", score: 8, year: 1995 },
    { id: 5, status: "completed", score: 9, year: 2018 },
    { id: 6, status: "dropped", score: 10, year: 1984 },
  ], 5);
  assert.deepEqual(seeds.slice(0, 3), [2, 3, 4]);
  assert.deepEqual(new Set(seeds), new Set([1, 2, 3, 4, 5]));
});

test("does not force a weak classic seed", () => {
  const seeds = selectRecommendationSeedIds([
    { id: 1, status: "completed", score: 10, year: 2020 },
    { id: 2, status: "completed", score: 5, year: 1979 },
  ], 1);
  assert.deepEqual(seeds, [1]);
});
