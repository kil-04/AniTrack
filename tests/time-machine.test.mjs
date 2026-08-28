import test from "node:test";
import assert from "node:assert/strict";
import { animeEraForYear, clampTimeMachineYear, yearTransmission } from "../packages/shared/time-machine.ts";

test("maps landmark years to their anime era", () => {
  assert.equal(animeEraForYear(1979).label, "1970s");
  assert.equal(animeEraForYear(1988).headline, "The age of impossible ambition");
  assert.equal(animeEraForYear(1995).label, "1990s");
});

test("clamps time-machine years to the supported archive", () => {
  assert.equal(clampTimeMachineYear(1945, 2026), 1960);
  assert.equal(clampTimeMachineYear(2032, 2026), 2026);
  assert.equal(clampTimeMachineYear(1986, 2026), 1986);
});

test("describes a year's position within its decade", () => {
  assert.equal(yearTransmission(1981), "Early 1980s transmission");
  assert.equal(yearTransmission(1985), "Mid-1980s transmission");
  assert.equal(yearTransmission(1989), "Late 1980s transmission");
});
