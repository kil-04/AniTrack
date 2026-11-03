import test from "node:test";
import assert from "node:assert/strict";
import { AniListPacer, ANILIST_MAX_COOLDOWN_MS, rateHeaders } from "../apps/desktop/main/services/anilist-pacing.ts";

const clock = (start = 1_000_000) => {
  const c = { t: start, now: () => c.t };
  return c;
};

test("AniList pacing lets a burst through, then holds the 31st start for the window", () => {
  const c = clock();
  const pacer = new AniListPacer(c.now);
  for (let i = 0; i < 30; i++) {
    assert.equal(pacer.waitMs(), 0);
    pacer.noteStart();
    c.t += 100;
  }
  // The first start was 3 s ago, so a slot frees 57 s from now.
  assert.equal(pacer.waitMs(), 57_000);
  c.t += 57_000;
  assert.equal(pacer.waitMs(), 0);
});

test("AniList pacing follows the server's own limit header", () => {
  const c = clock();
  const pacer = new AniListPacer(c.now);
  pacer.noteReply(200, { limit: "90", remaining: "89" });
  for (let i = 0; i < 60; i++) pacer.noteStart();
  assert.equal(pacer.waitMs(), 0);
});

test("a 429 pauses the queue for Retry-After, bounded to the window", () => {
  const c = clock();
  const pacer = new AniListPacer(c.now);
  pacer.noteReply(429, { retryAfter: "42" });
  assert.equal(pacer.waitMs(), 42_000);
  const long = new AniListPacer(c.now);
  long.noteReply(429, { retryAfter: "3600" });
  assert.equal(long.waitMs(), ANILIST_MAX_COOLDOWN_MS);
});

test("a 429 without Retry-After waits for X-RateLimit-Reset, else a full window", () => {
  const c = clock(1_700_000_000_000);
  const pacer = new AniListPacer(c.now);
  pacer.noteReply(429, { reset: String(1_700_000_000 + 20) });
  assert.equal(pacer.waitMs(), 20_000);
  const bare = new AniListPacer(c.now);
  bare.noteReply(429, {});
  assert.equal(bare.waitMs(), 60_000);
});

test("a spent budget pauses before the next request instead of waiting for a 429", () => {
  const c = clock();
  const pacer = new AniListPacer(c.now);
  pacer.noteStart();
  c.t += 10_000;
  pacer.noteReply(200, { remaining: "0" });
  // No reset header: the oldest start ages out of the window in 50 s.
  assert.equal(pacer.waitMs(), 50_000);
  const healthy = new AniListPacer(c.now);
  healthy.noteReply(200, { remaining: "12" });
  healthy.noteReply(200, { remaining: "" });
  assert.equal(healthy.waitMs(), 0);
});

test("rate headers are read case-insensitively off a fetch reply", () => {
  const headers = new Headers({ "Retry-After": "7", "X-RateLimit-Remaining": "0", "X-RateLimit-Limit": "30" });
  assert.deepEqual(rateHeaders(headers), { retryAfter: "7", remaining: "0", reset: null, limit: "30" });
  assert.deepEqual(rateHeaders(null), { retryAfter: null, remaining: null, reset: null, limit: null });
});
