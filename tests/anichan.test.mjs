import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ANICHAN, AniChanError, aniChanMetadataUrl, aniChanSearchUrl, aniChanTitleUrl,
  isAniChanAnimeId, parseAniChanSearch, parseAniChanServers, parseAniChanTitle,
} from "../packages/shared/anichan.ts";

// Public response shapes captured on 20 Oct 2026. All signed media/caption
// locations were replaced with fixed, non-expiring example URLs.
const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/anichan-${name}.json`, import.meta.url), "utf8"));
const title = () => fixture("title");
const server = (extra = {}) => ({ name: "mirror", label: "Mirror", rank: 2, type: "hls", stream: "https://c.toroplay.cymru/api/watch/m3u8?token=fixture", ...extra });

test("AniChan: public URLs preserve AniList identity and encode search input", () => {
  assert.equal(aniChanTitleUrl(212888), "https://anichan.to/anime/212888/watch/1");
  assert.equal(aniChanMetadataUrl(1), "https://anichan.to/api/catalog/anime/1");
  assert.equal(aniChanSearchUrl("  Cowboy & Bebop  "), "https://anichan.to/api/suggest?q=Cowboy%20%26%20Bebop");
  for (const invalid of [0, -1, 1.5, "1", 2_147_483_648, Infinity, NaN, null]) {
    assert.equal(isAniChanAnimeId(invalid), false);
    assert.throws(() => aniChanTitleUrl(invalid), AniChanError);
    assert.throws(() => aniChanMetadataUrl(invalid), AniChanError);
  }
  assert.equal(ANICHAN.MAX_EPISODES, 5000);
});

test("AniChan: search results keep tracker IDs, names and catalogue metadata", () => {
  assert.deepEqual(parseAniChanSearch(fixture("search")), [{
    anilistId: 212888, malId: 64340, title: "Overgeared",
    poster: "https://anichan.to/media/catalogue/overgeared.jpg", episodes: 12, year: 2026, format: "ONA",
  }]);
  const row = fixture("search").results[0];
  assert.equal(parseAniChanSearch({ results: [null, { ...row, id: "1" }, row, { ...row, title: "Duplicate" }] }).length, 1);
  assert.equal(parseAniChanSearch({ results: [{ id: 1, titleRomaji: " Cowboy\nBebop ", poster: "http://unsafe.example/poster.jpg" }] })[0].title, "Cowboy Bebop");
  assert.equal(parseAniChanSearch({ results: [{ id: 1, title: "Bebop", poster: "https://127.0.0.1/p.jpg" }] })[0].poster, null);
  assert.throws(() => parseAniChanSearch({ detail: "error" }), AniChanError);
});

test("AniChan: airing titles list available episodes rather than the announced total", () => {
  const result = parseAniChanTitle(title(), 212888, { episodes: 12, dubAvailable: true });
  assert.equal(result.anilistId, 212888);
  assert.equal(result.malId, 64340);
  assert.equal(result.title, "Overgeared");
  assert.equal(result.year, 2026);
  assert.deepEqual(result.episodes.map((e) => e.number), [1, 2, 3, 4]);
  assert.deepEqual(result.episodes[0], {
    number: 1, title: "Legendary Class", snapshot: "https://anichan.to/media/episodes/1.jpg", sub: true, dub: true,
  });
  assert.throws(() => parseAniChanTitle(title(), 1), (error) => error instanceof AniChanError && /different show/.test(error.message));
});

test("AniChan: sparse language availability is unioned, sorted and validated", () => {
  const result = parseAniChanTitle({
    id: 1, title: "Bebop", episodes: 26,
    selfhost: { cached_sub: [3, 1, 1, 0, 1.5, "2", 5001], cached_dub: [2, 3], ep_titles: { 2: "Fallback title" } },
    available_eps: { sub: [5], hsub: [4], dub: [6] },
  }, 1);
  assert.deepEqual(result.episodes.map((e) => [e.number, e.sub, e.dub]), [
    [1, true, false], [2, false, true], [3, true, true], [4, true, false], [5, true, false], [6, false, true],
  ]);
  assert.equal(result.episodes[1].title, "Fallback title");
});

test("AniChan: explicit empty availability never revives unavailable or future episodes", () => {
  const metadata = { id: 1, title: "Bebop", episodes: 26, selfhost: { cached_eps: [] } };
  assert.deepEqual(parseAniChanTitle(metadata, 1, { episodes: 26 }).episodes, []);
  assert.deepEqual(parseAniChanTitle({ id: 1, title: "Bebop", episodes: 26 }, 1).episodes, []);
  assert.deepEqual(parseAniChanTitle({ id: 1, title: "Bebop" }, 1, { episodes: 2, sources: [{ sub: true, dub: true }], dubAvailable: true }).episodes, [
    { number: 1, title: null, snapshot: null, sub: true, dub: true },
    { number: 2, title: null, snapshot: null, sub: true, dub: true },
  ]);
  assert.deepEqual(parseAniChanTitle({ id: 1, title: "Bebop" }, 1, { episodes: 5001 }).episodes, []);
});

test("AniChan: decoded server fixtures retain captions, sub/dub choices and skip ranges", () => {
  const sub = parseAniChanServers(fixture("servers-overgeared-sub"), "sub", "fast");
  assert.equal(sub.length, 5);
  assert.equal(sub[0].name, "anikoto");
  assert.equal(sub[0].label, "vidstream · Sub");
  assert.equal(sub[0].id, '["sub","fast","anikoto",0]');
  assert.equal(sub[0].hls, true);
  assert.equal(sub[0].subtitles.length, 10);
  assert.equal(sub[0].subtitles[0].label, "English");
  assert.equal(sub[0].subtitles[0].default, true);
  assert.equal(sub[0].subtitles[0].kind, "subtitles");
  const bebop = parseAniChanServers(fixture("servers-bebop-sub"), "sub", "fast");
  assert.equal(bebop.at(-1).label, "echovideo · Hard sub");
  assert.deepEqual(bebop[0].intro, { start: 49, end: 144 });
  assert.deepEqual(bebop[0].outro, { start: 1357, end: 1451 });
  const dub = parseAniChanServers(fixture("servers-bebop-dub"), "dub", "fast");
  assert.equal(dub.length, 4);
  assert.equal(dub[0].label, "vidstream · Dub");
  assert.equal(dub[0].id, '["dub","fast","anikoto",0]');
});

test("AniChan: duplicate server identities remain tied to raw response order", () => {
  const result = parseAniChanServers({ servers: [
    server({ type: "embed", rank: 0 }),
    server({ rank: 8 }),
    server({ rank: 1, type: "mp4", stream: "/media/episode.mp4" }),
    server({ name: "tie", rank: 1 }),
  ] }, "sub", "rest");
  assert.deepEqual(result.map((s) => [s.name, s.occurrence, s.rank]), [["mirror", 2, 1], ["tie", 0, 1], ["mirror", 1, 8]]);
  assert.equal(result[0].id, '["sub","rest","mirror",2]');
  assert.equal(result[0].url, "https://anichan.to/media/episode.mp4");
  assert.equal(result[0].hls, false);
});

test("AniChan: embeds and untrusted media destinations are excluded", () => {
  const bad = [
    "http://anichan.to/media.m3u8", "https://anichan.to.evil.example/media.m3u8",
    "https://user:pass@anichan.to/media.m3u8", "https://anichan.to:444/media.m3u8",
    "https://c.toroplay.cymru/media.m3u8#secret", "https://127.0.0.1/media.m3u8",
    "https://192.168.0.1/media.m3u8", "https://[::1]/media.m3u8", "https://localhost/media.m3u8",
    "", "//evil.example/media.m3u8", "javascript:alert(1)", "file:///video.mp4", "https://anichan.to/with space.m3u8",
    "https://anichan.to\\@evil.example/media.m3u8",
  ];
  assert.deepEqual(parseAniChanServers({ servers: bad.map((stream) => server({ stream })) }, "sub", "fast"), []);
  assert.deepEqual(parseAniChanServers({ servers: [server({ type: "embed" })] }, "sub", "fast"), []);
  assert.equal(parseAniChanServers({ servers: [server({ stream: "https://anichan.to:443/video.m3u8" })] }, "sub", "fast")[0].url, "https://anichan.to/video.m3u8");
});

test("AniChan: captions accept only allowed WebVTT URLs and safe skip ranges", () => {
  const [result] = parseAniChanServers({ servers: [server({
    subtitles: [
      { lang: " English ", default: true, url: "/api/watch/vtt?fixture=1", ass: "/media/extra.ass" },
      { lang: "Duplicate", url: "/api/watch/vtt?fixture=1" },
      { lang: "French", url: "https://c.toroplay.cymru/subs/fr.VTT" },
      { lang: "ASS only", ass: "/media/english.ass" },
      { lang: "ASS URL", url: "/media/english.ass" },
      { lang: "Untrusted", url: "https://captions.example/english.vtt" },
      { lang: "Chapters", url: "/api/watch/chapters" },
    ],
    intro: { start: "0", end: 90 }, outro: { start: 1400, end: 86_400 },
  })] }, "sub", "fast");
  assert.deepEqual(result.subtitles, [
    { file: "https://anichan.to/api/watch/vtt?fixture=1", label: "English", default: true, kind: "subtitles" },
    { file: "https://c.toroplay.cymru/subs/fr.VTT", label: "French", default: false, kind: "subtitles" },
  ]);
  assert.equal(result.intro, null);
  assert.equal(result.outro, null);
});

test("AniChan: response limits bound results and text without mixing server identity", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, title: "x".repeat(500) }));
  assert.equal(parseAniChanSearch({ results: rows }).length, 40);
  assert.equal(parseAniChanSearch({ results: rows })[0].title.length, 300);
  const raw = Array.from({ length: 50 }, (_, i) => server({ name: `server-${i}`, rank: 50 - i,
    subtitles: Array.from({ length: 40 }, (_, j) => ({ lang: "x".repeat(100), url: `/captions/${j}.vtt` })),
  }));
  const result = parseAniChanServers({ servers: raw }, "sub", "fast");
  assert.equal(result.length, 32);
  assert.equal(result[0].name, "server-49");
  assert.equal(result[0].subtitles.length, 32);
  assert.equal(result[0].subtitles[0].label.length, 60);
});

test("AniChan: missing sessions and malformed responses produce clear local errors", () => {
  assert.deepEqual(parseAniChanServers({ servers: [] }, "sub", "fast"), []);
  assert.throws(() => parseAniChanServers({ detail: "session" }, "sub", "fast"), (e) => e instanceof AniChanError && /Connect AniChan/.test(e.message));
  for (const value of [null, [], {}, { servers: "encoded" }]) {
    assert.throws(() => parseAniChanServers(value, "sub", "fast"), AniChanError);
  }
  assert.throws(() => parseAniChanServers({ servers: [] }, "hsub", "fast"), AniChanError);
  assert.throws(() => parseAniChanServers({ servers: [] }, "sub", "all"), AniChanError);
});
