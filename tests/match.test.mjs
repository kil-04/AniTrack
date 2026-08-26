import test from "node:test";
import assert from "node:assert/strict";
import {
  getSeasonNumber,
  pickVerifiedCandidate,
  scoreMatch,
} from "../src/lib/match.ts";

test("extracts common season-number formats", () => {
  assert.equal(getSeasonNumber("Attack on Titan Season 4"), 4);
  assert.equal(getSeasonNumber("Classroom of the Elite IV"), 4);
  assert.equal(getSeasonNumber("Example 2nd Season"), 2);
  assert.equal(getSeasonNumber("Example Cour 3"), 3);
  assert.equal(getSeasonNumber("A title without a sequel"), null);
});

test("prefers an exact title and matching year", () => {
  const exact = scoreMatch(
    { title: "Frieren: Beyond Journey's End", year: 2023, episodes: 28 },
    "Frieren: Beyond Journey's End",
    2023,
    28,
  );
  const unrelatedYear = scoreMatch(
    { title: "Frieren: Beyond Journey's End", year: 2018, episodes: 28 },
    "Frieren: Beyond Journey's End",
    2023,
    28,
  );
  assert.ok(exact > 100);
  assert.equal(unrelatedYear, -100);
});

test("heavily penalizes the wrong season", () => {
  const correct = scoreMatch(
    { title: "Classroom of the Elite Season 3", year: 2024, episodes: 13 },
    "Classroom of the Elite Season 3",
    2024,
    13,
  );
  const wrong = scoreMatch(
    { title: "Classroom of the Elite Season 2", year: 2022, episodes: 13 },
    "Classroom of the Elite Season 3",
    2024,
    13,
  );
  assert.ok(correct - wrong >= 50);
});

test("does not penalize an airing provider for having fewer episodes", () => {
  const caughtUp = scoreMatch(
    { title: "Currently Airing", year: 2026, episodes: 12 },
    "Currently Airing",
    2026,
    12,
    "RELEASING",
  );
  const providerBehind = scoreMatch(
    { title: "Currently Airing", year: 2026, episodes: 8 },
    "Currently Airing",
    2026,
    12,
    "RELEASING",
  );
  assert.equal(providerBehind, caughtUp);
});

test("uses a positively verified ID when the title winner is known-wrong", async () => {
  const candidates = [
    { id: "wrong", title: "City Hunter" },
    { id: "right", title: "City Hunter '91" },
  ];
  const checked = [];
  globalThis.window = {
    api: {
      pahe: {
        getIds: async (id) => {
          checked.push(id);
          return id === "right" ? { anilistId: 1477 } : { anilistId: 1478 };
        },
      },
    },
  };

  const selected = await pickVerifiedCandidate(candidates, 1477, undefined);
  assert.equal(selected, candidates[1]);
  assert.deepEqual(checked, ["wrong", "right"]);
});

test("verifies matches through the provider-neutral bridge", async () => {
  const candidates = [
    {
      id: "show-session",
      externalLookupId: 321,
      providerId: "third-provider",
      title: "Example Show",
    },
  ];
  const calls = [];
  globalThis.window = {
    api: {
      providers: {
        getExternalIds: async (...args) => {
          calls.push(args);
          return { anilistId: 42 };
        },
      },
      pahe: {
        getIds: async () => {
          throw new Error("legacy bridge should not be used");
        },
      },
    },
  };

  const selected = await pickVerifiedCandidate(candidates, 42, undefined);
  assert.equal(selected, candidates[0]);
  assert.deepEqual(calls, [["third-provider", "show-session", 321]]);
});

test("does not misroute an unknown connector through the legacy Anikoto fallback", async () => {
  let legacyCalls = 0;
  const candidate = { id: "third-party-id", providerId: "mockstream", title: "Expected title" };
  globalThis.window = {
    api: {
      pahe: {
        getIds: async () => {
          legacyCalls++;
          return { anilistId: 999 };
        },
      },
    },
  };

  const selected = await pickVerifiedCandidate([candidate], 42, undefined);
  assert.equal(selected, candidate);
  assert.equal(legacyCalls, 0);
});

test("trusts the top title match when its IDs are unavailable", async () => {
  const candidates = [
    { id: "unknown", title: "Expected title" },
    { id: "other", title: "Another title" },
  ];
  let calls = 0;
  globalThis.window = {
    api: {
      pahe: {
        getIds: async () => {
          calls++;
          return {};
        },
      },
    },
  };

  const selected = await pickVerifiedCandidate(candidates, 123, 456);
  assert.equal(selected, candidates[0]);
  assert.equal(calls, 1);
});
