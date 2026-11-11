import test from "node:test";
import assert from "node:assert/strict";
import { RequestPace } from "../apps/desktop/main/services/novel/pace.ts";

// The request budget Novel Phoenix's reader, chapter-list fill and downloads share.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("request pace: a burst goes at once, then one request per refill", async () => {
  const pace = new RequestPace(3, 40);
  const started = Date.now();
  const at = [];
  await Promise.all(Array.from({ length: 6 }, () => pace.take().then(() => at.push(Date.now() - started))));
  assert.equal(at.length, 6);
  assert.ok(at[2] < 30, `the first three go at once (${at})`);
  // Timers can run late but never early: each later request waits at least one more refill.
  assert.ok(at[3] >= 35 && at[4] >= 75 && at[5] >= 115, `the rest are spaced (${at})`);
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
  await Promise.all(Array.from({ length: 3 }, () => pace.take().then(() => at.push(Date.now() - started))));
  assert.ok(at[1] < 15, `two are ready after a rest (${at})`);
  assert.ok(at[2] >= 15, `the third still waits (${at})`);
});
