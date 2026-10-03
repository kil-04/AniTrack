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
