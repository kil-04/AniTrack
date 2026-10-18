import test from "node:test";
import assert from "node:assert/strict";
import {
  parseShonenEpisodeCount,
  parseShonenSearch,
  parseShonenSources,
  ShonenError,
  shonenSourcesUrl,
} from "../packages/shared/shonen.ts";

// Shapes copied from shonen.to on 19 Oct 2026 (trimmed).
const SEARCH = `<div class="grid"><a class="card" href="/anime/154587" title="Frieren: Beyond Journey&#39;s End"><div class="poster" style="--c:#bbf1a1"><img loading="lazy" decoding="async" width="230" height="326" src="/media/catalogue/07/070a.jpg" alt="poster"><span class="pill ep">EP 28</span><span class="pill score">9.1</span></div><div class="ct">Frieren: Beyond Journey’s End</div><div class="cm">TV / 2023</div></a><a class="card" href="/anime/182255" title="Frieren: Beyond Journey’s End Season 2"><div class="poster"><img src="/media/catalogue/54/5417.jpg"><span class="pill ep">EP 10</span><span class="pill score">8.7</span></div><div class="ct">x</div><div class="cm">TV / 2026</div></a><a class="card" href="/anime/154587" title="duplicate"></a><a class="card" href="/anime/abc" title="bad id"></a></div>`;

test("shonen: search cards give AniList ids, titles, episodes and years", () => {
  const results = parseShonenSearch(SEARCH);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    anilistId: 154587,
    title: "Frieren: Beyond Journey's End",
    poster: "https://shonen.to/media/catalogue/07/070a.jpg",
    episodes: 28,
    score: 9.1,
    format: "TV",
    year: 2023,
  });
  assert.equal(results[1].anilistId, 182255);
  assert.equal(results[1].episodes, 10);
});

test("shonen: episode count from the Follow button, else the facts list", () => {
  assert.equal(parseShonenEpisodeCount('<button class="btn fbtn big" data-id="21" data-t="ONE PIECE" data-eps="1180">Follow</button>'), 1180);
  assert.equal(parseShonenEpisodeCount("<dl><dt>Format</dt><dd>TV</dd><dt>Episodes</dt><dd>12</dd></dl>"), 12);
  assert.equal(parseShonenEpisodeCount("<p>nothing</p>"), null);
});

test("shonen: sources give the HLS url, subtitles and skip ranges", () => {
  const stream = parseShonenSources({
    data: {
      provider: "shonen",
      source: "https://vidcloud.sbs/api/proxy/m3u8?t=A",
      sources: [{ file: "https://vidcloud.sbs/api/proxy/m3u8?t=A", type: "hls", label: "Primary", tracks: [] }],
      tracks: [
        { file: "https://vidcloud.sbs/api/proxy/vtt?t=B", label: "English", kind: "subtitles", default: true },
        { file: "http://insecure.example/x.vtt", label: "Bad", kind: "subtitles" },
        { file: "https://vidcloud.sbs/thumbs.vtt", label: "Thumbs", kind: "thumbnails" },
      ],
      intro: { start: 11, end: 101 },
      outro: null,
      expiresAt: "2026-10-18T22:05:27.279Z",
    },
  });
  assert.equal(stream.url, "https://vidcloud.sbs/api/proxy/m3u8?t=A");
  assert.deepEqual(stream.subtitles, [{ file: "https://vidcloud.sbs/api/proxy/vtt?t=B", label: "English", kind: "subtitles", default: true }]);
  assert.deepEqual(stream.intro, { start: 11, end: 101 });
  assert.equal(stream.outro, null);
  assert.equal(stream.expiresAt, Date.parse("2026-10-18T22:05:27.279Z"));
});

test("shonen: a missing episode is a clear not-found, other errors stay generic", () => {
  assert.throws(
    () => parseShonenSources({ error: { code: "SOURCE_NOT_FOUND", message: "No compatible Shonen stream is available." } }),
    (e) => e instanceof ShonenError && e.notFound && /no stream for this episode/.test(e.message),
  );
  assert.throws(() => parseShonenSources({ error: { code: "UPSTREAM", message: "<script>" } }), (e) => e instanceof ShonenError && !e.notFound);
  assert.throws(() => parseShonenSources({ data: { sources: [{ file: "javascript:alert(1)", type: "hls" }] } }), ShonenError);
});

test("shonen: source URLs only for valid ids, episodes and languages", () => {
  assert.equal(shonenSourcesUrl(21, 1150, "dub"), "https://shonen.to/sources/shonen?id=21&episode=1150&language=dub");
  assert.throws(() => shonenSourcesUrl(0, 1, "sub"), ShonenError);
  assert.throws(() => shonenSourcesUrl(21, 1.5, "sub"), ShonenError);
});
