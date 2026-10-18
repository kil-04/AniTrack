package com.sanjay.anitrack.next.data.novel

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import com.sanjay.anitrack.next.data.Db
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray

/*
 * Novels' progress, list and linked copies (tables made in [Db]). Everything is
 * stored per source copy (source + that source's title id). Copies of the same
 * novel on different sources share a novel_key in novel_title — the smallest
 * "source:id" among them, so two devices linking the same copies agree on it — and
 * progress and the list are read for the whole group, matching chapters by label
 * ([Novels.chapterKey]). Removals also go to novel_sync_removed so the sync gist
 * can hide them on other devices. Mirrors desktop's services/novel/store.ts.
 */
object NovelStore {
    val STATUSES = listOf("reading", "completed", "on_hold", "dropped", "plan_to_read")
    val STATUS_LABELS = mapOf(
        "reading" to "Reading", "completed" to "Completed", "on_hold" to "On hold",
        "dropped" to "Dropped", "plan_to_read" to "Plan to read",
    )

    data class ReadingRow(
        val source: NovelSourceId,
        val titleId: String,
        val chapterId: String,
        val chapterOrder: Int,
        val chapterLabel: String,
        val paragraph: Int,
        val paragraphCount: Int,
        val title: String,
        val cover: String?,
        val updatedAt: Long,
    ) {
        val finished: Boolean get() = paragraphCount > 0 && paragraph >= maxOf(0, paragraphCount - 3)
    }

    data class ListRow(val source: NovelSourceId, val titleId: String, val status: String, val title: String, val cover: String?, val updatedAt: Long)

    /** One copy of a novel on one source. */
    data class Member(val source: NovelSourceId, val id: String, val title: String, val cover: String?)

    private data class Ref(val source: NovelSourceId, val id: String)

    private fun ownKey(source: NovelSourceId, id: String) = "${source.key}:$id"

    // ── Linked copies ─────────────────────────────────────────────────────────

    private fun keyOf(db: SQLiteDatabase, source: NovelSourceId, id: String): String =
        db.rawQuery("SELECT novel_key FROM novel_title WHERE source_id=? AND title_id=?", arrayOf(source.key, id))
            .use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: ownKey(source, id)

    private fun membersOf(db: SQLiteDatabase, key: String): List<Ref> {
        val refs = ArrayList<Ref>()
        db.rawQuery("SELECT source_id, title_id FROM novel_title WHERE novel_key=?", arrayOf(key)).use { c ->
            while (c.moveToNext()) NovelSourceId.of(c.getString(0))?.let { refs += Ref(it, c.getString(1)) }
        }
        if (refs.isEmpty()) {
            // An unregistered copy is its own group.
            val source = NovelSourceId.of(key.substringBefore(':'))
            val id = key.substringAfter(':', "")
            if (source != null && id.isNotEmpty()) refs += Ref(source, id)
        }
        return refs
    }

    private fun inGroup(refs: List<Ref>): Pair<String, Array<String>> =
        refs.joinToString(" OR ") { "(source_id=? AND title_id=?)" } to refs.flatMap { listOf(it.source.key, it.id) }.toTypedArray()

    /** A copy's group: every linked copy, this one first. */
    suspend fun group(source: NovelSourceId, id: String): List<Member> = withContext(Dispatchers.IO) {
        val db = Db.readable()
        val key = keyOf(db, source, id)
        val out = ArrayList<Member>()
        db.rawQuery("SELECT source_id, title_id, title, cover FROM novel_title WHERE novel_key=?", arrayOf(key)).use { c ->
            while (c.moveToNext()) NovelSourceId.of(c.getString(0))?.let { out += Member(it, c.getString(1), c.getString(2) ?: "", c.getString(3)) }
        }
        if (out.none { it.source == source && it.id == id }) out += Member(source, id, "", null)
        out.sortedByDescending { it.source == source && it.id == id }
    }

    /**
     * Remembers a copy whose details were fetched (keeping its link and the chapter
     * count last seen; a first sighting starts at today's count), then links it to a
     * copy of the same novel already known on another source (same name and author).
     */
    suspend fun registerTitle(detail: NovelDetail) = withContext(Dispatchers.IO) {
        val db = Db.writable()
        val c = detail.card
        data class Existing(val key: String, val seen: Int?, val linkAt: Long?)
        val existing = db.rawQuery("SELECT novel_key, seen_count, link_at FROM novel_title WHERE source_id=? AND title_id=?", arrayOf(c.source.key, c.id))
            .use { cur -> if (cur.moveToFirst()) Existing(cur.getString(0), if (cur.isNull(1)) null else cur.getInt(1), if (cur.isNull(2)) null else cur.getLong(2)) else null }
        db.insertWithOnConflict(
            "novel_title", null,
            ContentValues().apply {
                put("source_id", c.source.key); put("title_id", c.id)
                put("novel_key", existing?.key ?: ownKey(c.source, c.id))
                put("title", c.title.take(300)); put("author", detail.author?.take(300))
                put("alt_names", JSONArray(detail.altNames.take(8)).toString()); put("cover", c.cover?.take(2048))
                val seen = existing?.seen ?: detail.latest?.count
                if (seen != null) put("seen_count", seen) else putNull("seen_count")
                if (existing?.linkAt != null) put("link_at", existing.linkAt) else putNull("link_at")
                put("updated_at", System.currentTimeMillis())
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
        // Already placed: linked, or linked/unlinked on purpose (here or on another device).
        if (existing != null && (existing.linkAt != null || membersOf(db, existing.key).size > 1)) return@withContext
        data class Other(val source: NovelSourceId, val id: String, val key: String, val title: String, val author: String?, val alt: List<String>)
        val others = ArrayList<Other>()
        db.rawQuery("SELECT source_id, title_id, novel_key, title, author, alt_names FROM novel_title WHERE source_id!=?", arrayOf(c.source.key)).use { cur ->
            while (cur.moveToNext()) {
                val source = NovelSourceId.of(cur.getString(0)) ?: continue
                val alt = runCatching { JSONArray(cur.getString(5) ?: "[]").let { a -> (0 until a.length()).map { a.getString(it) } } }.getOrDefault(emptyList())
                others += Other(source, cur.getString(1), cur.getString(2), cur.getString(3) ?: "", cur.getString(4), alt)
            }
        }
        for (other in others) {
            if (Novels.sameNovel(c.title, detail.altNames, detail.author, other.title, other.alt, other.author) != "yes") continue
            // One copy per source in a novel.
            val taken = db.rawQuery("SELECT 1 FROM novel_title WHERE novel_key=? AND source_id=?", arrayOf(other.key, c.source.key)).use { it.moveToFirst() }
            if (taken) continue
            linkNow(db, Ref(other.source, other.id), Ref(c.source, c.id))
            break
        }
    }

    /** Puts [b]'s novel into [a]'s: progress and list status are shared from now on. */
    suspend fun link(aSource: NovelSourceId, aId: String, bSource: NovelSourceId, bId: String) = withContext(Dispatchers.IO) {
        val db = Db.writable()
        // One copy per source: a different copy already linked on b's source leaves first.
        val clash = membersOf(db, keyOf(db, aSource, aId)).firstOrNull { it.source == bSource && it.id != bId }
        if (clash != null) unlinkNow(db, clash)
        linkNow(db, Ref(aSource, aId), Ref(bSource, bId))
    }

    private fun linkNow(db: SQLiteDatabase, a: Ref, b: Ref) {
        db.beginTransaction()
        try {
            val ka = keyOf(db, a.source, a.id)
            val kb = keyOf(db, b.source, b.id)
            if (ka != kb) {
                val now = System.currentTimeMillis()
                for (ref in listOf(a, b)) {
                    db.insertWithOnConflict(
                        "novel_title", null,
                        ContentValues().apply {
                            put("source_id", ref.source.key); put("title_id", ref.id); put("novel_key", keyOf(db, ref.source, ref.id))
                            put("title", ""); put("updated_at", now)
                        },
                        SQLiteDatabase.CONFLICT_IGNORE,
                    )
                }
                // The smallest key names the novel, so every device that links these copies agrees.
                val key = minOf(ka, kb)
                db.execSQL("UPDATE novel_title SET novel_key=?, link_at=? WHERE novel_key IN (?, ?)", arrayOf<Any>(key, now, ka, kb))
                // One list entry per novel: keep the newest.
                listRows(db, key).drop(1).forEach {
                    db.delete("novel_list", "source_id=? AND title_id=?", arrayOf(it.source.key, it.titleId))
                    remember(db, "list", NovelSyncMerge.copyKey(it.source.key, it.titleId), now)
                }
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** Takes a copy out of its novel (its own progress rows go with it). */
    suspend fun unlink(source: NovelSourceId, id: String) = withContext(Dispatchers.IO) { unlinkNow(Db.writable(), Ref(source, id)) }

    private fun unlinkNow(db: SQLiteDatabase, ref: Ref) {
        val key = keyOf(db, ref.source, ref.id)
        val own = ownKey(ref.source, ref.id)
        val now = System.currentTimeMillis()
        val rest = membersOf(db, key).filter { it != ref }
        db.execSQL("UPDATE novel_title SET novel_key=?, link_at=? WHERE source_id=? AND title_id=?", arrayOf<Any>(own, now, ref.source.key, ref.id))
        if (key == own && rest.isNotEmpty()) {
            // The novel was named after this copy: the others carry on under the smallest of theirs.
            db.execSQL(
                "UPDATE novel_title SET novel_key=?, link_at=? WHERE novel_key=? AND NOT (source_id=? AND title_id=?)",
                arrayOf<Any>(rest.map { ownKey(it.source, it.id) }.min(), now, key, ref.source.key, ref.id),
            )
        }
    }

    /** Notes a removal for the sync gist ("reading": a copy or one chapter row; "list": a copy's entry). */
    private fun remember(db: SQLiteDatabase, kind: String, key: String, at: Long) {
        db.insertWithOnConflict(
            "novel_sync_removed", null,
            ContentValues().apply { put("kind", kind); put("key", key); put("at", at); put("sent", 0) },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    /** The newest removal known for a reading row (its own, or its whole copy's), or 0. */
    private fun removedAt(db: SQLiteDatabase, source: NovelSourceId, titleId: String, chapterId: String): Long =
        db.rawQuery(
            "SELECT MAX(at) FROM novel_sync_removed WHERE kind='reading' AND key IN (?, ?)",
            arrayOf(NovelSyncMerge.copyKey(source.key, titleId), NovelSyncMerge.rowKey(source.key, titleId, chapterId)),
        ).use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else 0L }

    /** Records how many chapters a copy had when its list was last shown, so "N new" counts from there. */
    suspend fun markSeen(source: NovelSourceId, id: String, count: Int) = withContext(Dispatchers.IO) {
        Db.writable().execSQL("UPDATE novel_title SET seen_count=? WHERE source_id=? AND title_id=?", arrayOf<Any>(count, source.key, id))
    }

    suspend fun seenCount(source: NovelSourceId, id: String): Int? = withContext(Dispatchers.IO) {
        Db.readable().rawQuery("SELECT seen_count FROM novel_title WHERE source_id=? AND title_id=?", arrayOf(source.key, id))
            .use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getInt(0) else null }
    }

    // ── Reading progress ──────────────────────────────────────────────────────

    private fun put(db: SQLiteDatabase, row: ReadingRow) {
        db.insertWithOnConflict(
            "novel_reading", null,
            ContentValues().apply {
                put("source_id", row.source.key); put("title_id", row.titleId); put("chapter_id", row.chapterId)
                put("chapter_order", row.chapterOrder); put("chapter_label", row.chapterLabel.take(200))
                put("paragraph", row.paragraph); put("paragraph_count", row.paragraphCount)
                put("title", row.title.take(300)); put("cover", row.cover?.take(2048)); put("updated_at", row.updatedAt)
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    suspend fun save(row: ReadingRow) = withContext(Dispatchers.IO) { put(Db.writable(), row) }

    /** The novel's progress on every linked source: [Novels.chapterKey] → the newest state. */
    suspend fun progressFor(source: NovelSourceId, titleId: String): Map<String, NovelProgress> = withContext(Dispatchers.IO) {
        val db = Db.readable()
        val (where, args) = inGroup(membersOf(db, keyOf(db, source, titleId)))
        val out = HashMap<String, NovelProgress>()
        db.rawQuery(
            "SELECT source_id, chapter_id, chapter_order, chapter_label, paragraph, paragraph_count, updated_at FROM novel_reading WHERE $where",
            args,
        ).use { c ->
            while (c.moveToNext()) {
                val src = NovelSourceId.of(c.getString(0)) ?: continue
                val p = NovelProgress(src, c.getString(1), c.getString(3), c.getInt(2), c.getInt(4), c.getInt(5), c.getLong(6))
                val key = Novels.chapterKey(p.chapterLabel)
                if ((out[key]?.updatedAt ?: Long.MIN_VALUE) < p.updatedAt) out[key] = p
            }
        }
        out
    }

    /**
     * Marks chapters read (1 of 1 paragraphs, which reads as finished) or, with
     * [read] false, forgets them on every linked source. Marked chapters stay older
     * than a chapter read later for real.
     */
    suspend fun mark(source: NovelSourceId, titleId: String, chapters: List<NovelChapter>, read: Boolean, title: String, cover: String?) =
        withContext(Dispatchers.IO) {
            val db = Db.writable()
            val (where, args) = inGroup(membersOf(db, keyOf(db, source, titleId)))
            db.beginTransaction()
            try {
                if (!read) {
                    val keys = chapters.map { Novels.chapterKey(it.label) }.toSet()
                    val doomed = ArrayList<Array<String>>()
                    db.rawQuery("SELECT source_id, title_id, chapter_id, chapter_label FROM novel_reading WHERE $where", args).use { c ->
                        while (c.moveToNext()) if (Novels.chapterKey(c.getString(3)) in keys) doomed += arrayOf(c.getString(0), c.getString(1), c.getString(2))
                    }
                    val now = System.currentTimeMillis()
                    doomed.forEach {
                        db.delete("novel_reading", "source_id=? AND title_id=? AND chapter_id=?", it)
                        remember(db, "reading", NovelSyncMerge.rowKey(it[0], it[1], it[2]), now)
                    }
                } else {
                    val sorted = chapters.sortedBy { it.order }
                    val newest = db.rawQuery("SELECT source_id, chapter_order, updated_at FROM novel_reading WHERE $where ORDER BY updated_at DESC LIMIT 1", args)
                        .use { c -> if (c.moveToFirst()) Triple(c.getString(0), c.getInt(1), c.getLong(2)) else null }
                    val highest = sorted.lastOrNull()?.order ?: 0
                    val later = newest != null && newest.first == source.key && newest.second > highest
                    val base = if (later) newest!!.third - sorted.size - 1 else System.currentTimeMillis() - sorted.size
                    // A mark is never dated under a removal of that chapter, or the next sync would undo it.
                    sorted.forEachIndexed { i, c ->
                        put(db, ReadingRow(source, titleId, c.id, c.order, c.label, 1, 1, title, cover, maxOf(base + i, removedAt(db, source, titleId, c.id) + 1)))
                    }
                }
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
        }

    /** One row per novel (all linked sources together) — its most recently read chapter, newest first. */
    suspend fun continueReading(limit: Int = 30): List<ReadingRow> = withContext(Dispatchers.IO) {
        val out = ArrayList<ReadingRow>()
        val seen = HashSet<String>()
        Db.readable().rawQuery(
            """SELECT r.source_id, r.title_id, r.chapter_id, r.chapter_order, r.chapter_label, r.paragraph,
                      r.paragraph_count, r.title, r.cover, r.updated_at,
                      COALESCE(t.novel_key, r.source_id || ':' || r.title_id)
               FROM novel_reading r
               LEFT JOIN novel_title t ON t.source_id = r.source_id AND t.title_id = r.title_id
               ORDER BY r.updated_at DESC""",
            null,
        ).use { c ->
            while (c.moveToNext() && out.size < limit) {
                if (!seen.add(c.getString(10))) continue
                val source = NovelSourceId.of(c.getString(0)) ?: continue
                out += ReadingRow(source, c.getString(1), c.getString(2), c.getInt(3), c.getString(4), c.getInt(5), c.getInt(6), c.getString(7) ?: "Unknown", c.getString(8), c.getLong(9))
            }
        }
        out
    }

    suspend fun forget(source: NovelSourceId, titleId: String) = withContext(Dispatchers.IO) {
        val db = Db.writable()
        val members = membersOf(db, keyOf(db, source, titleId))
        val (where, args) = inGroup(members)
        db.beginTransaction()
        try {
            db.delete("novel_reading", where, args)
            val now = System.currentTimeMillis()
            members.forEach { remember(db, "reading", NovelSyncMerge.copyKey(it.source.key, it.id), now) }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    // ── List ──────────────────────────────────────────────────────────────────

    private fun listRows(db: SQLiteDatabase, key: String): List<ListRow> {
        val (where, args) = inGroup(membersOf(db, key))
        val out = ArrayList<ListRow>()
        db.rawQuery("SELECT source_id, title_id, status, title, cover, updated_at FROM novel_list WHERE $where ORDER BY updated_at DESC", args).use { c ->
            while (c.moveToNext()) {
                val source = NovelSourceId.of(c.getString(0)) ?: continue
                out += ListRow(source, c.getString(1), c.getString(2), c.getString(3) ?: "Unknown", c.getString(4), c.getLong(5))
            }
        }
        return out
    }

    suspend fun statusOf(source: NovelSourceId, titleId: String): String? = withContext(Dispatchers.IO) {
        val db = Db.readable()
        listRows(db, keyOf(db, source, titleId)).firstOrNull()?.status?.takeIf { it in STATUSES }
    }

    /** Sets a novel's status (one entry for all its sources), or removes it with a null status. */
    suspend fun setStatus(source: NovelSourceId, titleId: String, status: String?, title: String, cover: String?) = withContext(Dispatchers.IO) {
        require(status == null || status in STATUSES)
        val db = Db.writable()
        db.beginTransaction()
        try {
            val now = System.currentTimeMillis()
            listRows(db, keyOf(db, source, titleId)).forEach {
                db.delete("novel_list", "source_id=? AND title_id=?", arrayOf(it.source.key, it.titleId))
                // The entry replaced below needs no removal (the new one is newer anyway).
                if (status == null || it.source != source || it.titleId != titleId) remember(db, "list", NovelSyncMerge.copyKey(it.source.key, it.titleId), now)
            }
            if (status != null) {
                db.insertWithOnConflict(
                    "novel_list", null,
                    ContentValues().apply {
                        put("source_id", source.key); put("title_id", titleId); put("status", status)
                        put("title", title.take(300)); put("cover", cover?.take(2048)); put("updated_at", System.currentTimeMillis())
                    },
                    SQLiteDatabase.CONFLICT_REPLACE,
                )
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    suspend fun list(): List<ListRow> = withContext(Dispatchers.IO) {
        val out = ArrayList<ListRow>()
        Db.readable().rawQuery("SELECT source_id, title_id, status, title, cover, updated_at FROM novel_list ORDER BY updated_at DESC", null).use { c ->
            while (c.moveToNext()) {
                val source = NovelSourceId.of(c.getString(0)) ?: continue
                out += ListRow(source, c.getString(1), c.getString(2), c.getString(3) ?: "Unknown", c.getString(4), c.getLong(5))
            }
        }
        out
    }

    // ── Sync (see NovelSyncMerge) ─────────────────────────────────────────────

    /** This device's novel tables, and the removals the sync gist hasn't received yet. */
    internal suspend fun syncSnapshot(): Pair<NovelSyncMerge.Local, NovelSyncMerge.Removals> = withContext(Dispatchers.IO) {
        val db = Db.readable()
        val reading = ArrayList<NovelSyncMerge.LocalReading>()
        db.rawQuery("SELECT source_id, title_id, chapter_id, chapter_order, chapter_label, paragraph, paragraph_count, title, cover, updated_at FROM novel_reading", null).use { c ->
            while (c.moveToNext()) {
                reading += NovelSyncMerge.LocalReading(
                    NovelSyncMerge.Reading(c.getString(0), c.getString(1), c.getString(2), c.getInt(3), c.getString(4), c.getInt(5), c.getInt(6), c.getLong(9)),
                    c.getString(7) ?: "", c.getString(8),
                )
            }
        }
        val list = ArrayList<NovelSyncMerge.LocalList>()
        db.rawQuery("SELECT source_id, title_id, status, title, cover, updated_at FROM novel_list", null).use { c ->
            while (c.moveToNext()) list += NovelSyncMerge.LocalList(NovelSyncMerge.ListRow(c.getString(0), c.getString(1), c.getString(2), c.getLong(5)), c.getString(3) ?: "", c.getString(4))
        }
        val titles = ArrayList<NovelSyncMerge.Title>()
        db.rawQuery("SELECT source_id, title_id, title, cover, novel_key, link_at, seen_count FROM novel_title", null).use { c ->
            while (c.moveToNext()) {
                titles += NovelSyncMerge.Title(
                    c.getString(0), c.getString(1), c.getString(2) ?: "", c.getString(3), c.getString(4),
                    if (c.isNull(5)) null else c.getLong(5), if (c.isNull(6)) null else c.getInt(6),
                )
            }
        }
        val pendingReading = HashMap<String, Long>()
        val pendingList = HashMap<String, Long>()
        db.rawQuery("SELECT kind, key, at FROM novel_sync_removed WHERE sent=0", null).use { c ->
            while (c.moveToNext()) when (c.getString(0)) {
                "reading" -> pendingReading[c.getString(1)] = c.getLong(2)
                "list" -> pendingList[c.getString(1)] = c.getLong(2)
            }
        }
        NovelSyncMerge.Local(reading, list, titles) to NovelSyncMerge.Removals(pendingReading, pendingList)
    }

    /** Applies a reconcile's local side: rows and links from other devices, and rows a removal hides. */
    internal suspend fun applySync(plan: NovelSyncMerge.Plan) = withContext(Dispatchers.IO) {
        val db = Db.writable()
        db.beginTransaction()
        try {
            for (l in plan.readingUpsert) {
                val source = NovelSourceId.of(l.row.source) ?: continue
                put(db, ReadingRow(source, l.row.titleId, l.row.chapterId, l.row.chapterOrder, l.row.chapterLabel, l.row.paragraph, l.row.paragraphCount,
                    l.title.ifEmpty { "Unknown" }, l.cover, l.row.updatedAt))
            }
            for ((source, titleId, chapterId) in plan.readingRemove) db.delete("novel_reading", "source_id=? AND title_id=? AND chapter_id=?", arrayOf(source, titleId, chapterId))
            for (l in plan.listUpsert) {
                db.insertWithOnConflict(
                    "novel_list", null,
                    ContentValues().apply {
                        put("source_id", l.row.source); put("title_id", l.row.titleId); put("status", l.row.status)
                        put("title", l.title.ifEmpty { "Unknown" }.take(300)); put("cover", l.cover?.take(2048)); put("updated_at", l.row.updatedAt)
                    },
                    SQLiteDatabase.CONFLICT_REPLACE,
                )
            }
            for ((source, titleId) in plan.listRemove) db.delete("novel_list", "source_id=? AND title_id=?", arrayOf(source, titleId))
            for (t in plan.titles) {
                val known = db.rawQuery("SELECT 1 FROM novel_title WHERE source_id=? AND title_id=?", arrayOf(t.source, t.titleId)).use { it.moveToFirst() }
                if (known) {
                    db.execSQL(
                        """UPDATE novel_title SET novel_key=?, link_at=?, seen_count=?,
                             title = CASE WHEN title = '' THEN ? ELSE title END, cover = COALESCE(cover, ?)
                           WHERE source_id=? AND title_id=?""",
                        arrayOf<Any?>(t.novelKey, t.linkAt, t.seen, t.title.take(300), t.cover, t.source, t.titleId),
                    )
                } else {
                    db.insertWithOnConflict(
                        "novel_title", null,
                        ContentValues().apply {
                            put("source_id", t.source); put("title_id", t.titleId); put("novel_key", t.novelKey)
                            put("title", t.title.take(300)); put("cover", t.cover)
                            if (t.linkAt != null) put("link_at", t.linkAt) else putNull("link_at")
                            if (t.seen != null) put("seen_count", t.seen) else putNull("seen_count")
                            put("updated_at", System.currentTimeMillis())
                        },
                        SQLiteDatabase.CONFLICT_IGNORE,
                    )
                }
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /**
     * After an upload: the removals it carried are sent, and every removal the gist
     * holds is remembered (so a later mark is never dated under one); old ones go.
     */
    internal suspend fun ackSync(sent: NovelSyncMerge.Removals, known: NovelSyncMerge.Removals) = withContext(Dispatchers.IO) {
        val db = Db.writable()
        db.beginTransaction()
        try {
            for ((kind, part) in listOf("reading" to sent.reading, "list" to sent.list)) {
                for ((key, at) in part) db.execSQL("UPDATE novel_sync_removed SET sent=1 WHERE kind=? AND key=? AND at=?", arrayOf<Any>(kind, key, at))
            }
            for ((kind, part) in listOf("reading" to known.reading, "list" to known.list)) {
                for ((key, at) in part) {
                    val held = db.rawQuery("SELECT at FROM novel_sync_removed WHERE kind=? AND key=?", arrayOf(kind, key))
                        .use { c -> if (c.moveToFirst()) c.getLong(0) else null }
                    if (held == null || at > held) {
                        db.insertWithOnConflict(
                            "novel_sync_removed", null,
                            ContentValues().apply { put("kind", kind); put("key", key); put("at", at); put("sent", 1) },
                            SQLiteDatabase.CONFLICT_REPLACE,
                        )
                    }
                }
            }
            db.delete("novel_sync_removed", "sent=1 AND at<?", arrayOf((System.currentTimeMillis() - NovelSyncMerge.TOMBSTONE_TTL_MS).toString()))
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }
}
