package com.sanjay.anitrack.next.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Local watch-progress store — same shape as the proven schema in the
 *  Capacitor app's AniTrackDbPlugin, trimmed to what Next needs today. */
object Db {
    private lateinit var helper: SQLiteOpenHelper

    fun init(ctx: Context) {
        if (::helper.isInitialized) return
        helper = object : SQLiteOpenHelper(ctx.applicationContext, "anitrack_next.db", null, 8) {
            override fun onCreate(db: SQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS playback(
                        anime_id     INTEGER NOT NULL,
                        episode      REAL    NOT NULL,
                        position_sec REAL    NOT NULL,
                        duration_sec REAL    NOT NULL,
                        anime_title  TEXT,
                        anime_cover  TEXT,
                        slug         TEXT,
                        provider_id  TEXT,
                        updated_at   INTEGER NOT NULL,
                        PRIMARY KEY(anime_id, episode)
                    )""",
                )
                createListTable(db)
                createMalOutbox(db)
                createReadingTable(db)
                createMangaListTable(db)
            }
            override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {
                if (old < 2) createListTable(db)
                if (old < 3) {
                    runCatching { db.execSQL("ALTER TABLE list_entry ADD COLUMN mal_id INTEGER") }
                    createMalOutbox(db)
                }
                if (old < 4) runCatching { db.execSQL("ALTER TABLE playback ADD COLUMN provider_id TEXT") }
                if (old < 5) runCatching { db.execSQL("ALTER TABLE list_entry ADD COLUMN year INTEGER") }
                if (old < 6) {
                    runCatching { db.execSQL("ALTER TABLE list_entry ADD COLUMN genres TEXT") }
                    runCatching { db.execSQL("ALTER TABLE list_entry ADD COLUMN format TEXT") }
                }
                if (old < 7) createReadingTable(db)
                if (old < 8) createMangaListTable(db)
            }
        }
    }

    private fun createListTable(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS list_entry(
                anime_id   INTEGER PRIMARY KEY,
                mal_id     INTEGER,
                status     TEXT NOT NULL,
                title      TEXT,
                cover      TEXT,
                score      REAL,
                year       INTEGER,
                genres     TEXT,
                format     TEXT,
                updated_at INTEGER NOT NULL
            )""",
        )
    }

    private fun createMangaListTable(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS manga_list(
                manga_id   INTEGER PRIMARY KEY,
                status     TEXT NOT NULL,
                title      TEXT,
                cover      TEXT,
                updated_at INTEGER NOT NULL
            )""",
        )
    }

    private fun createReadingTable(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS reading(
                manga_id    INTEGER NOT NULL,
                chapter     REAL    NOT NULL,
                chapter_id  TEXT    NOT NULL,
                page        INTEGER NOT NULL,
                page_count  INTEGER NOT NULL,
                title       TEXT,
                cover       TEXT,
                source_id   TEXT    NOT NULL,
                updated_at  INTEGER NOT NULL,
                PRIMARY KEY(manga_id, chapter)
            )""",
        )
    }

    private fun createMalOutbox(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS mal_outbox(
                anime_id         INTEGER PRIMARY KEY,
                op_id            TEXT NOT NULL,
                mal_id           INTEGER NOT NULL,
                operation        TEXT NOT NULL CHECK(operation IN ('upsert','delete')),
                status           TEXT,
                episodes_watched INTEGER,
                created_at       INTEGER NOT NULL
            )""",
        )
    }

    // ── Backup & restore ─────────────────────────────────────────────────────

    /** Tables a backup carries, with their primary keys. The MAL outbox is account state and stays out. */
    private val BACKUP_TABLES = linkedMapOf(
        "playback" to listOf("anime_id", "episode"),
        "list_entry" to listOf("anime_id"),
        "reading" to listOf("manga_id", "chapter"),
        "manga_list" to listOf("manga_id"),
    )

    /** Every row of the backed-up tables, column by column. */
    suspend fun exportTables(): org.json.JSONObject = withContext(Dispatchers.IO) {
        val out = org.json.JSONObject()
        for (table in BACKUP_TABLES.keys) {
            val rows = org.json.JSONArray()
            helper.readableDatabase.rawQuery("SELECT * FROM $table", null).use { c ->
                while (c.moveToNext()) {
                    val row = org.json.JSONObject()
                    for (i in 0 until c.columnCount) {
                        val name = c.getColumnName(i)
                        when (c.getType(i)) {
                            android.database.Cursor.FIELD_TYPE_NULL -> row.put(name, org.json.JSONObject.NULL)
                            android.database.Cursor.FIELD_TYPE_INTEGER -> row.put(name, c.getLong(i))
                            android.database.Cursor.FIELD_TYPE_FLOAT -> row.put(name, c.getDouble(i))
                            android.database.Cursor.FIELD_TYPE_STRING -> row.put(name, c.getString(i))
                            else -> Unit // No blobs in these tables.
                        }
                    }
                    rows.put(row)
                }
            }
            out.put(table, rows)
        }
        out
    }

    /**
     * Merges backed-up rows: one is taken when it's missing here or its updated_at
     * is later than ours. Unknown columns are ignored. Returns rows taken per table.
     */
    suspend fun importTables(tables: org.json.JSONObject): Map<String, Int> = withContext(Dispatchers.IO) {
        val db = helper.writableDatabase
        val taken = linkedMapOf<String, Int>()
        db.beginTransaction()
        try {
            for ((table, keys) in BACKUP_TABLES) {
                val rows = tables.optJSONArray(table) ?: continue
                val columns = db.rawQuery("PRAGMA table_info($table)", null).use { c ->
                    buildSet { while (c.moveToNext()) add(c.getString(c.getColumnIndexOrThrow("name"))) }
                }
                var count = 0
                for (i in 0 until minOf(rows.length(), 500_000)) {
                    val row = rows.optJSONObject(i) ?: continue
                    if (keys.any { !row.has(it) || row.isNull(it) } || row.isNull("updated_at")) continue
                    val updatedAt = row.optLong("updated_at", -1L).takeIf { it >= 0 } ?: continue
                    val where = keys.joinToString(" AND ") { "$it=?" }
                    val args = keys.map { row.get(it).toString() }.toTypedArray()
                    val ours = db.rawQuery("SELECT updated_at FROM $table WHERE $where", args)
                        .use { c -> if (c.moveToFirst()) c.getLong(0) else null }
                    if (ours != null && ours >= updatedAt) continue
                    val values = ContentValues()
                    for (column in columns) {
                        if (!row.has(column)) continue
                        when (val value = row.get(column)) {
                            org.json.JSONObject.NULL -> values.putNull(column)
                            is Int -> values.put(column, value)
                            is Long -> values.put(column, value)
                            is Double -> values.put(column, value)
                            is Number -> values.put(column, value.toDouble())
                            is Boolean -> values.put(column, if (value) 1 else 0)
                            else -> values.put(column, value.toString().take(8192))
                        }
                    }
                    db.insertWithOnConflict(table, null, values, SQLiteDatabase.CONFLICT_REPLACE)
                    count++
                }
                taken[table] = count
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        taken
    }

    // ── My List ───────────────────────────────────────────────────────────────

    val STATUSES = listOf("watching", "completed", "on_hold", "dropped", "plan_to_watch")

    data class ListRow(
        val animeId: Int,
        val status: String,
        val title: String,
        val cover: String?,
        val score: Double?,
        val year: Int?,
        val genres: List<String>,
        val format: String?,
        val updatedAt: Long,
    )

    suspend fun setListStatus(
        animeId: Int,
        status: String,
        title: String,
        cover: String?,
        malId: Int? = null,
        queueForMal: Boolean = false,
        episodesWatched: Int? = null,
        year: Int? = null,
        genres: List<String> = emptyList(),
        format: String? = null,
    ) = withContext(Dispatchers.IO) {
        require(status in STATUSES) { "Invalid list status" }
        val db = helper.writableDatabase
        val cv = ContentValues().apply {
            put("status", status)
            put("title", title); put("cover", cover)
            if (malId != null) put("mal_id", malId)
            if (year != null) put("year", year)
            if (genres.isNotEmpty()) put("genres", org.json.JSONArray(genres).toString())
            if (format != null) put("format", format)
            put("updated_at", System.currentTimeMillis())
        }
        db.beginTransaction()
        try {
            if (db.update("list_entry", cv, "anime_id=?", arrayOf(animeId.toString())) == 0) {
                cv.put("anime_id", animeId)
                db.insertOrThrow("list_entry", null, cv)
            }
            if (queueForMal && malId != null) {
                queueMalOp(db, animeId, malId, "upsert", status, episodesWatched)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    suspend fun removeFromList(
        animeId: Int,
        malId: Int? = null,
        queueForMal: Boolean = false,
    ) = withContext(Dispatchers.IO) {
        val db = helper.writableDatabase
        var effectiveMalId = malId
        if (effectiveMalId == null) {
            db.rawQuery("SELECT mal_id FROM list_entry WHERE anime_id=?", arrayOf(animeId.toString())).use { cursor ->
                if (cursor.moveToFirst() && !cursor.isNull(0)) effectiveMalId = cursor.getInt(0)
            }
        }
        db.beginTransaction()
        try {
            if (queueForMal && effectiveMalId != null) {
                queueMalOp(db, animeId, effectiveMalId!!, "delete", null, null)
            }
            db.delete("list_entry", "anime_id=?", arrayOf(animeId.toString()))
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    private fun queueMalOp(
        db: SQLiteDatabase,
        animeId: Int,
        malId: Int,
        operation: String,
        status: String?,
        episodesWatched: Int?,
    ) {
        val values = ContentValues().apply {
            put("anime_id", animeId)
            put("op_id", java.util.UUID.randomUUID().toString())
            put("mal_id", malId)
            put("operation", operation)
            put("status", status)
            put("episodes_watched", episodesWatched)
            put("created_at", System.currentTimeMillis())
        }
        db.insertWithOnConflict("mal_outbox", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    data class MalOp(
        val animeId: Int,
        val opId: String,
        val malId: Int,
        val operation: String,
        val status: String?,
        val episodesWatched: Int?,
    )

    suspend fun pendingMalOps(): List<MalOp> = withContext(Dispatchers.IO) {
        val out = mutableListOf<MalOp>()
        helper.readableDatabase.rawQuery(
            "SELECT anime_id, op_id, mal_id, operation, status, episodes_watched FROM mal_outbox ORDER BY created_at",
            null,
        ).use { cursor ->
            while (cursor.moveToNext()) {
                out += MalOp(
                    cursor.getInt(0), cursor.getString(1), cursor.getInt(2), cursor.getString(3),
                    if (cursor.isNull(4)) null else cursor.getString(4),
                    if (cursor.isNull(5)) null else cursor.getInt(5),
                )
            }
        }
        out
    }

    suspend fun ackMalOp(animeId: Int, opId: String) = withContext(Dispatchers.IO) {
        helper.writableDatabase.delete(
            "mal_outbox",
            "anime_id=? AND op_id=?",
            arrayOf(animeId.toString(), opId),
        )
    }

    suspend fun applyMalListStatus(
        animeId: Int,
        malId: Int,
        status: String,
        title: String,
        cover: String?,
        score: Double?,
        year: Int?,
        genres: List<String>,
        format: String?,
    ): Boolean = withContext(Dispatchers.IO) {
        val db = helper.writableDatabase
        val pending = db.rawQuery("SELECT 1 FROM mal_outbox WHERE anime_id=?", arrayOf(animeId.toString())).use {
            it.moveToFirst()
        }
        if (pending) return@withContext false
        val cv = ContentValues().apply {
            put("status", status); put("title", title); put("cover", cover)
            if (score != null && score > 0) put("score", score) else putNull("score")
            if (year != null) put("year", year)
            if (genres.isNotEmpty()) put("genres", org.json.JSONArray(genres).toString())
            if (format != null) put("format", format)
            put("mal_id", malId); put("updated_at", System.currentTimeMillis())
        }
        if (db.update("list_entry", cv, "anime_id=?", arrayOf(animeId.toString())) == 0) {
            cv.put("anime_id", animeId)
            db.insertOrThrow("list_entry", null, cv)
        }
        true
    }

    fun clearMalOutbox() {
        if (::helper.isInitialized) helper.writableDatabase.delete("mal_outbox", null, null)
    }

    suspend fun listStatusOf(animeId: Int): String? = withContext(Dispatchers.IO) {
        helper.readableDatabase.rawQuery(
            "SELECT status FROM list_entry WHERE anime_id=?", arrayOf(animeId.toString()),
        ).use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }

    suspend fun listByStatus(status: String): List<ListRow> = withContext(Dispatchers.IO) {
        val out = mutableListOf<ListRow>()
        helper.readableDatabase.rawQuery(
            "SELECT anime_id, status, title, cover, score, year, genres, format, updated_at FROM list_entry WHERE status=? ORDER BY updated_at DESC",
            arrayOf(status),
        ).use { c ->
            while (c.moveToNext()) {
                out += ListRow(
                    c.getInt(0), c.getString(1), c.getString(2) ?: "Unknown", c.getString(3),
                    if (c.isNull(4)) null else c.getDouble(4),
                    if (c.isNull(5)) null else c.getInt(5),
                    if (c.isNull(6)) emptyList() else runCatching {
                        val json = org.json.JSONArray(c.getString(6))
                        List(json.length()) { json.getString(it) }
                    }.getOrDefault(emptyList()),
                    if (c.isNull(7)) null else c.getString(7),
                    c.getLong(8),
                )
            }
        }
        out
    }

    data class CwRow(
        val animeId: Int,
        val episode: Float,
        val positionSec: Double,
        val durationSec: Double,
        val title: String,
        val cover: String?,
        val slug: String?,
        val providerId: String?,
        val updatedAt: Long,
    ) {
        val percent: Int get() = if (durationSec > 0) ((positionSec / durationSec) * 100).toInt() else 0
    }

    suspend fun save(
        animeId: Int, episode: Float, positionSec: Double, durationSec: Double,
        title: String, cover: String?, slug: String?,
        providerId: String? = null,
        updatedAt: Long = System.currentTimeMillis(), // pulled rows keep their remote stamp
    ) = withContext(Dispatchers.IO) {
        if (animeId == 0 || durationSec <= 0) return@withContext
        // Never wipe a stored slug with null (mirror of the main app's COALESCE
        // lesson — sync-pulled rows may not carry one).
        var keepSlug = slug
        var keepProviderId = providerId
        if (keepSlug.isNullOrEmpty() || keepProviderId.isNullOrEmpty()) {
            helper.readableDatabase.rawQuery(
                "SELECT slug, provider_id FROM playback WHERE anime_id=? AND episode=?",
                arrayOf(animeId.toString(), episode.toString()),
            ).use { c -> if (c.moveToFirst()) {
                if (!c.isNull(0)) keepSlug = c.getString(0)
                if (keepProviderId.isNullOrEmpty() && !c.isNull(1)) keepProviderId = c.getString(1)
            } }
        }
        val cv = ContentValues().apply {
            put("anime_id", animeId)
            put("episode", episode)
            put("position_sec", positionSec)
            put("duration_sec", durationSec)
            put("anime_title", title)
            put("anime_cover", cover)
            put("slug", keepSlug)
            put("provider_id", keepProviderId)
            put("updated_at", updatedAt)
        }
        helper.writableDatabase.insertWithOnConflict("playback", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }

    suspend fun updatedAtFor(animeId: Int, episode: Float): Long? = withContext(Dispatchers.IO) {
        helper.readableDatabase.rawQuery(
            "SELECT updated_at FROM playback WHERE anime_id=? AND episode=?",
            arrayOf(animeId.toString(), episode.toString()),
        ).use { c -> if (c.moveToFirst()) c.getLong(0) else null }
    }

    suspend fun newestUpdatedAtFor(animeId: Int): Long? = withContext(Dispatchers.IO) {
        helper.readableDatabase.rawQuery(
            "SELECT MAX(updated_at) FROM playback WHERE anime_id=?",
            arrayOf(animeId.toString()),
        ).use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null }
    }

    /** Every playback row — for the sync push-back pass. */
    suspend fun allRows(): List<CwRow> = withContext(Dispatchers.IO) {
        val out = mutableListOf<CwRow>()
        helper.readableDatabase.rawQuery(
            """SELECT anime_id, episode, position_sec, duration_sec,
                      anime_title, anime_cover, slug, provider_id, updated_at FROM playback""",
            null,
        ).use { c ->
            while (c.moveToNext()) {
                out += CwRow(
                    c.getInt(0), c.getFloat(1), c.getDouble(2), c.getDouble(3),
                    c.getString(4) ?: "Unknown", c.getString(5), c.getString(6), c.getString(7), c.getLong(8),
                )
            }
        }
        out
    }

    /** One card per anime — its most recently touched episode, newest first. */
    suspend fun continueWatching(limit: Int = 30): List<CwRow> = withContext(Dispatchers.IO) {
        val out = mutableListOf<CwRow>()
        helper.readableDatabase.rawQuery(
            """SELECT p.anime_id, p.episode, p.position_sec, p.duration_sec,
                      p.anime_title, p.anime_cover, p.slug, p.provider_id, p.updated_at
               FROM playback p
               JOIN (SELECT anime_id, MAX(updated_at) mu FROM playback GROUP BY anime_id) l
                 ON p.anime_id = l.anime_id AND p.updated_at = l.mu
               ORDER BY p.updated_at DESC LIMIT ?""",
            arrayOf(limit.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                out += CwRow(
                    c.getInt(0), c.getFloat(1), c.getDouble(2), c.getDouble(3),
                    c.getString(4) ?: "Unknown", c.getString(5), c.getString(6), c.getString(7), c.getLong(8),
                )
            }
        }
        out
    }

    /**
     * Marks episodes watched (played to the end) or, with [watched] false, forgets
     * them. Marked episodes stay older than a later episode watched for real, so
     * Continue Watching keeps pointing at that one.
     */
    suspend fun markEpisodesWatched(
        animeId: Int,
        episodes: List<Float>,
        watched: Boolean,
        title: String,
        cover: String?,
        durationSec: Double,
        slug: String?,
        providerId: String?,
    ) = withContext(Dispatchers.IO) {
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            if (!watched) {
                episodes.forEach { ep ->
                    db.delete("playback", "anime_id=? AND episode=?", arrayOf(animeId.toString(), ep.toString()))
                }
            } else {
                val sorted = episodes.sorted()
                val newest = db.rawQuery(
                    "SELECT episode, updated_at FROM playback WHERE anime_id=? ORDER BY updated_at DESC LIMIT 1",
                    arrayOf(animeId.toString()),
                ).use { c -> if (c.moveToFirst()) c.getFloat(0) to c.getLong(1) else null }
                val highest = sorted.lastOrNull() ?: 0f
                val base = if (newest != null && newest.first > highest) newest.second - sorted.size - 1
                    else System.currentTimeMillis() - sorted.size
                sorted.forEachIndexed { i, ep ->
                    db.insertWithOnConflict(
                        "playback", null,
                        ContentValues().apply {
                            put("anime_id", animeId); put("episode", ep)
                            put("position_sec", durationSec); put("duration_sec", durationSec)
                            put("anime_title", title); put("anime_cover", cover)
                            put("slug", slug); put("provider_id", providerId)
                            put("updated_at", base + i)
                        },
                        SQLiteDatabase.CONFLICT_REPLACE,
                    )
                }
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** The episode of a show touched most recently, if any (for "next up"). */
    suspend fun lastWatchedEpisode(animeId: Int): Float? = withContext(Dispatchers.IO) {
        helper.readableDatabase.rawQuery(
            "SELECT episode FROM playback WHERE anime_id=? ORDER BY updated_at DESC LIMIT 1",
            arrayOf(animeId.toString()),
        ).use { c -> if (c.moveToFirst()) c.getFloat(0) else null }
    }

    /** episode number -> percent watched, for the detail grid indicators. */
    suspend fun positionsFor(animeId: Int): Map<Float, Int> = withContext(Dispatchers.IO) {
        val out = mutableMapOf<Float, Int>()
        helper.readableDatabase.rawQuery(
            "SELECT episode, position_sec, duration_sec FROM playback WHERE anime_id=?",
            arrayOf(animeId.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                val dur = c.getDouble(2)
                if (dur > 0) out[c.getFloat(0)] = ((c.getDouble(1) / dur) * 100).toInt()
            }
        }
        out
    }

    suspend fun resumeFor(animeId: Int, episode: Float): Double? = withContext(Dispatchers.IO) {
        helper.readableDatabase.rawQuery(
            "SELECT position_sec, duration_sec FROM playback WHERE anime_id=? AND episode=?",
            arrayOf(animeId.toString(), episode.toString()),
        ).use { c ->
            if (c.moveToFirst()) {
                val pos = c.getDouble(0); val dur = c.getDouble(1)
                // Resume mid-episode only — a finished episode restarts clean.
                if (pos > 5 && (dur <= 0 || pos / dur < 0.93)) pos else null
            } else null
        }
    }

    suspend fun dismiss(animeId: Int) = withContext(Dispatchers.IO) {
        helper.writableDatabase.delete("playback", "anime_id=?", arrayOf(animeId.toString()))
    }

    // ── Manga reading progress ───────────────────────────────────────────

    data class ReadRow(
        val mangaId: Int,
        val chapter: Float,
        val chapterId: String,
        val page: Int,
        val pageCount: Int,
        val title: String,
        val cover: String?,
        val sourceId: String,
        val updatedAt: Long,
    )

    suspend fun saveReading(row: ReadRow) = withContext(Dispatchers.IO) {
        helper.writableDatabase.insertWithOnConflict(
            "reading",
            null,
            ContentValues().apply {
                put("manga_id", row.mangaId)
                put("chapter", row.chapter)
                put("chapter_id", row.chapterId)
                put("page", row.page)
                put("page_count", row.pageCount)
                put("title", row.title)
                put("cover", row.cover)
                put("source_id", row.sourceId)
                put("updated_at", row.updatedAt)
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    /** chapter number -> read state, for the detail list and resume target. */
    suspend fun readingFor(mangaId: Int): Map<Float, com.sanjay.anitrack.next.data.manga.ReadState> =
        withContext(Dispatchers.IO) {
            val out = mutableMapOf<Float, com.sanjay.anitrack.next.data.manga.ReadState>()
            helper.readableDatabase.rawQuery(
                "SELECT chapter, page, page_count, updated_at FROM reading WHERE manga_id=?",
                arrayOf(mangaId.toString()),
            ).use { c ->
                while (c.moveToNext()) {
                    out[c.getFloat(0)] = com.sanjay.anitrack.next.data.manga.ReadState(c.getInt(1), c.getInt(2), c.getLong(3))
                }
            }
            out
        }

    /**
     * Marks chapters (number, chapter id, page count) read — their last page reached —
     * or, with [read] false, forgets them. Marked chapters stay older than a later
     * chapter read for real, so Continue Reading keeps pointing at that one.
     */
    suspend fun markChaptersRead(
        mangaId: Int,
        chapters: List<Triple<Float, String, Int>>,
        read: Boolean,
        title: String,
        cover: String?,
        sourceId: String,
    ) = withContext(Dispatchers.IO) {
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            if (!read) {
                chapters.forEach { (number, _, _) ->
                    db.delete("reading", "manga_id=? AND chapter=?", arrayOf(mangaId.toString(), number.toString()))
                }
            } else {
                val sorted = chapters.sortedBy { it.first }
                val newest = db.rawQuery(
                    "SELECT chapter, updated_at FROM reading WHERE manga_id=? ORDER BY updated_at DESC LIMIT 1",
                    arrayOf(mangaId.toString()),
                ).use { c -> if (c.moveToFirst()) c.getFloat(0) to c.getLong(1) else null }
                val highest = sorted.lastOrNull()?.first ?: 0f
                val base = if (newest != null && newest.first > highest) newest.second - sorted.size - 1
                    else System.currentTimeMillis() - sorted.size
                sorted.forEachIndexed { i, (number, chapterId, pages) ->
                    val count = pages.coerceAtLeast(1)
                    db.insertWithOnConflict(
                        "reading", null,
                        ContentValues().apply {
                            put("manga_id", mangaId); put("chapter", number); put("chapter_id", chapterId)
                            put("page", count - 1); put("page_count", count)
                            put("title", title); put("cover", cover); put("source_id", sourceId)
                            put("updated_at", base + i)
                        },
                        SQLiteDatabase.CONFLICT_REPLACE,
                    )
                }
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** One card per manga — its most recently read chapter, newest first. */
    suspend fun continueReading(limit: Int = 30): List<ReadRow> = withContext(Dispatchers.IO) {
        val out = mutableListOf<ReadRow>()
        helper.readableDatabase.rawQuery(
            """SELECT r.manga_id, r.chapter, r.chapter_id, r.page, r.page_count,
                      r.title, r.cover, r.source_id, r.updated_at
               FROM reading r
               JOIN (SELECT manga_id, MAX(updated_at) mu FROM reading GROUP BY manga_id) l
                 ON r.manga_id = l.manga_id AND r.updated_at = l.mu
               ORDER BY r.updated_at DESC LIMIT ?""",
            arrayOf(limit.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                out += ReadRow(
                    c.getInt(0), c.getFloat(1), c.getString(2), c.getInt(3), c.getInt(4),
                    c.getString(5) ?: "Unknown", c.getString(6), c.getString(7), c.getLong(8),
                )
            }
        }
        out
    }

    suspend fun dismissReading(mangaId: Int) = withContext(Dispatchers.IO) {
        helper.writableDatabase.delete("reading", "manga_id=?", arrayOf(mangaId.toString()))
    }

    /** Every reading row, newest first, for cross-device sync. */
    suspend fun allReadingRows(limit: Int = 20_000): List<ReadRow> = withContext(Dispatchers.IO) {
        val out = mutableListOf<ReadRow>()
        helper.readableDatabase.rawQuery(
            """SELECT manga_id, chapter, chapter_id, page, page_count, title, cover, source_id, updated_at
               FROM reading ORDER BY updated_at DESC LIMIT ?""",
            arrayOf(limit.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                out += ReadRow(
                    c.getInt(0), c.getFloat(1), c.getString(2), c.getInt(3), c.getInt(4),
                    c.getString(5) ?: "Unknown", c.getString(6), c.getString(7), c.getLong(8),
                )
            }
        }
        out
    }

    /**
     * One sync reconcile in a transaction: rows from another device, and rows a
     * removal hides. Chapters are REAL (7.2f is stored as 7.19999…), so removals
     * match within 0.0001.
     */
    suspend fun applySyncedReading(upserts: List<ReadRow>, removes: List<Pair<Int, Double>>) = withContext(Dispatchers.IO) {
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            for ((mangaId, chapter) in removes) {
                db.delete("reading", "manga_id=? AND abs(chapter - ?) < 0.0001", arrayOf(mangaId.toString(), chapter.toString()))
            }
            for (row in upserts) {
                db.insertWithOnConflict(
                    "reading", null,
                    ContentValues().apply {
                        put("manga_id", row.mangaId); put("chapter", row.chapter); put("chapter_id", row.chapterId)
                        put("page", row.page); put("page_count", row.pageCount)
                        put("title", row.title); put("cover", row.cover); put("source_id", row.sourceId)
                        put("updated_at", row.updatedAt)
                    },
                    SQLiteDatabase.CONFLICT_REPLACE,
                )
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    // ── Manga reading list (local) ───────────────────────────────────────

    val MANGA_STATUSES = listOf("reading", "completed", "on_hold", "dropped", "plan_to_read")

    data class MangaListRow(val mangaId: Int, val status: String, val title: String, val cover: String?, val updatedAt: Long)

    suspend fun setMangaStatus(mangaId: Int, status: String, title: String, cover: String?) = withContext(Dispatchers.IO) {
        require(status in MANGA_STATUSES)
        helper.writableDatabase.insertWithOnConflict(
            "manga_list",
            null,
            ContentValues().apply {
                put("manga_id", mangaId)
                put("status", status)
                put("title", title)
                put("cover", cover)
                put("updated_at", System.currentTimeMillis())
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    suspend fun removeMangaFromList(mangaId: Int) = withContext(Dispatchers.IO) {
        helper.writableDatabase.delete("manga_list", "manga_id=?", arrayOf(mangaId.toString()))
    }

    suspend fun mangaStatusOf(mangaId: Int): String? = withContext(Dispatchers.IO) {
        helper.readableDatabase.rawQuery("SELECT status FROM manga_list WHERE manga_id=?", arrayOf(mangaId.toString()))
            .use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }

    suspend fun mangaList(): List<MangaListRow> = withContext(Dispatchers.IO) {
        val out = mutableListOf<MangaListRow>()
        helper.readableDatabase.rawQuery(
            "SELECT manga_id, status, title, cover, updated_at FROM manga_list ORDER BY updated_at DESC",
            null,
        ).use { c ->
            while (c.moveToNext()) {
                out += MangaListRow(c.getInt(0), c.getString(1), c.getString(2) ?: "Unknown", c.getString(3), c.getLong(4))
            }
        }
        out
    }

    /** The highest chapter number read so far per manga, for "new chapters" counts. */
    suspend fun lastReadChapters(): Map<Int, Float> = withContext(Dispatchers.IO) {
        val out = mutableMapOf<Int, Float>()
        helper.readableDatabase.rawQuery("SELECT manga_id, MAX(chapter) FROM reading GROUP BY manga_id", null).use { c ->
            while (c.moveToNext()) out[c.getInt(0)] = c.getFloat(1)
        }
        out
    }
}
