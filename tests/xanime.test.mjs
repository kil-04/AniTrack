import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isXanimeId,
  isXanimeMediaUrl,
  parseXanimeEpisodes,
  parseXanimeShow,
  parseXanimeShows,
  parseXanimeStreams,
  xanimeEpisodeUrl,
  xanimeSearchUrl,
  xanimeStreamLabel,
} from "../packages/shared/xanime.ts";

// Pages from xanime.me (3 Nov 2026), reduced to their Qwik state; stream signatures blanked.
const fixture = (name) => readFileSync(new URL(`./fixtures/xanime/${name}`, import.meta.url), "utf-8");

test("search results carry each show's AniList and MAL ids, year, type and episode counts", () => {
  const shows = parseXanimeShows(fixture("search.html"));
  assert.deepEqual(shows.map((s) => [s.id, s.anilistId, s.malId, s.year, s.type, s.episodes, s.subCount, s.dubCount]), [
    ["91594", 1, 1, 1998, "TV", 26, 26, 26],
    ["94002", 5, 5, 2001, "MOVIE", 1, 1, 1],
  ]);
  assert.equal(shows[0].title, "Cowboy Bebop");
  assert.equal(shows[0].latestEpisodeId, "31962046");
  assert.equal(shows[0].adult, false);
  assert.match(shows[0].poster, /^https:\/\/s4\.anilist\.co\//);
  assert.equal(xanimeSearchUrl("  cowboy bebop "), "https://xanime.me/search?word=cowboy%20bebop");
});

test("an episode page lists its show's episodes in order, with the show's total", () => {
  const list = parseXanimeEpisodes(fixture("episode.html"), "91594");
  assert.equal(list.total, 26);
  assert.equal(list.episodes.length, 26);
  assert.deepEqual(list.episodes[0], { id: "31962021", number: 1, title: "Episode 1" });
  assert.deepEqual(list.episodes.at(-1), { id: "31962046", number: 26, title: "Episode 26" });
  assert.equal(list.show.anilistId, 1);
  assert.deepEqual(parseXanimeEpisodes(fixture("episode.html"), "123").episodes, [], "another show's id lists nothing");
});

test("a long show's page holds only the 50-episode page around its episode", () => {
  const list = parseXanimeEpisodes(fixture("episode-long.html"), "88514");
  assert.equal(list.total, 1180);
  assert.equal(list.episodes.length, 30);
  assert.equal(list.episodes[0].number, 1151);
  assert.equal(list.episodes.at(-1).number, 1180);
  assert.equal(parseXanimeShow(fixture("episode-long.html"), "88514").anilistId, 21);
});

test("an episode's sub and dub streams come with captions and skip times", () => {
  const streams = parseXanimeStreams(fixture("episode.html"), "31962021");
  assert.deepEqual(streams.map((s) => [s.id, s.language, s.server]), [["835924", "sub", null], ["835925", "dub", null]]);
  assert.match(streams[0].url, /^https:\/\/xanivsrc5\.org\/media\/s1v\/810\/84018\/a-master\.m3u8\?/);
  assert.deepEqual(streams[0].subtitles.map((s) => [s.label, s.kind, s.default]), [["English", "captions", true]]);
  assert.match(streams[0].subtitles[0].file, /^https:\/\/xanivsrc3\.org\/media\/.+\.vtt\?/);
  assert.deepEqual(streams[0].intro, { start: 49, end: 144 });
  assert.deepEqual(streams[0].outro, { start: 1357, end: 1451 });
  assert.deepEqual(streams.map((s) => xanimeStreamLabel(s, streams)), ["Sub", "Dub"]);
  assert.deepEqual(parseXanimeStreams(fixture("episode.html"), "31962046"), [], "only the page's own episode has streams");
});

test("a hard-subbed stream names its server and has no captions or skip times", () => {
  const [stream, ...rest] = parseXanimeStreams(fixture("episode-hardsub.html"), "32070822");
  assert.equal(rest.length, 0);
  assert.equal(stream.language, "sub");
  assert.equal(stream.server, "Vidplay");
  assert.deepEqual(stream.subtitles, []);
  assert.equal(stream.intro, null);
  assert.equal(xanimeStreamLabel(stream, [stream]), "Sub · Vidplay");
});

test("ids, routes and media hosts", () => {
  assert.equal(isXanimeId("91594"), true);
  for (const bad of ["0", "-1", "91594-cowboy-bebop", "99999999999", 91594]) assert.equal(isXanimeId(bad), false, String(bad));
  assert.equal(xanimeEpisodeUrl("91594", "31962021"), "https://xanime.me/title/91594/31962021");
  assert.equal(isXanimeMediaUrl("https://xanivsrc10.org/media/s1v/071/84170/a-master.m3u8?slug=x&e=1&s=y"), true);
  for (const bad of [
    "http://xanivsrc10.org/media/a.m3u8",
    "https://xanivsrc10.org/other/a.m3u8",
    "https://xanivsrc10.org.evil.com/media/a.m3u8",
    "https://user@xanivsrc10.org/media/a.m3u8",
    "https://xanivsrc10.org:8443/media/a.m3u8",
  ]) assert.equal(isXanimeMediaUrl(bad), false, bad);
  assert.deepEqual(parseXanimeShows("<html>no state</html>"), []);
  assert.deepEqual(parseXanimeStreams('<script type="qwik/json">{not json</script>', "1"), []);
});
