import test from "node:test";
import assert from "node:assert/strict";
import { entryAfterEpisode } from "../packages/shared/watch-progress.ts";

test("rewatching a completed show leaves the list alone", () => {
  assert.equal(entryAfterEpisode({ status: "completed", episodesWatched: 26 }, 1, 26), null);
  // Even when the saved count is short of the total (MAL 25/26), it stays completed.
  assert.equal(entryAfterEpisode({ status: "completed", episodesWatched: 25 }, 3, 26), null);
  // And when the show's total is unknown.
  assert.equal(entryAfterEpisode({ status: "completed", episodesWatched: 12 }, 1, null), null);
});

test("watching progresses, never goes backwards, and completes at the last episode", () => {
  assert.deepEqual(entryAfterEpisode(null, 1, 12), { status: "watching", episodesWatched: 1 });
  assert.deepEqual(entryAfterEpisode({ status: "plan_to_watch", episodesWatched: 0 }, 1, 12), { status: "watching", episodesWatched: 1 });
  assert.deepEqual(entryAfterEpisode({ status: "watching", episodesWatched: 10 }, 3, 12), { status: "watching", episodesWatched: 10 });
  assert.deepEqual(entryAfterEpisode({ status: "watching", episodesWatched: 11 }, 12, 12), { status: "completed", episodesWatched: 12 });
  assert.deepEqual(entryAfterEpisode({ status: "on_hold", episodesWatched: 4 }, 5, 12), { status: "watching", episodesWatched: 5 });
  assert.deepEqual(entryAfterEpisode({ status: "watching", episodesWatched: 40 }, 41, null), { status: "watching", episodesWatched: 41 });
});

test("a dropped show stays dropped", () => {
  assert.deepEqual(entryAfterEpisode({ status: "dropped", episodesWatched: 3 }, 4, 12), { status: "dropped", episodesWatched: 4 });
});
