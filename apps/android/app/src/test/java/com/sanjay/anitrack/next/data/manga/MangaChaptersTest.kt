package com.sanjay.anitrack.next.data.manga

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MangaChaptersTest {
    private fun ch(id: String, number: Float, group: String? = null) = MangaChapter(id, number, group = group)

    @Test fun normalizeKeepsOneEntryPerNumberInReadingOrder() {
        val list = MangaChapters.normalize(
            listOf(ch("c49a", 49f, "A"), ch("c49b", 49f, "B"), ch("c48", 48f, "B"), ch("c1", 1f), ch("bad", Float.NaN)),
        )
        // Group B covers more chapters (48 and 49), so it wins chapter 49 automatically.
        assertEquals(listOf("c1", "c48", "c49b"), list.map { it.id })
    }

    @Test fun normalizePrefersTheChosenGroupAndFallsBackWhereItHasNoUpload() {
        val uploads = listOf(ch("a1", 1f, "A"), ch("b1", 1f, "B"), ch("b2", 2f, "B"), ch("a3", 3f, "A"), ch("b3", 3f, "B"))
        assertEquals(listOf("a1", "b2", "a3"), MangaChapters.normalize(uploads, preferredGroup = "A").map { it.id })
        assertEquals(listOf("b1", "b2", "b3"), MangaChapters.normalize(uploads, preferredGroup = "B").map { it.id })
    }

    @Test fun listsGroupsByCoverageAndUploadsPerChapter() {
        val uploads = listOf(ch("a1", 1f, "A"), ch("b1", 1f, "B"), ch("b2", 2f, "B"), ch("x2", 2f))
        assertEquals(listOf("B" to 2, "A" to 1), MangaChapters.groups(uploads))
        assertEquals(listOf("a1", "b1"), MangaChapters.uploads(uploads)[1f]?.map { it.id })
        assertEquals(listOf("b2", "x2"), MangaChapters.uploads(uploads)[2f]?.map { it.id })
    }

    @Test fun substitutesOneChaptersUploadWithoutChangingTheRest() {
        val shown = listOf(ch("b1", 1f, "B"), ch("b2", 2f, "B"))
        assertEquals(listOf("b1", "a2"), MangaChapters.withUpload(shown, ch("a2", 2f, "A")).map { it.id })
    }

    @Test fun listsEveryUploadOrOneGroupNewestFirst() {
        val uploads = listOf(
            MangaChapter("a1", 1f, group = "A", uploadedAt = 10),
            MangaChapter("b1", 1f, group = "B", uploadedAt = 20),
            MangaChapter("a2", 2f, title = "Between Conqueror and Loser", group = "A", uploadedAt = 30),
            MangaChapter("a10", 10f, group = "A", uploadedAt = 40),
        )
        assertEquals(listOf("a10", "a2", "b1", "a1"), MangaChapters.listing(uploads, null, "", newestFirst = true).map { it.id })
        assertEquals(listOf("a1", "b1", "a2", "a10"), MangaChapters.listing(uploads, null, "", newestFirst = false).map { it.id })
        assertEquals(listOf("a10", "a2", "a1"), MangaChapters.listing(uploads, "A", "", newestFirst = true).map { it.id })
        assertEquals(listOf("a10", "b1", "a1"), MangaChapters.listing(uploads, null, "1", newestFirst = true).map { it.id })
        assertEquals(listOf("a10"), MangaChapters.listing(uploads, null, "Ch. 10", newestFirst = true).map { it.id })
        assertEquals(listOf("a2"), MangaChapters.listing(uploads, null, "conqueror", newestFirst = true).map { it.id })
    }

    @Test fun selectsARangeInEitherOrderIncludingHalfChapters() {
        val chapters = listOf(ch("c1", 1f), ch("c2", 2f), ch("c2.5", 2.5f), ch("c3", 3f), ch("c4", 4f))
        assertEquals(listOf("c2", "c2.5", "c3"), MangaChapters.inRange(chapters, 2f, 3f).map { it.id })
        assertEquals(listOf("c2", "c2.5", "c3"), MangaChapters.inRange(chapters, 3f, 2f).map { it.id })
        assertEquals(listOf("c2.5"), MangaChapters.inRange(chapters, 2.5f, 2.5f).map { it.id })
        assertEquals(emptyList<String>(), MangaChapters.inRange(chapters, 7f, 9f).map { it.id })
    }

    @Test fun downloadsARangeFromOneGroupAndFillsItsGapsOnlyWhenAsked() {
        val uploads = listOf(
            ch("a1", 1f, "A"), ch("b1", 1f, "B"),
            ch("b2", 2f, "B"), ch("c2", 2f, "C"),
            ch("a3", 3f, "A"), ch("b3", 3f, "B"),
            ch("b4", 4f, "B"),
        )
        // One upload per number, so a chapter never downloads from two groups.
        val filled = MangaChapters.rangeChoice(uploads, "A", 1f, 4f, fillGaps = true)
        assertEquals(listOf("a1", "b2", "a3", "b4"), filled.chapters.map { it.id })
        assertEquals(listOf(2f, 4f), filled.gaps.map { it.number })
        val strict = MangaChapters.rangeChoice(uploads, "A", 1f, 4f, fillGaps = false)
        assertEquals(listOf("a1", "a3"), strict.chapters.map { it.id })
        assertEquals(listOf(2f, 4f), strict.gaps.map { it.number })
        // A group with every chapter in the range has no gaps (bounds in either order).
        val complete = MangaChapters.rangeChoice(uploads, "B", 4f, 1f, fillGaps = false)
        assertEquals(listOf("b1", "b2", "b3", "b4"), complete.chapters.map { it.id })
        assertEquals(emptyList<MangaChapter>(), complete.gaps)
        // Without named groups each number still downloads once.
        assertEquals(listOf("x1", "x2"), MangaChapters.rangeChoice(listOf(ch("x1", 1f), ch("y1", 1f), ch("x2", 2f)), null, 1f, 2f, fillGaps = false).chapters.map { it.id })
    }

    @Test fun offersPresetsFromTheNextUnreadChapter() {
        val chapters = (1..40).map { ch("c$it", it.toFloat()) }
        val presets = MangaChapters.rangePresets(chapters, chapters[11]) // next unread: chapter 12
        assertEquals(
            listOf("Next 10" to (12f to 21f), "Next 25" to (12f to 36f), "All unread" to (12f to 40f), "All" to (1f to 40f)),
            presets.map { it.first to (it.second to it.third) },
        )
        // From the first chapter "All unread" equals "All", so only one is offered.
        assertEquals(listOf("Next 10", "Next 25", "All"), MangaChapters.rangePresets(chapters.take(30), null).map { it.first })
        // A short series collapses repeated presets into the broadest one.
        assertEquals(listOf("All"), MangaChapters.rangePresets(chapters.take(5), null).map { it.first })
        assertEquals(emptyList<String>(), MangaChapters.rangePresets(emptyList(), null).map { it.first })
    }

    @Test fun labelsUploadAgesLikeMangaDot() {
        val zone = java.time.ZoneOffset.UTC
        val now = java.time.LocalDateTime.of(2026, 10, 3, 12, 0).toInstant(zone).toEpochMilli()
        fun ago(minutes: Long) = MangaChapters.uploadedLabel(now - minutes * 60_000, now, zone)
        assertEquals("1m", ago(0))
        assertEquals("45m", ago(45))
        assertEquals("3h", ago(3 * 60))
        assertEquals("6d", ago(6 * 24 * 60))
        assertEquals("Sep 19", MangaChapters.uploadedLabel(java.time.LocalDateTime.of(2026, 9, 19, 8, 0).toInstant(zone).toEpochMilli(), now, zone))
        assertEquals("Dec 2, 2024", MangaChapters.uploadedLabel(java.time.LocalDateTime.of(2024, 12, 2, 8, 0).toInstant(zone).toEpochMilli(), now, zone))
    }

    @Test fun labelsWholeAndSplitChapters() {
        assertEquals("12", MangaChapters.label(12f))
        assertEquals("12.5", MangaChapters.label(12.5f))
    }

    @Test fun resumeTargetStartsAtFirstChapterWithoutHistory() {
        val chapters = listOf(ch("c1", 1f), ch("c2", 2f))
        assertEquals("c1", MangaChapters.resumeTarget(chapters, emptyMap())?.id)
        assertNull(MangaChapters.resumeTarget(emptyList(), emptyMap()))
    }

    @Test fun resumeTargetContinuesTheLatestChapterOrMovesPastAFinishedOne() {
        val chapters = listOf(ch("c1", 1f), ch("c2", 2f), ch("c3", 3f))
        val midway = mapOf(1f to ReadState(page = 19, pageCount = 20, updatedAt = 1), 2f to ReadState(4, 30, 2))
        assertEquals("c2", MangaChapters.resumeTarget(chapters, midway)?.id)
        val finished = mapOf(2f to ReadState(page = 29, pageCount = 30, updatedAt = 5))
        assertEquals("c3", MangaChapters.resumeTarget(chapters, finished)?.id)
        val caughtUp = mapOf(3f to ReadState(page = 9, pageCount = 10, updatedAt = 9))
        assertEquals("c3", MangaChapters.resumeTarget(chapters, caughtUp)?.id)
    }
}
