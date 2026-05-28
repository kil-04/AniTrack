package com.sanjay.anitrack.plugins

import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.content.ContentValues
import android.content.Context
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject

// ── Schema ────────────────────────────────────────────────────────────────────

private class DbHelper(ctx: Context) : SQLiteOpenHelper(ctx, "anitrack.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS anime (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                cover_image TEXT,
                banner_image TEXT,
                episodes INTEGER,
                status TEXT,
                season TEXT,
                season_year INTEGER,
                score REAL,
                genres TEXT,
                description TEXT,
                mal_id INTEGER,
                updated_at INTEGER
            )
        """.trimIndent())
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS list_entry (
                anime_id INTEGER PRIMARY KEY,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                score REAL,
                rewatches INTEGER DEFAULT 0,
                notes TEXT,
                mal_dirty INTEGER DEFAULT 0,
                updated_at INTEGER
            )
        """.trimIndent())
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS playback (
                anime_id INTEGER NOT NULL,
                episode INTEGER NOT NULL,
                position_sec REAL NOT NULL DEFAULT 0,
                duration_sec REAL NOT NULL DEFAULT 0,
                anime_title TEXT,
                anime_cover_url TEXT,
                animepahe_session TEXT,
                updated_at INTEGER,
                PRIMARY KEY (anime_id, episode)
            )
        """.trimIndent())
    }
    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {}
}

// ── Plugin ────────────────────────────────────────────────────────────────────

@CapacitorPlugin(name = "AniTrackDb")
class AniTrackDbPlugin : Plugin() {

    private lateinit var db: DbHelper

    override fun load() {
        db = DbHelper(context)
    }

    // ── list.getAll ───────────────────────────────────────────────────────────

    @PluginMethod
    fun getAll(call: PluginCall) {
        try {
            val result = JSONArray()
            val rw = db.readableDatabase
            val c = rw.rawQuery("""
                SELECT le.anime_id, le.status, le.progress, le.score, le.rewatches, le.notes, le.updated_at,
                       a.title, a.cover_image, a.banner_image, a.episodes, a.status as a_status,
                       a.season, a.season_year, a.score as a_score, a.genres, a.mal_id
                FROM list_entry le
                LEFT JOIN anime a ON a.id = le.anime_id
                ORDER BY le.updated_at DESC
            """.trimIndent(), null)
            while (c.moveToNext()) {
                val entry = JSONObject().apply {
                    put("animeId",   c.getInt(0))
                    put("status",    c.getString(1))
                    put("progress",  c.getInt(2))
                    put("score",     if (c.isNull(3)) JSONObject.NULL else c.getDouble(3))
                    put("rewatches", c.getInt(4))
                    put("notes",     c.getString(5) ?: "")
                    put("updatedAt", c.getLong(6))
                }
                val anime = if (!c.isNull(7)) JSONObject().apply {
                    put("id",         c.getInt(0))
                    put("title",      c.getString(7) ?: "")
                    put("coverImage", if (c.isNull(8)) JSONObject.NULL else c.getString(8))
                    put("bannerImage",if (c.isNull(9)) JSONObject.NULL else c.getString(9))
                    put("episodes",   if (c.isNull(10)) JSONObject.NULL else c.getInt(10))
                    put("status",     if (c.isNull(11)) JSONObject.NULL else c.getString(11))
                    put("season",     if (c.isNull(12)) JSONObject.NULL else c.getString(12))
                    put("seasonYear", if (c.isNull(13)) JSONObject.NULL else c.getInt(13))
                    put("score",      if (c.isNull(14)) JSONObject.NULL else c.getDouble(14))
                    put("genres",     if (c.isNull(15)) JSONArray() else JSONArray(c.getString(15) ?: "[]"))
                    put("malId",      if (c.isNull(16)) JSONObject.NULL else c.getInt(16))
                } else JSONObject.NULL
                result.put(JSONObject().apply { put("entry", entry); put("anime", anime) })
            }
            c.close()
            val ret = JSObject(); ret.put("value", result.toString())
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("getAll failed: ${e.message}")
        }
    }

    // ── list.set ──────────────────────────────────────────────────────────────

    @PluginMethod
    fun listSet(call: PluginCall) {
        try {
            val entryStr = call.getString("entry") ?: return call.reject("entry required")
            val e = JSONObject(entryStr)
            val rw = db.writableDatabase
            val cv = ContentValues().apply {
                put("anime_id",  e.getInt("animeId"))
                put("status",    e.getString("status"))
                put("progress",  e.optInt("progress", 0))
                put("score",     if (e.isNull("score")) null else e.getDouble("score"))
                put("rewatches", e.optInt("rewatches", 0))
                put("notes",     e.optString("notes", ""))
                put("mal_dirty", 1)
                put("updated_at", System.currentTimeMillis())
            }
            rw.insertWithOnConflict("list_entry", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
            // Save anime stub if provided
            if (e.has("anime")) {
                val a = e.getJSONObject("anime")
                upsertAnime(rw, a)
            }
            val ret = JSObject(); ret.put("value", "[]")
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("listSet failed: ${e.message}")
        }
    }

    private fun upsertAnime(rw: SQLiteDatabase, a: JSONObject) {
        val cv = ContentValues().apply {
            put("id",          a.getInt("id"))
            put("title",       a.optString("title", ""))
            put("cover_image", if (a.isNull("coverImage")) null else a.getString("coverImage"))
            put("episodes",    if (a.isNull("episodes")) null else a.getInt("episodes"))
            put("status",      if (a.isNull("status")) null else a.getString("status"))
            put("season",      if (a.isNull("season")) null else a.getString("season"))
            put("season_year", if (a.isNull("seasonYear")) null else a.getInt("seasonYear"))
            put("score",       if (a.isNull("score")) null else a.getDouble("score"))
            put("genres",      a.optJSONArray("genres")?.toString() ?: "[]")
            put("mal_id",      if (a.isNull("malId")) null else a.getInt("malId"))
            put("updated_at",  System.currentTimeMillis())
        }
        rw.insertWithOnConflict("anime", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }

    // ── list.continueWatching ─────────────────────────────────────────────────

    @PluginMethod
    fun continueWatching(call: PluginCall) {
        try {
            val result = buildContinueWatching(db.readableDatabase, 1, 20)
            val ret = JSObject(); ret.put("value", result.getJSONArray("items").toString())
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("continueWatching failed: ${e.message}")
        }
    }

    @PluginMethod
    fun continueWatchingPaged(call: PluginCall) {
        try {
            val page     = call.getInt("page") ?: 1
            val pageSize = call.getInt("pageSize") ?: 24
            val result   = buildContinueWatching(db.readableDatabase, page, pageSize)
            val ret = JSObject(); ret.put("value", result.toString())
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("continueWatchingPaged failed: ${e.message}")
        }
    }

    private fun buildContinueWatching(rdb: SQLiteDatabase, page: Int, pageSize: Int): JSONObject {
        pruneDuplicateStubs(rdb)
        val offset = (page - 1) * pageSize
        val countC = rdb.rawQuery("""
            SELECT COUNT(DISTINCT LOWER(TRIM(COALESCE(p.anime_title, a.title))))
            FROM playback p
            LEFT JOIN anime a ON a.id = p.anime_id
            WHERE p.duration_sec > 0 AND (p.position_sec / p.duration_sec) < 0.95
        """.trimIndent(), null)
        val total = if (countC.moveToFirst()) countC.getInt(0) else 0
        countC.close()

        val items = JSONArray()
        val c = rdb.rawQuery("""
            WITH latest AS (
                SELECT LOWER(TRIM(COALESCE(p2.anime_title, a2.title))) AS clean_title,
                       MAX(p2.updated_at) AS max_updated
                FROM playback p2
                LEFT JOIN anime a2 ON a2.id = p2.anime_id
                WHERE p2.duration_sec > 0 AND (p2.position_sec / p2.duration_sec) < 0.95
                GROUP BY LOWER(TRIM(COALESCE(p2.anime_title, a2.title)))
            )
            SELECT p.anime_id, p.episode, p.position_sec, p.duration_sec,
                   p.anime_title, p.anime_cover_url, p.animepahe_session, p.updated_at,
                   a.title, a.cover_image
            FROM playback p
            LEFT JOIN anime a ON a.id = p.anime_id
            JOIN latest l ON LOWER(TRIM(COALESCE(p.anime_title, a.title))) = l.clean_title AND p.updated_at = l.max_updated
            ORDER BY p.updated_at DESC
            LIMIT ? OFFSET ?
        """.trimIndent(), arrayOf(pageSize.toString(), offset.toString()))
        val seen = hashSetOf<String>()
        while (c.moveToNext()) {
            val animeTitle  = c.getString(4) ?: c.getString(8) ?: "Unknown"
            val dedupKey = animeTitle.trim().lowercase()
            if (seen.contains(dedupKey)) continue
            seen.add(dedupKey)

            val animeId     = c.getInt(0)
            val posSec      = c.getDouble(2)
            val durSec      = c.getDouble(3)
            val coverUrl    = c.getString(5) ?: c.getString(9)
            val paheSession = c.getString(6)
            val pct         = if (durSec > 0) (posSec / durSec) * 100.0 else 0.0
            val anime = JSONObject().apply {
                put("id",          animeId)
                put("title",       animeTitle)
                put("coverImage",  coverUrl ?: JSONObject.NULL)
            }
            items.put(JSONObject().apply {
                put("anime",             anime)
                put("episode",           c.getInt(1))
                put("positionSec",       posSec)
                put("durationSec",       durSec)
                put("percent",           pct)
                put("animePaheSession",  paheSession ?: JSONObject.NULL)
                put("updatedAt",         c.getLong(7))
            })
        }
        c.close()
        return JSONObject().apply { put("items", items); put("total", total) }
    }

    // ── list.dismissContinueWatching ──────────────────────────────────────────

    @PluginMethod
    fun dismissContinueWatching(call: PluginCall) {
        val animeId = call.getInt("animeId") ?: return call.reject("animeId required")
        db.writableDatabase.delete("playback", "anime_id = ?", arrayOf(animeId.toString()))
        val ret = JSObject(); ret.put("ok", true)
        call.resolve(ret)
    }

    // ── progress.get ──────────────────────────────────────────────────────────

    @PluginMethod
    fun progressGet(call: PluginCall) {
        val animeId = call.getInt("animeId") ?: return call.reject("animeId required")
        val episode = call.getInt("episode") ?: return call.reject("episode required")
        val c = db.readableDatabase.rawQuery(
            "SELECT position_sec, duration_sec, anime_title, anime_cover_url, animepahe_session, updated_at FROM playback WHERE anime_id=? AND episode=?",
            arrayOf(animeId.toString(), episode.toString())
        )
        val ret = JSObject()
        if (c.moveToFirst()) {
            val obj = JSONObject().apply {
                put("animeId",         animeId)
                put("episode",         episode)
                put("positionSec",     c.getDouble(0))
                put("durationSec",     c.getDouble(1))
                put("animeTitle",      c.getString(2) ?: "")
                put("animeCoverUrl",   c.getString(3))
                put("animePaheSession",c.getString(4))
                put("updatedAt",       c.getLong(5))
            }
            ret.put("value", obj.toString())
        } else {
            ret.put("value", JSObject.NULL)
        }
        c.close()
        call.resolve(ret)
    }

    // ── progress.set ──────────────────────────────────────────────────────────

    @PluginMethod
    fun progressSet(call: PluginCall) {
        try {
            val pStr = call.getString("progress") ?: return call.reject("progress required")
            val p    = JSONObject(pStr)
            val cv   = ContentValues().apply {
                put("anime_id",         p.getInt("animeId"))
                put("episode",          p.getInt("episode"))
                put("position_sec",     p.getDouble("positionSec"))
                put("duration_sec",     p.getDouble("durationSec"))
                put("anime_title",      p.optString("animeTitle"))
                put("anime_cover_url",  p.optString("animeCoverUrl"))
                put("animepahe_session",if (p.isNull("animePaheSession")) null else p.getString("animePaheSession"))
                put("updated_at",       p.optLong("updatedAt", System.currentTimeMillis()))
            }
            db.writableDatabase.insertWithOnConflict("playback", null, cv, SQLiteDatabase.CONFLICT_REPLACE)

            // Also upsert anime row if cover/title provided but no DB row yet
            val animeId = p.getInt("animeId")
            val title   = p.optString("animeTitle")
            val cover   = p.optString("animeCoverUrl")
            if (title.isNotEmpty()) {
                val animeCheck = db.readableDatabase.rawQuery("SELECT id FROM anime WHERE id=?", arrayOf(animeId.toString()))
                val exists = animeCheck.moveToFirst(); animeCheck.close()
                if (!exists) {
                    val acv = ContentValues().apply {
                        put("id", animeId); put("title", title)
                        if (cover.isNotEmpty()) put("cover_image", cover)
                        put("updated_at", System.currentTimeMillis())
                    }
                    db.writableDatabase.insertWithOnConflict("anime", null, acv, SQLiteDatabase.CONFLICT_IGNORE)
                }
            }

            pruneDuplicateStubs(db.writableDatabase)

            val ret = JSObject(); ret.put("ok", true)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("progressSet failed: ${e.message}")
        }
    }

    // ── progress.getForAnime ──────────────────────────────────────────────────

    @PluginMethod
    fun progressGetForAnime(call: PluginCall) {
        val animeId = call.getInt("animeId") ?: return call.reject("animeId required")
        val result  = JSONArray()
        val c = db.readableDatabase.rawQuery(
            "SELECT episode, position_sec, duration_sec, updated_at FROM playback WHERE anime_id=? ORDER BY episode",
            arrayOf(animeId.toString())
        )
        while (c.moveToNext()) {
            result.put(JSONObject().apply {
                put("animeId",   animeId)
                put("episode",   c.getInt(0))
                put("positionSec", c.getDouble(1))
                put("durationSec", c.getDouble(2))
                put("updatedAt", c.getLong(3))
            })
        }
        c.close()
        val ret = JSObject(); ret.put("value", result.toString())
        call.resolve(ret)
    }

    private fun pruneDuplicateStubs(ldb: SQLiteDatabase) {
        try {
            ldb.execSQL("""
                DELETE FROM playback
                WHERE anime_id < 0
                  AND EXISTS (
                      SELECT 1 FROM playback p2
                      WHERE p2.anime_id > 0
                        AND p2.episode = playback.episode
                        AND (
                          (p2.animepahe_session IS NOT NULL AND p2.animepahe_session = playback.animepahe_session)
                          OR
                          (p2.anime_title IS NOT NULL AND LOWER(TRIM(p2.anime_title)) = LOWER(TRIM(playback.anime_title)))
                        )
                  )
            """.trimIndent())

            ldb.execSQL("""
                DELETE FROM anime
                WHERE id < 0
                  AND NOT EXISTS (SELECT 1 FROM playback WHERE anime_id = anime.id)
                  AND NOT EXISTS (SELECT 1 FROM list_entry WHERE anime_id = anime.id)
            """.trimIndent())
        } catch (e: Exception) {
            // best-effort
        }
    }
}
