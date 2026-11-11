import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyNovelSyncDoc,
  novelCopyKey,
  novelRowKey,
  parseNovelSyncDoc,
  planNovelSync,
  serializeNovelSyncDoc,
} from "../packages/shared/novel-sync.ts";

// Sources added after the first sync format (Novel Phoenix on) keep their rows under
// "more". Synthetic rows only; NovelSyncMergeTest.kt covers the same cases on Android.
const now = Date.parse("2026-11-10T12:00:00Z");
const NB = "novelbuddy";
const NP = "novelphoenix";
const OG_NB = "WAY3LXDy";
const SS_NP = "shadow-slave";

const reading = (over = {}) => ({
  sourceId: NB, titleId: OG_NB, chapterId: "Chap0001", chapterOrder: 0, chapterLabel: "Chapter 1",
  paragraph: 10, paragraphCount: 100, updatedAt: now - 60_000, title: "Overgeared", cover: "https://img.example/og.png", ...over,
});
const npReading = (over = {}) => reading({ sourceId: NP, titleId: SS_NP, chapterId: "12", chapterOrder: 11, chapterLabel: "Chapter 12: A Step", title: "Shadow Slave", cover: null, ...over });
const listRow = (over = {}) => ({ sourceId: NB, titleId: OG_NB, status: "reading", updatedAt: now - 60_000, title: "Overgeared", cover: null, ...over });
const title = (over = {}) => ({
  sourceId: NB, titleId: OG_NB, title: "Overgeared", cover: null, novelKey: novelCopyKey(NB, OG_NB), linkAt: null, seen: null, ...over,
});
const local = (over = {}) => ({ reading: [], list: [], titles: [], ...over });
const none = () => ({ reading: {}, list: {} });
const remoteOf = (l, deleted = none()) => parseNovelSyncDoc(serializeNovelSyncDoc(planNovelSync(l, emptyNovelSyncDoc(), deleted, now).doc));
const bare = (row) => ({ ...row, title: undefined, cover: undefined });

/** What an app from before Novel Phoenix accepts: the first sections, with its own key rules. */
function olderAppAccepts(serialized) {
  const json = JSON.parse(serialized);
  const copy = /^(novelbuddy|novelarchive):([A-Za-z0-9]{4,24})$/;
  const row = /^(novelbuddy|novelarchive):([A-Za-z0-9]{4,24}):([A-Za-z0-9]{1,24})$/;
  return Object.keys(json.reading).every((k) => row.test(k))
    && Object.keys(json.list).every((k) => copy.test(k))
    && Object.entries(json.titles).every(([k, t]) => copy.test(k) && copy.test(t.novelKey))
    && Object.keys(json.deleted.reading).every((k) => copy.test(k) || row.test(k))
    && Object.keys(json.deleted.list).every((k) => copy.test(k));
}

test("novel sync: a later source's rows live under \"more\", out of an older app's way", () => {
  const plan = planNovelSync(
    local({
      reading: [reading(), npReading()],
      list: [listRow(), listRow({ sourceId: NP, titleId: SS_NP, title: "Shadow Slave" })],
      titles: [title(), title({ sourceId: NP, titleId: SS_NP, title: "Shadow Slave", novelKey: novelCopyKey(NP, SS_NP), seen: 3242 })],
    }),
    emptyNovelSyncDoc(),
    { reading: { [novelRowKey(NP, SS_NP, "3")]: now - 5, [novelCopyKey(NB, "Other123")]: now - 6 }, list: { [novelCopyKey(NP, "gone-novel")]: now - 7 } },
    now,
  );
  const text = serializeNovelSyncDoc(plan.doc);
  const json = JSON.parse(text);
  assert.deepEqual(Object.keys(json.reading), [novelRowKey(NB, OG_NB, "Chap0001")]);
  assert.deepEqual(Object.keys(json.more.reading), [novelRowKey(NP, SS_NP, "12")]);
  assert.deepEqual(Object.keys(json.more.list), [novelCopyKey(NP, SS_NP)]);
  assert.equal(json.more.titles[novelCopyKey(NP, SS_NP)].seen, 3242);
  assert.deepEqual(json.deleted.reading, { [novelCopyKey(NB, "Other123")]: now - 6 });
  assert.deepEqual(json.more.deleted, { reading: { [novelRowKey(NP, SS_NP, "3")]: now - 5 }, list: { [novelCopyKey(NP, "gone-novel")]: now - 7 } });
  assert.equal(olderAppAccepts(text), true);
  // This version reads both parts back as one document.
  const back = parseNovelSyncDoc(text);
  assert.deepEqual(back, plan.doc);
  assert.equal(serializeNovelSyncDoc(back), text);
});

test("novel sync: a file without later-source rows has no \"more\" and is byte-for-byte the first format", () => {
  const text = serializeNovelSyncDoc(remoteOf(local({ reading: [reading()], list: [listRow()], titles: [title({ seen: 5 })] })));
  assert.equal("more" in JSON.parse(text), false);
  assert.deepEqual(Object.keys(JSON.parse(text)), ["v", "titles", "reading", "list", "deleted"]);
  assert.equal(olderAppAccepts(text), true);
});

test("novel sync: later-source progress merges like any other", () => {
  const remote = remoteOf(local({
    reading: [npReading({ paragraph: 40, updatedAt: now - 10 })],
    titles: [title({ sourceId: NP, titleId: SS_NP, title: "Shadow Slave", novelKey: novelCopyKey(NP, SS_NP) })],
  }));
  const pull = planNovelSync(local(), remote, none(), now);
  assert.deepEqual(pull.reading.upsert.map((r) => [r.sourceId, r.titleId, r.chapterId, r.paragraph, r.title]), [[NP, SS_NP, "12", 40, "Shadow Slave"]]);
  assert.equal(pull.changed, false);
  const newer = planNovelSync(local({ reading: [npReading({ paragraph: 90, updatedAt: now - 1 })] }), remote, none(), now);
  assert.equal(newer.doc.reading[novelRowKey(NP, SS_NP, "12")].paragraph, 90);
  assert.equal(newer.changed, true);
  // A removal of the copy hides it for the other device too.
  const removed = planNovelSync(local(), remote, { reading: { [novelCopyKey(NP, SS_NP)]: now }, list: {} }, now);
  assert.deepEqual(Object.keys(removed.doc.reading), []);
  assert.equal(olderAppAccepts(serializeNovelSyncDoc(removed.doc)), true);
});

test("novel sync: copies linked across first and later sources keep the smallest key, which an older app knows", () => {
  const key = novelCopyKey(NB, OG_NB);
  const plan = planNovelSync(
    local({ titles: [title({ novelKey: key, linkAt: now - 3 }), title({ sourceId: NP, titleId: "overgeared-novel", novelKey: key, linkAt: now - 3 })] }),
    emptyNovelSyncDoc(), none(), now,
  );
  const text = serializeNovelSyncDoc(plan.doc);
  const json = JSON.parse(text);
  assert.equal(json.titles[key].novelKey, key);
  assert.equal(json.more.titles[novelCopyKey(NP, "overgeared-novel")].novelKey, key);
  assert.equal(olderAppAccepts(text), true);
  assert.deepEqual(parseNovelSyncDoc(text).titles, plan.doc.titles);
  // A first-source copy filed under a later source's key can't sit where an older app reads.
  const odd = { ...plan.doc, titles: { [key]: { title: "Overgeared", cover: null, novelKey: novelCopyKey(NP, "a-novel"), linkAt: now, seen: null } } };
  const oddText = serializeNovelSyncDoc(odd);
  assert.equal(olderAppAccepts(oddText), true);
  assert.equal(JSON.parse(oddText).more.titles[key].novelKey, novelCopyKey(NP, "a-novel"));
  assert.deepEqual(parseNovelSyncDoc(oddText).titles, odd.titles);
});

test("novel sync: a row in the wrong part of the file is refused", () => {
  assert.throws(() => parseNovelSyncDoc(JSON.stringify({ reading: { [novelRowKey(NP, SS_NP, "12")]: bare(npReading()) } })), /reading row/);
  assert.throws(() => parseNovelSyncDoc(JSON.stringify({ more: { reading: { [novelRowKey(NB, OG_NB, "Chap0001")]: bare(reading()) } } })), /reading row/);
  assert.throws(() => parseNovelSyncDoc(JSON.stringify({ more: { list: { [novelCopyKey(NP, "Not_A_Slug")]: { sourceId: NP, titleId: "Not_A_Slug", status: "reading", updatedAt: now } } } })), /list row/);
  assert.throws(() => parseNovelSyncDoc(JSON.stringify({ more: { deleted: { list: { [novelCopyKey(NB, OG_NB)]: now } } } })), /removal/);
  assert.throws(() => parseNovelSyncDoc(JSON.stringify({ more: [] })), /invalid section/);
  // An unknown source in the first sections is still an error (nothing there is ever skipped).
  assert.throws(() => parseNovelSyncDoc(JSON.stringify({ list: { "novelnext:abc": { sourceId: "novelnext", titleId: "abc", status: "reading", updatedAt: now } } })), /list row/);
});

test("novel sync: rows of a source only a newer app knows are kept and written back untouched", () => {
  const future = {
    v: 1, titles: {}, reading: {}, list: {}, deleted: { reading: {}, list: {} },
    more: {
      titles: {
        "novelnext:Some.Id_9": { title: "Later", cover: null, novelKey: "novelnext:Some.Id_9", linkAt: null, seen: 4, extra: true },
        [novelCopyKey(NP, SS_NP)]: { title: "Shadow Slave", cover: null, novelKey: novelCopyKey(NP, SS_NP), linkAt: null, seen: null },
      },
      reading: { "novelnext:Some.Id_9:c/1": { anything: [1, 2, 3] }, [novelRowKey(NP, SS_NP, "12")]: bare(npReading()) },
      list: { "novelnext:Some.Id_9": { status: "reading" } },
      deleted: { reading: { "novelnext:Some.Id_9:c/0": "soon" }, list: {} },
    },
  };
  const doc = parseNovelSyncDoc(JSON.stringify(future));
  assert.deepEqual(Object.keys(doc.reading), [novelRowKey(NP, SS_NP, "12")]);
  assert.deepEqual(doc.kept.reading, { "novelnext:Some.Id_9:c/1": { anything: [1, 2, 3] } });
  // Nothing local to add: the file is left exactly as it was.
  const idle = planNovelSync(local({ reading: [npReading()] }), doc, none(), now);
  assert.equal(idle.changed, false);
  // A local change uploads, and the newer app's rows ride along unchanged.
  const plan = planNovelSync(local({ reading: [reading(), npReading()] }), doc, none(), now);
  assert.equal(plan.changed, true);
  const out = JSON.parse(serializeNovelSyncDoc(plan.doc));
  assert.deepEqual(out.more.titles["novelnext:Some.Id_9"], future.more.titles["novelnext:Some.Id_9"]);
  assert.deepEqual(out.more.reading["novelnext:Some.Id_9:c/1"], { anything: [1, 2, 3] });
  assert.deepEqual(out.more.list, future.more.list);
  assert.deepEqual(out.more.deleted.reading, { "novelnext:Some.Id_9:c/0": "soon" });
  assert.deepEqual(Object.keys(out.reading), [novelRowKey(NB, OG_NB, "Chap0001")]);
  // A key that isn't even shaped like a source's is not kept: the file is refused.
  assert.throws(() => parseNovelSyncDoc(JSON.stringify({ more: { list: { "No Source": {} } } })), /list row/);
});

test("novel sync: Android's \"more\" section parses (its key order differs)", () => {
  // As Android's org.json writes it: field order not sorted, nulls explicit.
  const android = `{"more":{"deleted":{"list":{},"reading":{"novelphoenix:shadow-slave:3":${now - 5}}},"list":{"novelphoenix:shadow-slave":{"updatedAt":${now - 2},"status":"reading","titleId":"shadow-slave","sourceId":"novelphoenix"}},`
    + `"reading":{"novelphoenix:shadow-slave:12":{"updatedAt":${now - 1},"paragraphCount":100,"paragraph":10,"chapterLabel":"Chapter 12: A Step","chapterOrder":11,"chapterId":"12","titleId":"shadow-slave","sourceId":"novelphoenix"}},`
    + `"titles":{"novelphoenix:shadow-slave":{"seen":3242,"linkAt":null,"novelKey":"novelphoenix:shadow-slave","cover":null,"title":"Shadow Slave"}}},`
    + `"v":1,"deleted":{"list":{},"reading":{}},"list":{},"reading":{},"titles":{}}`;
  const doc = parseNovelSyncDoc(android);
  assert.equal(doc.reading[novelRowKey(NP, SS_NP, "12")].paragraph, 10);
  assert.equal(doc.list[novelCopyKey(NP, SS_NP)].status, "reading");
  assert.equal(doc.titles[novelCopyKey(NP, SS_NP)].seen, 3242);
  assert.equal(doc.deleted.reading[novelRowKey(NP, SS_NP, "3")], now - 5);
  // And it reserializes canonically: no needless upload from a different key order alone.
  const plan = planNovelSync(local({
    reading: [{ ...doc.reading[novelRowKey(NP, SS_NP, "12")], title: "Shadow Slave", cover: null }],
    list: [{ ...doc.list[novelCopyKey(NP, SS_NP)], title: "Shadow Slave", cover: null }],
    titles: [{ ...doc.titles[novelCopyKey(NP, SS_NP)], sourceId: NP, titleId: SS_NP }],
  }), doc, none(), now);
  assert.equal(plan.changed, false);
});
