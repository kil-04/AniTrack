import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderSearchQueries,
  normalizeProviderTitle,
  pickProviderResult,
} from "../apps/desktop/renderer/components/provider/providerSearch.ts";

test("builds unique provider queries from primary and alternate titles", () => {
  assert.deepEqual(
    buildProviderSearchQueries(
      "Shingeki no Kyojin The Final Season",
      "Attack on Titan Final Season",
      "Shingeki no Kyojin",
    ),
    [
      "Shingeki no Kyojin The Final Season",
      "Attack on Titan Final Season",
      "Shingeki no Kyojin",
      "Shingeki Kyojin",
      "Attack on",
      "Shingeki",
    ],
  );
});

test("deduplicates equivalent provider queries case-insensitively", () => {
  assert.deepEqual(buildProviderSearchQueries("Frieren", "frieren", " FRIEREN "), ["Frieren"]);
});

test("selects the strongest provider title match", () => {
  const expected = { title: "Classroom of the Elite Season 3", year: 2024, episodes: 13 };
  const actual = pickProviderResult(
    [
      { title: "Classroom of the Elite Season 2", year: 2022, episodes: 13 },
      expected,
    ],
    "Classroom of the Elite Season 3",
    { year: 2024, episodes: 13 },
  );
  assert.equal(actual, expected);
});

test("does not guess when every provider result scores poorly", () => {
  const actual = pickProviderResult(
    [
      { title: "Unrelated Show", year: 2012, episodes: 24 },
      { title: "Another Result", year: 2013, episodes: 12 },
    ],
    "Frieren: Beyond Journey's End",
    { year: 2023, episodes: 28 },
  );
  assert.equal(actual, null);
});

test("normalizes punctuation and whitespace for manual matching", () => {
  assert.equal(normalizeProviderTitle("  Frieren: Beyond Journey's End!  "), "frieren beyond journey s end");
});
