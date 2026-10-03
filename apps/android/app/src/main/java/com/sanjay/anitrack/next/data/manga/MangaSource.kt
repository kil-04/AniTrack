package com.sanjay.anitrack.next.data.manga

import com.sanjay.anitrack.next.data.Manga

/** A title as a reading source knows it, matched to an AniList [Manga]. */
data class SourceTitle(val sourceId: String, val id: String, val title: String)

/** One upload of a chapter. Several groups can upload the same [number]. */
data class MangaChapter(
    val id: String,
    val number: Float,
    val title: String? = null,
    val group: String? = null,
    val pageCount: Int? = null,
    /** When the source received this upload (epoch milliseconds). */
    val uploadedAt: Long? = null,
)

/** One page image. [headers] apply to this exact image URL only. */
data class MangaPage(
    val url: String,
    val width: Int? = null,
    val height: Int? = null,
    val headers: Map<String, String> = emptyMap(),
)

interface MangaSource {
    val id: String
    val label: String
    /** Optional user-operated connection screen; never opened automatically. */
    val connectionActivity: Class<out android.app.Activity>? get() = null
    suspend fun find(manga: Manga): SourceTitle?
    suspend fun chapters(title: SourceTitle): List<MangaChapter>
    suspend fun pages(title: SourceTitle, chapter: MangaChapter): List<MangaPage>
    /** Providers with encoded page images return a decoded cache file here. */
    suspend fun resolvePage(page: MangaPage): MangaPage = page
}

object MangaSources {
    /**
     * Registered reading sources, in preference order. Only MangaDot for now
     * (user choice, 2026-10-03): it has the largest catalogue and needs a
     * one-time user-completed Cloudflare check. MangaPill, MangaDex
     * (data/manga/mangapill, mangadex) and Comix (data/manga/comix) stay
     * implemented but unregistered; add them here to offer them again.
     */
    val all: List<MangaSource> = listOf(
        com.sanjay.anitrack.next.data.manga.mangadot.MangaDotSource,
    )

    fun byId(id: String): MangaSource? = all.firstOrNull { it.id == id }
}

object MangaChapters {
    private fun valid(chapters: List<MangaChapter>) = chapters.filter { it.number.isFinite() && it.number >= 0f }

    /**
     * One upload per chapter number, ascending. [preferredGroup] wins where it
     * uploaded that number; otherwise (and when no group is chosen) the group
     * covering the most chapters wins, so reading keeps one group's style.
     */
    fun normalize(chapters: List<MangaChapter>, preferredGroup: String? = null): List<MangaChapter> {
        val usable = valid(chapters)
        val coverage = groups(usable).mapIndexed { rank, entry -> entry.first to rank }.toMap()
        return usable.groupBy { it.number }
            .map { (_, same) ->
                same.firstOrNull { preferredGroup != null && it.group == preferredGroup }
                    ?: same.minByOrNull { coverage[it.group] ?: Int.MAX_VALUE }
                    ?: same.first()
            }
            .sortedBy { it.number }
    }

    /** Groups with how many chapter numbers each uploaded, most first (ties keep feed order). */
    fun groups(chapters: List<MangaChapter>): List<Pair<String, Int>> =
        valid(chapters).filter { it.group != null }
            .groupBy { it.group!! }
            .map { (group, uploads) -> group to uploads.map { it.number }.distinct().size }
            .sortedByDescending { it.second }

    /** Every upload of each chapter number, for choosing a group per chapter. */
    fun uploads(chapters: List<MangaChapter>): Map<Float, List<MangaChapter>> =
        valid(chapters).groupBy { it.number }

    /** [chapters] (one per number) with [choice] standing in for its number. */
    fun withUpload(chapters: List<MangaChapter>, choice: MangaChapter): List<MangaChapter> =
        chapters.map { if (it.number == choice.number) choice else it }

    /**
     * The chapter list as rows, like MangaDot's: every upload (or one [group]'s),
     * matching [query] by chapter number or title, newest or oldest first.
     */
    fun listing(uploads: List<MangaChapter>, group: String?, query: String, newestFirst: Boolean): List<MangaChapter> {
        val q = query.trim().lowercase().removePrefix("ch.").removePrefix("chapter").trim()
        val rows = valid(uploads)
            .filter { group == null || it.group == group }
            .filter { q.isEmpty() || label(it.number).startsWith(q) || it.title?.lowercase()?.contains(q) == true }
            .sortedWith(compareBy<MangaChapter>({ it.number }, { it.uploadedAt ?: 0L }))
        return if (newestFirst) rows.asReversed() else rows
    }

    /** Chapters numbered [from]..[to] (either order, inclusive), in reading order. */
    fun inRange(chapters: List<MangaChapter>, from: Float, to: Float): List<MangaChapter> {
        val low = minOf(from, to)
        val high = maxOf(from, to)
        return chapters.filter { it.number in low..high }.sortedBy { it.number }
    }

    /** What a range download fetches ([chapters]) and the numbers its group didn't upload ([gaps]). */
    data class RangeChoice(val chapters: List<MangaChapter>, val gaps: List<MangaChapter>)

    /**
     * A range download from one [group]: one upload per chapter number in
     * [from]..[to], never the same chapter from two groups. Where [group] has no
     * upload of a number, [fillGaps] takes another group's (the group with the
     * most chapters first); otherwise that number is left out. A null [group]
     * (the source names no groups) takes one upload per number.
     */
    fun rangeChoice(uploads: List<MangaChapter>, group: String?, from: Float, to: Float, fillGaps: Boolean): RangeChoice {
        val all = inRange(normalize(uploads, group), from, to)
        val gaps = if (group == null) emptyList() else all.filter { it.group != group }
        return RangeChoice(if (fillGaps) all else all.filter { group == null || it.group == group }, gaps)
    }

    /**
     * Download presets as (label, from, to) over one-per-number [chapters]:
     * the next 10 and 25 from [start] (the next unread chapter), everything
     * from [start] on, and everything. Presets that would repeat are dropped.
     */
    fun rangePresets(chapters: List<MangaChapter>, start: MangaChapter?): List<Triple<String, Float, Float>> {
        val ordered = chapters.sortedBy { it.number }
        if (ordered.isEmpty()) return emptyList()
        val first = ordered.indexOfFirst { it.number == start?.number }.coerceAtLeast(0)
        fun to(count: Int) = ordered[minOf(first + count - 1, ordered.lastIndex)].number
        val presets = listOf(
            Triple("Next 10", ordered[first].number, to(10)),
            Triple("Next 25", ordered[first].number, to(25)),
            Triple(if (first == 0) "All" else "All unread", ordered[first].number, ordered.last().number),
            Triple("All", ordered.first().number, ordered.last().number),
        )
        // When presets coincide (a short series), keep the broadest label ("All").
        return presets.asReversed().distinctBy { it.second to it.third }.asReversed()
    }

    /** "5m", "3h", "6d" for the past week; then "Sep 19", or "Sep 19, 2024" in another year. */
    fun uploadedLabel(epochMs: Long, nowMs: Long, zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): String {
        val minutes = (nowMs - epochMs) / 60_000
        if (minutes in 0 until 60) return "${minutes.coerceAtLeast(1)}m"
        if (minutes in 60 until 24 * 60) return "${minutes / 60}h"
        if (minutes in 24 * 60 until 7 * 24 * 60) return "${minutes / (24 * 60)}d"
        val date = java.time.Instant.ofEpochMilli(epochMs).atZone(zone).toLocalDate()
        val thisYear = java.time.Instant.ofEpochMilli(nowMs).atZone(zone).year
        val month = date.month.getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.ENGLISH)
        return if (date.year == thisYear) "$month ${date.dayOfMonth}" else "$month ${date.dayOfMonth}, ${date.year}"
    }

    fun label(number: Float): String =
        if (number == number.toInt().toFloat()) number.toInt().toString() else number.toString()

    /** The chapter to open from a detail page: the furthest one read (or the next one
     *  when it was finished), else the first chapter. */
    fun resumeTarget(chapters: List<MangaChapter>, progress: Map<Float, ReadState>): MangaChapter? {
        if (chapters.isEmpty()) return null
        val last = progress.maxByOrNull { it.value.updatedAt } ?: return chapters.first()
        val index = chapters.indexOfFirst { it.number == last.key }
        if (index < 0) return chapters.first()
        return if (last.value.finished) chapters.getOrNull(index + 1) ?: chapters[index] else chapters[index]
    }
}

data class ReadState(val page: Int, val pageCount: Int, val updatedAt: Long) {
    val finished: Boolean get() = pageCount > 0 && page >= pageCount - 1
}
