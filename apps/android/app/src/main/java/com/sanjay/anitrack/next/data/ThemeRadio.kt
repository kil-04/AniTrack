package com.sanjay.anitrack.next.data

import kotlin.random.Random

/** A shuffled station of openings and endings from the shows you've watched. */
object ThemeRadio {
    private const val MAX_SHOWS = 50
    /** Long-running shows have dozens of themes; a few each keeps the mix varied. */
    private const val PER_SHOW = 4
    private const val MAX_SONGS = 80

    /** Builds the queue from Continue Watching and your Completed / Watching lists. */
    suspend fun build(random: Random = Random.Default): List<ThemeSong> {
        val ids = buildList {
            Db.continueWatching(60).forEach { add(it.animeId) }
            Db.listByStatus("completed").forEach { add(it.animeId) }
            Db.listByStatus("watching").forEach { add(it.animeId) }
        }.distinct().take(MAX_SHOWS)
        if (ids.isEmpty()) return emptyList()
        val shows = AniList.byIds(ids)
        val themes = AnimeThemes.forAnime(shows)
        return mix(themes.values.flatten(), random)
    }

    /**
     * Up to [PER_SHOW] songs a show (openings first), shuffled so the same show
     * doesn't play twice in a row while another one could.
     */
    fun mix(songs: List<ThemeSong>, random: Random = Random.Default): List<ThemeSong> {
        val groups = songs.filter { it.audioUrl != null }
            .groupBy { it.animeId }
            .mapValues { (_, list) ->
                list.sortedBy { if (it.isOpening) 0 else 1 }.take(PER_SHOW).shuffled(random).toMutableList()
            }
            .toMutableMap()
        val out = mutableListOf<ThemeSong>()
        var last: Int? = null
        while (groups.isNotEmpty() && out.size < MAX_SONGS) {
            val sizes = groups.mapValues { it.value.size }
            val left = sizes.values.sum()
            val others = groups.keys.filter { it != last }
            // Only picks that still leave a repeat-free order for the rest.
            val safe = others.filter { id -> canSpread(sizes + (id to sizes.getValue(id) - 1), id, left - 1) }
            val choices = safe.ifEmpty { others }.ifEmpty { groups.keys.toList() }
            // Weighted by what's left, so a show's songs spread through the whole queue.
            var pick = random.nextInt(choices.sumOf { sizes.getValue(it) })
            val id = choices.first { pick -= sizes.getValue(it); pick < 0 }
            val queue = groups.getValue(id)
            out += queue.removeAt(0)
            if (queue.isEmpty()) groups.remove(id)
            last = id
        }
        return out
    }

    /**
     * Whether [count] songs split as [sizes] can follow a song from [last] with no
     * show twice in a row: [last] fits in every other slot after the first, any
     * other show in every other slot.
     */
    private fun canSpread(sizes: Map<Int, Int>, last: Int, count: Int): Boolean {
        val again = sizes[last] ?: 0
        val others = sizes.filterKeys { it != last }.values.maxOrNull() ?: 0
        return again <= count / 2 && others <= (count + 1) / 2
    }
}
