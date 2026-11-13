import test from "node:test";
import assert from "node:assert/strict";
import { RequestPace } from "../apps/desktop/main/services/novel/pace.ts";

// The request budget Novel Phoenix's reader, chapter-list fill and downloads share.
// Timers can run late on a busy machine but never early, so these tests check what
// is let through at once, the order, and minimum waits: never how fast something was.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Lets every already-granted request settle, without letting any timer fire. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("request pace: a burst goes at once, then one request per refill", async () => {
  // A refill far longer than any stall of the machine: only the burst can have gone when we look.
  const burst = new RequestPace(3, 1500);
  let gone = 0;
  const fourth = Array.from({ length: 4 }, () => burst.take().then(() => { gone++; }));
  await settle();
  assert.equal(gone, 3, "the first three go at once");
  const waited = Date.now();
  await Promise.all(fourth);
  assert.ok(Date.now() - waited >= 1000, "the fourth waits for a refill");

  // After the burst, each request waits at least one more refill.
  const pace = new RequestPace(1, 40);
  const started = Date.now();
  const at = [];
  await Promise.all(Array.from({ length: 4 }, () => pace.take().then(() => at.push(Date.now() - started))));
  assert.ok(at[1] >= 35 && at[2] >= 75 && at[3] >= 115, `the rest are spaced (${at})`);
});

test("request pace: what's on screen goes before background work, oldest first among equals", async () => {
  const pace = new RequestPace(1, 25);
  await pace.take();
  const order = [];
  const all = [
    pace.take(2).then(() => order.push("download")),
    pace.take(1).then(() => order.push("fill-1")),
    pace.take(1).then(() => order.push("fill-2")),
    pace.take(0).then(() => order.push("reader")),
  ];
  await Promise.all(all);
  assert.deepEqual(order, ["reader", "fill-1", "fill-2", "download"]);
});

test("request pace: an idle budget fills back up, but never past its burst", async () => {
  const pace = new RequestPace(2, 20);
  await Promise.all([pace.take(), pace.take()]);
  await sleep(150);
  const started = Date.now();
  const at = [];
  const all = Array.from({ length: 3 }, () => pace.take().then(() => at.push(Date.now() - started)));
  await settle();
  assert.equal(at.length, 2, "two are ready after a rest, however long it was");
  await Promise.all(all);
  assert.ok(at[2] >= 15, `the third still waits for a refill (${at})`);
});
