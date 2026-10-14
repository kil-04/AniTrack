package com.sanjay.anitrack.next.data.manga

import org.junit.Assert.assertEquals
import org.junit.Test

class MangaSpreadsTest {
    private fun page(w: Int? = 800, h: Int? = 1200) = MangaPage("https://cdn.example/p.jpg", w, h)

    @Test fun coverAloneThenPairs() {
        val pages = List(6) { page() }
        assertEquals(listOf(listOf(0), listOf(1, 2), listOf(3, 4), listOf(5)), MangaSpreads.of(pages, shift = false))
    }

    @Test fun shiftPairsFromTheFirstPage() {
        val pages = List(5) { page() }
        assertEquals(listOf(listOf(0, 1), listOf(2, 3), listOf(4)), MangaSpreads.of(pages, shift = true))
    }

    @Test fun widePagesStandAlone() {
        // 0 cover, 1–2 pair, 3 is a joined double page, 4–5 pair.
        val pages = listOf(page(), page(), page(), page(1600, 1200), page(), page())
        assertEquals(listOf(listOf(0), listOf(1, 2), listOf(3), listOf(4, 5)), MangaSpreads.of(pages, shift = false))
        // Unknown sizes count as single pages.
        assertEquals(listOf(listOf(0), listOf(1, 2)), MangaSpreads.of(List(3) { page(null, null) }, shift = false))
    }

    @Test fun emptyChapter() {
        assertEquals(emptyList<List<Int>>(), MangaSpreads.of(emptyList(), shift = false))
    }
}
