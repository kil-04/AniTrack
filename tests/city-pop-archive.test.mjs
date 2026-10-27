import test from "node:test";
import assert from "node:assert/strict";
import { archiveSearchUrl, parseArchiveSearch, parseArchiveTracks, archiveFileUrl, validArchiveId, CITY_POP_ARCHIVE_PAGE_SIZE, ArchiveUnavailableError, ARCHIVE_SEARCH_UNAVAILABLE, ARCHIVE_ITEM_UNAVAILABLE } from "../packages/shared/city-pop-archive.ts";

// Compact shapes from the public metadata API, checked 24 October 2026.
const album = (files, metadata = {}) => ({ metadata: { identifier: "test-album", mediatype: "audio", title: "Album", creator: "Artist", ...metadata }, files });
const file = (name, fields = {}) => ({ name, source: "original", size: "1000", ...fields });

test("City Pop Archive: query words are quoted literals and search is bounded to audio and video", () => {
  const defaultUrl = new URL(archiveSearchUrl(""));
  assert.equal(defaultUrl.origin, "https://archive.org");
  assert.equal(defaultUrl.pathname, "/advancedsearch.php");
  assert.ok(defaultUrl.searchParams.get("q").includes('title:"city pop"'));
  assert.equal(defaultUrl.searchParams.get("rows"), String(CITY_POP_ARCHIVE_PAGE_SIZE));
  const url = new URL(archiveSearchUrl('Miki " OR mediatype:texts \\ Stay', -2));
  const words = String.raw`"Miki" AND "\"" AND "OR" AND "mediatype:texts" AND "\\" AND "Stay"`;
  const phrase = String.raw`Miki \" OR mediatype:texts \\ Stay`;
  assert.equal(url.searchParams.get("q"), `mediatype:(audio OR movies) AND (title:(${words}) OR creator:(${words}) OR subject:"${phrase}")`);
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(new URL(archiveSearchUrl("  ANRI  ", 99999)).searchParams.get("page"), "1000");
  assert.equal(new URL(archiveSearchUrl("x", NaN)).searchParams.get("page"), "1");
});

test("City Pop Archive: results normalize arrays, dates, types and duplicate items", () => {
  const result = parseArchiveSearch({ response: { numFound: 100, docs: [
    { identifier: "audio-item", title: ["First", "Second"], creator: ["Singer", "Band"], mediatype: "audio", year: 1983 },
    { identifier: "video-item", title: "Live", mediatype: "movies", date: "1980-05-01" },
    { identifier: "audio-item", title: "Duplicate", mediatype: "audio" },
    { identifier: "../bad", mediatype: "audio" },
    { identifier: "book", mediatype: "texts" },
    { identifier: "restricted", mediatype: "audio", "access-restricted-item": "true" },
    { identifier: "dark", mediatype: "audio", is_dark: true },
  ] } }, 2);
  assert.equal(result.total, 100);
  assert.equal(result.page, 2);
  assert.deepEqual(result.items.map((item) => [item.id, item.title, item.creator, item.mediaType, item.year]), [
    ["audio-item", "First; Second", "Singer; Band", "audio", 1983],
    ["video-item", "Live", "Unknown artist", "video", 1980],
  ]);
  assert.equal(result.items[0].coverUrl, "https://archive.org/services/img/audio-item");
  assert.equal(parseArchiveSearch({ response: { docs: Array.from({ length: 200 }, (_, i) => ({ identifier: `id-${i}`, mediatype: "audio" })) } }).items.length, 24);
});

test("City Pop Archive: an error answer is Archive being unavailable, never an empty search", () => {
  const unavailable = (error) => error instanceof ArchiveUnavailableError && error.message === ARCHIVE_SEARCH_UNAVAILABLE;
  for (const answer of [null, "html", [], {}, { error: "Search engine down" }, { responseHeader: { status: 500 }, response: { numFound: 0, docs: [] } }, { responseHeader: { status: "0" }, response: { docs: [] } }, { response: { docs: [] }, error: null }]) {
    assert.throws(() => parseArchiveSearch(answer), unavailable, JSON.stringify(answer));
  }
  // A real answer with no documents is an honest "nothing found".
  assert.deepEqual(parseArchiveSearch({ responseHeader: { status: 0 }, response: { numFound: 0, docs: [] } }, 3), { items: [], total: 0, page: 3 });
});

test("City Pop Archive: media filters keep video search scoped and preserve literal artist queries", () => {
  const video = new URL(archiveSearchUrl("", 3, "video"));
  assert.equal(video.searchParams.get("q"), 'mediatype:movies AND ((title:"city pop" OR subject:"city pop" OR title:citypop OR subject:citypop))');
  assert.equal(video.searchParams.get("page"), "3");
  assert.equal(new URL(archiveSearchUrl("Mariya Takeuchi", 1, "video")).searchParams.get("q"), 'mediatype:movies AND (title:("Mariya" AND "Takeuchi") OR creator:("Mariya" AND "Takeuchi") OR subject:"Mariya Takeuchi")');
  assert.equal(new URL(archiveSearchUrl("ANRI", 2, "audio")).searchParams.get("q"), 'mediatype:audio AND (title:("ANRI") OR creator:("ANRI") OR subject:"ANRI")');
  assert.equal(archiveSearchUrl("Miki", 1, "all"), archiveSearchUrl("Miki"));
  for (const media of ["movies", "video OR audio", null, {}, 1]) assert.throws(() => archiveSearchUrl("Miki", 1, media), /Invalid Archive media filter/);
});

test("City Pop Archive: song and artist words can match separately instead of requiring an exact phrase", () => {
  assert.equal(new URL(archiveSearchUrl("  miki\n matsubara   stay with me ", 1, "video")).searchParams.get("q"), 'mediatype:movies AND (title:("miki" AND "matsubara" AND "stay" AND "with" AND "me") OR creator:("miki" AND "matsubara" AND "stay" AND "with" AND "me") OR subject:"miki  matsubara   stay with me")');
  assert.equal(new URL(archiveSearchUrl("竹内まりや Plastic Love", 1, "video")).searchParams.get("q"), 'mediatype:movies AND (title:("竹内まりや" AND "Plastic" AND "Love") OR creator:("竹内まりや" AND "Plastic" AND "Love") OR subject:"竹内まりや Plastic Love")');
  assert.equal(new URL(archiveSearchUrl("Plastic Love", 1, "video")).searchParams.get("q"), 'mediatype:movies AND (title:("Plastic" AND "Love") OR creator:("Plastic" AND "Love") OR subject:"Plastic Love")');
});

test("City Pop Archive: filtered results cannot mix audio albums into the Videos tab", () => {
  const data = { response: { numFound: 2, docs: [
    { identifier: "album", mediatype: "audio", title: "Studio album" },
    { identifier: "performance", mediatype: "movies", title: "Live performance" },
  ] } };
  assert.deepEqual(parseArchiveSearch(data, 2, "video").items.map((item) => item.id), ["performance"]);
  assert.deepEqual(parseArchiveSearch(data, 1, "audio").items.map((item) => item.id), ["album"]);
  assert.equal(parseArchiveSearch(data, 1, "all").items.length, 2);
  assert.throws(() => parseArchiveSearch(data, 1, "movies"), /Invalid Archive media filter/);
});

test("City Pop Archive: URL construction rejects traversal and preserves encoded track names", () => {
  assert.equal(archiveFileUrl("safe-item", "disc 1/01 - 曲.mp3"), "https://archive.org/download/safe-item/disc%201/01%20-%20%E6%9B%B2.mp3");
  for (const id of ["", ".", "..", "a/b", "https://evil.test", "item\n", "a".repeat(101)]) {
    assert.equal(validArchiveId(id), false);
    assert.throws(() => archiveFileUrl(id, "song.mp3"));
  }
  for (const name of ["", "/song.mp3", "song.mp3/", "../song.mp3", "disc/../../song.mp3", "disc/./song.mp3", "disc//song.mp3", "disc\\song.mp3", "song\n.mp3"]) assert.throws(() => archiveFileUrl("safe-item", name));
  assert.equal(archiveFileUrl("safe-item", "%2e%2e/song.mp3"), "https://archive.org/download/safe-item/%252e%252e/song.mp3");
});

test("City Pop Archive: prefer playable MP3 derivatives and retain numbered album order", () => {
  const tracks = parseArchiveTracks("test-album", album([
    file("02 - MUSIC BOOK.flac", { title: "MUSIC BOOK", track: "2" }),
    file("02 - MUSIC BOOK.mp3", { source: "derivative", original: "02 - MUSIC BOOK.flac", title: "MUSIC BOOK", track: "2", size: "7558556" }),
    file("01 - SPARKLE.flac", { title: "SPARKLE", artist: "山下達郎", track: "1/16" }),
    file("01 - SPARKLE.mp3", { source: "derivative", original: "01 - SPARKLE.flac", title: "SPARKLE", track: "1", size: "6152644" }),
    file("02 - MUSIC BOOK.ogg", { source: "derivative", original: "02 - MUSIC BOOK.mp3", title: "MUSIC BOOK", track: "2" }),
    file("cover.jpg"), file("metadata.xml"), file("subtitles.srt"),
  ]));
  assert.equal(tracks.length, 2);
  assert.deepEqual(tracks.map((track) => track.fileName), ["01 - SPARKLE.mp3", "02 - MUSIC BOOK.mp3"]);
  assert.equal(tracks[0].size, 6152644);
  assert.equal(tracks[0].artist, "山下達郎");
  assert.equal(tracks[0].mediaType, "audio");
  assert.equal(tracks[0].url, "https://archive.org/download/test-album/01%20-%20SPARKLE.mp3");
});

test("City Pop Archive: prefer browser MP4 and preserve source order without complete track numbers", () => {
  const tracks = parseArchiveTracks("test-album", album([
    file("concert.mp4", { title: "Concert", size: "49538281" }),
    file("concert.ia.mp4", { source: "derivative", original: "concert.mp4", format: "h.264 IA", size: "49538281" }),
    file("concert.webm", { source: "derivative", original: "concert.mp4" }),
    file("side-b.wav", { track: "1", size: "not-known" }),
    file("side-a.m4a", { track: "2" }),
  ], { mediatype: "movies", creator: ["Singer", "Band"] }));
  assert.deepEqual(tracks.map((track) => track.fileName), ["concert.ia.mp4", "side-b.wav", "side-a.m4a"]);
  assert.equal(tracks[0].mediaType, "video");
  assert.equal(tracks[0].artist, "Singer; Band");
  assert.equal(tracks[1].size, null);
  const discs = parseArchiveTracks("test-album", album([
    file("disc2.mp3", { track: "1", disc: "2/2" }), file("disc1.mp3", { track: "1", disc: "1/2" }),
  ]));
  assert.equal(discs[0].fileName, "disc1.mp3");
});

test("City Pop Archive: dark, restricted, private and unsupported files never become tracks", () => {
  const publicFile = file("song.mp3");
  for (const flag of ["is_dark", "access-restricted-item", "access_restricted", "private", "restricted"]) {
    assert.deepEqual(parseArchiveTracks("test-album", album([publicFile], { [flag]: "true" })), []);
    assert.deepEqual(parseArchiveTracks("test-album", { ...album([publicFile]), [flag]: true }), []);
    assert.deepEqual(parseArchiveTracks("test-album", album([{ ...publicFile, [flag]: 1 }])), []);
  }
  assert.deepEqual(parseArchiveTracks("test-album", album([
    file("private.flac", { private: "true" }), file("private.mp3", { source: "derivative", original: "private.flac" }),
    file("../song.mp3"), file("zero.mp3", { size: "0" }), file("script.mp3.exe"),
  ])), []);
  assert.deepEqual(parseArchiveTracks("wrong-id", album([publicFile])), []);
  assert.deepEqual(parseArchiveTracks("test-album", album([publicFile], { mediatype: "texts" })), []);
  // An item that no longer exists (Archive answers {}) has nothing to play.
  assert.deepEqual(parseArchiveTracks("test-album", {}), []);
});

test("City Pop Archive: an error answer or an item without its file list is unavailable, not empty", () => {
  const unavailable = (error) => error instanceof ArchiveUnavailableError && error.message === ARCHIVE_ITEM_UNAVAILABLE;
  for (const answer of [null, "html", [], { error: "Item storage offline" }, { ...album([file("song.mp3")]), error: "Temporary" }, { metadata: album([]).metadata }]) {
    assert.throws(() => parseArchiveTracks("test-album", answer), unavailable, JSON.stringify(answer));
  }
  // A dark or restricted item without files is still simply not playable.
  assert.deepEqual(parseArchiveTracks("test-album", { is_dark: true, metadata: album([]).metadata }), []);
});

test("City Pop Archive: file processing and outputs remain bounded", () => {
  const files = Array.from({ length: 5500 }, (_, i) => file(`song-${i}.mp3`));
  assert.equal(parseArchiveTracks("test-album", album(files)).length, 500);
});
