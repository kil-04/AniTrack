package com.sanjay.anitrack.next.data.manga.comix

import com.sanjay.anitrack.next.data.manga.MangaChapter
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ComixChapterAccumulatorTest {
    private fun page(total: Any) = JSONObject().put("meta", JSONObject().put("total", total))
    private fun row(id: String, number: Float = 1f) = MangaChapter(id, number)

    @Test fun onlyCompleteStableIdCountProducesAResult() {
        val collector = ComixChapterAccumulator()
        assertNull(collector.append(page(3), listOf(row("1"), row("2")), true))
        val complete = collector.append(page(3), listOf(row("3", 1.5f)), false)!!
        assertEquals(listOf("1", "2", "3"), complete.map { it.id })
        assertEquals(listOf(1f, 1f, 1.5f), complete.map { it.number })
    }

    @Test fun genuineEmptyTitleIsCompleteWithoutInventedRows() {
        assertTrue(ComixChapterAccumulator().append(page(0), emptyList(), false)!!.isEmpty())
    }

    @Test fun missingInvalidOrExcessiveTotalsCannotSucceed() {
        for (value in listOf(JSONObject(), page("1"), page(-1), page(1.5), page(20_001), page(JSONObject.NULL))) {
            assertThrows(IllegalStateException::class.java) {
                ComixChapterAccumulator().append(value, listOf(row("1")), false)
            }
        }
    }

    @Test fun changingTotalRequiresFreshTraversal() {
        val collector = ComixChapterAccumulator()
        assertNull(collector.append(page(3), listOf(row("1")), true))
        assertThrows(IllegalStateException::class.java) {
            collector.append(page(4), listOf(row("2")), false)
        }
    }

    @Test fun incompleteOrDuplicateLastPageCannotBecomeCachedSuccess() {
        assertThrows(IllegalStateException::class.java) {
            ComixChapterAccumulator().append(page(2), listOf(row("1")), false)
        }
        assertThrows(IllegalStateException::class.java) {
            ComixChapterAccumulator().append(page(2), listOf(row("1"), row("1")), false)
        }
        val collector = ComixChapterAccumulator()
        assertNull(collector.append(page(2), listOf(row("1")), true))
        assertThrows(IllegalStateException::class.java) {
            collector.append(page(2), listOf(row("1")), false)
        }
    }

    @Test fun excessRowsOrContradictoryProgressAreRefused() {
        assertThrows(IllegalStateException::class.java) {
            ComixChapterAccumulator().append(page(1), listOf(row("1"), row("2")), false)
        }
        assertThrows(IllegalStateException::class.java) {
            ComixChapterAccumulator().append(page(1), emptyList(), true)
        }
        assertThrows(IllegalStateException::class.java) {
            ComixChapterAccumulator().append(page(1), listOf(row("1")), true)
        }
    }
}
