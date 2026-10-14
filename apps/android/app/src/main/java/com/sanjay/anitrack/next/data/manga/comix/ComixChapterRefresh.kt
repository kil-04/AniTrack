package com.sanjay.anitrack.next.data.manga.comix

import com.sanjay.anitrack.next.data.manga.MangaChapter
import org.json.JSONObject

/** A chapter list, and whether a full traversal just produced it (only those are saved). */
internal class ComixChapterResult(val chapters: List<MangaChapter>, val traversed: Boolean)

/**
 * Reads a title's chapter list through [read], one API page per call (the session
 * paces them). A recent [saved] list is kept when page 1 and the newest page still
 * match it exactly: two requests instead of the whole paced traversal. Any
 * difference, or no recent saved list, reads every page, and only a list that
 * passes [ComixChapterAccumulator] is returned.
 */
internal suspend fun readComixChapters(
    saved: ComixSavedChapters.Saved?,
    now: Long,
    read: suspend (page: Int) -> JSONObject,
): ComixChapterResult {
    val known = saved?.takeIf { ComixChapterCheck.recent(it, now) }?.chapters
    val all = ComixChapterAccumulator()
    for (page in 1..ComixChapterCheck.MAX_PAGES) {
        val value = read(page)
        val rows = ComixProtocol.chapters(value)
        all.append(value, rows, ComixProtocol.hasNext(value, page))?.let { return ComixChapterResult(it, traversed = true) }
        if (page == 1 && known != null && ComixChapterCheck.unchanged(known, value, rows, read)) {
            return ComixChapterResult(known, traversed = false)
        }
    }
    error("Comix chapter list exceeds the supported limit; no partial list was saved.")
}

internal object ComixChapterCheck {
    /** The request contract's page cap. */
    const val MAX_PAGES = 200
    /**
     * A saved list is re-read in full once it is this old, even when the quick check
     * passes: a same-count change between the first and last pages is only seen then.
     */
    const val FULL_REFRESH_MS = 7L * 24 * 60 * 60 * 1000

    fun recent(saved: ComixSavedChapters.Saved, now: Long) = now - saved.at in 0L..FULL_REFRESH_MS

    /** Whether page 1 ([first], parsed as [rows]) and the last page are exactly [known]'s. */
    suspend fun unchanged(
        known: List<MangaChapter>,
        first: JSONObject,
        rows: List<MangaChapter>,
        read: suspend (page: Int) -> JSONObject,
    ): Boolean {
        val total = ComixChapterAccumulator.total(first)
        val pageSize = ComixProtocol.items(first).length()
        if (!samePage(known, 1, pageSize, total, rows)) return false
        val last = lastPage(first, total, pageSize) ?: return false
        val value = read(last)
        return !ComixProtocol.hasNext(value, last) && ComixChapterAccumulator.total(value) == total &&
            samePage(known, last, pageSize, total, ComixProtocol.chapters(value))
    }

    /** The page holding the newest uploads, when it is a later page the request contract allows. */
    fun lastPage(first: JSONObject, total: Int, pageSize: Int): Int? {
        if (pageSize < 1) return null
        val computed = (total + pageSize - 1) / pageSize
        val pagination = first.optJSONObject("pagination") ?: first.optJSONObject("meta")
        val stated = pagination?.optInt("lastPage", pagination.optInt("last_page", -1)) ?: -1
        if (stated >= 1 && stated != computed) return null
        return computed.takeIf { it in 2..MAX_PAGES }
    }

    /** [rows] must be exactly [known]'s slice for [page]: same uploads, every field equal. */
    fun samePage(known: List<MangaChapter>, page: Int, pageSize: Int, total: Int, rows: List<MangaChapter>): Boolean {
        if (total != known.size || pageSize < 1 || page < 1) return false
        val from = (page - 1) * pageSize
        val to = minOf(from + pageSize, total)
        if (from >= to || rows.size != to - from) return false
        return rows.toSet() == known.subList(from, to).toSet()
    }
}
