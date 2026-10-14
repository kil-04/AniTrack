import test from "node:test";
import assert from "node:assert/strict";
import { mergeListEntries, titleKey } from "../packages/shared/list-merge.ts";

const entry = (over) => ({ status: "watching", episodesWatched: 1, score: null, updatedAt: 1000, dirty: false, ...over });

test("completed wins, whichever copy is newer", () => {
  // Kimagure Orange Road: MAL's completed copy vs an older watching copy.
  const real = entry({ status: "watching", episodesWatched: 12, updatedAt: 5000 });
  const fromMal = entry({ status: "completed", episodesWatched: 48, updatedAt: 1000 });
  const merged = mergeListEntries(real, fromMal);
  assert.equal(merged.status, "completed");
  assert.equal(merged.episodesWatched, 48);
  // A local, unsent "watching" copy does not undo completed either.
  assert.equal(mergeListEntries(entry({ status: "completed", episodesWatched: 12 }), entry({ status: "watching", episodesWatched: 12, dirty: true, updatedAt: 9000 })).status, "completed");
});

test("episode counts never go backwards", () => {
  // ONE PIECE: a streaming-site copy at 1163 and MAL's copy at 1150.
  const merged = mergeListEntries(entry({ episodesWatched: 1150, updatedAt: 2000 }), entry({ episodesWatched: 1163, dirty: true, updatedAt: 1000 }));
  assert.equal(merged.episodesWatched, 1163);
  assert.equal(merged.dirty, true);
});

test("an unsent change wins over a sent one, then the newer change", () => {
  assert.equal(mergeListEntries(entry({ status: "on_hold", updatedAt: 9000 }), entry({ status: "dropped", dirty: true, updatedAt: 1000 })).status, "dropped");
  assert.equal(mergeListEntries(entry({ status: "plan_to_watch", updatedAt: 1000 }), entry({ status: "watching", updatedAt: 2000 })).status, "watching");
  assert.equal(mergeListEntries(entry({ status: "watching", updatedAt: 3000 }), entry({ status: "plan_to_watch", updatedAt: 2000 })).status, "watching");
});

test("sent to MAL again only when the result differs from what MAL had", () => {
  const same = mergeListEntries(entry({ status: "completed", episodesWatched: 12 }), entry({ status: "completed", episodesWatched: 12, updatedAt: 500 }));
  assert.equal(same.dirty, false);
  const differs = mergeListEntries(entry({ status: "watching", episodesWatched: 9, updatedAt: 3000 }), entry({ status: "watching", episodesWatched: 7, updatedAt: 1000 }));
  assert.equal(differs.dirty, true);
});

test("score keeps the newer one, falling back to the other", () => {
  assert.equal(mergeListEntries(entry({ score: 8, updatedAt: 1 }), entry({ score: null, updatedAt: 2 })).score, 8);
  assert.equal(mergeListEntries(entry({ score: 8, updatedAt: 1 }), entry({ score: 9, updatedAt: 2 })).score, 9);
  assert.equal(mergeListEntries(entry({ updatedAt: 1 }), entry({ updatedAt: 7 })).updatedAt, 7);
});

test("title keys ignore case and outer spaces only", () => {
  assert.equal(titleKey("  ONE PIECE "), "one piece");
  assert.notEqual(titleKey("Re:Monster"), titleKey("Re: Monster"));
  assert.equal(titleKey(null), "");
});
