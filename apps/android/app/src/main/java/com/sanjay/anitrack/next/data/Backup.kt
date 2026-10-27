package com.sanjay.anitrack.next.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStream

/**
 * Backup & restore of everything AniTrack keeps only on this device: watch
 * progress, the anime and manga lists, reading progress, and plain settings
 * (player, captions, reader, per-title source and group picks). Account tokens
 * (MyAnimeList, GitHub) and the MAL outbox are never included.
 *
 * Restoring merges: an entry is taken when it's missing here or was updated
 * later in the backup, so restoring an old file never rolls progress back.
 */
object Backup {
    private const val FORMAT = "anitrack-backup"
    private const val VERSION = 1
    private const val MAX_BYTES = 64 * 1024 * 1024
    private const val PREFS = "anitrack_next"
    private val PREF_PREFIXES = listOf("manga_source_", "manga_group_", "mangadot_match_", "mangaball_match_", "xcomic_match_", "toonkotsu_match_", "reader_", "cap_")
    private val PREF_KEYS = setOf("autoplay", "auto_next", "auto_skip", "home_mode", "city_pop_enabled", "city_pop_favorites", "city_pop_saved_tracks")

    data class Summary(val watched: Int, val anime: Int, val reading: Int, val manga: Int, val settings: Int) {
        /** "12 watched episodes, 3 anime list entries", or "nothing new". */
        fun describe(): String = listOfNotNull(
            count(watched, "watched episode", "watched episodes"),
            count(anime, "anime list entry", "anime list entries"),
            count(reading, "read chapter", "read chapters"),
            count(manga, "manga list entry", "manga list entries"),
            count(settings, "setting", "settings"),
        ).joinToString(", ").ifEmpty { "nothing new" }

        private fun count(n: Int, one: String, many: String) = if (n <= 0) null else "$n ${if (n == 1) one else many}"
    }

    internal fun isBackedUpPref(key: String): Boolean = key in PREF_KEYS || PREF_PREFIXES.any(key::startsWith)

    suspend fun export(context: Context, out: OutputStream): Summary = withContext(Dispatchers.IO) {
        Db.init(context)
        val tables = Db.exportTables()
        val prefs = JSONObject()
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).all.forEach { (key, value) ->
            if (!isBackedUpPref(key)) return@forEach
            val typed = when (value) {
                is Boolean -> JSONObject().put("type", "bool").put("value", value)
                is Int -> JSONObject().put("type", "int").put("value", value)
                is Long -> JSONObject().put("type", "long").put("value", value)
                is Float -> JSONObject().put("type", "float").put("value", value.toDouble())
                is String -> JSONObject().put("type", "string").put("value", value)
                else -> null
            }
            if (typed != null) prefs.put(key, typed)
        }
        val document = JSONObject()
            .put("format", FORMAT)
            .put("version", VERSION)
            .put("exportedAt", System.currentTimeMillis())
            .put("app", com.sanjay.anitrack.next.BuildConfig.VERSION_NAME)
            .put("tables", tables)
            .put("prefs", prefs)
        out.bufferedWriter(Charsets.UTF_8).use { it.write(document.toString()) }
        Summary(
            watched = tables.optJSONArray("playback")?.length() ?: 0,
            anime = tables.optJSONArray("list_entry")?.length() ?: 0,
            reading = tables.optJSONArray("reading")?.length() ?: 0,
            manga = tables.optJSONArray("manga_list")?.length() ?: 0,
            settings = prefs.length(),
        )
    }

    suspend fun import(context: Context, input: InputStream): Summary = withContext(Dispatchers.IO) {
        Db.init(context)
        val bytes = input.use { stream ->
            val buffer = java.io.ByteArrayOutputStream()
            val chunk = ByteArray(64 * 1024)
            while (true) {
                val n = stream.read(chunk)
                if (n < 0) break
                if (buffer.size() + n > MAX_BYTES) throw IllegalArgumentException("That file is too large to be an AniTrack backup.")
                buffer.write(chunk, 0, n)
            }
            buffer.toByteArray()
        }
        val document = runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }
            .getOrElse { throw IllegalArgumentException("That file isn't an AniTrack backup.") }
        if (document.optString("format") != FORMAT) throw IllegalArgumentException("That file isn't an AniTrack backup.")
        if (document.optInt("version") > VERSION) throw IllegalArgumentException("This backup is from a newer AniTrack. Update the app first.")
        val taken = Db.importTables(document.optJSONObject("tables") ?: JSONObject())
        var settings = 0
        document.optJSONObject("prefs")?.let { prefs ->
            val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            prefs.keys().forEach { key ->
                if (!isBackedUpPref(key)) return@forEach
                val typed = prefs.optJSONObject(key) ?: return@forEach
                when (typed.optString("type")) {
                    "bool" -> editor.putBoolean(key, typed.optBoolean("value"))
                    "int" -> editor.putInt(key, typed.optInt("value"))
                    "long" -> editor.putLong(key, typed.optLong("value"))
                    "float" -> editor.putFloat(key, typed.optDouble("value").toFloat())
                    "string" -> editor.putString(key, typed.optString("value").take(if (key == "city_pop_saved_tracks") 131072 else 4096))
                    else -> return@forEach
                }
                settings++
            }
            editor.apply()
        }
        Summary(
            watched = taken["playback"] ?: 0,
            anime = taken["list_entry"] ?: 0,
            reading = taken["reading"] ?: 0,
            manga = taken["manga_list"] ?: 0,
            settings = settings,
        )
    }
}
