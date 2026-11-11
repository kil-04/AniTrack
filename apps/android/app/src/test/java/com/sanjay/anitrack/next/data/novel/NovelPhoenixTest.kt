package com.sanjay.anitrack.next.data.novel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Synthetic pages shaped like Novel Phoenix's markup (no saved site content): the
// same pages and expectations as tests/novel-phoenix.test.mjs on desktop.
class NovelPhoenixTest {
    private val now = 1_794_312_000_000L // 2026-11-10T12:00:00Z
    private val hour = 3_600_000L
    private val np = NovelSourceId.NovelPhoenix

    private val searchPage = """<main role="main"><article id="latest-updates"> <div class="container"> <header id="header"><h1>“example” found on Novel Phoenix with 23 results...</h1></header> <ul class="novel-list horizontal col2 chapters"> <li class="novel-item"> <a href="/novel/example-saga"> <div class="cover-wrap"><figure class="novel-cover"><img src="/server-1/example-saga.jpg"></figure></div> <div class="item-body"> <h4 class="novel-title text1row">Example Saga</h4> <div class="novel-stats"><strong><i class="icon-crown"></i> Rank 1</strong></div> <div class="novel-stats"><span><i class="icon-book-open"></i> Ch. 3,242 · Ongoing</span></div> </div> </a> </li> <li class="novel-item"> <a href="/novel/the-completed-hero-s-tale"> <div class="cover-wrap"><figure class="novel-cover"><img src="/server-1/the-completed-hero-s-tale.jpg"></figure></div> <div class="item-body"> <h4 class="novel-title text1row">The Completed Hero&#039;s Tale &amp; More</h4> <div class="novel-stats"><span><i class="icon-book-open"></i> Ch. 108 · Completed</span></div> </div> </a> </li> <li class="novel-item"> <a href="/novel/Bad_Slug"> <div class="item-body"> <h4 class="novel-title text1row">Dropped: not a slug</h4> </div> </a> </li> </ul> <div class="text-center"><nav> <ul class="pagination"> <li class="page-item active" aria-current="page"><span class="page-link">1</span></li> <li class="page-item"><a class="page-link" href="https://novelphoenix.com/search?keyword=example&amp;page=2">2</a></li> </ul> </nav></div> <section class="popular-novels"><div class="section-header"><h3>Some Popular Novels</h3></div><ul class="novel-list col6"><li class="novel-item"><a href="/novel/a-suggestion"><h4 class="novel-title text2row">A Suggestion</h4></a></li></ul></section></div></article></main>"""

    private val browsePage = """<ul class="novel-list col6"> <li class="novel-item"><a title="Example Saga" href="/novel/example-saga"><figure class="novel-cover"><img class="lazy" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" data-src="/server-1/example-saga.jpg" alt="Example Saga"><span class="badge _bl"><i class="icon-award"></i>R 1</span><span class="badge _br"><i class="icon-star"></i>4.5</span></figure><h4 class="novel-title text2row">Example Saga</h4></a><div class="novel-stats"><i class="icon-book-open"></i> 3242 Chapters</span></div></li> <li class="novel-item"><a title="Second Story" href="/novel/second-story"><figure class="novel-cover"><img class="lazy" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" data-src="http://insecure.example/x.jpg" alt="Second Story"><span class="badge _br"><i class="icon-star"></i>0</span></figure><h4 class="novel-title text2row">Second Story</h4></a><div class="novel-stats"><i class="icon-book-open"></i> 515 Chapters</span></div></li> </ul> <nav> <ul class="pagination"> <li class="page-item"><a class="page-link" href="https://novelphoenix.com/genre-all/sort-popular/status-all/all-novel?page=2">2</a></li> <li class="page-item active" aria-current="page"><span class="page-link">3</span></li> </ul> </nav>"""

    private val titlePage = """<header class="novel-header"> <div class="header-body container"> <div class="fixed-img"><figure class="cover"><img src="https://novelphoenix.com/server-1/example-saga.jpg"></figure></div> <div class="novel-info"> <div class="main-head"><h1 class="novel-title text2row">Example Saga</h1><div class="author"><span>Author:</span> <a href="/author/jane-roe" class="property-item"><span itemprop="author">Jane Roe</span></a>, <a href="/author/x" class="property-item"><span itemprop="author"> 简</span></a> </div><div class="rating"><div class="rank"><strong>RANK 1</strong></div><div class="rating-star"><div class="my-rating" data-rating="4.5"></div></div><strong class="nub">4.5</strong></div></div> <nav class="links"> <a href="/novel/example-saga/chapter-1" class="button">Read Now</a> </nav> <div class="header-stats"><span><strong><i class="icon-book-open"></i> 3242</strong><small>Chapters</small></span><span><strong><i class="icon-eye"></i> 75M</strong><small>Views</small></span><span> <strong class="ongoing">Ongoing</strong> <small>Status</small></span></div><div class="categories"><h4>Genres</h4><ul><li><a href="/genre-action/sort-new/status-all/all-novel" class="property-item">Action</a></li><li><a href="/genre-sci-fi/sort-new/status-all/all-novel" class="property-item">Sci-fi</a></li><li><a href="/genre-action/sort-new/status-all/all-novel" class="property-item">Action</a></li></ul></div> </div> </div> </header> <div class="novel-body container"> <section id="info"> <nav class="content-nav"> <a class="grdbtn chapter-latest-container" href="https://novelphoenix.com/novel/example-saga/chapters"> <div class="body"> <h4>Novel Chapters</h4> <p class="latest text1row">Chapter 3242 The Last One</p> <p class="update">Updated 13 hours ago</p> </div> </a> </nav> <div class="summary"> <h4 class="lined">Summary</h4> <div class="content expand-wrapper"><p>A first paragraph &amp; more.</p><p>A second one.</p><div class="expand"><a class="expand-btn"><span>Show More</span></a></div></div> </div> </section> </div>"""

    private val chaptersPage = """<article id="chapter-list-page"> <p>A total of 3242 chapters have been translated</p> <div id="chpagedlist" class="mb-5"> <div class="filters"> <div id="gotochap"><input id="gotochapno" class="n-page" name="chapno" type="number" min="1" max="3242" placeholder="Enter Chapter No"></div> </div> <div class="pagenav"> <div class="chapter-range-pager"> <select aria-label="Chapter range"> <option value="http://novelphoenix.com/novel/example-saga/chapters?page=1" selected>1-100</option> <option value="http://novelphoenix.com/novel/example-saga/chapters?page=2">101-200</option> <option value="http://novelphoenix.com/novel/example-saga/chapters?page=33">3201-3242</option> </select> </div> </div> <ul class="chapter-list"><li><a href="/novel/example-saga/chapter-1"><span class="chapter-no">Ch. 1</span><strong class="chapter-title">Nightmare Begins</strong><time class="chapter-update">4 years ago</time></a></li><li><a href="/novel/example-saga/chapter-2"><span class="chapter-no">Ch. 2</span><strong class="chapter-title">Chapter 1.5: An Interlude</strong><time class="chapter-update">2 days ago</time></a></li><li><a href="/novel/example-saga/chapter-3"><span class="chapter-no">Ch. 3</span><strong class="chapter-title">(END) - In Modern Day (28)</strong><time class="chapter-update">an hour ago</time></a></li><li><a href="/novel/example-saga/chapter-4"><span class="chapter-no">Ch. 4</span><strong class="chapter-title"></strong><time class="chapter-update">Nov 9, 2026</time></a></li></ul> </div> </article>"""

    private val chapterPage = """<div class="titles"><h1><a href="https://novelphoenix.com/novel/example-saga" class="booktitle">Example Saga</a><span hidden=""> - </span><br><span class="chapter-title">Chapter 7 The Cup</span></h1></div> <div id="chapter-container" class="d-chapter-content"> <div class="nf-ads my-3"><div id="frame"><iframe src='//ads.example/x'></iframe></div></div> <div id="content" class="clearfix font_default" data-chapter-id="58592219"><p>Chapter 7 The Cup</p><p>A frail-looking young man sat on a bench.</p> <div class="nf-ads"><div><script>var x = "<p>not text</p>";</script></div></div> <p>&quot;Ah! So bitter!&quot;</p><p>   </p><p>The end&hellip;</p></div> <div class="box-notification mb-3 pt-2"><div class="text-center pb-1">Share to your friends</div></div> <div class="chapternav"><a rel="next" class="button nextchap" href="/novel/example-saga/chapter-8"></a></div>"""

    private val notFoundPage = """<html><head><title>Page Chapter Not Found - Novel Phoenix</title></head><body><div id="content" class="clearfix"><p>Sorry, nothing here.</p></div></body></html>"""

    private fun failure(block: () -> Unit): String? = runCatching(block).exceptionOrNull()?.let { assertTrue(it is NovelParseException); it.message }

    @Test fun itIsASourceWithSlugTitleIdsAndPositionChapterIds() {
        assertEquals(np, NovelSourceId.of("novelphoenix"))
        assertEquals(listOf("novelbuddy", "novelarchive", "novelphoenix"), NovelSourceId.entries.map { it.key })
        assertTrue(Novels.isTitleId(np, "shadow-slave"))
        assertTrue(Novels.isTitleId(np, "i-became-the-legendary-emperor-throughout-the-ages-after-i-started-giving-away-my-territory"))
        assertTrue(Novels.isTitleId(np, "a".repeat(120)))
        for (bad in listOf("", "-leading", "Shadow-Slave", "shadow_slave", "shadow slave", "a/../b", "a:b", "a".repeat(121))) assertFalse(bad, Novels.isTitleId(np, bad))
        assertTrue(Novels.isChapterId(np, "3242"))
        for (bad in listOf("0", "01", "1.5", "1234567", "abc")) assertFalse(bad, Novels.isChapterId(np, bad))
        // While it is down, its searches fall back to NovelBuddy.
        assertEquals(NovelSourceId.NovelBuddy, Novels.otherSource(np))
    }

    @Test fun addressesForSearchBrowseTitlesAndChapters() {
        assertEquals("https://novelphoenix.com/search?keyword=shadow+slave&page=2", NovelPhoenixParser.searchUrl(NovelFilters(query = " shadow slave ", page = 2, genre = "Action", sort = NovelSort.Latest)))
        assertEquals("https://novelphoenix.com/genre-all/sort-popular/status-all/all-novel?page=1", NovelPhoenixParser.searchUrl(NovelFilters()))
        assertEquals("https://novelphoenix.com/genre-sci-fi/sort-latest-release/status-completed/all-novel?page=1", NovelPhoenixParser.searchUrl(NovelFilters(genre = "Sci-fi", status = "completed", sort = NovelSort.Latest)))
        assertEquals("https://novelphoenix.com/genre-slice-of-life/sort-new/status-all/all-novel?page=3", NovelPhoenixParser.searchUrl(NovelFilters(genre = "Slice of Life", sort = NovelSort.Newest, page = 3)))
        // The site only sorts by popular, new or latest release: the rest map to popular.
        assertTrue(NovelPhoenixParser.searchUrl(NovelFilters(sort = NovelSort.Favourites)).contains("/sort-popular/"))
        assertTrue(NovelPhoenixParser.searchUrl(NovelFilters(sort = NovelSort.Rating, status = "ongoing")).contains("/sort-popular/status-ongoing/"))
        assertTrue(NovelPhoenixParser.searchUrl(NovelFilters(page = 0)).endsWith("page=1"))
        assertTrue(NovelPhoenixParser.searchUrl(NovelFilters(page = 9999)).endsWith("page=500"))
        assertEquals("https://novelphoenix.com/novel/example-saga", NovelPhoenixParser.titleUrl("example-saga"))
        assertEquals("https://novelphoenix.com/novel/example-saga/chapters?page=33", NovelPhoenixParser.chaptersUrl("example-saga", 33))
        assertEquals("https://novelphoenix.com/novel/example-saga/chapter-3242", NovelPhoenixParser.chapterUrl("example-saga", "3242"))
    }

    @Test fun searchResultsComeFromTheFirstListOnly() {
        val page = NovelPhoenixParser.search(searchPage, 1)
        assertEquals(listOf("example-saga", "the-completed-hero-s-tale"), page.items.map { it.id })
        assertEquals(
            NovelCard(np, "example-saga", "Example Saga", "https://novelphoenix.com/server-1/example-saga.jpg", "ongoing", 3242, null, emptyList(), false, null),
            page.items[0],
        )
        // The status is read from the stats line, never from a title that happens to say "Completed".
        assertEquals("The Completed Hero's Tale & More", page.items[1].title)
        assertEquals("completed", page.items[1].status)
        assertTrue(page.hasNext)
        assertFalse(NovelPhoenixParser.search(searchPage, 2).hasNext)
    }

    @Test fun browseCardsReadTheLazyCoverRatingAndChapterCount() {
        val page = NovelPhoenixParser.search(browsePage, 3)
        assertEquals(2, page.items.size)
        assertEquals("https://novelphoenix.com/server-1/example-saga.jpg", page.items[0].cover)
        assertEquals(4.5, page.items[0].rating!!, 0.0)
        assertEquals(3242, page.items[0].chapters)
        assertNull(page.items[0].status)
        // Only https covers are kept, and an unrated title has no rating.
        assertNull(page.items[1].cover)
        assertNull(page.items[1].rating)
        assertFalse(page.hasNext)
        assertTrue(NovelPhoenixParser.search(browsePage, 1).hasNext)
    }

    @Test fun anEmptyResultListIsEmptyAndAPageWithoutOneIsRefused() {
        val empty = """<header id="header"><h1>found with 0 results...</h1></header> <ul class="novel-list horizontal col2 chapters"> </ul> <section class="popular-novels"><ul class="novel-list col6"><li class="novel-item"><a href="/novel/a-suggestion"><h4 class="novel-title">A Suggestion</h4></a></li></ul></section>"""
        assertEquals(NovelPage(emptyList(), false), NovelPhoenixParser.search(empty, 1))
        assertTrue(failure { NovelPhoenixParser.search("<html><body>Just a moment...</body></html>", 1) }!!.contains("couldn't read"))
    }

    @Test fun titleDetails() {
        val detail = NovelPhoenixParser.detail(titlePage, "example-saga", now)
        assertEquals(
            NovelDetail(
                card = NovelCard(np, "example-saga", "Example Saga", "https://novelphoenix.com/server-1/example-saga.jpg", "ongoing", 3242, 4.5, listOf("Action", "Sci-fi"), false, null),
                author = "Jane Roe, 简",
                altNames = emptyList(),
                synopsis = "A first paragraph & more.\nA second one.",
                url = "https://novelphoenix.com/novel/example-saga",
                latest = NovelLatest(3242, "Chapter 3242 The Last One", now - 13 * hour),
            ),
            detail,
        )
        // The same author on another source links the two copies.
        assertEquals("yes", Novels.sameNovel(detail.card.title, detail.altNames, detail.author, "Example Saga", emptyList(), "Jane Roe"))
        assertTrue(failure { NovelPhoenixParser.detail("<html><title>Page Not Found 404</title></html>", "example-saga", now) }!!.contains("doesn't have this title"))
        assertTrue(failure { NovelPhoenixParser.detail(titlePage, "Not A Slug", now) }!!.contains("doesn't have this title"))
    }

    @Test fun aChapterListPageGivesPositionsLabelsTimesAndThePageCount() {
        val page = NovelPhoenixParser.chapterPage(chaptersPage, now)
        assertEquals(33, page.pages)
        assertEquals(3242, page.total)
        assertEquals(
            listOf(
                NovelPhoenixParser.Row("1", "Chapter 1: Nightmare Begins", now - 4 * 365 * 24 * hour),
                // A title that already names its chapter is kept: the site's number is a position.
                NovelPhoenixParser.Row("2", "Chapter 1.5: An Interlude", now - 2 * 24 * hour),
                NovelPhoenixParser.Row("3", "Chapter 3: (END) - In Modern Day (28)", now - hour),
                NovelPhoenixParser.Row("4", "Chapter 4", java.util.GregorianCalendar(2026, java.util.Calendar.NOVEMBER, 9).timeInMillis),
            ),
            page.chapters,
        )
        assertEquals(listOf("1", "1.5", "3 p28", "4"), page.chapters.map { Novels.chapterKey(it.label) })
        assertTrue(failure { NovelPhoenixParser.chapterPage("<html><title>Page Not Found 404</title></html>", now) }!!.contains("chapters"))
        // A single-page list has no pager; the total falls back to the sentence, or is unknown.
        val single = NovelPhoenixParser.chapterPage("""<p>A total of 1,204 chapters have been translated</p><ul class="chapter-list"><li><a href="/novel/x/chapter-1"><span class="chapter-no">Ch. 1</span><strong class="chapter-title">One</strong></a></li></ul>""", now)
        assertEquals(1, single.pages)
        assertEquals(1204, single.total)
        assertNull(NovelPhoenixParser.chapterPage("""<ul class="chapter-list"></ul>""", now).total)
    }

    private fun row(id: Int, label: String = "Chapter $id", at: Long? = null) = NovelPhoenixParser.Row(id.toString(), label, at)

    @Test fun pagesJoinIntoOneListInReadingOrderWithoutRepeats() {
        val list = NovelPhoenixParser.chapters(listOf(listOf(row(1), row(2)), listOf(row(2), row(3)), emptyList()))
        assertEquals(listOf("1" to 0, "2" to 1, "3" to 2), list.map { it.id to it.order })
        assertEquals(emptyList<NovelChapter>(), NovelPhoenixParser.chapters(emptyList()))
    }

    @Test fun aLongListStandsInWithChapterNForThePagesNotReadYet() {
        val list = NovelPhoenixParser.provisional(5, listOf(listOf(row(1, "Chapter 1: One", 1000), row(2, "Chapter 1.5: Between", 2000)), listOf(row(5, "Chapter 5: Five", 5000)), emptyList()))
        assertEquals(
            listOf(
                NovelChapter("1", 0, "Chapter 1: One", 1000),
                NovelChapter("2", 1, "Chapter 1.5: Between", 2000),
                NovelChapter("3", 2, "Chapter 3", null),
                NovelChapter("4", 3, "Chapter 4", null),
                NovelChapter("5", 4, "Chapter 5: Five", 5000),
            ),
            list,
        )
        // Every stand-in is a valid chapter to request, and a row past the total is left out.
        assertTrue(list.all { Novels.isChapterId(np, it.id) })
        assertEquals(listOf("1"), NovelPhoenixParser.provisional(1, listOf(listOf(row(1, "One"), row(2, "Two")))).map { it.id })
        assertEquals(emptyList<NovelChapter>(), NovelPhoenixParser.provisional(0, emptyList()))
        assertEquals(20_000, NovelPhoenixParser.provisional(1_000_000_000, emptyList()).size)
    }

    @Test fun chapterTextIsTheContentBlocksParagraphsOnly() {
        // The repeated heading, the ad block inside the text, scripts and blank paragraphs are dropped.
        assertEquals(
            NovelChapterText("7", "Chapter 7 The Cup", listOf("A frail-looking young man sat on a bench.", "\"Ah! So bitter!\"", "The end…")),
            NovelPhoenixParser.chapterText(chapterPage, "7"),
        )
    }

    @Test fun aMissingChapterAndAPageWithoutTextSaySo() {
        assertTrue(failure { NovelPhoenixParser.chapterText(notFoundPage, "99999") }!!.contains("doesn't have this chapter"))
        assertTrue(failure { NovelPhoenixParser.chapterText("<html><title>Example</title><body></body></html>", "1") }!!.contains("without its text"))
    }

    @Test fun relativeTimes() {
        assertEquals(now - 13 * hour, NovelPhoenixParser.relativeTime("Updated 13 hours ago", now))
        assertEquals(now - 60_000, NovelPhoenixParser.relativeTime("1 minute ago", now))
        assertEquals(now - 7 * 24 * hour, NovelPhoenixParser.relativeTime("a week ago", now))
        assertEquals(now - 90 * 24 * hour, NovelPhoenixParser.relativeTime("3 months ago", now))
        assertNull(NovelPhoenixParser.relativeTime("soon", now))
        assertNull(NovelPhoenixParser.relativeTime(null, now))
    }

    @Test fun longIdsGetShortFileNamesTheSameAsOnDesktop() {
        // 120 characters, the longest id accepted: the value desktop's fileStem gives for it.
        val id = "a-very-long-novel-title-".repeat(5).take(120)
        assertEquals("612d766572792d6c6f6e672d6e6f76656c2d7469746c652d612d766572792d6c-f42d5a53ee67b5e0701b1fc71a56607d", NovelNames.stem(id))
        // A short id keeps the plain hex name, like every title saved before.
        assertEquals("574159334c584479", NovelNames.stem("WAY3LXDy"))
        assertEquals("WAY3LXDy", NovelNames.unhex(NovelNames.hex("WAY3LXDy")))
    }
}
