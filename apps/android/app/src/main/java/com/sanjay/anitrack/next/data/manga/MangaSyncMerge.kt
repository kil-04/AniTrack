package com.sanjay.anitrack.next.data.manga

import java.math.BigDecimal
import org.json.JSONObject

/**
 * Cross-device manga reading sync rules (Continue Reading and read marks): the
 * Kotlin twin of packages/shared/manga-sync.ts. Same gist file, wire format,
 * chapter keys and merge decisions, so desktop and Android converge.
 *
 *   { "v": 1,
 *     "manga":   { "<mangaId>": { "title": string, "cover": string | null } },
 *     "reading": { "<mangaId>:<chapterKey>": row },
 *     "deleted": { "<mangaId>": ms, "<mangaId>:<chapterKey>": ms } }
 *
 * Rows merge last-write-wins by `updatedAt`. A removal hides every row of that
 * manga (Continue Reading) or that one chapter (marked unread) not newer than it.
 */
internal object MangaSyncMerge {
    const val FILE = "anitrack-manga-sync.json"
    const val TOMBSTONE_TTL_MS = 90L * 24 * 3600 * 1000
    const val MAX_ROWS = 20_000

    data class Row(
        val mangaId: Int,
        val chapter: Double,
        val chapterId: String,
        val page: Int,
        val pageCount: Int,
        val sourceId: String,
        val updatedAt: Long,
    )

    data class Meta(val title: String, val cover: String?)

    /** A local reading-table row: the synced fields plus the card's title and cover. */
    data class LocalRow(val row: Row, val title: String, val cover: String?)

    data class Doc(
        val manga: Map<String, Meta> = emptyMap(),
        val reading: Map<String, Row> = emptyMap(),
        val deleted: Map<String, Long> = emptyMap(),
    )

    data class Plan(val upsert: List<LocalRow>, val remove: List<Pair<Int, Double>>, val doc: Doc, val changed: Boolean)

    private val sourceId = Regex("[a-z0-9]{1,20}")
    private val deletedKey = Regex("\\d{1,9}(:\\d{1,6}(\\.\\d{1,4})?)?")
    private val mangaKey = Regex("\\d{1,9}")

    /** Canonical chapter number text, the same on desktop: 4 decimals, no trailing zeros. */
    fun chapterKey(chapter: Double): String =
        BigDecimal.valueOf(rounded(chapter)).stripTrailingZeros().toPlainString()

    fun readingKey(mangaId: Int, chapter: Double) = "$mangaId:${chapterKey(chapter)}"

    /** Android keeps chapters as Float; 7.2f widens to 7.199999809265137, which rounds back to 7.2. */
    fun rounded(chapter: Double): Double = Math.round(chapter * 10_000.0) / 10_000.0

    private fun integral(value: Any?): Long? = when (value) {
        is Int -> value.toLong()
        is Long -> value
        else -> null
    }

    /** A validated row, or null. */
    fun row(json: JSONObject?): Row? {
        json ?: return null
        val mangaId = integral(json.opt("mangaId"))?.takeIf { it in 1..Int.MAX_VALUE.toLong() } ?: return null
        val chapter = (json.opt("chapter") as? Number)?.toDouble()?.takeIf { it.isFinite() && it in 0.0..100_000.0 } ?: return null
        val chapterId = (json.opt("chapterId") as? String)?.takeIf { it.isNotEmpty() && it.length <= 64 } ?: return null
        val pageCount = integral(json.opt("pageCount"))?.takeIf { it in 1..2000 } ?: return null
        val page = integral(json.opt("page"))?.takeIf { it in 0 until pageCount } ?: return null
        val source = (json.opt("sourceId") as? String)?.takeIf { sourceId.matches(it) } ?: return null
        val updatedAt = integral(json.opt("updatedAt"))?.takeIf { it > 0 } ?: return null
        return Row(mangaId.toInt(), rounded(chapter), chapterId, page.toInt(), pageCount.toInt(), source, updatedAt)
    }

    /** The gist file. Absent is empty; malformed throws, so nothing unreadable is ever overwritten. */
    fun parse(content: String?): Doc {
        if (content.isNullOrBlank()) return Doc()
        val json = JSONObject(content)
        fun section(name: String): JSONObject? =
            if (!json.has(name) || json.isNull(name)) JSONObject()
            else json.opt(name) as? JSONObject
        val reading = section("reading") ?: error("The manga sync file has an invalid reading section.")
        val manga = section("manga") ?: error("The manga sync file has an invalid manga section.")
        val deleted = section("deleted") ?: error("The manga sync file has an invalid removal section.")
        require(reading.length() <= MAX_ROWS) { "The manga sync file has too many rows." }
        val rows = LinkedHashMap<String, Row>()
        for (key in reading.keys()) {
            val row = row(reading.optJSONObject(key)) ?: error("The manga sync file has an invalid reading row.")
            val canonical = readingKey(row.mangaId, row.chapter)
            val held = rows[canonical]
            if (held == null || row.updatedAt > held.updatedAt) rows[canonical] = row
        }
        val metas = LinkedHashMap<String, Meta>()
        for (key in manga.keys()) {
            val meta = manga.optJSONObject(key)
            val title = meta?.opt("title") as? String
            val cover = if (meta == null || !meta.has("cover") || meta.isNull("cover")) null else meta.opt("cover")
            require(mangaKey.matches(key) && title != null && title.length <= 300 &&
                (cover == null || (cover is String && cover.length <= 2048))) { "The manga sync file has invalid manga details." }
            metas[key] = Meta(title!!, cover as String?)
        }
        val removed = LinkedHashMap<String, Long>()
        for (key in deleted.keys()) {
            val ts = integral(deleted.opt(key))
            require(deletedKey.matches(key) && ts != null && ts > 0) { "The manga sync file has an invalid removal." }
            removed[key] = ts!!
        }
        return Doc(metas, rows, removed)
    }

    fun serialize(doc: Doc): String {
        val reading = JSONObject()
        for ((key, r) in doc.reading) {
            reading.put(key, JSONObject()
                .put("mangaId", r.mangaId).put("chapter", r.chapter).put("chapterId", r.chapterId)
                .put("page", r.page).put("pageCount", r.pageCount).put("sourceId", r.sourceId).put("updatedAt", r.updatedAt))
        }
        val manga = JSONObject()
        for ((key, m) in doc.manga) manga.put(key, JSONObject().put("title", m.title).put("cover", m.cover ?: JSONObject.NULL))
        val deleted = JSONObject()
        for ((key, ts) in doc.deleted) deleted.put(key, ts)
        return JSONObject().put("v", 1).put("manga", manga).put("reading", reading).put("deleted", deleted).toString()
    }

    /** Whether a removal hides this row: its manga or chapter was removed at or after it was read. */
    fun covered(deleted: Map<String, Long>, row: Row): Boolean {
        val whole = deleted[row.mangaId.toString()]
        val one = deleted[readingKey(row.mangaId, row.chapter)]
        return (whole != null && row.updatedAt <= whole) || (one != null && row.updatedAt <= one)
    }

    /**
     * One two-way reconcile. [pending] holds removals made on this device that may
     * not be in the gist yet. Newer remote rows are written locally, rows a removal
     * hides are deleted locally, and the merged file is uploaded when it differs.
     */
    fun plan(local: List<LocalRow>, remote: Doc, pending: Map<String, Long>, now: Long): Plan {
        val deleted = LinkedHashMap(remote.deleted)
        for ((key, ts) in pending) if ((deleted[key] ?: Long.MIN_VALUE) < ts) deleted[key] = ts

        val localByKey = LinkedHashMap<String, LocalRow>()
        for (l in local) localByKey[readingKey(l.row.mangaId, l.row.chapter)] = l.copy(row = l.row.copy(chapter = rounded(l.row.chapter)))

        val upsert = mutableListOf<LocalRow>()
        for ((key, r) in remote.reading) {
            if (covered(deleted, r)) continue
            val mine = localByKey[key]
            if (mine != null && mine.row.updatedAt >= r.updatedAt) continue
            val meta = remote.manga[r.mangaId.toString()]
            upsert += LocalRow(r, meta?.title ?: mine?.title ?: "Unknown", if (meta != null) meta.cover else mine?.cover)
        }
        val remove = local.filter { covered(deleted, it.row.copy(chapter = rounded(it.row.chapter))) }
            .map { it.row.mangaId to it.row.chapter }

        val reading = LinkedHashMap<String, Row>()
        for ((key, r) in remote.reading) if (!covered(deleted, r)) reading[key] = r
        val newestLocal = HashMap<Int, LocalRow>()
        for ((key, l) in localByKey) {
            if (covered(deleted, l.row)) continue
            val held = reading[key]
            if (held == null || l.row.updatedAt > held.updatedAt) reading[key] = l.row
            val seen = newestLocal[l.row.mangaId]
            if (seen == null || l.row.updatedAt > seen.row.updatedAt) newestLocal[l.row.mangaId] = l
        }

        val manga = LinkedHashMap<String, Meta>()
        for (r in reading.values) {
            val id = r.mangaId.toString()
            if (id in manga) continue
            val mine = newestLocal[r.mangaId]
            manga[id] = if (mine != null) Meta(mine.title.take(300), mine.cover?.takeIf { it.length <= 2048 })
                else remote.manga[id] ?: Meta("Unknown", null)
        }

        val cutoff = now - TOMBSTONE_TTL_MS
        deleted.entries.removeAll { (key, ts) -> ts < cutoff && pending[key] != ts }

        val doc = Doc(manga, reading, deleted)
        return Plan(upsert, remove, doc, changed = doc != remote)
    }
}
