package com.sanjay.anitrack.next.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MangaReaderProgressTest {
    @Test fun slowImageCompletionProducesProgressWithoutAnotherPageTurn() {
        val displayed = mutableSetOf<Int>()
        val units = listOf(listOf(0), listOf(1))
        assertNull(pagedReaderSavePage(0, units, 2, displayed::contains))
        displayed += 0
        assertEquals(0, pagedReaderSavePage(0, units, 2, displayed::contains))
    }

    @Test fun failedSecondPageOfPairDoesNotCountAsRead() {
        assertEquals(0, pagedReaderSavePage(0, listOf(listOf(0, 1)), 2) { it == 0 })
    }

    @Test fun secondPageCompletionAdvancesTheSamePair() {
        val displayed = mutableSetOf(0)
        val units = listOf(listOf(0, 1))
        assertEquals(0, pagedReaderSavePage(0, units, 2, displayed::contains))
        displayed += 1
        assertEquals(1, pagedReaderSavePage(0, units, 2, displayed::contains))
    }

    @Test fun anUnloadedUnitDoesNotReuseOtherDisplayedPages() {
        assertNull(pagedReaderSavePage(1, listOf(listOf(0), listOf(1)), 2) { it == 0 })
    }

    @Test fun endCardDoesNotFinishWhenLastImageFailed() {
        assertNull(pagedReaderSavePage(2, listOf(listOf(0), listOf(1)), 2) { it == 0 })
    }

    @Test fun endCardCanFinishOnlyAfterTheLastImageDisplayed() {
        assertEquals(1, pagedReaderSavePage(2, listOf(listOf(0), listOf(1)), 2) { it == 1 })
    }

    @Test fun emptyAndOutOfBoundsLayoutsNeverSaveInvalidPages() {
        assertNull(pagedReaderSavePage(0, emptyList(), 0) { true })
        assertNull(pagedReaderSavePage(-1, listOf(listOf(0)), 1) { true })
        assertNull(pagedReaderSavePage(2, listOf(listOf(0)), 1) { true })
        assertNull(pagedReaderSavePage(0, listOf(listOf(-1, 2)), 1) { true })
    }
}
