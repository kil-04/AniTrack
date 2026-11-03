import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isWeebCentralId,
  isWeebCentralImage,
  weebCentralChapterNumber,
  weebCentralChapters,
  weebCentralDetail,
  weebCentralImagesUrl,
  weebCentralLatest,
  weebCentralPages,
  weebCentralSearchIds,
  weebCentralSearchUrl,
} from "../packages/shared/weebcentral.ts";
import { isSourceChapterId, sourceMatches } from "../packages/shared/manga.ts";

const fixture = (name) => readFileSync(new URL(`./fixtures/weebcentral/${name}`, import.meta.url), "utf-8");

test("search lists series ids in the site's order, once each", () => {
  assert.deepEqual(weebCentralSearchIds(fixture("search.html")), [
    "01J76XY7EF75DJNQCV04HTPDZK",
    "01J76XYCHM8SEKG7J7Z594YCKD",
    "01M02S1JJEE1AB149Y5RP577RG",
  ]);
  assert.match(weebCentralSearchUrl("  Sousou no Frieren "), /\/search\/data\?author=&text=Sousou%20no%20Frieren&sort=Best\+Match/);
});

test("a series page gives its AniList id, year, country and newest chapter", () => {
  const detail = weebCentralDetail(fixture("series.html"), "01J76XYDGDQERFSK333582BNBZ");
  assert.equal(detail.title, "Frieren - Beyond Journey's End");
  assert.equal(detail.anilistId, 118586);
  assert.equal(detail.year, 2020);
  assert.equal(detail.country, "JP");
  assert.equal(detail.adult, false);
  assert.equal(detail.latestChapter, 147);
  assert.equal(detail.latestAt, Date.parse("2025-10-15T01:02:34.107Z"));
  assert.deepEqual(weebCentralLatest(fixture("series.html")), { chapter: 147, at: Date.parse("2025-10-15T01:02:34.107Z") });

  const frieren = { id: 118586, malId: 126287, title: "Frieren", titleRomaji: "Sousou no Frieren", year: 2020, country: "JP" };
  assert.equal(sourceMatches(detail, frieren), true);
  assert.equal(sourceMatches(detail, { ...frieren, id: 1 }), false, "a different AniList id is a rejection");
  assert.equal(weebCentralDetail(fixture("series.html"), "not-a-ulid"), null);

  // "Adult Content: Yes" (Berserk's violence) doesn't block an AniList-linked match; unlinked, it does.
  const flagged = fixture("series.html").replace('search?adult=False" class="link link-info link-hover">No', 'search?adult=True" class="link link-info link-hover">Yes');
  assert.equal(weebCentralDetail(flagged, "01J76XYDGDQERFSK333582BNBZ").adult, false);
  assert.equal(weebCentralDetail(flagged.replace(/anilist\.co\/manga\/\d+/g, ""), "01J76XYDGDQERFSK333582BNBZ").adult, true);
});

test("the full chapter list keeps every chapter and files prologues before chapter 1", () => {
  const list = weebCentralChapters(fixture("chapter-list.html"));
  assert.deepEqual(list.map((c) => c.number), [386, 385, 0.02, 0.01]);
  assert.equal(list[0].id, "01KX4BFP5E3FEZ50TRS752CT9V");
  assert.ok(list.every((c) => isWeebCentralId(c.id) && isSourceChapterId("weebcentral", c.id)));
  assert.ok(list.every((c) => typeof c.uploadedAt === "number"));
});

test("chapter labels", () => {
  assert.equal(weebCentralChapterNumber("Chapter 1197"), 1197);
  assert.equal(weebCentralChapterNumber("Chapter 12.5"), 12.5);
  assert.equal(weebCentralChapterNumber("Episode 40"), 40);
  assert.equal(weebCentralChapterNumber("Prologue 16"), 0.16);
  assert.equal(weebCentralChapterNumber("Special"), null);
  assert.equal(weebCentralChapterNumber("Volume 3 Extra"), null);
});

test("chapter pages come in order, only from Weeb Central's image hosts", () => {
  const pages = weebCentralPages(fixture("chapter-images.html"));
  assert.equal(pages.length, 19);
  assert.equal(pages[0], "https://hot.planeptune.us/manga/Berserk/Part2/0188-001.png");
  assert.equal(pages[18], "https://hot.planeptune.us/manga/Berserk/Part2/0188-019.png");
  const injected = weebCentralPages('<img src="https://evil.example/manga/a.png"><img src="https://scans.lastation.us/manga/A/1-001.png">');
  assert.deepEqual(injected, ["https://scans.lastation.us/manga/A/1-001.png"]);
  assert.match(weebCentralImagesUrl("01J76XZ4MH88Z971ZFBVWVCRBZ"), /\/chapters\/01J76XZ4MH88Z971ZFBVWVCRBZ\/images\?is_prev=False&current_page=1&reading_style=long_strip$/);
});

test("image host rules", () => {
  for (const ok of ["https://scans-hot.planeptune.us/manga/One-Piece/1197-001.png", "https://official.lowee.us/manga/X/1-001.png", "https://scans.lastation.us/manga/X/1-001.png"]) {
    assert.equal(isWeebCentralImage(new URL(ok)), true, ok);
  }
  for (const bad of ["http://scans.lastation.us/manga/X/1.png", "https://scans.lastation.us/cover/X.png", "https://planeptune.us.evil.com/manga/x.png", "https://a.b.planeptune.us/manga/x.png", "https://scans.lastation.us:8443/manga/x.png"]) {
    assert.equal(isWeebCentralImage(new URL(bad)), false, bad);
  }
});
