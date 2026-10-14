import test from "node:test";
import assert from "node:assert/strict";
import { planStory } from "../packages/shared/story-bridge.ts";

const book = (id, format, popularity) => ({
  id, title: `Book ${id}`, coverImage: null, format, status: "FINISHED",
  chapters: null, volumes: null, year: 2010, popularity, country: "JP",
});
const link = (relationType, id, format, popularity) => ({ relationType, book: book(id, format, popularity) });

test("manga-based shows lead with the main series, not one-shots", () => {
  const plan = planStory("MANGA", [
    link("ADAPTATION", 30793, "MANGA", 9000),
    link("ADAPTATION", 134184, "ONE_SHOT", 4000),
    link("ADAPTATION", 30013, "MANGA", 300000),
    link("ADAPTATION", 96427, "NOVEL", 2000),
  ]);
  assert.equal(plan.kind, "source-manga");
  assert.equal(plan.primary?.id, 30013);
  assert.equal(plan.readable?.id, 30013);
  assert.deepEqual(plan.more.map((l) => l.book.id), [30793, 134184, 96427]);
});

test("a SOURCE edge beats a more popular adaptation", () => {
  const plan = planStory("MANGA", [link("ADAPTATION", 2, "MANGA", 80000), link("SOURCE", 1, "MANGA", 20000)]);
  assert.equal(plan.primary?.id, 1);
  assert.deepEqual(plan.more.map((l) => l.book.id), [2]);
});

test("novel-based shows point at the novel and read its manga version", () => {
  const plan = planStory("LIGHT_NOVEL", [
    link("SOURCE", 85737, "NOVEL", 60000),
    link("ALTERNATIVE", 87259, "MANGA", 20000),
    link("ALTERNATIVE", 85736, "MANGA", 30000),
  ]);
  assert.equal(plan.kind, "source-novel");
  assert.equal(plan.primary?.id, 85737);
  assert.equal(plan.readable?.id, 85736);
  assert.deepEqual(plan.more.map((l) => l.book.id), [87259]);
});

test("original shows offer their manga retelling; spin-offs alone are not the story", () => {
  const retold = planStory("ORIGINAL", [link("ADAPTATION", 30173, "MANGA", 8000), link("ADAPTATION", 30174, "MANGA", 6000)]);
  assert.equal(retold.kind, "manga-version");
  assert.equal(retold.primary?.id, 30173);
  const spinOff = planStory("ORIGINAL", [link("SPIN_OFF", 1, "MANGA", 50000)]);
  assert.equal(spinOff.primary, null);
  assert.deepEqual(spinOff.more.map((l) => l.book.id), [1]);
  assert.equal(planStory("MANGA", []).primary, null);
});
