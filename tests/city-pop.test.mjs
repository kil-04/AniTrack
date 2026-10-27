import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

// Match the desktop main compiler's CommonJS JSON import without a generated test tree.
const moduleUrl = new URL("../packages/shared/city-pop.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(moduleUrl, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true },
}).outputText;
const shared = { exports: {} };
new Function("exports", "require", "module", compiled)(shared.exports, createRequire(moduleUrl), shared);
const {
  CITY_POP_TRACKS: tracks, CITY_POP_STATIONS: stations, CITY_POP_SEARCH_UNAVAILABLE, validateCityPopCatalog, filterCityPop, cityPopQueue, cityPopWatchUrl,
  cityPopThumbnail, parseCityPopSearch, parseCityPopSavedTracks, cityPopCanonical, cityPopFavorites, cityPopPlayOrder,
} = shared.exports;

const clone = () => JSON.parse(JSON.stringify(tracks));

test("City Pop: shared catalog has unique curated records and each station has music", () => {
  assert.ok(tracks.length >= 8);
  assert.deepEqual(validateCityPopCatalog(clone()), tracks);
  assert.equal(new Set(tracks.map((track) => track.id)).size, tracks.length);
  assert.equal(new Set(tracks.map((track) => track.videoId)).size, tracks.length);
  assert.ok(Object.isFrozen(tracks));
  assert.ok(Object.isFrozen(tracks[0]));
  assert.ok(Object.isFrozen(tracks[0].moods));
  for (const station of stations) assert.ok(filterCityPop(tracks, "", station.id).length > 0);
});

test("City Pop: catalog rejects malformed metadata, duplicate identities and unsafe links", () => {
  for (const invalid of [null, {}, [], Array(101).fill(tracks[0])]) assert.throws(() => validateCityPopCatalog(invalid));
  const patches = [
    { id: "../bad" }, { id: "a".repeat(81) }, { videoId: "https://bad" },
    { title: " " }, { artist: 42 }, { channel: null }, { note: "" },
    { year: 1899 }, { year: 2101 }, { year: 1983.5 }, { year: "1983" },
    { moods: [] }, { moods: ["unknown"] }, { moods: ["sunset", "sunset"] },
    { sourceUrl: "https://youtube.com.evil.test/watch?v=" + tracks[0].videoId },
    { sourceUrl: tracks[0].sourceUrl + "&redirect=https://evil.test" },
  ];
  for (const patch of patches) assert.throws(() => validateCityPopCatalog([{ ...tracks[0], ...patch }]), JSON.stringify(patch));
  assert.throws(() => validateCityPopCatalog([tracks[0], { ...tracks[1], id: tracks[0].id }]));
  assert.throws(() => validateCityPopCatalog([tracks[0], { ...tracks[1], videoId: tracks[0].videoId, sourceUrl: tracks[0].sourceUrl }]));
  assert.throws(() => validateCityPopCatalog([null]));
});

test("City Pop: search combines words, moods and favorites without reordering the catalog", () => {
  const anri = filterCityPop(tracks, "  anri   summer ", "all");
  assert.ok(anri.length >= 2);
  assert.ok(anri.every((track) => track.artist === "ANRI" && /summer/i.test(track.title)));
  assert.deepEqual(filterCityPop(tracks, "", "all", []), []);
  assert.deepEqual(filterCityPop(tracks, "", "all", [tracks[3].id, tracks[0].id]), [tracks[0], tracks[3]]);
  assert.deepEqual(filterCityPop(tracks, "", "all", null), tracks);
  assert.deepEqual(filterCityPop(tracks, "impossible track query", "all"), []);
  assert.ok(filterCityPop(tracks, "universal", "all").length >= 1);
  const accented = [{ ...tracks[0], title: "Café Night", artist: "ＡＮＲＩ" }];
  assert.equal(filterCityPop(accented, "cafe anri", "all").length, 1);
  const afterHours = filterCityPop(tracks, "", "after-hours", tracks.map((track) => track.id));
  assert.ok(afterHours.every((track) => track.moods.includes("after-hours")));
});

test("City Pop: URL helpers accept curated records and build a bounded native player queue", () => {
  const chosen = [tracks[0], tracks[1], tracks[2]];
  assert.deepEqual(cityPopQueue(chosen.map((track) => track.id)), chosen);
  assert.equal(cityPopWatchUrl(tracks[0]), tracks[0].sourceUrl);
  assert.equal(cityPopThumbnail(tracks[0]), `https://i.ytimg.com/vi/${tracks[0].videoId}/hqdefault.jpg`);
});

test("City Pop: queues play once from the chosen track, each video once and at most 100", () => {
  const [a, b, c] = tracks;
  assert.deepEqual(cityPopPlayOrder([a, b, c], b.id), [b, c, a]);
  assert.deepEqual(cityPopPlayOrder([a, b, c]), [a, b, c]);
  assert.deepEqual(cityPopPlayOrder([a, b, c], "not-in-the-list"), [a, b, c]);
  const result = { ...b, id: `youtube-${b.videoId}`, year: null, moods: [], note: "YouTube search result" };
  assert.deepEqual(cityPopPlayOrder([a, result, b, c], c.id), [c, a, result]);
  const many = Array.from({ length: 120 }, (_, i) => ({ ...a, id: `youtube-${String(i).padStart(11, "v")}`, videoId: String(i).padStart(11, "v") }));
  assert.equal(cityPopPlayOrder(many, many[50].id).length, 100);
  assert.equal(cityPopPlayOrder(many, many[50].id)[0], many[50]);
  assert.deepEqual(cityPopPlayOrder([]), []);
});

test("City Pop: a search result for a curated song is that song, favorited once under its catalog id", () => {
  const plastic = tracks.find((track) => track.id === "mariya-takeuchi-plastic-love");
  const result = { id: `youtube-${plastic.videoId}`, title: "Plastic Love (Official Music Video)", artist: "Mariya Takeuchi", year: null, videoId: plastic.videoId, channel: "Mariya Takeuchi", moods: [], note: "YouTube search result", sourceUrl: plastic.sourceUrl };
  assert.equal(cityPopCanonical(result), plastic);
  const other = { ...result, id: "youtube-abcdefghijk", videoId: "abcdefghijk", sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk" };
  assert.equal(cityPopCanonical(other), other);
  assert.equal(cityPopCanonical(plastic), plastic);
  // Stored favorites: curated stay, an old search-result id of a curated video becomes its catalog id,
  // saved results stay, anything unknown is dropped, each song once.
  assert.deepEqual(cityPopFavorites([plastic.id, result.id, other.id, "youtube-zzzzzzzzzzz", "gone", 42, tracks[0].id], [other]), [plastic.id, other.id, tracks[0].id]);
  assert.deepEqual(cityPopFavorites(null, [other]), []);
});

test("City Pop: playback rejects invalid videos, injected input and duplicate queues", () => {
  for (const invalid of [null, {}, [], [42], ["not-curated"], ["youtube-short"], ["youtube-abcdefghijk?x=1"], [`https://www.youtube.com/watch?v=${tracks[0].videoId}`], [tracks[0].id, tracks[0].id], Array(101).fill(tracks[0].id)]) assert.throws(() => cityPopQueue(invalid));
  // The same video under its catalog id and as a search result plays once (the first wins).
  assert.deepEqual(cityPopQueue([tracks[1].id, `youtube-${tracks[1].videoId}`, tracks[2].id]), [tracks[1], tracks[2]]);
  assert.deepEqual(cityPopQueue([`youtube-${tracks[1].videoId}`]), [tracks[1]]);
  assert.throws(() => cityPopWatchUrl({ ...tracks[0], videoId: tracks[1].videoId }));
  assert.throws(() => cityPopThumbnail({ ...tracks[0], id: "unknown" }));
  assert.equal(cityPopWatchUrl({ ...tracks[0], sourceUrl: "https://evil.test" }), tracks[0].sourceUrl);
});

const video = (id = "abcdefghijk", extra = {}) => ({ videoRenderer: {
  videoId: id, title: { runs: [{ text: 'A title with } braces and "quotes"' }] },
  ownerText: { runs: [{ text: "Artist Official" }] }, ...extra,
} });
// The shape of YouTube's desktop results page (trimmed).
const resultsData = (rows, extra = {}) => ({ estimatedResults: String(rows.length), contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: rows } }] } } } }, ...extra });
const searchPage = (rows) => `<html><script>var ytInitialData = ${JSON.stringify(resultsData(rows))};</script></html>`;

test("City Pop: online search parses only ordinary video metadata in page order", () => {
  const html = searchPage([
    video(), video(), video("bcdefghijkl", { title: { simpleText: "Second song" }, ownerText: undefined, longBylineText: { runs: [{ text: "Label" }] } }),
    video("cdefghijklm", { badges: [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_LIVE_NOW" } }] }),
    video("defghijklmn", { thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { style: "UPCOMING" } }] }),
    video("efghijklmno", { upcomingEventData: { startTime: "1000" } }),
    video("fghijklmnop", { navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: "/shorts/fghijklmnop" } } } }),
    { reelShelfRenderer: { items: [video("ghijklmnopq")] } },
    { channelRenderer: { videoId: "hijklmnopqr", title: { simpleText: "Not a video" } } },
    video("bad"), video("ijklmnopqrs", { ownerText: { simpleText: "" } }),
  ]);
  const result = parseCityPopSearch(html);
  assert.equal(result.length, 2);
  assert.equal(result[0].title, 'A title with } braces and "quotes"');
  assert.equal(result[0].id, "youtube-abcdefghijk");
  assert.equal(result[0].artist, "Artist Official");
  assert.equal(result[0].channel, "Artist Official");
  assert.equal(result[0].year, null);
  assert.deepEqual(result[0].moods, []);
  assert.equal(result[0].sourceUrl, "https://www.youtube.com/watch?v=abcdefghijk");
  assert.equal(result[1].channel, "Label");
  assert.deepEqual(parseCityPopSearch(html.replace("var ytInitialData", 'window["ytInitialData"]')), result);
});

test("City Pop: search parser bounds results and refuses nonliteral, broken or unknown pages", () => {
  // Never "no matches" for a page it couldn't read: consent/check pages, broken or script data, other layouts.
  const unreadable = [
    "not a page", "var ytInitialData = {bad};", "var ytInitialData = JSON.parse('anything');", "var ytInitialData = {\"broken\":\"unterminated",
    "x".repeat(4 * 1024 * 1024 + 1), 'var ytInitialData = {"contents":{}};', 'var ytInitialData = {"responseContext":{}};',
    `var ytInitialData = ${JSON.stringify(resultsData([{ lockupViewModel: { contentId: "abcdefghijk" } }]))};`,
  ];
  for (const html of unreadable) assert.throws(() => parseCityPopSearch(html), (error) => error.message === CITY_POP_SEARCH_UNAVAILABLE, html.slice(0, 60));
  const rows = Array.from({ length: 25 }, (_, i) => video(String(i).padStart(11, "a")));
  assert.equal(parseCityPopSearch(searchPage(rows)).length, 20);
  // A real results page with nothing playable is an honest empty search.
  assert.deepEqual(parseCityPopSearch(searchPage([video("abcdefghijk", { title: { simpleText: "x".repeat(201) } })])), []);
  assert.deepEqual(parseCityPopSearch(searchPage([])), []);
  assert.deepEqual(parseCityPopSearch(`var ytInitialData = ${JSON.stringify({ contents: { sectionListRenderer: { contents: [] } } })};`), []);
});

test("City Pop: saved search favorites are metadata only and stay playable after a restart", () => {
  const [record] = parseCityPopSearch(searchPage([video()]));
  assert.deepEqual(parseCityPopSavedTracks([record, record]), [record]);
  assert.deepEqual(parseCityPopSavedTracks(null), []);
  const invalid = [
    { ...record, id: "made-up" }, { ...record, year: 1983 }, { ...record, moods: ["sunset"] },
    { ...record, title: "x".repeat(201) }, { ...record, note: "x".repeat(501) },
    { ...record, sourceUrl: "https://evil.test" }, null,
  ];
  assert.deepEqual(parseCityPopSavedTracks(invalid), []);
  assert.equal(cityPopWatchUrl(record), record.sourceUrl);
  assert.equal(cityPopThumbnail(record), "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg");
  // The player gets the saved metadata from the page; without it the video still plays under a stand-in name.
  assert.deepEqual(cityPopQueue([record.id], parseCityPopSavedTracks([record])), [record]);
  const [standIn] = cityPopQueue([record.id]);
  assert.equal(standIn.videoId, "abcdefghijk");
  assert.equal(standIn.title, "YouTube video");
});
