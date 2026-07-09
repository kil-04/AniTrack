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
        helper = object : SQLiteOpenHelper(ctx.applicationContext, "anitrack_next.db", null, 2) {
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
                        updated_at   INTEGER NOT NULL,
                        PRIMARY KEY(anime_id, episode)
                    )""",
                )
                createListTable(db)
            }
            override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {
                if (old < 2) createListTable(db)
            }
        }
    }

    private fun createListTable(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS list_entry(
                anime_id   INTEGER PRIMARY KEY,
                status     TEXT NOT NULL,
                title      TEXT,
                cover      TEXT,
                score      REAL,
                updated_at INTEGER NOT NULL
            )""",
        )
    }

    // ── My List ───────────────────────────────────────────────────────────────

    val STATUSES = listOf("watching", "completed", "on_hold", "dropped", "plan_to_watch")

    data class ListRow(val animeId: Int, val status: String, val title: String, val cover: String?, val score: Double?)

    suspend fun setListStatus(animeId: Int, status: String, title: String, cover: String?) = withContext(Dispatchers.IO) {
        val cv = ContentValues().apply {
            put("anime_id", animeId); put("status", status)
            put("title", title); put("cover", cover)
            put("updated_at", System.currentTimeMillis())
        }
        helper.writableDatabase.insertWithOnConflict("list_entry", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }

    suspend fun removeFromList(animeId: Int) = withContext(Dispatchers.IO) {
        helper.writableDatabase.delete("list_entry", "anime_id=?", arrayOf(animeId.toString()))
    }

    suspend fun listStatusOf(animeId: Int): String? = withContext(Dispatchers.IO) {
        helper.readableDatabase.rawQuery(
            "SELECT status FROM list_entry WHERE anime_id=?", arrayOf(animeId.toString()),
        ).use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }

    suspend fun listByStatus(status: String): List<ListRow> = withContext(Dispatchers.IO) {
        val out = mutableListOf<ListRow>()
        helper.readableDatabase.rawQuery(
            "SELECT anime_id, status, title, cover, score FROM list_entry WHERE status=? ORDER BY updated_at DESC",
            arrayOf(status),
        ).use { c ->
            while (c.moveToNext()) {
                out += ListRow(c.getInt(0), c.getString(1), c.getString(2) ?: "Unknown", c.getString(3),
                    if (c.isNull(4)) null else c.getDouble(4))
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
        val updatedAt: Long,
    ) {
        val percent: Int get() = if (durationSec > 0) ((positionSec / durationSec) * 100).toInt() else 0
    }

    suspend fun save(
        animeId: Int, episode: Float, positionSec: Double, durationSec: Double,
        title: String, cover: String?, slug: String?,
        updatedAt: Long = System.currentTimeMillis(), // pulled rows keep their remote stamp
    ) = withContext(Dispatchers.IO) {
        if (animeId == 0 || durationSec <= 0) return@withContext
        // Never wipe a stored slug with null (mirror of the main app's COALESCE
        // lesson — sync-pulled rows may not carry one).
        var keepSlug = slug
        if (keepSlug.isNullOrEmpty()) {
            helper.readableDatabase.rawQuery(
                "SELECT slug FROM playback WHERE anime_id=? AND episode=?",
                arrayOf(animeId.toString(), episode.toString()),
            ).use { c -> if (c.moveToFirst() && !c.isNull(0)) keepSlug = c.getString(0) }
        }
        val cv = ContentValues().apply {
            put("anime_id", animeId)
            put("episode", episode)
            put("position_sec", positionSec)
            put("duration_sec", durationSec)
            put("anime_title", title)
            put("anime_cover", cover)
            put("slug", keepSlug)
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
                      anime_title, anime_cover, slug, updated_at FROM playback""",
            null,
        ).use { c ->
            while (c.moveToNext()) {
                out += CwRow(
                    c.getInt(0), c.getFloat(1), c.getDouble(2), c.getDouble(3),
                    c.getString(4) ?: "Unknown", c.getString(5), c.getString(6), c.getLong(7),
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
                      p.anime_title, p.anime_cover, p.slug, p.updated_at
               FROM playback p
               JOIN (SELECT anime_id, MAX(updated_at) mu FROM playback GROUP BY anime_id) l
                 ON p.anime_id = l.anime_id AND p.updated_at = l.mu
               ORDER BY p.updated_at DESC LIMIT ?""",
            arrayOf(limit.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                out += CwRow(
                    c.getInt(0), c.getFloat(1), c.getDouble(2), c.getDouble(3),
                    c.getString(4) ?: "Unknown", c.getString(5), c.getString(6), c.getLong(7),
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
}
