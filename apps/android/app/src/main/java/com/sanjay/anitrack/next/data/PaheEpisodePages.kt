package com.sanjay.anitrack.next.data

/**
 * Page arithmetic for AnimePahe's episode list (sorted oldest first, a fixed number
 * per page). A long show (One Piece: 40 pages) is opened from its first and last
 * page alone: when the numbering is contiguous, every episode in between is known,
 * and its page is read only when that episode is played.
 */
internal object PaheEpisodePages {
    /** Shows with at most this many pages are read in full. */
    const val READ_ALL_PAGES = 4

    /**
     * Episode numbers [first]..[last] when they are whole numbers and [total] says
     * none are missing or extra (no recaps or .5 specials); null otherwise.
     */
    fun contiguousNumbers(first: Float, last: Float, total: Int): List<Int>? {
        if (first % 1f != 0f || last % 1f != 0f) return null
        val from = first.toInt()
        val to = last.toInt()
        if (from < 0 || to < from || to - from + 1 != total) return null
        return (from..to).toList()
    }

    /** The page that holds episode [number], counting from the show's [first] episode. */
    fun pageOf(number: Int, first: Int, perPage: Int): Int {
        require(perPage > 0 && number >= first)
        return (number - first) / perPage + 1
    }
}
