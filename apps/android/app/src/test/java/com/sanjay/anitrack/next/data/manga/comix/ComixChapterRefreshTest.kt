package com.sanjay.anitrack.next.data.manga.comix

import com.sanjay.anitrack.next.data.manga.MangaChapter
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ComixChapterRefreshTest {
    private val now = 1_760_000_000_000L
    private val hour = 60 * 60 * 1000L
    private fun upload(i: Int, group: String = "G") = MangaChapter("${1000 + i}", i.toFloat(), group = group)
    private val list45 = (1..45).map { upload(it) }

    /** A fake chapter API serving [list] in 20-row pages and recording which pages were asked for. */
    private class Site(var list: List<MangaChapter>) {
        val asked = mutableListOf<Int>()
        fun page(page: Int): JSONObject {
            asked += page
            val items = JSONArray()
            list.drop((page - 1) * 20).take(20).forEach { c ->
                items.put(JSONObject().put("id", c.id).put("number", c.number.toDouble())
                    .putOpt("name", c.title).put("group", JSONObject().put("name", c.group)))
            }
            return JSONObject().put("items", items).put("pagination", JSONObject()
                .put("page", page).put("lastPage", maxOf(1, (list.size + 19) / 20)).put("total", list.size))
        }
    }

    private fun saved(list: List<MangaChapter>, age: Long = hour) = ComixSavedChapters.Saved(now - age, list)
    private fun read(site: Site, saved: ComixSavedChapters.Saved?) = runBlocking { readComixChapters(saved, now) { site.page(it) } }

    @Test fun withoutASavedListEveryPageIsReadAndTheResultIsSaved() {
        val site = Site(list45)
        val result = read(site, null)
        assertEquals(list45, result.chapters)
        assertTrue(result.traversed)
        assertEquals(listOf(1, 2, 3), site.asked)
    }

    @Test fun anUnchangedRecentListCostsTwoRequests() {
        val site = Site(list45)
        val known = saved(list45)
        val result = read(site, known)
        assertSame(known.chapters, result.chapters)
        assertFalse(result.traversed)
        assertEquals(listOf(1, 3), site.asked)
    }

    @Test fun aNewChapterReadsTheWholeList() {
        val site = Site(list45 + upload(46))
        val result = read(site, saved(list45))
        assertEquals(list45 + upload(46), result.chapters)
        assertTrue(result.traversed)
        assertEquals(listOf(1, 2, 3), site.asked)
    }

    @Test fun aRemovedUploadReadsTheWholeList() {
        val site = Site(list45 - upload(30))
        val result = read(site, saved(list45))
        assertEquals(list45 - upload(30), result.chapters)
        assertTrue(result.traversed)
        assertEquals(listOf(1, 2, 3), site.asked)
    }

    @Test fun aSameCountSwapReachingTheNewestPageIsCaught() {
        // One upload on page 2 removed and a new latest chapter added: the count is unchanged.
        val changed = list45 - upload(30) + upload(46)
        val site = Site(changed)
        val result = read(site, saved(list45))
        assertEquals(changed, result.chapters)
        assertTrue(result.traversed)
        assertEquals(listOf(1, 3, 2, 3), site.asked)
    }

    @Test fun aChangedFieldOnACheckedPageIsCaught() {
        val changed = list45.map { if (it.id == "1005") it.copy(group = "Other") else it }
        val site = Site(changed)
        val result = read(site, saved(list45))
        assertEquals(changed, result.chapters)
        assertEquals(listOf(1, 2, 3), site.asked)
    }

    @Test fun aSameCountSwapBetweenCheckedPagesWaitsForTheWeeklyRead() {
        // The accepted limit: only page 2 changed and the count held, so the saved list stays...
        val changed = list45.map { if (it.id == "1030") it.copy(id = "2030") else it }
        assertSame(list45, read(Site(changed), saved(list45)).chapters)
        // ...until it is a week old, when every page is read again.
        val site = Site(changed)
        val result = read(site, saved(list45, age = ComixChapterCheck.FULL_REFRESH_MS + 1))
        assertEquals(changed, result.chapters)
        assertTrue(result.traversed)
        assertEquals(listOf(1, 2, 3), site.asked)
    }

    @Test fun aSavedTimeInTheFutureIsNotTrusted() {
        val site = Site(list45)
        assertTrue(read(site, saved(list45, age = -hour)).traversed)
        assertEquals(listOf(1, 2, 3), site.asked)
    }

    @Test fun aSinglePageTitleIsAlwaysReadInFull() {
        val short = list45.take(7)
        val site = Site(short)
        val result = read(site, saved(short))
        assertTrue(result.traversed)
        assertEquals(listOf(1), site.asked)
    }

    @Test fun aListThatChangesMidReadFailsWithoutAPartialList() {
        val changed = list45 - upload(30) + upload(46)
        val site = Site(changed)
        val failure = runCatching {
            runBlocking {
                readComixChapters(saved(list45), now) { page ->
                    if (page == 2) site.list = changed + upload(47)
                    site.page(page)
                }
            }
        }.exceptionOrNull()
        assertTrue(failure is IllegalStateException)
        assertEquals(listOf(1, 3, 2), site.asked)
    }

    @Test fun lastPageNeedsConsistentPaginationWithinTheContract() {
        fun first(lastPage: Int?) = JSONObject().put("pagination", JSONObject().put("page", 1).put("total", 45)
            .apply { if (lastPage != null) put("lastPage", lastPage) })
        assertEquals(3, ComixChapterCheck.lastPage(first(3), 45, 20))
        assertEquals(3, ComixChapterCheck.lastPage(first(null), 45, 20))
        assertNull(ComixChapterCheck.lastPage(first(5), 45, 20))
        assertNull(ComixChapterCheck.lastPage(first(null), 20, 20))
        assertNull(ComixChapterCheck.lastPage(first(null), 4_001, 20))
        assertNull(ComixChapterCheck.lastPage(first(null), 45, 0))
    }
}
