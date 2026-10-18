import test from "node:test";
import assert from "node:assert/strict";
import {
  authorsMatch,
  chapterKey,
  decodeEntities,
  dropRepeatedHeading,
  htmlToParagraphs,
  isChapterFinished,
  isNovelChapterId,
  isNovelTitleId,
  novelArchiveChapters,
  novelArchiveChapterText,
  novelArchiveDetail,
  novelArchiveSearch,
  novelArchiveSearchUrl,
  novelBuddyChapters,
  novelBuddyChapterText,
  novelBuddyDetail,
  novelBuddyHome,
  novelBuddySearch,
  novelBuddySearchUrl,
  novelResumeTarget,
  progressFor,
  rankNovelMatches,
  sameNovel,
  textToParagraphs,
} from "../packages/shared/novel.ts";

// Synthetic responses shaped like the sources' JSON APIs (no saved site content).
const nbTitle = (over = {}) => ({
  id: "AbC123xY", name: "Example Saga", slug: "example-saga", cover: "https://rs.novelbuddy.me/covers/x.png",
  status: "OnGoing", rating: 4.5, stats: { chapters_count: 3 }, genres: [{ name: "Fantasy" }, { name: "Fantasy" }, { name: "Action" }],
  is_mtl: false, ...over,
});

test("NovelBuddy search keeps ids case-sensitive and flags machine translations", () => {
  const page = novelBuddySearch({
    success: true,
    data: {
      items: [nbTitle(), nbTitle({ id: "abc123xy", name: "MTL-Other Story" }), { id: "../bad", name: "Nope" }],
      pagination: { has_next: true },
    },
  });
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].id, "AbC123xY");
  assert.deepEqual(page.items[0].genres, ["Fantasy", "Action"]);
  assert.equal(page.items[0].status, "ongoing");
  assert.equal(page.items[1].id, "abc123xy");
  assert.equal(page.items[1].mtl, true);
  assert.equal(page.hasNextPage, true);
});

test("NovelBuddy home rows leave machine translations out", () => {
  const home = novelBuddyHome({
    success: true,
    data: { trending: [nbTitle(), nbTitle({ id: "Zz9", name: "x" }), nbTitle({ id: "Mtl12345", is_mtl: true })], popular: [], latest: { items: [] } },
  });
  // "Zz9" is too short to be a NovelBuddy id, the MTL one is hidden.
  assert.deepEqual(home.trending.map((c) => c.id), ["AbC123xY"]);
});

test("NovelBuddy errors surface the API's message", () => {
  assert.throws(() => novelBuddySearch({ success: false, message: "Sort field must be one of: views" }), /Sort field/);
});

test("NovelBuddy detail splits alt names, dedupes authors, ignores the embedded newest-chapters list", () => {
  const detail = novelBuddyDetail({
    success: true,
    data: {
      title: nbTitle({
        alt_names: [{ name: "예시,ES" }, { name: "Example Saga" }],
        authors: [{ name: "Park Writer" }, { name: "Park Writer" }],
        summary: "<p>A hero&rsquo;s tale</p><p>Second <b>line</b></p>",
        stats: { chapters_count: 2060 },
        latest_chapters: [{ id: "Newest99", name: "Chapter 2059", number: null, updated_at: "2025-02-21T18:37:52.000Z" }],
        chapters: Array.from({ length: 50 }, (_, i) => ({ id: `Chap${i}x`, name: `Chapter ${i}` })),
      }),
    },
  });
  assert.deepEqual(detail.altNames, ["예시", "ES"]);
  assert.equal(detail.author, "Park Writer");
  assert.equal(detail.synopsis, "A hero’s tale\nSecond line");
  assert.equal(detail.chapters, 2060);
  assert.equal(detail.url, "https://novelbuddy.me/example-saga");
  assert.deepEqual(detail.latest, { count: 2060, label: "Chapter 2059", at: Date.parse("2025-02-21T18:37:52.000Z") });
});

test("NovelBuddy trending items: genres from slugs, blurb as plain text", () => {
  const home = novelBuddyHome({
    success: true,
    data: { trending: [nbTitle({ genres: undefined, genre_slugs: ["sci-fi", "martial-arts"], summary: "<p>Growing up&nbsp;poor.</p>" })], popular: [], latest: { items: [] } },
  });
  assert.deepEqual(home.trending[0].genres, ["Sci fi", "Martial arts"]);
  assert.equal(home.trending[0].synopsis, "Growing up poor.");
});

test("NovelBuddy chapters come back in reading order, positions apart from printed labels", () => {
  const list = novelBuddyChapters({
    success: true,
    data: {
      chapters: [
        { id: "Ccc33333", name: "Chapter 770", number: 772 },
        { id: "Bbb22222", name: "Chapter 769.5", number: 771 },
        { id: "Aaa11111", name: "Chapter 769", number: 770 },
        { id: "Aaa11111", name: "Chapter 769 (dupe)", number: 770 },
      ],
    },
  });
  assert.deepEqual(list.map((c) => [c.id, c.order, c.label]), [
    ["Aaa11111", 0, "Chapter 769"],
    ["Bbb22222", 1, "Chapter 769.5"],
    ["Ccc33333", 2, "Chapter 770"],
  ]);
});

test("NovelBuddy chapter text: tags and scripts never survive, a repeated heading is dropped", () => {
  const text = novelBuddyChapterText({
    success: true,
    data: {
      chapter: {
        id: "Aaa11111",
        name: "Chapter 1",
        content: "<p>Chapter 1</p><p>He said &ldquo;hi&rdquo;</p><br><script>alert(1)</script><p onclick=\"x()\">Next&nbsp;&nbsp;line<img src=x onerror=y></p><p>&#x1F600; &#39;q&#39;</p>",
      },
    },
  });
  assert.equal(text.label, "Chapter 1");
  assert.deepEqual(text.paragraphs, ["He said “hi”", "Next line", "😀 'q'"]);
});

test("NovelArchive positions are the request ids; labels can skip or repeat", () => {
  const response = {
    novel: {
      id: "6a1637414f942c668d69a5a9", title: "Example Saga", author: "Writer", total_chapters: "4",
      cover_url: "/api/novels/6a1637414f942c668d69a5a9/cover?w=640", release_status: "completed",
      genres: "Action, Fantasy", associated_names: ["ES"], description: "About", rating: 5, rating_count: 0,
      chapter_names: ["Chapter 1", "Chapter 1.5", "Chapter 3", "Chapter 3 (Teaser)"],
    },
  };
  const chapters = novelArchiveChapters(response);
  assert.deepEqual(chapters.map((c) => [c.id, c.label]), [["1", "Chapter 1"], ["2", "Chapter 1.5"], ["3", "Chapter 3"], ["4", "Chapter 3 (Teaser)"]]);
  const detail = novelArchiveDetail(response);
  assert.equal(detail.cover, "https://novelarchive.cc/api/novels/6a1637414f942c668d69a5a9/cover?w=640");
  assert.equal(detail.status, "completed");
  assert.deepEqual(detail.genres, ["Action", "Fantasy"]);
  assert.equal(detail.rating, null, "a rating nobody gave is not a 5");
  assert.equal(detail.chapters, 4);
});

test("NovelArchive chapter text is split by line", () => {
  const text = novelArchiveChapterText({ chapter: { number: 2, name: "Chapter 1.5", content: "Chapter 1.5\nFirst\n\n  Second  \r\nThird" } }, "2");
  assert.deepEqual(text, { id: "2", label: "Chapter 1.5", paragraphs: ["First", "Second", "Third"] });
});

test("NovelArchive search rejects an unexpected shape", () => {
  assert.throws(() => novelArchiveSearch({ error: "x" }), /couldn't read/);
  assert.equal(novelArchiveSearch({ novels: [], pagination: { has_next: false } }).items.length, 0);
});

test("search URLs: query skips sort, browse sends one; AI-generated titles are excluded", () => {
  const nb = new URL(novelBuddySearchUrl({ query: " Overgeared ", sort: "rating", page: 2 }));
  assert.equal(nb.searchParams.get("q"), "Overgeared");
  assert.equal(nb.searchParams.get("sort"), null);
  assert.equal(nb.searchParams.get("page"), "2");
  const browse = new URL(novelBuddySearchUrl({ genre: "Martial Arts", status: "completed", sort: "latest" }));
  assert.equal(browse.searchParams.get("genres"), "martial-arts");
  assert.equal(browse.searchParams.get("sort"), "latest");
  const na = new URL(novelArchiveSearchUrl({ sort: "latest", page: 0 }));
  assert.equal(na.searchParams.get("sort"), "recent");
  // NovelArchive only sorts by recent/popular/rating/chapters: the rest map to the closest one.
  assert.equal(new URL(novelArchiveSearchUrl({ sort: "favourites" })).searchParams.get("sort"), "popular");
  assert.equal(new URL(novelBuddySearchUrl({ sort: "favourites" })).searchParams.get("sort"), "bookmarks");
  assert.equal(na.searchParams.get("ai_generated"), "exclude");
  assert.equal(na.searchParams.get("page"), "1");
});

test("ids are checked per source before they reach a URL", () => {
  assert.ok(isNovelTitleId("novelbuddy", "WAY3LXDy"));
  assert.ok(!isNovelTitleId("novelbuddy", "WAY3/../x"));
  assert.ok(isNovelTitleId("novelarchive", "6a1637414f942c668d69a5a9"));
  assert.ok(!isNovelTitleId("novelarchive", "WAY3LXDy"));
  assert.ok(isNovelChapterId("novelarchive", "2060"));
  assert.ok(!isNovelChapterId("novelarchive", "0"));
  assert.ok(!isNovelChapterId("other", "1"));
});

test("text helpers", () => {
  assert.equal(decodeEntities("&amp;&lt;b&gt; &unknown; &#0;"), "&<b> &unknown; ");
  assert.deepEqual(htmlToParagraphs("<div>a<br/>b</div><hr><!-- c -->d"), ["a", "b", "* * *", "d"]);
  assert.deepEqual(textToParagraphs("​one\n\u0007two"), ["one", "two"]);
  assert.deepEqual(dropRepeatedHeading(["Chapter 12: The End", "x"], "Chapter 12 - The End"), ["x"]);
  assert.deepEqual(dropRepeatedHeading(["Only line"], "Only line"), ["Only line"]);
});

const ch = (id, order, label) => ({ id, order, label, updatedAt: null });
const at = (sourceId, chapterId, chapterLabel, paragraph, paragraphCount, updatedAt, chapterOrder = 0) =>
  ({ sourceId, chapterId, chapterLabel, chapterOrder, paragraph, paragraphCount, updatedAt });
const map = (...rows) => Object.fromEntries(rows.map((r) => [chapterKey(r.chapterLabel), r]));

test("chapter keys: number (and volume, part, teaser), never the position", () => {
  assert.equal(chapterKey("Chapter 769.5"), "769.5");
  assert.equal(chapterKey("Chapter 012: The Return"), "12");
  assert.equal(chapterKey("chapter 12 - the return (end)"), "12");
  assert.equal(chapterKey("Chapter 1733 (Teaser)"), "1733 teaser");
  assert.equal(chapterKey("Ch. 5 (Part 2)"), "5 p2");
  assert.equal(chapterKey("Chapter 5 Part 2"), "5 p2");
  assert.equal(chapterKey("Chapter 5 (2/3)"), "5 p2");
  assert.equal(chapterKey("Volume 2 Chapter 3"), "v2 3");
  assert.equal(chapterKey("17. A Quiet Night"), "17");
  assert.equal(chapterKey("Prologue"), "~prologue");
  assert.equal(chapterKey("Side Story 1"), "~side story 1");
  assert.notEqual(chapterKey("Side Story 1"), chapterKey("Chapter 1"));
});

test("resume on the same copy: the newest chapter, or the next once finished", () => {
  const chapters = [ch("c0", 0, "Chapter 1"), ch("c1", 1, "Chapter 2"), ch("c2", 2, "Chapter 3")];
  assert.equal(novelResumeTarget(chapters, {}, "novelbuddy").via, "start");
  const r = novelResumeTarget(chapters, map(at("novelbuddy", "c0", "Chapter 1", 99, 100, 1), at("novelbuddy", "c1", "Chapter 2", 10, 100, 2)), "novelbuddy");
  assert.deepEqual(r, { chapter: chapters[1], paragraph: 10, fraction: null, via: "same" });
  assert.equal(novelResumeTarget(chapters, map(at("novelbuddy", "c1", "Chapter 2", 98, 100, 3)), "novelbuddy").chapter.id, "c2");
  assert.equal(novelResumeTarget(chapters, map(at("novelbuddy", "c2", "Chapter 3", 99, 100, 3)), "novelbuddy").chapter.id, "c2");
  assert.ok(isChapterFinished({ paragraph: 97, paragraphCount: 100 }));
  assert.ok(!isChapterFinished({ paragraph: 0, paragraphCount: 0 }));
});

test("resume across sources goes by chapter name, not position (Overgeared's numbering)", () => {
  // NovelArchive: an extra teaser entry and no Chapter 2009, so positions drift.
  const archive = [ch("1732", 1731, "Chapter 1732"), ch("1733", 1732, "Chapter 1733"), ch("1734", 1733, "Chapter 1733 (Teaser)"),
    ch("1735", 1734, "Chapter 1734"), ch("2009", 2008, "Chapter 2008"), ch("2010", 2009, "Chapter 2010")];
  // Halfway through NovelBuddy's Chapter 1734 → NovelArchive's "Chapter 1734", half way.
  const half = novelResumeTarget(archive, map(at("novelbuddy", "Xyz12345", "Chapter 1734", 50, 100, 5)), "novelarchive");
  assert.equal(half.chapter.id, "1735");
  assert.equal(half.fraction, 0.5);
  assert.equal(half.via, "label");
  // Finished 1733 elsewhere → the next entry here (the teaser), by label.
  assert.equal(novelResumeTarget(archive, map(at("novelbuddy", "Abc12345", "Chapter 1733", 99, 100, 5)), "novelarchive").chapter.id, "1734");
  // Chapter 2009 doesn't exist here: carry on after the nearest earlier chapter.
  const gap = novelResumeTarget(archive, map(at("novelbuddy", "Gap12345", "Chapter 2009", 10, 100, 5)), "novelarchive");
  assert.deepEqual([gap.chapter.id, gap.via], ["2010", "nearest"]);
  // Read marks follow the label too.
  const progress = map(at("novelbuddy", "Abc12345", "Chapter 1733", 1, 1, 5));
  assert.ok(progressFor(progress, archive[1]));
  assert.equal(progressFor(progress, archive[2]), undefined);
});

test("same novel: shared name plus the same author; a missing author is only a maybe", () => {
  const nb = { title: "Overgeared", altNames: ["템빨", "OG"], author: "Park Saenal" };
  const na = { title: "Overgeared", altNames: ["OG", "Temppal", "템빨"], author: "Park Saenal / 박새날" };
  assert.equal(sameNovel(nb, na), "yes");
  assert.equal(sameNovel(nb, { ...na, author: null }), "maybe");
  assert.equal(sameNovel(nb, { ...na, author: "Someone Else" }), "no");
  assert.equal(sameNovel(nb, { title: "Temppal", altNames: [], author: "Park Saenal" }), "no", "a different main title needs a shared alt name on both sides");
  assert.equal(sameNovel({ ...nb, altNames: ["Temppal"] }, { title: "Temppal", altNames: [], author: "Park Saenal" }), "yes");
  assert.equal(sameNovel(nb, { title: "Overgeared: Sage", altNames: [], author: "Park Saenal" }), "no");
  assert.equal(authorsMatch("Park Saenal", null), null);
  assert.equal(authorsMatch("Guiltythree", "guiltythree"), true);
});

test("cross-source matches: exact names first, machine translations dropped", () => {
  const card = (id, title, mtl = false) => ({ sourceId: "novelarchive", id, title, cover: null, status: null, chapters: null, rating: null, genres: [], mtl, synopsis: null });
  const ranked = rankNovelMatches("Overgeared", ["템빨"], [
    card("a", "Overgeared: Sage"), card("b", "MTL-Overgeared", true), card("c", "템빨"), card("d", "Overgeared (Web Novel)"),
  ]);
  assert.deepEqual(ranked.map((c) => c.id), ["c", "d", "a"]);
});
