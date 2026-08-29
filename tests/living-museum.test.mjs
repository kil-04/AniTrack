import test from "node:test";
import assert from "node:assert/strict";
import { buildMuseumExhibit, readableAnimeFormat } from "../packages/shared/living-museum.ts";

test("builds a factual museum label from catalog metadata", () => {
  const exhibit = buildMuseumExhibit({
    id: 820,
    title: "Legend of the Galactic Heroes",
    year: 1988,
    format: "OVA",
    episodes: 110,
    duration: 26,
    averageScore: 91,
    popularity: 127000,
    studios: ["Artland"],
    genres: ["Drama", "Sci-Fi", "Drama"],
  });
  assert.equal(exhibit.accession, "1988-OVA-820");
  assert.equal(exhibit.eyebrow, "1980s collection");
  assert.match(exhibit.curatorLine, /1988 original video animation from Artland/);
  assert.deepEqual(exhibit.tags, ["Drama", "Sci-Fi"]);
  assert.ok(exhibit.facts.some((fact) => fact.value === "110 × 26 min"));
});

test("handles incomplete archive records without inventing facts", () => {
  const exhibit = buildMuseumExhibit({ id: 7, title: "Unknown" });
  assert.equal(exhibit.accession, "UNDATED-ANIM-7");
  assert.equal(exhibit.facts.length, 1);
  assert.equal(readableAnimeFormat("TV_SHORT"), "short-form television series");
});
