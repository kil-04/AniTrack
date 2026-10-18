import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyNovelSyncDoc,
  NOVEL_SYNC_FILE,
  NOVEL_SYNC_TOMBSTONE_TTL_MS,
  novelCopyKey,
  novelRowKey,
  parseNovelSyncDoc,
  planNovelSync,
  readingRemoved,
  serializeNovelSyncDoc,
} from "../packages/shared/novel-sync.ts";

// Synthetic rows shaped like each app's tables (no real reading data).
const now = Date.parse("2026-10-18T12:00:00Z");
const NB = "novelbuddy";
const NA = "novelarchive";
const OG_NB = "WAY3LXDy";
const OG_NA = "6a1637414f942c668d69a5a9";

const reading = (over = {}) => ({
  sourceId: NB, titleId: OG_NB, chapterId: "Chap0001", chapterOrder: 0, chapterLabel: "Chapter 1",
  paragraph: 10, paragraphCount: 100, updatedAt: now - 60_000, title: "Overgeared", cover: "https://img.example/og.png", ...over,
});
const listRow = (over = {}) => ({ sourceId: NB, titleId: OG_NB, status: "reading", updatedAt: now - 60_000, title: "Overgeared", cover: null, ...over });
const title = (over = {}) => ({
  sourceId: NB, titleId: OG_NB, title: "Overgeared", cover: null, novelKey: novelCopyKey(NB, OG_NB), linkAt: null, seen: null, ...over,
});
const local = (over = {}) => ({ reading: [], list: [], titles: [], ...over });
const none = () => ({ reading: {}, list: {} });
/** The gist after another device uploaded [l] (its tables) with [deleted] removals. */
const remoteOf = (l, deleted = none()) => {
  const plan = planNovelSync(l, emptyNovelSyncDoc(), deleted, now);
  return parseNovelSyncDoc(serializeNovelSyncDoc(plan.doc));
};

test("novel sync: its own gist file; absent is empty, malformed throws, newer sections are ignored", () => {
  assert.equal(NOVEL_SYNC_FILE, "anitrack-novel-sync.json");
  assert.deepEqual(parseNovelSyncDoc(null), emptyNovelSyncDoc());
  assert.deepEqual(parseNovelSyncDoc("  "), emptyNovelSyncDoc());
  assert.throws(() => parseNovelSyncDoc("[]"), /not an object/);
  assert.throws(() => parseNovelSyncDoc(JSON.stringify({ reading: { "novelbuddy:WAY3LXDy:x": { nope: 1 } } })), /reading row/);
  // A row filed under another key is refused rather than trusted.
  const row = { ...reading(), title: undefined, cover: undefined };
  assert.throws(() => parseNovelSyncDoc(JSON.stringify({ reading: { [novelRowKey(NB, OG_NB, "Other999")]: row } })), /reading row/);
  assert.throws(() => parseNovelSyncDoc(JSON.stringify({ deleted: { reading: { "../etc": now } } })), /removal/);
  const doc = parseNovelSyncDoc(JSON.stringify({ v: 2, future: { anything: true }, reading: {} }));
  assert.deepEqual(doc, emptyNovelSyncDoc());
});

test("novel sync: newer progress wins both ways; equal copies change nothing", () => {
  const mine = reading({ paragraph: 50, updatedAt: now - 10_000 });
  const older = remoteOf(local({ reading: [reading({ paragraph: 5, updatedAt: now - 20_000 })] }));
  let plan = planNovelSync(local({ reading: [mine] }), older, none(), now);
  assert.deepEqual(plan.reading.upsert, []);
  assert.equal(plan.doc.reading[novelRowKey(NB, OG_NB, "Chap0001")].paragraph, 50);
  assert.equal(plan.changed, true);

  const newer = remoteOf(local({ reading: [reading({ paragraph: 90, updatedAt: now - 1_000 })] }));
  plan = planNovelSync(local({ reading: [mine] }), newer, none(), now);
  assert.equal(plan.reading.upsert.length, 1);
  assert.equal(plan.reading.upsert[0].paragraph, 90);
  assert.equal(plan.reading.upsert[0].title, "Overgeared");
  assert.equal(plan.changed, false);

  const same = remoteOf(local({ reading: [mine] }));
  plan = planNovelSync(local({ reading: [mine] }), same, none(), now);
  assert.deepEqual([plan.reading.upsert, plan.reading.remove, plan.titles], [[], [], []]);
  assert.equal(plan.changed, false);
});

test("novel sync: a new device pulls everything, with names and covers", () => {
  const other = local({
    reading: [reading(), reading({ sourceId: NA, titleId: OG_NA, chapterId: "1735", chapterOrder: 1734, chapterLabel: "Chapter 1734", title: "Overgeared (NA)" })],
    list: [listRow({ status: "plan_to_read" })],
    titles: [title({ seen: 2060 })],
  });
  const plan = planNovelSync(local(), remoteOf(other), none(), now);
  assert.equal(plan.reading.upsert.length, 2);
  assert.deepEqual(plan.reading.upsert.map((r) => r.title).sort(), ["Overgeared", "Overgeared (NA)"]);
  assert.equal(plan.list.upsert[0].status, "plan_to_read");
  assert.equal(plan.titles.find((t) => t.titleId === OG_NB)?.seen, 2060);
  assert.equal(plan.changed, false);
});

test("novel sync: a removal hides the other device's rows until something newer is read", () => {
  const theirs = remoteOf(local({ reading: [reading({ updatedAt: now - 50_000 }), reading({ chapterId: "Chap0002", chapterOrder: 1, chapterLabel: "Chapter 2", updatedAt: now - 40_000 })] }));
  // Removed from Continue Reading here (the whole copy).
  let plan = planNovelSync(local(), theirs, { reading: { [novelCopyKey(NB, OG_NB)]: now - 30_000 }, list: {} }, now);
  assert.deepEqual(plan.reading.upsert, []);
  assert.deepEqual(plan.doc.reading, {});
  assert.equal(plan.doc.deleted.reading[novelCopyKey(NB, OG_NB)], now - 30_000);
  assert.equal(plan.changed, true);
  // The other device then drops its own copies of those rows.
  const after = parseNovelSyncDoc(serializeNovelSyncDoc(plan.doc));
  plan = planNovelSync(local({ reading: [reading({ updatedAt: now - 50_000 })] }), after, none(), now);
  assert.deepEqual(plan.reading.remove, [{ sourceId: NB, titleId: OG_NB, chapterId: "Chap0001" }]);
  // Reading it again afterwards wins over the removal.
  plan = planNovelSync(local({ reading: [reading({ updatedAt: now - 1_000 })] }), after, none(), now);
  assert.deepEqual(plan.reading.remove, []);
  assert.equal(plan.doc.reading[novelRowKey(NB, OG_NB, "Chap0001")].updatedAt, now - 1_000);
  // A chapter marked unread hides only that row.
  assert.ok(readingRemoved({ [novelRowKey(NB, OG_NB, "Chap0002")]: now }, reading({ chapterId: "Chap0002" })));
  assert.ok(!readingRemoved({ [novelRowKey(NB, OG_NB, "Chap0002")]: now }, reading()));
});

test("novel sync: list entries merge by time; a removed entry stays removed", () => {
  const theirs = remoteOf(local({ list: [listRow({ status: "completed", updatedAt: now - 5_000 })] }));
  let plan = planNovelSync(local({ list: [listRow({ status: "on_hold", updatedAt: now - 9_000 })] }), theirs, none(), now);
  assert.equal(plan.list.upsert[0].status, "completed");
  plan = planNovelSync(local(), theirs, { reading: {}, list: { [novelCopyKey(NB, OG_NB)]: now - 1_000 } }, now);
  assert.deepEqual(plan.list.upsert, []);
  assert.deepEqual(plan.doc.list, {});
});

test("novel sync: links merge by link time; the newer link or unlink wins", () => {
  const key = novelCopyKey(NA, OG_NA); // the smaller copy key names the novel
  const linked = [title({ novelKey: key, linkAt: now - 5_000 }), title({ sourceId: NA, titleId: OG_NA, novelKey: key, linkAt: now - 5_000 })];
  // A device that never linked them takes the link (and a copy it never saw).
  let plan = planNovelSync(local({ titles: [title()] }), remoteOf(local({ titles: linked })), none(), now);
  assert.deepEqual(plan.titles.map((t) => [t.sourceId, t.novelKey]).sort(), [[NA, key], [NB, key]]);
  // A newer unlink here beats the older link in the gist.
  const unlinked = [title({ linkAt: now - 1_000 }), title({ sourceId: NA, titleId: OG_NA, novelKey: key, linkAt: now - 1_000 })];
  plan = planNovelSync(local({ titles: unlinked }), remoteOf(local({ titles: linked })), none(), now);
  assert.deepEqual(plan.titles, []);
  assert.equal(plan.doc.titles[novelCopyKey(NB, OG_NB)].novelKey, novelCopyKey(NB, OG_NB));
  // Copies nobody linked or read stay out of the gist.
  plan = planNovelSync(local({ titles: [title({ titleId: "Lone1234", novelKey: novelCopyKey(NB, "Lone1234") })] }), emptyNovelSyncDoc(), none(), now);
  assert.deepEqual(plan.doc.titles, {});
  assert.equal(plan.changed, false);
});

test("novel sync: the chapter count last shown merges by maximum", () => {
  const theirs = remoteOf(local({ reading: [reading()], titles: [title({ seen: 2060 })] }));
  let plan = planNovelSync(local({ reading: [reading()], titles: [title({ seen: 2000 })] }), theirs, none(), now);
  assert.equal(plan.titles[0].seen, 2060);
  plan = planNovelSync(local({ reading: [reading()], titles: [title({ seen: 2100 })] }), theirs, none(), now);
  assert.deepEqual(plan.titles, []);
  assert.equal(plan.doc.titles[novelCopyKey(NB, OG_NB)].seen, 2100);
});

test("novel sync: old removals expire unless they're still waiting here", () => {
  const old = now - NOVEL_SYNC_TOMBSTONE_TTL_MS - 1_000;
  const doc = emptyNovelSyncDoc();
  doc.deleted.reading[novelCopyKey(NB, OG_NB)] = old;
  doc.deleted.list[novelCopyKey(NA, OG_NA)] = old;
  let plan = planNovelSync(local(), doc, none(), now);
  assert.deepEqual(plan.doc.deleted, { reading: {}, list: {} });
  plan = planNovelSync(local(), doc, { reading: { [novelCopyKey(NB, OG_NB)]: old }, list: {} }, now);
  assert.equal(plan.doc.deleted.reading[novelCopyKey(NB, OG_NB)], old);
});

test("novel sync: the same content always serializes the same", () => {
  const a = local({ reading: [reading(), reading({ chapterId: "Chap0002", chapterOrder: 1, chapterLabel: "Chapter 2" })] });
  const b = local({ reading: [...a.reading].reverse() });
  assert.equal(serializeNovelSyncDoc(planNovelSync(a, emptyNovelSyncDoc(), none(), now).doc),
    serializeNovelSyncDoc(planNovelSync(b, emptyNovelSyncDoc(), none(), now).doc));
});

test("novel sync: rows the other device would refuse are never uploaded", () => {
  const bad = local({
    reading: [reading(), reading({ chapterId: "bad/id" }), reading({ chapterId: "Chap0003", chapterLabel: "" })],
    list: [listRow({ status: "watching" })],
    titles: [title({ novelKey: "elsewhere:1" })],
  });
  const plan = planNovelSync(bad, emptyNovelSyncDoc(), none(), now);
  assert.deepEqual(Object.keys(plan.doc.reading), [novelRowKey(NB, OG_NB, "Chap0001")]);
  assert.deepEqual(plan.doc.list, {});
  // Whatever is uploaded parses again on the other side.
  assert.doesNotThrow(() => parseNovelSyncDoc(serializeNovelSyncDoc(plan.doc)));
});

test("novel sync: Android's wire format parses (its key order differs)", () => {
  // As Android's org.json writes it: field order not sorted, nulls explicit.
  const android = `{"v":1,"deleted":{"list":{},"reading":{"novelbuddy:WAY3LXDy":${now}}},"list":{},` +
    `"reading":{"novelarchive:${OG_NA}:1735":{"updatedAt":${now - 5},"paragraphCount":104,"paragraph":52,"chapterLabel":"Chapter 1734",` +
    `"chapterOrder":1734,"chapterId":"1735","titleId":"${OG_NA}","sourceId":"novelarchive"}},` +
    `"titles":{"novelarchive:${OG_NA}":{"seen":2060,"linkAt":${now - 9},"novelKey":"novelarchive:${OG_NA}","cover":null,"title":"Overgeared"}}}`;
  const doc = parseNovelSyncDoc(android);
  assert.equal(doc.reading[novelRowKey(NA, OG_NA, "1735")].paragraph, 52);
  assert.equal(doc.titles[novelCopyKey(NA, OG_NA)].seen, 2060);
  assert.equal(doc.deleted.reading[novelCopyKey(NB, OG_NB)], now);
  // And it reserializes canonically: no needless upload from a different key order alone.
  const plan = planNovelSync(local({ reading: [{ ...doc.reading[novelRowKey(NA, OG_NA, "1735")], title: "Overgeared", cover: null }], titles: [{ ...doc.titles[novelCopyKey(NA, OG_NA)], sourceId: NA, titleId: OG_NA }] }), doc, none(), now);
  assert.equal(plan.changed, false);
});
