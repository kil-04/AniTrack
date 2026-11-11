package com.sanjay.anitrack.next.data.novel

import org.json.JSONObject
import org.json.JSONTokener

/**
 * Cross-device novel sync rules (progress, the list, linked sources): the Kotlin
 * twin of packages/shared/novel-sync.ts. Same gist file, wire format and merge
 * decisions, so desktop and Android converge.
 *
 *   { "v": 1,
 *     "titles":  { "<source>:<titleId>": { "title", "cover", "novelKey", "linkAt", "seen" } },
 *     "reading": { "<source>:<titleId>:<chapterId>": row },
 *     "list":    { "<source>:<titleId>": row },
 *     "deleted": { "reading": { "<source>:<titleId>[:<chapterId>]": ms }, "list": { "<source>:<titleId>": ms } } }
 *
 * Rows merge last-write-wins by `updatedAt`; a removal hides the copy's rows (or
 * the one row) not newer than it. A copy's link merges by `linkAt`; `seen` by maximum.
 *
 * Sources added after the first release (Novel Phoenix on) keep their rows under
 * "more", a section with the same four parts. An app version from before a source
 * existed refuses a whole file holding a row it can't validate, so new sources' rows
 * never go in the first sections; that version ignores "more" and keeps syncing the
 * sources it knows. Inside "more", rows of a source this version doesn't know are
 * kept as they are and written back. The file has no "more" while it would be empty.
 */
internal object NovelSyncMerge {
    const val FILE = "anitrack-novel-sync.json"
    const val TOMBSTONE_TTL_MS = 90L * 24 * 3600 * 1000
    const val MAX_ROWS = 20_000

    data class Reading(
        val source: String,
        val titleId: String,
        val chapterId: String,
        val chapterOrder: Int,
        val chapterLabel: String,
        val paragraph: Int,
        val paragraphCount: Int,
        val updatedAt: Long,
    )

    data class ListRow(val source: String, val titleId: String, val status: String, val updatedAt: Long)

    /** One source copy's details and link, as both the gist and each device keep them. */
    data class Title(
        val source: String,
        val titleId: String,
        val title: String,
        val cover: String?,
        /** The novel it belongs to: the smallest "source:id" among its linked copies. */
        val novelKey: String,
        /** When it was last linked or unlinked; null when never. */
        val linkAt: Long?,
        /** How many chapters its list had when last shown. */
        val seen: Int?,
    )

    data class LocalReading(val row: Reading, val title: String, val cover: String?)
    data class LocalList(val row: ListRow, val title: String, val cover: String?)
    data class Local(val reading: List<LocalReading>, val list: List<LocalList>, val titles: List<Title>)
    data class Removals(val reading: Map<String, Long> = emptyMap(), val list: Map<String, Long> = emptyMap())
    data class DocTitle(val title: String, val cover: String?, val novelKey: String, val linkAt: Long?, val seen: Int?)
    /** Rows of sources a newer app added, exactly as the file held them: key to the value's JSON text. */
    data class Kept(
        val titles: Map<String, String> = emptyMap(),
        val reading: Map<String, String> = emptyMap(),
        val list: Map<String, String> = emptyMap(),
        val deletedReading: Map<String, String> = emptyMap(),
        val deletedList: Map<String, String> = emptyMap(),
    ) {
        val isEmpty: Boolean get() = titles.isEmpty() && reading.isEmpty() && list.isEmpty() && deletedReading.isEmpty() && deletedList.isEmpty()
    }

    data class Doc(
        val titles: Map<String, DocTitle> = emptyMap(),
        val reading: Map<String, Reading> = emptyMap(),
        val list: Map<String, ListRow> = emptyMap(),
        val deleted: Removals = Removals(),
        /** Present when the file held rows of sources this version doesn't know; written back unchanged. */
        val kept: Kept? = null,
    )

    data class Plan(
        val readingUpsert: List<LocalReading>,
        /** (source, titleId, chapterId) */
        val readingRemove: List<Triple<String, String, String>>,
        val listUpsert: List<LocalList>,
        /** (source, titleId) */
        val listRemove: List<Pair<String, String>>,
        /** Local copies to add, or whose link or seen count changed. */
        val titles: List<Title>,
        val doc: Doc,
        val changed: Boolean,
    ) {
        val touchesLocal: Boolean get() =
            readingUpsert.isNotEmpty() || readingRemove.isNotEmpty() || listUpsert.isNotEmpty() || listRemove.isNotEmpty() || titles.isNotEmpty()
    }

    /** The sources of the first sync format; every other source's rows live under "more". */
    private val FIRST_SOURCES = setOf("novelbuddy", "novelarchive")
    private val STATUSES = setOf("reading", "completed", "on_hold", "dropped", "plan_to_read")
    private val SHORT_ID = Regex("[A-Za-z0-9]{4,24}")
    /** Title ids per source: short codes, or Novel Phoenix's address slugs. */
    private val TITLE_IDS = mapOf("novelbuddy" to SHORT_ID, "novelarchive" to SHORT_ID, "novelphoenix" to Regex("[a-z0-9][a-z0-9-]{0,119}"))
    private val CHAPTER_ID = Regex("[A-Za-z0-9]{1,24}")
    /** How a source id looks, known to this version or not (the part of a key before its first colon). */
    private val SOURCE_SHAPE = Regex("[a-z][a-z0-9]{2,31}")

    private fun isTitleId(source: String, titleId: String) = TITLE_IDS[source]?.matches(titleId) == true

    /** Whether [key] is a valid "<source>:<titleId>" of a source this version knows. */
    fun isCopyKey(key: String): Boolean {
        val parts = key.split(":")
        return parts.size == 2 && isTitleId(parts[0], parts[1])
    }

    /** Whether [key] is a valid "<source>:<titleId>:<chapterId>" of a source this version knows. */
    fun isRowKey(key: String): Boolean {
        val parts = key.split(":")
        return parts.size == 3 && isTitleId(parts[0], parts[1]) && CHAPTER_ID.matches(parts[2])
    }

    private fun sourceOf(key: String) = key.substring(0, maxOf(0, key.indexOf(':')))
    private fun inFirstFormat(key: String) = sourceOf(key) in FIRST_SOURCES
    /** A key of a source this version doesn't know (a newer app's): its row is kept untouched. */
    private fun isForeignKey(key: String) = SOURCE_SHAPE.matches(sourceOf(key)) && sourceOf(key) !in TITLE_IDS

    /** A JSON value's text, to write back exactly what was read. */
    private fun rawJson(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is String -> JSONObject.quote(value)
        else -> value.toString()
    }

    fun copyKey(source: String, titleId: String) = "$source:$titleId"
    fun rowKey(source: String, titleId: String, chapterId: String) = "$source:$titleId:$chapterId"

    private fun integral(value: Any?): Long? = when (value) {
        is Int -> value.toLong()
        is Long -> value
        else -> null
    }

    fun validReading(r: Reading): Boolean =
        isTitleId(r.source, r.titleId) && CHAPTER_ID.matches(r.chapterId) &&
            r.chapterOrder in 0..20_000 && r.chapterLabel.isNotEmpty() && r.chapterLabel.length <= 200 &&
            r.paragraphCount in 0..5_000 && r.paragraph in 0..r.paragraphCount && r.updatedAt > 0

    fun validList(r: ListRow): Boolean = isTitleId(r.source, r.titleId) && r.status in STATUSES && r.updatedAt > 0

    private fun validTitle(t: Title): Boolean =
        isTitleId(t.source, t.titleId) && isCopyKey(t.novelKey) &&
            (t.linkAt == null || t.linkAt > 0) && (t.seen == null || t.seen in 0..20_000)

    /** A validated reading row, or null. */
    fun reading(json: JSONObject?): Reading? {
        json ?: return null
        val source = json.opt("sourceId") as? String ?: return null
        val titleId = json.opt("titleId") as? String ?: return null
        val chapterId = json.opt("chapterId") as? String ?: return null
        val order = integral(json.opt("chapterOrder")) ?: return null
        val label = json.opt("chapterLabel") as? String ?: return null
        val paragraph = integral(json.opt("paragraph")) ?: return null
        val count = integral(json.opt("paragraphCount")) ?: return null
        val updatedAt = integral(json.opt("updatedAt")) ?: return null
        if (order !in 0..20_000 || count !in 0..5_000 || paragraph !in 0..count) return null
        return Reading(source, titleId, chapterId, order.toInt(), label, paragraph.toInt(), count.toInt(), updatedAt).takeIf(::validReading)
    }

    /** A validated list row, or null. */
    fun list(json: JSONObject?): ListRow? {
        json ?: return null
        val source = json.opt("sourceId") as? String ?: return null
        val titleId = json.opt("titleId") as? String ?: return null
        val status = json.opt("status") as? String ?: return null
        val updatedAt = integral(json.opt("updatedAt")) ?: return null
        return ListRow(source, titleId, status, updatedAt).takeIf(::validList)
    }

    /** The gist file. Absent is empty; malformed throws, so nothing unreadable is ever overwritten. Newer sections are ignored. */
    fun parse(content: String?): Doc {
        if (content.isNullOrBlank()) return Doc()
        val json = JSONObject(content)
        fun section(parent: JSONObject, name: String): JSONObject? =
            if (!parent.has(name) || parent.isNull(name)) JSONObject() else parent.opt(name) as? JSONObject
        val more = section(json, "more") ?: error("The novel sync file has an invalid section.")

        val rows = LinkedHashMap<String, Reading>()
        val entries = LinkedHashMap<String, ListRow>()
        val copies = LinkedHashMap<String, DocTitle>()
        val removedReading = LinkedHashMap<String, Long>()
        val removedList = LinkedHashMap<String, Long>()
        val keptTitles = LinkedHashMap<String, String>()
        val keptReading = LinkedHashMap<String, String>()
        val keptList = LinkedHashMap<String, String>()
        val keptRemovedReading = LinkedHashMap<String, String>()
        val keptRemovedList = LinkedHashMap<String, String>()
        // The first sections hold the first sources only; "more" holds every later source.
        for ((part, first) in listOf(json to true, more to false)) {
            val titles = section(part, "titles") ?: error("The novel sync file has an invalid section.")
            val reading = section(part, "reading") ?: error("The novel sync file has an invalid section.")
            val list = section(part, "list") ?: error("The novel sync file has an invalid section.")
            val deleted = section(part, "deleted") ?: error("The novel sync file has an invalid section.")
            val deletedReading = section(deleted, "reading") ?: error("The novel sync file has an invalid removal section.")
            val deletedList = section(deleted, "list") ?: error("The novel sync file has an invalid removal section.")
            require(reading.length() <= MAX_ROWS && titles.length() <= MAX_ROWS) { "The novel sync file has too many rows." }
            /** A row this version leaves alone: under "more", from a source it doesn't know. */
            fun keep(into: MutableMap<String, String>, from: JSONObject, key: String): Boolean {
                if (first || !isForeignKey(key)) return false
                into[key] = rawJson(from.opt(key))
                return true
            }
            /** Each source's rows sit in their own part of the file, or an older app would choke on them. */
            fun placed(key: String) = inFirstFormat(key) == first

            for (key in reading.keys()) {
                if (keep(keptReading, reading, key)) continue
                val row = reading(reading.optJSONObject(key))
                require(row != null && placed(key) && key == rowKey(row.source, row.titleId, row.chapterId)) { "The novel sync file has an invalid reading row." }
                rows[key] = row!!
            }
            for (key in list.keys()) {
                if (keep(keptList, list, key)) continue
                val row = list(list.optJSONObject(key))
                require(row != null && placed(key) && key == copyKey(row.source, row.titleId)) { "The novel sync file has an invalid list row." }
                entries[key] = row!!
            }
            for (key in titles.keys()) {
                if (keep(keptTitles, titles, key)) continue
                val t = titles.optJSONObject(key)
                val title = t?.opt("title") as? String
                val cover = if (t == null || !t.has("cover") || t.isNull("cover")) null else t.opt("cover")
                val novelKey = t?.opt("novelKey") as? String
                val linkAt = if (t == null || !t.has("linkAt") || t.isNull("linkAt")) null else integral(t.opt("linkAt")) ?: -1L
                val seen = if (t == null || !t.has("seen") || t.isNull("seen")) null else integral(t.opt("seen")) ?: -1L
                // A first-format copy linked under a later source's key sits in "more" as well.
                require(
                    isCopyKey(key) && title != null && title.length <= 300 && (cover == null || (cover is String && cover.length <= 2048)) &&
                        novelKey != null && isCopyKey(novelKey) && (inFirstFormat(key) && inFirstFormat(novelKey)) == first &&
                        (linkAt == null || linkAt > 0) && (seen == null || seen in 0..20_000),
                ) { "The novel sync file has invalid title details." }
                copies[key] = DocTitle(title!!, cover as String?, novelKey!!, linkAt, seen?.toInt())
            }
            fun removals(o: JSONObject, into: MutableMap<String, Long>, kept: MutableMap<String, String>, pattern: (String) -> Boolean) {
                for (key in o.keys()) {
                    if (keep(kept, o, key)) continue
                    val ts = integral(o.opt(key))
                    require(pattern(key) && placed(key) && ts != null && ts > 0) { "The novel sync file has an invalid removal." }
                    into[key] = ts!!
                }
            }
            removals(deletedReading, removedReading, keptRemovedReading) { isCopyKey(it) || isRowKey(it) }
            removals(deletedList, removedList, keptRemovedList) { isCopyKey(it) }
        }
        val kept = Kept(keptTitles, keptReading, keptList, keptRemovedReading, keptRemovedList)
        return Doc(copies, rows, entries, Removals(removedReading, removedList), kept.takeIf { !it.isEmpty })
    }

    fun serialize(doc: Doc): String {
        fun title(t: DocTitle) = JSONObject().put("title", t.title).put("cover", t.cover ?: JSONObject.NULL).put("novelKey", t.novelKey)
            .put("linkAt", t.linkAt ?: JSONObject.NULL).put("seen", t.seen ?: JSONObject.NULL)
        fun reading(r: Reading) = JSONObject().put("sourceId", r.source).put("titleId", r.titleId).put("chapterId", r.chapterId)
            .put("chapterOrder", r.chapterOrder).put("chapterLabel", r.chapterLabel).put("paragraph", r.paragraph)
            .put("paragraphCount", r.paragraphCount).put("updatedAt", r.updatedAt)
        fun list(r: ListRow) = JSONObject().put("sourceId", r.source).put("titleId", r.titleId).put("status", r.status).put("updatedAt", r.updatedAt)
        /** One part of the file: the first sources' rows, or (under "more") every other source's and the kept ones. */
        fun part(first: Boolean): JSONObject {
            fun <T> mine(rows: Map<String, T>, kept: Map<String, String>?, here: (String, T) -> Boolean, write: (T) -> Any): JSONObject {
                val out = JSONObject()
                if (!first) kept?.forEach { (key, text) -> out.put(key, JSONTokener(text).nextValue()) }
                for ((key, row) in rows) if (here(key, row) == first) out.put(key, write(row))
                return out
            }
            return JSONObject()
                .put("titles", mine(doc.titles, doc.kept?.titles, { k, t -> inFirstFormat(k) && inFirstFormat(t.novelKey) }, ::title))
                .put("reading", mine(doc.reading, doc.kept?.reading, { k, _ -> inFirstFormat(k) }, ::reading))
                .put("list", mine(doc.list, doc.kept?.list, { k, _ -> inFirstFormat(k) }, ::list))
                .put("deleted", JSONObject()
                    .put("reading", mine(doc.deleted.reading, doc.kept?.deletedReading, { k, _ -> inFirstFormat(k) }) { it })
                    .put("list", mine(doc.deleted.list, doc.kept?.deletedList, { k, _ -> inFirstFormat(k) }) { it }))
        }
        val out = part(true).put("v", 1)
        val more = part(false)
        val deleted = more.getJSONObject("deleted")
        val empty = more.getJSONObject("titles").length() == 0 && more.getJSONObject("reading").length() == 0 && more.getJSONObject("list").length() == 0 &&
            deleted.getJSONObject("reading").length() == 0 && deleted.getJSONObject("list").length() == 0
        if (!empty) out.put("more", more)
        return out.toString()
    }

    /** Whether a removal hides this reading row: its copy or the row was removed at or after it was read. */
    fun readingRemoved(deleted: Map<String, Long>, r: Reading): Boolean {
        val whole = deleted[copyKey(r.source, r.titleId)]
        val one = deleted[rowKey(r.source, r.titleId, r.chapterId)]
        return (whole != null && r.updatedAt <= whole) || (one != null && r.updatedAt <= one)
    }

    private fun listRemoved(deleted: Map<String, Long>, r: ListRow): Boolean {
        val ts = deleted[copyKey(r.source, r.titleId)]
        return ts != null && r.updatedAt <= ts
    }

    private fun merge(remote: Map<String, Long>, pending: Map<String, Long>): LinkedHashMap<String, Long> {
        val out = LinkedHashMap(remote)
        for ((key, ts) in pending) if ((out[key] ?: Long.MIN_VALUE) < ts) out[key] = ts
        return out
    }

    /**
     * One two-way reconcile. [pending] holds removals made on this device that may
     * not be in the gist yet. Newer remote rows and links are written locally, rows a
     * removal hides are deleted locally, and the merged file is uploaded when it differs.
     */
    fun plan(input: Local, remote: Doc, pending: Removals, now: Long): Plan {
        // Only rows the other device's parser accepts are ever uploaded (it refuses a whole file otherwise).
        val local = Local(
            input.reading.filter { validReading(it.row) },
            input.list.filter { validList(it.row) },
            input.titles.filter(::validTitle),
        )
        val deletedReading = merge(remote.deleted.reading, pending.reading)
        val deletedList = merge(remote.deleted.list, pending.list)
        val localTitles = local.titles.associateBy { copyKey(it.source, it.titleId) }
        // Rows carry their card's name too: the newest per copy, for copies without a title row.
        val rowNames = HashMap<String, Triple<String, String?, Long>>()
        for ((key, title, cover, at) in local.reading.map { Quad(copyKey(it.row.source, it.row.titleId), it.title, it.cover, it.row.updatedAt) } +
            local.list.map { Quad(copyKey(it.row.source, it.row.titleId), it.title, it.cover, it.row.updatedAt) }) {
            if (title.isNotEmpty() && (rowNames[key]?.third ?: Long.MIN_VALUE) < at) rowNames[key] = Triple(title, cover, at)
        }
        fun nameOf(key: String): Pair<String, String?>? {
            localTitles[key]?.takeIf { it.title.isNotEmpty() }?.let { return it.title to it.cover }
            rowNames[key]?.let { return it.first to it.second }
            remote.titles[key]?.takeIf { it.title.isNotEmpty() }?.let { return it.title to it.cover }
            return null
        }
        fun shown(key: String) = nameOf(key) ?: ("Unknown" to null)

        // Reading
        val localReading = LinkedHashMap<String, LocalReading>()
        for (l in local.reading) localReading[rowKey(l.row.source, l.row.titleId, l.row.chapterId)] = l
        val readingUpsert = ArrayList<LocalReading>()
        for ((key, r) in remote.reading) {
            if (readingRemoved(deletedReading, r)) continue
            val mine = localReading[key]
            if (mine != null && mine.row.updatedAt >= r.updatedAt) continue
            val (title, cover) = shown(copyKey(r.source, r.titleId))
            readingUpsert += LocalReading(r, title, cover)
        }
        val readingRemove = local.reading.filter { readingRemoved(deletedReading, it.row) }.map { Triple(it.row.source, it.row.titleId, it.row.chapterId) }
        val reading = LinkedHashMap<String, Reading>()
        for ((key, r) in remote.reading) if (!readingRemoved(deletedReading, r)) reading[key] = r
        for ((key, l) in localReading) {
            if (readingRemoved(deletedReading, l.row)) continue
            val held = reading[key]
            if (held == null || l.row.updatedAt > held.updatedAt) reading[key] = l.row
        }

        // List
        val localList = LinkedHashMap<String, LocalList>()
        for (l in local.list) localList[copyKey(l.row.source, l.row.titleId)] = l
        val listUpsert = ArrayList<LocalList>()
        for ((key, r) in remote.list) {
            if (listRemoved(deletedList, r)) continue
            val mine = localList[key]
            if (mine != null && mine.row.updatedAt >= r.updatedAt) continue
            val (title, cover) = shown(key)
            listUpsert += LocalList(r, title, cover)
        }
        val listRemove = local.list.filter { listRemoved(deletedList, it.row) }.map { it.row.source to it.row.titleId }
        val list = LinkedHashMap<String, ListRow>()
        for ((key, r) in remote.list) if (!listRemoved(deletedList, r)) list[key] = r
        for ((key, l) in localList) {
            if (listRemoved(deletedList, l.row)) continue
            val held = list[key]
            if (held == null || l.row.updatedAt > held.updatedAt) list[key] = l.row
        }

        // Copies: links by linkAt, seen counts by maximum
        val referenced = reading.values.map { copyKey(it.source, it.titleId) }.toHashSet().apply { addAll(list.keys) }
        val titleUpdates = ArrayList<Title>()
        val merged = LinkedHashMap<String, DocTitle>()
        for (key in (localTitles.keys + remote.titles.keys + referenced).toSortedSet()) {
            val mine = localTitles[key]
            val theirs = remote.titles[key]
            val source = key.substringBefore(':')
            val titleId = key.substringAfter(':')
            val theirsWin = theirs != null && (theirs.linkAt ?: 0) > (mine?.linkAt ?: 0)
            val (novelKey, linkAt) = when {
                theirsWin || (mine == null && theirs != null) -> theirs!!.novelKey to theirs.linkAt
                mine != null -> mine.novelKey to mine.linkAt
                else -> key to null
            }
            val seen = listOfNotNull(mine?.seen, theirs?.seen).maxOrNull()
            val (title, cover) = nameOf(key) ?: ("" to (mine?.cover ?: theirs?.cover))
            val row = Title(source, titleId, title, cover, novelKey, linkAt, seen)
            // A copy the gist knows only by name changes nothing here; a link, unlink or seen count does.
            val informative = theirs != null && (theirs.linkAt != null || theirs.novelKey != key || theirs.seen != null)
            if (theirs != null && (if (mine != null) theirsWin || (seen ?: -1) > (mine.seen ?: -1) else informative)) titleUpdates += row
            // The gist keeps copies that were linked (or unlinked) or that rows refer to.
            if (linkAt != null || novelKey != key || key in referenced) {
                merged[key] = DocTitle(title.take(300), cover?.takeIf { it.length <= 2048 }, novelKey, linkAt, seen)
            }
        }

        // Removals older than the TTL are dropped (unless still pending here)
        val cutoff = now - TOMBSTONE_TTL_MS
        deletedReading.entries.removeAll { (key, ts) -> ts < cutoff && pending.reading[key] != ts }
        deletedList.entries.removeAll { (key, ts) -> ts < cutoff && pending.list[key] != ts }

        // Rows of sources only a newer app knows go back exactly as they came.
        val doc = Doc(merged, reading, list, Removals(deletedReading, deletedList), remote.kept)
        return Plan(readingUpsert, readingRemove, listUpsert, listRemove, titleUpdates, doc, changed = doc != remote)
    }

    private data class Quad(val key: String, val title: String, val cover: String?, val at: Long)
}
