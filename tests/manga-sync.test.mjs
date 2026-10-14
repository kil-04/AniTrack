import test from "node:test";
import assert from "node:assert/strict";
import {
  chapterKey, readingKey, parseMangaSyncDoc, serializeMangaSyncDoc, planMangaSync, emptyMangaSyncDoc,
  MANGA_SYNC_FILE, MANGA_SYNC_TOMBSTONE_TTL_MS,
} from "../packages/shared/manga-sync.ts";

const now = Date.parse("2026-10-15T00:00:00Z");
const row = (over = {}) => ({
  mangaId: 30013, chapter: 1195, chapterId: "user:9001", page: 3, pageCount: 17,
  sourceId: "mangadot", updatedAt: now - 60_000, title: "One Piece", cover: "https://img.example/op.jpg", ...over,
});
const remoteOf = (rows, deleted = {}, manga = {}) => {
  const doc = emptyMangaSyncDoc();
  for (const r of rows) {
    const { title, cover, ...synced } = r;
    doc.reading[readingKey(r.mangaId, r.chapter)] = synced;
    doc.manga[String(r.mangaId)] = manga[r.mangaId] ?? { title, cover };
  }
  doc.deleted = deleted;
  return doc;
};

test("manga sync: its own gist file, and chapter keys both apps agree on", () => {
  assert.equal(MANGA_SYNC_FILE, "anitrack-manga-sync.json");
  assert.equal(chapterKey(1194), "1194");
  assert.equal(chapterKey(7.2), "7.2");
  // Android stores REAL chapters as Float: 7.2f widens to 7.199999809265137.
  assert.equal(chapterKey(7.199999809265137), "7.2");
  assert.equal(chapterKey(12.25), "12.25");
  assert.equal(chapterKey(0), "0");
  assert.equal(readingKey(30013, 1195), "30013:1195");
});

test("manga sync: newer rows win both ways; ties and older copies change nothing", () => {
  const mine = row({ page: 5, updatedAt: now - 10_000 });
  const theirsOlder = row({ page: 2, updatedAt: now - 20_000 });
  let plan = planMangaSync([mine], remoteOf([theirsOlder]), {}, now);
  assert.deepEqual(plan.upsert, []);
  assert.equal(plan.doc.reading["30013:1195"].page, 5);
  assert.equal(plan.changed, true);

  const theirsNewer = row({ page: 9, updatedAt: now - 1_000, chapterId: "user:9002", sourceId: "mangaball" });
  plan = planMangaSync([mine], remoteOf([theirsNewer]), {}, now);
  assert.equal(plan.upsert.length, 1);
  assert.equal(plan.upsert[0].page, 9);
  assert.equal(plan.upsert[0].sourceId, "mangaball");
  assert.equal(plan.upsert[0].title, "One Piece");
  assert.equal(plan.changed, false);

  plan = planMangaSync([mine], remoteOf([mine]), {}, now);
  assert.deepEqual(plan.upsert, []);
  assert.deepEqual(plan.remove, []);
  assert.equal(plan.changed, false);
});

test("manga sync: a new device pulls everything; an empty gist receives everything", () => {
  const a = row({ chapter: 1194, chapterId: "user:1", updatedAt: now - 50_000 });
  const b = row({ mangaId: 105398, chapter: 12.5, chapterId: "abc", sourceId: "comix", title: "Solo Leveling", cover: null });
  let plan = planMangaSync([], remoteOf([a, b]), {}, now);
  assert.equal(plan.upsert.length, 2);
  assert.equal(plan.changed, false);
  plan = planMangaSync([a, b], emptyMangaSyncDoc(), {}, now);
  assert.deepEqual(plan.upsert, []);
  assert.deepEqual(Object.keys(plan.doc.reading).sort(), ["105398:12.5", "30013:1194"]);
  assert.deepEqual(plan.doc.manga["105398"], { title: "Solo Leveling", cover: null });
  assert.equal(plan.changed, true);
});

test("manga sync: Continue Reading removal is not resurrected, but reading again wins", () => {
  const old = row({ updatedAt: now - 100_000 });
  const removedAt = now - 50_000;
  // Removed here, still on the other device's copy in the gist.
  let plan = planMangaSync([], remoteOf([old]), { "30013": removedAt }, now);
  assert.deepEqual(plan.upsert, []);
  assert.deepEqual(plan.doc.reading, {});
  assert.equal(plan.doc.deleted["30013"], removedAt);
  assert.equal(plan.changed, true);
  // The other device applies the removal from the gist.
  plan = planMangaSync([old], remoteOf([], { "30013": removedAt }), {}, now);
  assert.deepEqual(plan.remove, [{ mangaId: 30013, chapter: 1195 }]);
  assert.deepEqual(plan.doc.reading, {});
  // Reading it again after the removal brings it back everywhere.
  const again = row({ chapter: 1196, chapterId: "user:2", updatedAt: now - 1_000 });
  plan = planMangaSync([again], remoteOf([], { "30013": removedAt }), {}, now);
  assert.deepEqual(plan.remove, []);
  assert.ok(plan.doc.reading["30013:1196"]);
});

test("manga sync: marking one chapter unread hides only that chapter", () => {
  const ch1 = row({ chapter: 1, chapterId: "c1", page: 16, updatedAt: now - 90_000 });
  const ch2 = row({ chapter: 2, chapterId: "c2", page: 16, updatedAt: now - 80_000 });
  const plan = planMangaSync([ch1], remoteOf([ch1, ch2]), { "30013:2": now - 10_000 }, now);
  assert.deepEqual(plan.upsert, []);
  assert.deepEqual(Object.keys(plan.doc.reading), ["30013:1"]);
  assert.equal(plan.doc.deleted["30013:2"], now - 10_000);
});

test("manga sync: old removals are pruned, unsent ones are kept", () => {
  const ancient = now - MANGA_SYNC_TOMBSTONE_TTL_MS - 1;
  let plan = planMangaSync([], remoteOf([], { "1": ancient, "2": now - 5 }), {}, now);
  assert.deepEqual(plan.doc.deleted, { "2": now - 5 });
  plan = planMangaSync([], remoteOf([], {}), { "3": ancient }, now);
  assert.deepEqual(plan.doc.deleted, { "3": ancient });
});

test("manga sync: absent file is empty, malformed file throws, round trip is stable", () => {
  assert.deepEqual(parseMangaSyncDoc(null), emptyMangaSyncDoc());
  assert.deepEqual(parseMangaSyncDoc(""), emptyMangaSyncDoc());
  assert.throws(() => parseMangaSyncDoc("[]"));
  assert.throws(() => parseMangaSyncDoc(JSON.stringify({ reading: { x: { mangaId: -1 } } })));
  assert.throws(() => parseMangaSyncDoc(JSON.stringify({ reading: {}, deleted: { "abc": 5 } })));
  assert.throws(() => parseMangaSyncDoc(JSON.stringify({ reading: { k: { ...row(), page: 17 } } })));
  const doc = remoteOf([row(), row({ mangaId: 7, chapter: 7.2, chapterId: "z", title: "T", cover: null })], { "9": now });
  const again = parseMangaSyncDoc(serializeMangaSyncDoc(doc));
  assert.deepEqual(again, doc);
  // A row stored under a non-canonical key is re-keyed, newest copy kept.
  const odd = JSON.stringify({ reading: { "7:7.20": { ...remoteOf([row({ mangaId: 7, chapter: 7.2 })]).reading["7:7.2"] } } });
  assert.deepEqual(Object.keys(parseMangaSyncDoc(odd).reading), ["7:7.2"]);
});
