package com.sanjay.anitrack.next.data.manga

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PageStripsTest {
    @Test fun recognisesLongStripsButNotOrdinaryPages() {
        assertTrue(PageStrips.isTall(1200, 16848))
        assertTrue(PageStrips.isTall(800, 2600)) // more than 3:1
        assertFalse(PageStrips.isTall(1200, 1722))
        assertFalse(PageStrips.isTall(null, 16848))
        assertFalse(PageStrips.isTall(0, 0))
    }

    @Test fun slicesCoverEveryRowOnceAndFoldATinyRemainder() {
        val slices = PageStrips.slices(16848)
        assertEquals(0, slices.first().first)
        assertEquals(16847, slices.last().last)
        assertEquals(slices.sumOf { it.last - it.first + 1 }, 16848)
        slices.zipWithNext().forEach { (a, b) -> assertEquals(a.last + 1, b.first) }
        // 4196 = 2048 + 2048 + 100: the 100-row remainder joins the last slice.
        assertEquals(listOf(0..2047, 2048..4195), PageStrips.slices(4196))
        assertEquals(emptyList<IntRange>(), PageStrips.slices(0))
    }

    @Test fun downsamplesOnlyWhenTheSourceIsAtLeastTwiceAsWide() {
        assertEquals(1, PageStrips.sampleSize(1200, 1530))
        assertEquals(1, PageStrips.sampleSize(2000, 1530))
        assertEquals(2, PageStrips.sampleSize(3200, 1530))
        assertEquals(4, PageStrips.sampleSize(6400, 1530))
    }
}
