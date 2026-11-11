import test from "node:test";
import assert from "node:assert/strict";
import {
  chapterKey,
  isNovelChapterId,
  isNovelSource,
  isNovelTitleId,
  NOVEL_SOURCES,
  novelPhoenixChapterPage,
  novelPhoenixChapters,
  novelPhoenixChaptersUrl,
  novelPhoenixChapterText,
  novelPhoenixChapterUrl,
  novelPhoenixDetail,
  novelPhoenixProvisional,
  novelPhoenixSearch,
  novelPhoenixSearchUrl,
  novelPhoenixTitleUrl,
  otherNovelSource,
  relativeTime,
  sameNovel,
} from "../packages/shared/novel.ts";

// Synthetic pages shaped like Novel Phoenix's markup (no saved site content).
// NovelTest.kt on Android parses the same pages and expects the same results.
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const HOUR = 3_600_000;

const SEARCH_PAGE = `<main role="main"><article id="latest-updates"> <div class="container"> <header id="header"><h1>“example” found on Novel Phoenix with 23 results...</h1></header> <ul class="novel-list horizontal col2 chapters"> <li class="novel-item"> <a href="/novel/example-saga"> <div class="cover-wrap"><figure class="novel-cover"><img src="/server-1/example-saga.jpg"></figure></div> <div class="item-body"> <h4 class="novel-title text1row">Example Saga</h4> <div class="novel-stats"><strong><i class="icon-crown"></i> Rank 1</strong></div> <div class="novel-stats"><span><i class="icon-book-open"></i> Ch. 3,242 · Ongoing</span></div> </div> </a> </li> <li class="novel-item"> <a href="/novel/the-completed-hero-s-tale"> <div class="cover-wrap"><figure class="novel-cover"><img src="/server-1/the-completed-hero-s-tale.jpg"></figure></div> <div class="item-body"> <h4 class="novel-title text1row">The Completed Hero&#039;s Tale &amp; More</h4> <div class="novel-stats"><span><i class="icon-book-open"></i> Ch. 108 · Completed</span></div> </div> </a> </li> <li class="novel-item"> <a href="/novel/Bad_Slug"> <div class="item-body"> <h4 class="novel-title text1row">Dropped: not a slug</h4> </div> </a> </li> </ul> <div class="text-center"><nav> <ul class="pagination"> <li class="page-item active" aria-current="page"><span class="page-link">1</span></li> <li class="page-item"><a class="page-link" href="https://novelphoenix.com/search?keyword=example&amp;page=2">2</a></li> </ul> </nav></div> <section class="popular-novels"><div class="section-header"><h3>Some Popular Novels</h3></div><ul class="novel-list col6"><li class="novel-item"><a href="/novel/a-suggestion"><h4 class="novel-title text2row">A Suggestion</h4></a></li></ul></section></div></article></main>`;

const BROWSE_PAGE = `<ul class="novel-list col6"> <li class="novel-item"><a title="Example Saga" href="/novel/example-saga"><figure class="novel-cover"><img class="lazy" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" data-src="/server-1/example-saga.jpg" alt="Example Saga"><span class="badge _bl"><i class="icon-award"></i>R 1</span><span class="badge _br"><i class="icon-star"></i>4.5</span></figure><h4 class="novel-title text2row">Example Saga</h4></a><div class="novel-stats"><i class="icon-book-open"></i> 3242 Chapters</span></div></li> <li class="novel-item"><a title="Second Story" href="/novel/second-story"><figure class="novel-cover"><img class="lazy" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" data-src="http://insecure.example/x.jpg" alt="Second Story"><span class="badge _br"><i class="icon-star"></i>0</span></figure><h4 class="novel-title text2row">Second Story</h4></a><div class="novel-stats"><i class="icon-book-open"></i> 515 Chapters</span></div></li> </ul> <nav> <ul class="pagination"> <li class="page-item"><a class="page-link" href="https://novelphoenix.com/genre-all/sort-popular/status-all/all-novel?page=2">2</a></li> <li class="page-item active" aria-current="page"><span class="page-link">3</span></li> </ul> </nav>`;

const TITLE_PAGE = `<header class="novel-header"> <div class="header-body container"> <div class="fixed-img"><figure class="cover"><img src="https://novelphoenix.com/server-1/example-saga.jpg"></figure></div> <div class="novel-info"> <div class="main-head"><h1 class="novel-title text2row">Example Saga</h1><div class="author"><span>Author:</span> <a href="/author/jane-roe" class="property-item"><span itemprop="author">Jane Roe</span></a>, <a href="/author/x" class="property-item"><span itemprop="author"> 简</span></a> </div><div class="rating"><div class="rank"><strong>RANK 1</strong></div><div class="rating-star"><div class="my-rating" data-rating="4.5"></div></div><strong class="nub">4.5</strong></div></div> <nav class="links"> <a href="/novel/example-saga/chapter-1" class="button">Read Now</a> </nav> <div class="header-stats"><span><strong><i class="icon-book-open"></i> 3242</strong><small>Chapters</small></span><span><strong><i class="icon-eye"></i> 75M</strong><small>Views</small></span><span> <strong class="ongoing">Ongoing</strong> <small>Status</small></span></div><div class="categories"><h4>Genres</h4><ul><li><a href="/genre-action/sort-new/status-all/all-novel" class="property-item">Action</a></li><li><a href="/genre-sci-fi/sort-new/status-all/all-novel" class="property-item">Sci-fi</a></li><li><a href="/genre-action/sort-new/status-all/all-novel" class="property-item">Action</a></li></ul></div> </div> </div> </header> <div class="novel-body container"> <section id="info"> <nav class="content-nav"> <a class="grdbtn chapter-latest-container" href="https://novelphoenix.com/novel/example-saga/chapters"> <div class="body"> <h4>Novel Chapters</h4> <p class="latest text1row">Chapter 3242 The Last One</p> <p class="update">Updated 13 hours ago</p> </div> </a> </nav> <div class="summary"> <h4 class="lined">Summary</h4> <div class="content expand-wrapper"><p>A first paragraph &amp; more.</p><p>A second one.</p><div class="expand"><a class="expand-btn"><span>Show More</span></a></div></div> </div> </section> </div>`;

const CHAPTERS_PAGE = `<article id="chapter-list-page"> <p>A total of 3242 chapters have been translated</p> <div id="chpagedlist" class="mb-5"> <div class="filters"> <div id="gotochap"><input id="gotochapno" class="n-page" name="chapno" type="number" min="1" max="3242" placeholder="Enter Chapter No"></div> </div> <div class="pagenav"> <div class="chapter-range-pager"> <select aria-label="Chapter range"> <option value="http://novelphoenix.com/novel/example-saga/chapters?page=1" selected>1-100</option> <option value="http://novelphoenix.com/novel/example-saga/chapters?page=2">101-200</option> <option value="http://novelphoenix.com/novel/example-saga/chapters?page=33">3201-3242</option> </select> </div> </div> <ul class="chapter-list"><li><a href="/novel/example-saga/chapter-1"><span class="chapter-no">Ch. 1</span><strong class="chapter-title">Nightmare Begins</strong><time class="chapter-update">4 years ago</time></a></li><li><a href="/novel/example-saga/chapter-2"><span class="chapter-no">Ch. 2</span><strong class="chapter-title">Chapter 1.5: An Interlude</strong><time class="chapter-update">2 days ago</time></a></li><li><a href="/novel/example-saga/chapter-3"><span class="chapter-no">Ch. 3</span><strong class="chapter-title">(END) - In Modern Day (28)</strong><time class="chapter-update">an hour ago</time></a></li><li><a href="/novel/example-saga/chapter-4"><span class="chapter-no">Ch. 4</span><strong class="chapter-title"></strong><time class="chapter-update">Nov 9, 2026</time></a></li></ul> </div> </article>`;

const CHAPTER_PAGE = `<div class="titles"><h1><a href="https://novelphoenix.com/novel/example-saga" class="booktitle">Example Saga</a><span hidden=""> - </span><br><span class="chapter-title">Chapter 7 The Cup</span></h1></div> <div id="chapter-container" class="d-chapter-content"> <div class="nf-ads my-3"><div id="frame"><iframe src='//ads.example/x'></iframe></div></div> <div id="content" class="clearfix font_default" data-chapter-id="58592219"><p>Chapter 7 The Cup</p><p>A frail-looking young man sat on a bench.</p> <div class="nf-ads"><div><script>var x = "<p>not text</p>";</script></div></div> <p>&quot;Ah! So bitter!&quot;</p><p>   </p><p>The end&hellip;</p></div> <div class="box-notification mb-3 pt-2"><div class="text-center pb-1">Share to your friends</div></div> <div class="chapternav"><a rel="next" class="button nextchap" href="/novel/example-saga/chapter-8"></a></div>`;

const NOT_FOUND_PAGE = `<html><head><title>Page Chapter Not Found - Novel Phoenix</title></head><body><div id="content" class="clearfix"><p>Sorry, nothing here.</p></div></body></html>`;

test("novel phoenix: it is a source with slug title ids and position chapter ids", () => {
  assert.equal(isNovelSource("novelphoenix"), true);
  assert.deepEqual(NOVEL_SOURCES.map((s) => s.id), ["novelbuddy", "novelarchive", "novelphoenix"]);
  assert.equal(isNovelTitleId("novelphoenix", "shadow-slave"), true);
  assert.equal(isNovelTitleId("novelphoenix", "i-became-the-legendary-emperor-throughout-the-ages-after-i-started-giving-away-my-territory"), true);
  assert.equal(isNovelTitleId("novelphoenix", "a".repeat(120)), true);
  for (const bad of ["", "-leading", "Shadow-Slave", "shadow_slave", "shadow slave", "a/../b", "a:b", "a".repeat(121)]) {
    assert.equal(isNovelTitleId("novelphoenix", bad), false, bad);
  }
  assert.equal(isNovelChapterId("novelphoenix", "3242"), true);
  for (const bad of ["0", "01", "1.5", "1234567", "abc"]) assert.equal(isNovelChapterId("novelphoenix", bad), false, bad);
  // While it is down, its searches fall back to NovelBuddy.
  assert.equal(otherNovelSource("novelphoenix"), "novelbuddy");
});

test("novel phoenix: addresses for search, browse, titles and chapters", () => {
  assert.equal(novelPhoenixSearchUrl({ query: " shadow slave ", page: 2, genre: "Action", sort: "latest" }), "https://novelphoenix.com/search?keyword=shadow+slave&page=2");
  assert.equal(novelPhoenixSearchUrl({}), "https://novelphoenix.com/genre-all/sort-popular/status-all/all-novel?page=1");
  assert.equal(novelPhoenixSearchUrl({ genre: "Sci-fi", status: "completed", sort: "latest" }), "https://novelphoenix.com/genre-sci-fi/sort-latest-release/status-completed/all-novel?page=1");
  assert.equal(novelPhoenixSearchUrl({ genre: "Slice of Life", sort: "newest", page: 3 }), "https://novelphoenix.com/genre-slice-of-life/sort-new/status-all/all-novel?page=3");
  // The site only sorts by popular, new or latest release: the rest map to popular.
  assert.match(novelPhoenixSearchUrl({ sort: "favourites" }), /\/sort-popular\//);
  assert.match(novelPhoenixSearchUrl({ sort: "rating", status: "ongoing" }), /\/sort-popular\/status-ongoing\//);
  assert.match(novelPhoenixSearchUrl({ page: 0 }), /page=1$/);
  assert.match(novelPhoenixSearchUrl({ page: 9999 }), /page=500$/);
  assert.equal(novelPhoenixTitleUrl("example-saga"), "https://novelphoenix.com/novel/example-saga");
  assert.equal(novelPhoenixChaptersUrl("example-saga", 33), "https://novelphoenix.com/novel/example-saga/chapters?page=33");
  assert.equal(novelPhoenixChapterUrl("example-saga", "3242"), "https://novelphoenix.com/novel/example-saga/chapter-3242");
});

test("novel phoenix: search results come from the first list only", () => {
  const page = novelPhoenixSearch(SEARCH_PAGE, 1);
  assert.deepEqual(page.items.map((c) => c.id), ["example-saga", "the-completed-hero-s-tale"]);
  assert.deepEqual(page.items[0], {
    sourceId: "novelphoenix", id: "example-saga", title: "Example Saga", cover: "https://novelphoenix.com/server-1/example-saga.jpg",
    status: "ongoing", chapters: 3242, rating: null, genres: [], mtl: false, synopsis: null,
  });
  // The status is read from the stats line, never from a title that happens to say "Completed".
  assert.equal(page.items[1].title, "The Completed Hero's Tale & More");
  assert.equal(page.items[1].status, "completed");
  assert.equal(page.hasNextPage, true);
  assert.equal(novelPhoenixSearch(SEARCH_PAGE, 2).hasNextPage, false);
});

test("novel phoenix: browse cards read the lazy cover, rating and chapter count", () => {
  const page = novelPhoenixSearch(BROWSE_PAGE, 3);
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].cover, "https://novelphoenix.com/server-1/example-saga.jpg");
  assert.equal(page.items[0].rating, 4.5);
  assert.equal(page.items[0].chapters, 3242);
  assert.equal(page.items[0].status, null);
  // Only https covers are kept, and an unrated title has no rating.
  assert.equal(page.items[1].cover, null);
  assert.equal(page.items[1].rating, null);
  assert.equal(page.hasNextPage, false);
  assert.equal(novelPhoenixSearch(BROWSE_PAGE, 1).hasNextPage, true);
});

test("novel phoenix: an empty result list is empty, and a page without one is refused", () => {
  const empty = `<header id="header"><h1>found with 0 results...</h1></header> <ul class="novel-list horizontal col2 chapters"> </ul> <section class="popular-novels"><ul class="novel-list col6"><li class="novel-item"><a href="/novel/a-suggestion"><h4 class="novel-title">A Suggestion</h4></a></li></ul></section>`;
  assert.deepEqual(novelPhoenixSearch(empty, 1), { items: [], hasNextPage: false });
  assert.throws(() => novelPhoenixSearch("<html><body>Just a moment...</body></html>", 1), /couldn't read/);
});

test("novel phoenix: title details", () => {
  const detail = novelPhoenixDetail(TITLE_PAGE, "example-saga", NOW);
  assert.deepEqual(detail, {
    sourceId: "novelphoenix", id: "example-saga", title: "Example Saga", cover: "https://novelphoenix.com/server-1/example-saga.jpg",
    status: "ongoing", chapters: 3242, rating: 4.5, genres: ["Action", "Sci-fi"], mtl: false,
    synopsis: "A first paragraph & more.\nA second one.", author: "Jane Roe, 简", altNames: [],
    url: "https://novelphoenix.com/novel/example-saga",
    latest: { count: 3242, label: "Chapter 3242 The Last One", at: NOW - 13 * HOUR },
  });
  // The same author on another source links the two copies.
  assert.equal(sameNovel(detail, { title: "Example Saga", altNames: [], author: "Jane Roe" }), "yes");
  assert.throws(() => novelPhoenixDetail("<html><title>Page Not Found 404</title></html>", "example-saga", NOW), /doesn't have this title/);
  assert.throws(() => novelPhoenixDetail(TITLE_PAGE, "Not A Slug", NOW), /doesn't have this title/);
});

test("novel phoenix: a chapter-list page gives positions, labels, times and the page count", () => {
  const page = novelPhoenixChapterPage(CHAPTERS_PAGE, NOW);
  assert.equal(page.pages, 33);
  assert.equal(page.total, 3242);
  assert.deepEqual(page.chapters, [
    { id: "1", label: "Chapter 1: Nightmare Begins", updatedAt: NOW - 4 * 365 * 24 * HOUR },
    // A title that already names its chapter is kept: the site's number is a position.
    { id: "2", label: "Chapter 1.5: An Interlude", updatedAt: NOW - 2 * 24 * HOUR },
    { id: "3", label: "Chapter 3: (END) - In Modern Day (28)", updatedAt: NOW - HOUR },
    { id: "4", label: "Chapter 4", updatedAt: Date.parse("Nov 9, 2026") },
  ]);
  assert.deepEqual(page.chapters.map((c) => chapterKey(c.label)), ["1", "1.5", "3 p28", "4"]);
  assert.throws(() => novelPhoenixChapterPage("<html><title>Page Not Found 404</title></html>", NOW), /chapters/);
  // A single-page list has no pager; the total falls back to the sentence, or is unknown.
  const single = novelPhoenixChapterPage(`<p>A total of 1,204 chapters have been translated</p><ul class="chapter-list"><li><a href="/novel/x/chapter-1"><span class="chapter-no">Ch. 1</span><strong class="chapter-title">One</strong></a></li></ul>`, NOW);
  assert.equal(single.pages, 1);
  assert.equal(single.total, 1204);
  assert.equal(novelPhoenixChapterPage(`<ul class="chapter-list"></ul>`, NOW).total, null);
});

test("novel phoenix: a long list stands in with \"Chapter N\" for the pages not read yet", () => {
  const row = (id, label) => ({ id: String(id), label, updatedAt: id * 1000 });
  const list = novelPhoenixProvisional(5, [[row(1, "Chapter 1: One"), row(2, "Chapter 1.5: Between")], [row(5, "Chapter 5: Five")], []]);
  assert.deepEqual(list, [
    { id: "1", order: 0, label: "Chapter 1: One", updatedAt: 1000 },
    { id: "2", order: 1, label: "Chapter 1.5: Between", updatedAt: 2000 },
    { id: "3", order: 2, label: "Chapter 3", updatedAt: null },
    { id: "4", order: 3, label: "Chapter 4", updatedAt: null },
    { id: "5", order: 4, label: "Chapter 5: Five", updatedAt: 5000 },
  ]);
  // Every stand-in is a valid chapter to request, and a row past the total is left out.
  assert.equal(list.every((c) => isNovelChapterId("novelphoenix", c.id)), true);
  assert.deepEqual(novelPhoenixProvisional(1, [[row(1, "One"), row(2, "Two")]]).map((c) => c.id), ["1"]);
  assert.deepEqual(novelPhoenixProvisional(0, []), []);
  assert.equal(novelPhoenixProvisional(1e9, []).length, 20_000);
});

test("novel phoenix: pages join into one list in reading order, without repeats", () => {
  const row = (id) => ({ id: String(id), label: `Chapter ${id}`, updatedAt: null });
  const list = novelPhoenixChapters([[row(1), row(2)], [row(2), row(3)], []]);
  assert.deepEqual(list.map((c) => [c.id, c.order]), [["1", 0], ["2", 1], ["3", 2]]);
  assert.deepEqual(novelPhoenixChapters([]), []);
});

test("novel phoenix: chapter text is the content block's paragraphs only", () => {
  const text = novelPhoenixChapterText(CHAPTER_PAGE, "7");
  assert.deepEqual(text, {
    id: "7", label: "Chapter 7 The Cup",
    // The repeated heading, the ad block inside the text, scripts and blank paragraphs are dropped.
    paragraphs: ["A frail-looking young man sat on a bench.", '"Ah! So bitter!"', "The end…"],
  });
});

test("novel phoenix: a missing chapter and a page without text say so", () => {
  assert.throws(() => novelPhoenixChapterText(NOT_FOUND_PAGE, "99999"), /doesn't have this chapter/);
  assert.throws(() => novelPhoenixChapterText("<html><title>Example</title><body></body></html>", "1"), /without its text/);
});

test("novel phoenix: relative times", () => {
  assert.equal(relativeTime("Updated 13 hours ago", NOW), NOW - 13 * HOUR);
  assert.equal(relativeTime("1 minute ago", NOW), NOW - 60_000);
  assert.equal(relativeTime("a week ago", NOW), NOW - 7 * 24 * HOUR);
  assert.equal(relativeTime("3 months ago", NOW), NOW - 90 * 24 * HOUR);
  assert.equal(relativeTime("Nov 9, 2026", NOW), Date.parse("Nov 9, 2026"));
  assert.equal(relativeTime("soon", NOW), null);
  assert.equal(relativeTime(null, NOW), null);
});
