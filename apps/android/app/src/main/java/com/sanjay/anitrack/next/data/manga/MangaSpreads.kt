package com.sanjay.anitrack.next.data.manga

/** How pages pair up when two are shown side by side, like an open book. */
object MangaSpreads {
    /**
     * Groups page indexes into what's shown together: the first page (usually the
     * cover) alone, then pairs. A wide page (an already-joined double-page scan)
     * always stands alone. [shift] pairs from the first page instead, for chapters
     * whose spreads come out misaligned.
     */
    fun of(count: Int, shift: Boolean, wide: (Int) -> Boolean): List<List<Int>> = buildList {
        var i = 0
        if (!shift && count > 0) {
            add(listOf(0))
            i = 1
        }
        while (i < count) {
            if (!wide(i) && i + 1 < count && !wide(i + 1)) {
                add(listOf(i, i + 1))
                i += 2
            } else {
                add(listOf(i))
                i += 1
            }
        }
    }

    /** Pairs [pages] using the sizes the source reported (unknown sizes count as single pages). */
    fun of(pages: List<MangaPage>, shift: Boolean): List<List<Int>> = of(pages.size, shift) { i ->
        val w = pages[i].width
        val h = pages[i].height
        w != null && h != null && w > h
    }
}
