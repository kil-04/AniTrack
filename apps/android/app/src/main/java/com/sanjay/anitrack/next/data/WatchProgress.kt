package com.sanjay.anitrack.next.data

/**
 * What watching an episode through does to a list entry: the Kotlin twin of
 * packages/shared/watch-progress.ts, so desktop and Android decide alike.
 */
internal object WatchProgress {
    data class Entry(val status: String, val episodesWatched: Int)

    /**
     * The entry after [episode] was watched through, or null to leave the list alone.
     * A completed show stays completed while it is rewatched; the episode count never
     * goes backwards (watching an earlier episode keeps the furthest one); a dropped
     * show stays dropped; the last episode completes the show.
     */
    fun after(existing: Entry?, episode: Int, totalEpisodes: Int?): Entry? {
        if (existing?.status == "completed") return null
        val episodes = maxOf(episode, existing?.episodesWatched ?: 0)
        if (existing?.status == "dropped") return Entry("dropped", episodes)
        val total = totalEpisodes?.takeIf { it > 0 }
        return Entry(if (total != null && episodes >= total) "completed" else "watching", episodes)
    }
}
