import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTasteGenome } from "../packages/shared/taste-genome.ts";

const entries = [
  { status: "completed", score: 10, year: 1988, genres: ["Sci-Fi", "Drama"], format: "OVA" },
  { status: "completed", score: 9, year: 1985, genres: ["Sci-Fi", "Mecha"], format: "TV" },
  { status: "watching", score: 8, year: 1997, genres: ["Drama"], format: "TV" },
  { status: "completed", score: 6, year: 2022, genres: ["Comedy"], format: "ONA" },
  { status: "plan_to_watch", score: 10, year: 2024, genres: ["Fantasy"], format: "TV" },
];

test("builds a genome only from experienced titles", () => {
  const genome = analyzeTasteGenome(entries);
  assert.equal(genome.analyzed, 4);
  assert.equal(genome.rated, 4);
  assert.equal(genome.eras[0].label, "1980s");
  assert.equal(genome.genres[0].label, "Sci-Fi");
  assert.match(genome.archetype, /1980s Sci-Fi Archivist/);
  assert.equal(genome.classicShare, 75);
});

test("returns an honest empty profile", () => {
  const genome = analyzeTasteGenome([{ status: "plan_to_watch", year: 1980, genres: ["Mecha"] }]);
  assert.equal(genome.analyzed, 0);
  assert.equal(genome.confidence, 0);
  assert.equal(genome.archetype, "Uncharted Viewer");
});
