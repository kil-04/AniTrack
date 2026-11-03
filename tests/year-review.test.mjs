import test from "node:test";
import assert from "node:assert/strict";
import { buildYearRecap, recapYears, formatWatchTime } from "../packages/shared/year-review.ts";

// Deterministic "local" time: UTC.
const utc = (ts) => {
  const d = new Date(ts);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), hour: d.getUTCHours(),
    dayKey: Math.floor(ts / 86_400_000),
  };
};
const at = (iso) => Date.parse(iso);
const ep = (animeId, episode, iso, extra = {}) => ({
  animeId, episode, positionSec: 1400, durationSec: 1440, updatedAt: at(iso),
  title: animeId === 1 ? "Frieren" : animeId === 2 ? "Dandadan" : `Show ${animeId}`,
  cover: null, genres: animeId === 1 ? ["Adventure", "Fantasy"] : ["Action", "Comedy"], ...extra,
});

test("counts only episodes watched through in the chosen year", () => {
  const watches = [
    ep(1, 1, "2025-01-03T20:00:00Z"),
    ep(1, 2, "2025-01-04T20:00:00Z"),
    ep(1, 3, "2025-01-05T20:00:00Z"),
    ep(2, 1, "2025-03-10T23:30:00Z", { positionSec: 300 }), // started, not finished
    ep(2, 2, "2024-12-31T20:00:00Z"), // last year
  ];
  const recap = buildYearRecap(2025, watches, [], utc);
  assert.equal(recap.episodes, 3);
  assert.equal(recap.shows, 1, "five minutes of a show is not watching it");
  assert.equal(recap.topShows[0].title, "Frieren");
  assert.equal(recap.topShows[0].count, 3);
  assert.equal(recap.minutes, Math.round((1400 * 3 + 300) / 60));
  assert.equal(recap.longestStreak, 3);
  assert.equal(recap.activeDays, 4);
  assert.equal(recap.busiestMonth, 0);
  assert.equal(recap.timeOfDay, "evening");
  assert.deepEqual(recap.topGenres.map((g) => g.label), ["Adventure", "Fantasy"]);
  assert.equal(recap.firstShow.title, "Frieren");
  assert.equal(recap.biggestDay.day, 3);
});

test("bulk 'mark read' and 'mark watched' rows are not counted as reading or watching", () => {
  const base = at("2025-06-01T12:00:00Z");
  const marked = Array.from({ length: 40 }, (_, i) => ({ kind: "manga", key: "77", chapter: String(i + 1), progress: 1, updatedAt: base + i, title: "Berserk" }));
  const read = [
    { kind: "manga", key: "77", chapter: "41", progress: 1, updatedAt: at("2025-06-02T22:00:00Z"), title: "Berserk" },
    { kind: "manga", key: "77", chapter: "42", progress: 0.2, updatedAt: at("2025-06-02T22:20:00Z"), title: "Berserk" },
    { kind: "novel", key: "ln:1", chapter: "a", progress: 0.9, updatedAt: at("2025-06-03T23:00:00Z"), title: "Mushoku Tensei" },
  ];
  const bulkEpisodes = Array.from({ length: 12 }, (_, i) => ep(5, i + 1, "2025-06-01T10:00:00Z", { updatedAt: base + i }));
  const recap = buildYearRecap(2025, bulkEpisodes, [...marked, ...read], utc);
  assert.equal(recap.mangaChapters, 1);
  assert.equal(recap.novelChapters, 1);
  assert.equal(recap.titlesRead, 2);
  assert.equal(recap.topManga.title, "Berserk");
  assert.equal(recap.episodes, 0);
  assert.equal(recap.minutes, 0);
  assert.equal(recap.monthChapters[5], 2);
});

test("an empty year is honest", () => {
  const recap = buildYearRecap(2023, [ep(1, 1, "2025-01-01T10:00:00Z")], [], utc);
  assert.equal(recap.hasActivity, false);
  assert.equal(recap.episodes, 0);
  assert.equal(recap.busiestMonth, null);
  assert.equal(recap.timeOfDay, null);
  assert.equal(recap.persona.title, "A Quiet Year");
});

test("personas follow the year's shape", () => {
  const devotee = Array.from({ length: 20 }, (_, i) => ep(1, i + 1, `2025-02-${String(i + 1).padStart(2, "0")}T13:00:00Z`));
  assert.equal(buildYearRecap(2025, devotee, [], utc).persona.title, "The Devotee");

  const owl = Array.from({ length: 10 }, (_, i) => ep(10 + i, 1, `2025-04-${String(i * 2 + 1).padStart(2, "0")}T23:30:00Z`));
  const owlRecap = buildYearRecap(2025, owl, [], utc);
  assert.equal(owlRecap.timeOfDay, "night");
  assert.equal(owlRecap.persona.title, "The Night Owl");

  const reader = Array.from({ length: 30 }, (_, i) => ({ kind: "manga", key: "9", chapter: String(i), progress: 1, updatedAt: at("2025-05-01T09:00:00Z") + i * 600_000 }));
  assert.equal(buildYearRecap(2025, [ep(1, 1, "2025-05-02T09:00:00Z")], reader, utc).persona.title, "The Page Turner");
});

test("years with activity, newest first", () => {
  const years = recapYears([ep(1, 1, "2024-05-01T00:00:00Z"), ep(1, 2, "2025-05-01T00:00:00Z")],
    [{ kind: "novel", key: "x", chapter: "1", progress: 1, updatedAt: at("2022-01-01T12:00:00Z") }], utc);
  assert.deepEqual(years, [2025, 2024, 2022]);
});

test("watch time reads as minutes, then hours", () => {
  assert.deepEqual(formatWatchTime(45), { value: "45", unit: "minutes" });
  assert.deepEqual(formatWatchTime(90_000), { value: "1,500", unit: "hours" });
});
