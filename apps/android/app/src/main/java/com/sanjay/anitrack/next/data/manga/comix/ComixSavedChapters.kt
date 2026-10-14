package com.sanjay.anitrack.next.data.manga.comix

import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.SourceTitle
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * The last complete Comix chapter list per title, and confirmed AniList matches,
 * kept on disk so a title page shows them at once after a restart (like desktop
 * `savedChapters`). Only lists that passed [ComixChapterAccumulator] are written;
 * a file that fails any check on read is ignored whole, never partly shown.
 */
internal class ComixSavedChapters(private val dir: File) {
    /** A saved list and when a complete traversal last produced it (epoch ms). */
    data class Saved(val at: Long, val chapters: List<MangaChapter>)

    fun read(hid: String): Saved? = runCatching {
        val file = listFile(hid) ?: return null
        if (!file.isFile || file.length() > MAX_FILE_BYTES) return null
        val json = JSONObject(file.readText())
        if (json.opt("v") != VERSION || json.opt("hid") != hid) return null
        val at = (json.opt("at") as? Number)?.takeIf { it is Int || it is Long }?.toLong()?.takeIf { it > 0 } ?: return null
        val rows = json.optJSONArray("chapters") ?: return null
        val total = json.opt("total") as? Int ?: return null
        if (total !in 1..MAX_CHAPTERS || rows.length() != total) return null
        val seen = HashSet<String>(total)
        Saved(at, List(total) { i ->
            val chapter = chapter(rows.optJSONObject(i)) ?: return null
            if (!seen.add(chapter.id)) return null
            chapter
        })
    }.getOrNull()

    fun write(hid: String, chapters: List<MangaChapter>, at: Long = System.currentTimeMillis()) {
        val file = listFile(hid) ?: return
        if (chapters.isEmpty() || chapters.size > MAX_CHAPTERS) return
        val rows = JSONArray()
        for (c in chapters) {
            rows.put(JSONObject().put("id", c.id).put("number", c.number.toDouble())
                .putOpt("title", c.title).putOpt("group", c.group)
                .putOpt("pageCount", c.pageCount).putOpt("uploadedAt", c.uploadedAt))
        }
        val text = JSONObject().put("v", VERSION).put("hid", hid).put("at", at).put("total", chapters.size)
            .put("chapters", rows).toString()
        if (text.length > MAX_FILE_BYTES) return
        replace(file, text)
        prune()
    }

    fun title(anilistId: Int): SourceTitle? = runCatching {
        val saved = matches().optJSONObject(anilistId.toString()) ?: return null
        val id = (saved.opt("id") as? String)?.takeIf { HID.matches(it) } ?: return null
        val name = (saved.opt("title") as? String)?.takeIf { it.isNotBlank() && it.length <= 300 } ?: return null
        SourceTitle("comix", id, name)
    }.getOrNull()

    fun saveTitle(anilistId: Int, title: SourceTitle) {
        if (title.sourceId != "comix" || !HID.matches(title.id) || title.title.isBlank()) return
        val all = matches()
        all.remove(anilistId.toString())
        // JSONObject keeps no order, so each match carries a save sequence; the oldest go first.
        fun seq(key: String) = all.optJSONObject(key)?.optLong("n") ?: 0L
        while (all.length() >= MAX_TITLES) all.remove(all.keys().asSequence().minBy(::seq))
        val next = (all.keys().asSequence().maxOfOrNull(::seq) ?: 0L) + 1
        all.put(anilistId.toString(), JSONObject().put("id", title.id).put("title", title.title.take(300)).put("n", next))
        replace(File(dir, MATCHES), all.toString())
    }

    private fun matches(): JSONObject {
        val file = File(dir, MATCHES)
        if (!file.isFile || file.length() > MAX_FILE_BYTES) return JSONObject()
        return runCatching { JSONObject(file.readText()) }.getOrDefault(JSONObject())
    }

    private fun listFile(hid: String): File? = if (HID.matches(hid)) File(dir, "$hid.json") else null

    /** Writes beside the target and renames over it, so a crash leaves the old file or the new one. */
    private fun replace(file: File, text: String) {
        dir.mkdirs()
        val temp = File(dir, "${file.name}.tmp")
        temp.writeText(text)
        if (!temp.renameTo(file)) {
            file.delete()
            if (!temp.renameTo(file)) temp.delete()
        }
    }

    /** Keeps the [MAX_LISTS] most recently saved lists. */
    private fun prune() {
        val lists = dir.listFiles { f -> f.isFile && f.name.endsWith(".json") && f.name != MATCHES }.orEmpty()
        if (lists.size <= MAX_LISTS) return
        lists.sortedByDescending { it.lastModified() }.drop(MAX_LISTS).forEach { it.delete() }
    }

    private fun chapter(row: JSONObject?): MangaChapter? {
        row ?: return null
        val id = (row.opt("id") as? String)?.takeIf { CHAPTER_ID.matches(it) } ?: return null
        val number = (row.opt("number") as? Number)?.toFloat()?.takeIf { it.isFinite() && it >= 0f } ?: return null
        // An optional field is either absent or valid; anything else rejects the row (and so the list).
        fun text(key: String, max: Int): String? {
            if (!row.has(key)) return null
            return (row.opt(key) as? String)?.takeIf { it.isNotBlank() && it.length <= max } ?: throw InvalidRow()
        }
        fun whole(key: String, range: LongRange): Long? {
            if (!row.has(key)) return null
            val n = row.opt(key) as? Number ?: throw InvalidRow()
            return n.toLong().takeIf { it.toDouble() == n.toDouble() && it in range } ?: throw InvalidRow()
        }
        return try {
            MangaChapter(id, number, text("title", 300), text("group", 120),
                whole("pageCount", 0L..10_000L)?.toInt(), whole("uploadedAt", 1L..Long.MAX_VALUE))
        } catch (_: InvalidRow) { null }
    }

    private class InvalidRow : RuntimeException()

    companion object {
        const val VERSION = 1
        const val MAX_LISTS = 40
        const val MAX_TITLES = 200
        /** The accumulator's own chapter-total cap. */
        const val MAX_CHAPTERS = 20_000
        const val MAX_FILE_BYTES = 4_000_000L
        private const val MATCHES = "titles.json"
        private val HID = Regex("[a-zA-Z0-9]{1,32}")
        private val CHAPTER_ID = Regex("[0-9]{1,15}")
    }
}
