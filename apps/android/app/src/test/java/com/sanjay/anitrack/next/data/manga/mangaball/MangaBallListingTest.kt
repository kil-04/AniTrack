package com.sanjay.anitrack.next.data.manga.mangaball

import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.MangaSourceException
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** The same cases as tests/manga.test.mjs's readMangaBallListing test (the TS twin). */
class MangaBallListingTest {
    private val retryable = { e: Throwable ->
        val status = (e as? MangaSourceException)?.status
        e is MangaSourceException && (status == null || (status >= 500 && status != 503))
    }

    private class Fake(private val failures: MutableMap<Int, Pair<Int, Int?>> = mutableMapOf()) {
        val calls = java.util.Collections.synchronizedList(ArrayList<Pair<Int, Int>>())
        private val inFlight = AtomicInteger()
        val peak = AtomicInteger()

        suspend fun page(page: Int, lane: Int): MangaBallParser.ChapterPage {
            calls += page to lane
            val now = inFlight.incrementAndGet()
            peak.accumulateAndGet(now) { a, b -> maxOf(a, b) }
            delay(if (page == 2) 15 else 5)
            inFlight.decrementAndGet()
            synchronized(failures) {
                failures[page]?.let { (times, status) ->
                    if (times > 1) failures[page] = times - 1 to status else failures.remove(page)
                    throw MangaSourceException("page $page", status)
                }
            }
            return MangaBallParser.ChapterPage(listOf(MangaChapter("p$page", page.toFloat())), 6)
        }
    }

    private fun run(fake: Fake) = runBlocking { readMangaBallListing(fake::page, retryable, wait = {}) }

    @Test fun readsPagesTwoAtATimeInPageOrder() {
        assertEquals(2, MANGABALL_LIST_LANES)
        assertEquals(1, MANGABALL_PAGE_RETRIES)
        val fake = Fake()
        val listing = run(fake)
        assertNull(listing.failure)
        // Page order is kept even though page 2 finishes after page 3.
        assertEquals(listOf("p1", "p2", "p3", "p4", "p5", "p6"), listing.chapters.map { it.id })
        assertEquals(2, fake.peak.get())
        assertTrue(fake.calls.any { it.second == 1 })
    }

    @Test fun retriesATimeoutOnce() {
        val fake = Fake(mutableMapOf(4 to (1 to null)))
        val listing = run(fake)
        assertNull(listing.failure)
        assertEquals(6, listing.chapters.size)
        assertEquals(2, fake.calls.count { it.first == 4 })
    }

    @Test fun keepsPagesReadWhenALaterPageIsLimited() {
        val fake = Fake(mutableMapOf(3 to (9 to 429)))
        val listing = run(fake)
        assertEquals(429, (listing.failure as MangaSourceException).status)
        assertEquals(1, fake.calls.count { it.first == 3 })
        val ids = listing.chapters.map { it.id }
        assertTrue("p1" in ids && "p2" in ids && "p3" !in ids)
        assertTrue(fake.calls.size < 6)
    }

    @Test fun firstPageFailingStillThrows() {
        try {
            run(Fake(mutableMapOf(1 to (9 to 502))))
            fail("expected the first page's failure")
        } catch (e: MangaSourceException) {
            assertEquals("page 1", e.message)
        }
    }
}
