import test from "node:test";
import assert from "node:assert/strict";
import {
  isSleepMode,
  SLEEP_CHOICES,
  SLEEP_END_OF_EPISODE,
  SLEEP_OFF,
  sleepDeadline,
  sleepDue,
  sleepLabel,
  sleepMinutesLeft,
  sleepStopsAtEpisodeEnd,
} from "../packages/shared/sleep-timer.ts";

const NOW = Date.parse("2026-11-03T22:00:00Z");

test("the choices match Android's sleep timer", () => {
  assert.deepEqual(SLEEP_CHOICES.map((c) => c.mode), [0, -1, 15, 30, 45, 60]);
  assert.deepEqual(SLEEP_CHOICES.map((c) => c.label), ["Off", "End of episode", "15 minutes", "30 minutes", "45 minutes", "1 hour"]);
  assert.equal(isSleepMode(30), true);
  assert.equal(isSleepMode(20), false);
  assert.equal(isSleepMode("30"), false);
});

test("a timed mode pauses at its deadline; off and end of episode have none", () => {
  const deadline = sleepDeadline(30, NOW);
  assert.equal(deadline, NOW + 30 * 60_000);
  assert.equal(sleepDeadline(SLEEP_OFF, NOW), null);
  assert.equal(sleepDeadline(SLEEP_END_OF_EPISODE, NOW), null);
  assert.equal(sleepDue(30, deadline, deadline - 1), false);
  assert.equal(sleepDue(30, deadline, deadline), true);
  assert.equal(sleepDue(SLEEP_END_OF_EPISODE, null, NOW), false);
  assert.equal(sleepDue(SLEEP_OFF, deadline, deadline + 1), false, "a stale deadline never pauses once the timer is off");
});

test("minutes left round up and never read zero", () => {
  const deadline = NOW + 15 * 60_000;
  assert.equal(sleepMinutesLeft(deadline, NOW), 15);
  assert.equal(sleepMinutesLeft(deadline, NOW + 30_000), 15);
  assert.equal(sleepMinutesLeft(deadline, deadline - 1_000), 1);
  assert.equal(sleepMinutesLeft(deadline, deadline + 5_000), 1);
  assert.equal(sleepMinutesLeft(null, NOW), null);
});

test("labels", () => {
  assert.equal(sleepLabel(SLEEP_OFF, null, NOW), "Off");
  assert.equal(sleepLabel(SLEEP_END_OF_EPISODE, null, NOW), "End of episode");
  assert.equal(sleepLabel(45, NOW + 12 * 60_000 - 10_000, NOW), "12 min left");
  assert.equal(sleepStopsAtEpisodeEnd(SLEEP_END_OF_EPISODE), true);
  assert.equal(sleepStopsAtEpisodeEnd(30), false);
});
