package com.sanjay.anitrack.next.data.novel

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Synthetic responses shaped like the sources' JSON APIs (no saved site content).
class NovelTest {
    private fun nbTitle(id: String = "AbC123xY", name: String = "Example Saga", mtl: Boolean = false) = JSONObject()
        .put("id", id).put("name", name).put("slug", "example-saga").put("cover", "https://rs.novelbuddy.me/covers/x.png")
        .put("status", "OnGoing").put("rating", 4.5).put("stats", JSONObject().put("chapters_count", 3))
        .put("genres", JSONArray().put(JSONObject().put("name", "Fantasy")).put(JSONObject().put("name", "Fantasy")))
        .put("is_mtl", mtl)

    @Test fun buddySearchKeepsCaseSensitiveIdsAndFlagsMtl() {
        val page = NovelBuddyParser.search(JSONObject().put("success", true).put("data", JSONObject()
            .put("items", JSONArray().put(nbTitle()).put(nbTitle("abc123xy", "MTL-Other")).put(JSONObject().put("id", "../x").put("name", "n")))
            .put("pagination", JSONObject().put("has_next", true))))
        assertEquals(listOf("AbC123xY", "abc123xy"), page.items.map { it.id })
        assertEquals(listOf("Fantasy"), page.items[0].genres)
        assertEquals("ongoing", page.items[0].status)
        assertTrue(page.items[1].mtl)
        assertTrue(page.hasNext)
    }

    @Test fun buddyChaptersInReadingOrderWithLabelsApartFromPositions() {
        val list = NovelBuddyParser.chapters(JSONObject().put("success", true).put("data", JSONObject().put("chapters", JSONArray()
            .put(JSONObject().put("id", "Ccc33333").put("name", "Chapter 770").put("number", 772))
            .put(JSONObject().put("id", "Bbb22222").put("name", "Chapter 769.5").put("number", 771))
            .put(JSONObject().put("id", "Aaa11111").put("name", "Chapter 769").put("number", 770).put("updated_at", "2023-02-24T18:34:20.000Z"))
            .put(JSONObject().put("id", "Aaa11111").put("name", "dupe").put("number", 770)))))
        assertEquals(listOf("Aaa11111" to "Chapter 769", "Bbb22222" to "Chapter 769.5", "Ccc33333" to "Chapter 770"), list.map { it.id to it.label })
        assertEquals(listOf(0, 1, 2), list.map { it.order })
        assertEquals(1677263660000L, list[0].updatedAt)
    }

    @Test fun buddyChapterTextNeverKeepsMarkup() {
        val text = NovelBuddyParser.chapterText(JSONObject().put("success", true).put("data", JSONObject().put("chapter", JSONObject()
            .put("id", "Aaa11111").put("name", "Chapter 1")
            .put("content", "<p>Chapter 1</p><p>He said &ldquo;hi&rdquo;</p><br><script>alert(1)</script><p onclick=\"x()\">Next&nbsp;&nbsp;line<img src=x></p><p>&#x1F600; &#39;q&#39;</p>"))))
        assertEquals(listOf("He said “hi”", "Next line", "😀 'q'"), text.paragraphs)
    }

    @Test fun buddyErrorCarriesTheApiMessage() {
        val e = runCatching { NovelBuddyParser.search(JSONObject().put("success", false).put("message", "Sort field must be one of: views")) }.exceptionOrNull()
        assertTrue(e is NovelParseException && e.message!!.contains("Sort field"))
    }

    @Test fun archivePositionsAreRequestIds() {
        val response = JSONObject().put("novel", JSONObject()
            .put("id", "6a1637414f942c668d69a5a9").put("title", "Example Saga").put("author", "Writer").put("total_chapters", "4")
            .put("cover_url", "/api/novels/6a1637414f942c668d69a5a9/cover?w=640").put("release_status", "completed")
            .put("genres", "Action, Fantasy").put("associated_names", JSONArray().put("ES")).put("rating", 5).put("rating_count", 0)
            .put("chapter_names", JSONArray().put("Chapter 1").put("Chapter 1.5").put("Chapter 3").put("Chapter 3 (Teaser)")))
        assertEquals(listOf("1", "2", "3", "4"), NovelArchiveParser.chapters(response).map { it.id })
        val detail = NovelArchiveParser.detail(response)
        assertEquals("https://novelarchive.cc/api/novels/6a1637414f942c668d69a5a9/cover?w=640", detail.card.cover)
        assertEquals("completed", detail.card.status)
        assertNull("a rating nobody gave is not a 5", detail.card.rating)
        assertEquals(4, detail.card.chapters)
    }

    @Test fun archiveTextSplitsByLine() {
        val text = NovelArchiveParser.chapterText(JSONObject().put("chapter", JSONObject().put("name", "Chapter 1.5").put("content", "Chapter 1.5\nFirst\n\n  Second  \r\nThird")), "2")
        assertEquals(NovelChapterText("2", "Chapter 1.5", listOf("First", "Second", "Third")), text)
    }

    @Test fun searchUrls() {
        val nb = NovelBuddyParser.searchUrl(NovelFilters(query = " Overgeared ", sort = NovelSort.Rating, page = 2))
        assertTrue(nb.contains("q=Overgeared") && !nb.contains("sort=") && nb.contains("page=2"))
        val browse = NovelBuddyParser.searchUrl(NovelFilters(genre = "Martial Arts", status = "completed", sort = NovelSort.Latest))
        assertTrue(browse.contains("genres=martial-arts") && browse.contains("sort=latest"))
        val archive = NovelArchiveParser.searchUrl(NovelFilters(sort = NovelSort.Latest, page = 0))
        assertTrue(archive.contains("sort=recent") && archive.contains("ai_generated=exclude") && archive.contains("page=1"))
        // NovelArchive only sorts by recent/popular/rating/chapters: the rest map to the closest one.
        assertTrue(NovelArchiveParser.searchUrl(NovelFilters(sort = NovelSort.Favourites)).contains("sort=popular"))
        assertTrue(NovelBuddyParser.searchUrl(NovelFilters(sort = NovelSort.Favourites)).contains("sort=bookmarks"))
    }

    @Test fun idsCheckedPerSource() {
        assertTrue(Novels.isTitleId(NovelSourceId.NovelBuddy, "WAY3LXDy"))
        assertFalse(Novels.isTitleId(NovelSourceId.NovelBuddy, "WAY3/../x"))
        assertTrue(Novels.isTitleId(NovelSourceId.NovelArchive, "6a1637414f942c668d69a5a9"))
        assertFalse(Novels.isTitleId(NovelSourceId.NovelArchive, "WAY3LXDy"))
        assertTrue(Novels.isChapterId(NovelSourceId.NovelArchive, "2060"))
        assertFalse(Novels.isChapterId(NovelSourceId.NovelArchive, "0"))
    }

    private val nb = NovelSourceId.NovelBuddy
    private val na = NovelSourceId.NovelArchive
    private fun at(source: NovelSourceId, chapterId: String, label: String, paragraph: Int, count: Int, updatedAt: Long) =
        NovelProgress(source, chapterId, label, 0, paragraph, count, updatedAt)
    private fun map(vararg rows: NovelProgress) = rows.associateBy { Novels.chapterKey(it.chapterLabel) }

    @Test fun chapterKeys() {
        assertEquals("769.5", Novels.chapterKey("Chapter 769.5"))
        assertEquals("12", Novels.chapterKey("Chapter 012: The Return"))
        assertEquals("12", Novels.chapterKey("chapter 12 - the return (end)"))
        assertEquals("1733 teaser", Novels.chapterKey("Chapter 1733 (Teaser)"))
        assertEquals("5 p2", Novels.chapterKey("Ch. 5 (Part 2)"))
        assertEquals("5 p2", Novels.chapterKey("Chapter 5 Part 2"))
        assertEquals("5 p2", Novels.chapterKey("Chapter 5 (2/3)"))
        assertEquals("v2 3", Novels.chapterKey("Volume 2 Chapter 3"))
        assertEquals("17", Novels.chapterKey("17. A Quiet Night"))
        assertEquals("~prologue", Novels.chapterKey("Prologue"))
        assertEquals("~side story 1", Novels.chapterKey("Side Story 1"))
    }

    @Test fun resumeOnTheSameCopy() {
        val chapters = (0..2).map { NovelChapter("c$it", it, "Chapter ${it + 1}", null) }
        assertEquals("start", Novels.resumeTarget(chapters, emptyMap(), nb)!!.via)
        assertEquals(NovelResume(chapters[1], 10, null, "same"),
            Novels.resumeTarget(chapters, map(at(nb, "c0", "Chapter 1", 99, 100, 1), at(nb, "c1", "Chapter 2", 10, 100, 2)), nb))
        assertEquals("c2", Novels.resumeTarget(chapters, map(at(nb, "c1", "Chapter 2", 98, 100, 3)), nb)!!.chapter.id)
        assertEquals("c2", Novels.resumeTarget(chapters, map(at(nb, "c2", "Chapter 3", 99, 100, 3)), nb)!!.chapter.id)
        assertTrue(at(nb, "x", "x", 1, 1, 0).finished)
        assertFalse(at(nb, "x", "x", 0, 0, 0).finished)
    }

    @Test fun resumeAcrossSourcesGoesByChapterName() {
        // NovelArchive's Overgeared: an extra teaser entry and no Chapter 2009, so positions drift.
        val archive = listOf(
            NovelChapter("1732", 1731, "Chapter 1732", null), NovelChapter("1733", 1732, "Chapter 1733", null),
            NovelChapter("1734", 1733, "Chapter 1733 (Teaser)", null), NovelChapter("1735", 1734, "Chapter 1734", null),
            NovelChapter("2009", 2008, "Chapter 2008", null), NovelChapter("2010", 2009, "Chapter 2010", null),
        )
        val half = Novels.resumeTarget(archive, map(at(nb, "Xyz12345", "Chapter 1734", 50, 100, 5)), na)!!
        assertEquals("1735", half.chapter.id)
        assertEquals(0.5f, half.fraction)
        assertEquals("label", half.via)
        assertEquals("1734", Novels.resumeTarget(archive, map(at(nb, "Abc12345", "Chapter 1733", 99, 100, 5)), na)!!.chapter.id)
        val gap = Novels.resumeTarget(archive, map(at(nb, "Gap12345", "Chapter 2009", 10, 100, 5)), na)!!
        assertEquals("2010" to "nearest", gap.chapter.id to gap.via)
        val progress = map(at(nb, "Abc12345", "Chapter 1733", 1, 1, 5))
        assertTrue(Novels.progressFor(progress, archive[1]) != null)
        assertNull(Novels.progressFor(progress, archive[2]))
    }

    @Test fun sameNovelNeedsANameAndTheAuthor() {
        val alt = listOf("템빨", "OG")
        assertEquals("yes", Novels.sameNovel("Overgeared", alt, "Park Saenal", "Overgeared", listOf("OG", "Temppal", "템빨"), "Park Saenal / 박새날"))
        assertEquals("maybe", Novels.sameNovel("Overgeared", alt, "Park Saenal", "Overgeared", emptyList(), null))
        assertEquals("no", Novels.sameNovel("Overgeared", alt, "Park Saenal", "Overgeared", emptyList(), "Someone Else"))
        assertEquals("no", Novels.sameNovel("Overgeared", alt, "Park Saenal", "Overgeared: Sage", emptyList(), "Park Saenal"))
        assertEquals("yes", Novels.sameNovel("Overgeared", listOf("Temppal"), "Park Saenal", "Temppal", emptyList(), "Park Saenal"))
        assertNull(Novels.authorsMatch("Park Saenal", null))
    }

    @Test fun trendingGenresFromSlugsAndPlainBlurbs() {
        val home = NovelBuddyParser.home(JSONObject().put("success", true).put("data", JSONObject()
            .put("trending", JSONArray().put(nbTitle().apply { remove("genres") }.put("genre_slugs", "sci-fi,martial-arts").put("summary", "<p>Growing up&nbsp;poor.</p>")))
            .put("popular", JSONArray()).put("latest", JSONObject().put("items", JSONArray()))))
        assertEquals(listOf("Sci fi", "Martial arts"), home.trending[0].genres)
        assertEquals("Growing up poor.", home.trending[0].synopsis)
    }

    @Test fun detailLatestChapter() {
        val detail = NovelBuddyParser.detail(JSONObject().put("success", true).put("data", JSONObject().put("title", nbTitle()
            .put("stats", JSONObject().put("chapters_count", 2060))
            .put("latest_chapters", JSONArray().put(JSONObject().put("id", "Newest99").put("name", "Chapter 2059").put("updated_at", "2025-02-21T18:37:52.000Z"))))))
        assertEquals(NovelLatest(2060, "Chapter 2059", 1740163072000L), detail.latest)
    }

    @Test fun textHelpers() {
        assertEquals("&<b> &unknown; ", NovelText.decode("&amp;&lt;b&gt; &unknown; &#0;"))
        assertEquals(listOf("a", "b", "* * *", "d"), NovelText.htmlToParagraphs("<div>a<br/>b</div><hr><!-- c -->d"))
        assertEquals(listOf("x"), NovelText.dropRepeatedHeading(listOf("Chapter 12: The End", "x"), "Chapter 12 - The End"))
    }

    @Test fun crossSourceMatches() {
        fun card(id: String, title: String, mtl: Boolean = false) = NovelCard(NovelSourceId.NovelArchive, id, title, null, null, null, null, emptyList(), mtl)
        val ranked = Novels.rankMatches("Overgeared", listOf("템빨"), listOf(card("a", "Overgeared: Sage"), card("b", "MTL-Overgeared", true), card("c", "템빨"), card("d", "Overgeared (Web Novel)")))
        assertEquals(listOf("c", "d", "a"), ranked.map { it.id })
    }
}
