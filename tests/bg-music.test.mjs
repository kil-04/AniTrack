import test from "node:test";
import assert from "node:assert/strict";
import { isMusicFile, nextMode, nextTrackIndex, previousTrackIndex, safeTrackName, skipTrackIndex, sortTracks, startTrackId, trackFromFile } from "../packages/shared/bg-music.ts";

test("track names come from the file name, without the track number", () => {
  assert.deepEqual(trackFromFile("57 I Will Protect You -Reload-.mp3"), { id: "57 I Will Protect You -Reload-.mp3", title: "I Will Protect You -Reload-", number: 57 });
  assert.deepEqual(trackFromFile("01 Full Moon Full Life.mp3"), { id: "01 Full Moon Full Life.mp3", title: "Full Moon Full Life", number: 1 });
  assert.deepEqual(trackFromFile("28 tartarus_0d03.mp3")?.title, "tartarus_0d03");
  assert.deepEqual(trackFromFile("07 - Shadow.flac")?.title, "Shadow");
  assert.equal(trackFromFile("Kyoto.MP3")?.number, null);
  assert.equal(trackFromFile("Kyoto.MP3")?.title, "Kyoto");
  // A number that is the whole title stays the title.
  assert.equal(trackFromFile("1989.mp3")?.title, "1989");
  assert.equal(trackFromFile("cover.jpg"), null);
  assert.equal(isMusicFile(".hidden.mp3"), false);
});

test("tracks sort by number, unnumbered last by title", () => {
  const sorted = sortTracks(["10 b.mp3", "2 a.mp3", "Zeta.mp3", "alpha.ogg", "01 first.mp3"].map(trackFromFile));
  assert.deepEqual(sorted.map((t) => t.id), ["01 first.mp3", "2 a.mp3", "10 b.mp3", "alpha.ogg", "Zeta.mp3"]);
});

test("next track: repeat one, play all wraps, shuffle never repeats the last one", () => {
  assert.equal(nextTrackIndex("one", 3, 10), 3);
  assert.equal(nextTrackIndex("all", 3, 10), 4);
  assert.equal(nextTrackIndex("all", 9, 10), 0);
  for (const r of [0, 0.2, 0.5, 0.999]) {
    const next = nextTrackIndex("shuffle", 4, 10, () => r);
    assert.ok(next >= 0 && next < 10 && next !== 4);
  }
  assert.equal(nextTrackIndex("shuffle", 0, 1), 0);
  assert.equal(nextTrackIndex("all", 0, 0), -1);
  assert.equal(nextTrackIndex("all", -1, 5), 0);
});

test("Next skips on even in Repeat one; Previous goes back in list order", () => {
  assert.equal(skipTrackIndex("one", 2, 5), 3);
  assert.equal(skipTrackIndex("one", 4, 5), 0);
  assert.equal(skipTrackIndex("all", 4, 5), 0);
  assert.notEqual(skipTrackIndex("shuffle", 2, 5, () => 0.5), 2);
  assert.equal(skipTrackIndex("one", 0, 0), -1);
  assert.equal(previousTrackIndex(2, 5), 1);
  assert.equal(previousTrackIndex(0, 5), 4);
  assert.equal(previousTrackIndex(-1, 5), 0);
  assert.equal(previousTrackIndex(0, 0), -1);
});

test("the Repeat button cycles Play all, Repeat one, Shuffle", () => {
  assert.equal(nextMode("all"), "one");
  assert.equal(nextMode("one"), "shuffle");
  assert.equal(nextMode("shuffle"), "all");
});

test("AniTrack opens with the starred default, else the last track, else the first", () => {
  const tracks = ["01 A.mp3", "02 B.mp3", "Because I Will Protect You.mp3"].map((id) => ({ id, title: id, number: null }));
  assert.equal(startTrackId(tracks, "02 B.mp3", "Because I Will Protect You.mp3"), "Because I Will Protect You.mp3");
  assert.equal(startTrackId(tracks, "02 B.mp3", null), "02 B.mp3");
  // A default or last track that was removed falls through.
  assert.equal(startTrackId(tracks, "02 B.mp3", "gone.mp3"), "02 B.mp3");
  assert.equal(startTrackId(tracks, "gone.mp3", null), "01 A.mp3");
  assert.equal(startTrackId([], "02 B.mp3", "01 A.mp3"), null);
});

test("imported file names are made safe", () => {
  assert.equal(safeTrackName("C:\\Users\\x\\57 I Will Protect You.mp3"), "57 I Will Protect You.mp3");
  assert.equal(safeTrackName("../../evil.mp3"), "evil.mp3");
  assert.equal(safeTrackName("a<b>:c?.mp3"), "a_b__c_.mp3");
  assert.equal(safeTrackName("It’s Going Down Now.mp3"), "It’s Going Down Now.mp3");
});
