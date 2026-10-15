import test from "node:test";
import assert from "node:assert/strict";
import { entryAfterEpisode, entryForMal } from "../packages/shared/watch-progress.ts";

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

test("what goes to MAL never moves it backwards when this copy is behind", () => {
  // Finished on the tablet; this copy still says watching 11 (or rewatched an episode).
  assert.deepEqual(entryForMal({ status: "watching", episodesWatched: 11 }, { status: "completed", episodesWatched: 12 }), { status: "completed", episodesWatched: 12 });
  // MAL is at 8 from the tablet; this copy says 5.
  assert.deepEqual(entryForMal({ status: "watching", episodesWatched: 5 }, { status: "watching", episodesWatched: 8 }), { status: "watching", episodesWatched: 8 });
  assert.deepEqual(entryForMal({ status: "watching", episodesWatched: 9 }, { status: "watching", episodesWatched: 8 }), { status: "watching", episodesWatched: 9 });
  // Not on MAL's list yet: sent as it is.
  assert.deepEqual(entryForMal({ status: "watching", episodesWatched: 3 }, null), { status: "watching", episodesWatched: 3 });
});

test("other statuses picked by hand still go to MAL, without lowering the count", () => {
  for (const status of ["on_hold", "dropped", "plan_to_watch", "completed"]) {
    assert.deepEqual(entryForMal({ status, episodesWatched: 2 }, { status: "watching", episodesWatched: 6 }), { status, episodesWatched: 6 });
  }
  assert.deepEqual(entryForMal({ status: "on_hold", episodesWatched: 0 }, { status: "completed", episodesWatched: 12 }), { status: "on_hold", episodesWatched: 12 });
});
