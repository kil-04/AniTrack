package com.sanjay.anitrack.next.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Cross-device sync via the SAME private GitHub gist as the desktop app and
 * the Capacitor app — one Continue Watching universe across all three.
 *
 * Wire format (must stay byte-compatible):
 *   { "playback": { "<animeId>:<episode>": PlaybackRow }, "deleted": { "<animeId>": ts } }
 * PlaybackRow: animeId, episode, positionSec, durationSec, animeTitle,
 *              animeCoverUrl, animePaheSession, updatedAt (ms).
 * Semantics ported from src/lib/supabase-sync.ts: last-write-wins by
 * updatedAt, deletion tombstones beat older rows and clear on rewatch,
 * never fabricate timestamps.
 */
object GistSync {
    private const val GH = "https://api.github.com"
    private const val FILE = "anitrack-sync.json"
    private const val DESC = "AniTrack cross-device sync"

    private lateinit var prefs: SharedPreferences
    fun init(ctx: Context) {
        if (::prefs.isInitialized) return
        prefs = ctx.applicationContext.getSharedPreferences("anitrack_next", Context.MODE_PRIVATE)
    }

    var token: String
        get() = prefs.getString("gist_token", "") ?: ""
        set(v) { prefs.edit().putString("gist_token", v).apply() }
    private var gistId: String
        get() = prefs.getString("gist_id", "") ?: ""
        set(v) { prefs.edit().putString("gist_id", v).apply() }

    fun configured() = token.isNotEmpty()

    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()
    private var flushJob: Job? = null

    // In-memory mirror of the gist + pending local changes.
    private val cache = mutableMapOf<String, JSONObject>()
    private val tombstones = mutableMapOf<String, Long>()
    private val dirty = mutableSetOf<String>()
    private var cacheLoaded = false

    private fun req(url: String) = Request.Builder().url(url)
        .header("Authorization", "token $token")
        .header("Accept", "application/vnd.github+json")

    private fun ensureGistId(): String? {
        if (gistId.isNotEmpty()) return gistId
        try {
            http.newCall(req("$GH/gists?per_page=100").build()).execute().use { res ->
                if (res.isSuccessful) {
                    val arr = org.json.JSONArray(res.body?.string() ?: "[]")
                    for (i in 0 until arr.length()) {
                        val g = arr.getJSONObject(i)
                        if (g.optJSONObject("files")?.has(FILE) == true) {
                            gistId = g.getString("id"); return gistId
                        }
                    }
                }
            }
            val body = JSONObject()
                .put("description", DESC)
                .put("public", false)
                .put("files", JSONObject().put(FILE, JSONObject().put("content", """{"playback":{}}""")))
            http.newCall(
                req("$GH/gists").post(body.toString().toRequestBody("application/json".toMediaType())).build(),
            ).execute().use { res ->
                if (res.isSuccessful) {
                    gistId = JSONObject(res.body?.string() ?: "{}").optString("id", "")
                    return gistId.ifEmpty { null }
                }
            }
        } catch (e: Exception) { /* offline */ }
        return null
    }

    private fun loadRemote(id: String): Pair<Map<String, JSONObject>, Map<String, Long>> {
        try {
            http.newCall(req("$GH/gists/$id").build()).execute().use { res ->
                if (!res.isSuccessful) return emptyMap<String, JSONObject>() to emptyMap()
                val file = JSONObject(res.body?.string() ?: "{}").optJSONObject("files")?.optJSONObject(FILE)
                    ?: return emptyMap<String, JSONObject>() to emptyMap()
                var content = file.optString("content", "")
                if (file.optBoolean("truncated", false)) {
                    val raw = file.optString("raw_url", "")
                    if (raw.isNotEmpty()) {
                        http.newCall(req(raw).build()).execute().use { r2 ->
                            if (r2.isSuccessful) content = r2.body?.string() ?: content
                        }
                    }
                }
                if (content.isEmpty()) return emptyMap<String, JSONObject>() to emptyMap()
                val doc = JSONObject(content)
                val rows = mutableMapOf<String, JSONObject>()
                doc.optJSONObject("playback")?.let { pb ->
                    for (k in pb.keys()) rows[k] = pb.getJSONObject(k)
                }
                val deleted = mutableMapOf<String, Long>()
                doc.optJSONObject("deleted")?.let { d ->
                    for (k in d.keys()) deleted[k] = d.getLong(k)
                }
                return rows to deleted
            }
        } catch (e: Exception) {
            return emptyMap<String, JSONObject>() to emptyMap()
        }
    }

    private fun tombstoneCovers(animeId: Any, updatedAt: Long): Boolean {
        val ts = tombstones[animeId.toString()] ?: return false
        return updatedAt <= ts
    }

    private fun mergeRemote(rows: Map<String, JSONObject>, deleted: Map<String, Long>) {
        for ((id, ts) in deleted) if ((tombstones[id] ?: 0) < ts) tombstones[id] = ts
        for ((k, v) in rows) {
            if (tombstoneCovers(k.substringBefore(':'), v.optLong("updatedAt"))) continue
            val cur = cache[k]
            if (cur == null || v.optLong("updatedAt") > cur.optLong("updatedAt")) cache[k] = v
        }
        cache.entries.removeAll { (k, v) -> tombstoneCovers(k.substringBefore(':'), v.optLong("updatedAt")) }
        cacheLoaded = true
    }

    private fun writeGist(id: String): Boolean {
        // Prune ancient tombstones (90 days).
        val cutoff = System.currentTimeMillis() - 90L * 24 * 3600 * 1000
        tombstones.entries.removeAll { it.value < cutoff }
        val pb = JSONObject(); for ((k, v) in cache) pb.put(k, v)
        val del = JSONObject(); for ((k, v) in tombstones) del.put(k, v)
        val content = JSONObject().put("playback", pb).put("deleted", del).toString()
        val body = JSONObject().put("files", JSONObject().put(FILE, JSONObject().put("content", content)))
        return try {
            http.newCall(
                req("$GH/gists/$id").patch(body.toString().toRequestBody("application/json".toMediaType())).build(),
            ).execute().use { it.isSuccessful }
        } catch (e: Exception) { false }
    }

    private fun rowJson(r: Db.CwRow): JSONObject = JSONObject()
        .put("animeId", r.animeId)
        .put("episode", if (r.episode % 1f == 0f) r.episode.toInt() else r.episode)
        .put("positionSec", r.positionSec)
        .put("durationSec", r.durationSec)
        .put("animeTitle", r.title)
        .put("animeCoverUrl", r.cover ?: JSONObject.NULL)
        .put("animePaheSession", r.slug ?: JSONObject.NULL)
        .put("updatedAt", r.updatedAt)

    private fun keyOf(animeId: Int, episode: Float) =
        "$animeId:${if (episode % 1f == 0f) episode.toInt() else episode}"

    /** Called on every progress save — debounced batch flush (7s). */
    fun pushProgress(row: Db.CwRow) {
        if (!configured()) return
        synchronized(this) {
            val ts = tombstones[row.animeId.toString()]
            if (ts != null && row.updatedAt > ts) tombstones.remove(row.animeId.toString())
            val key = keyOf(row.animeId, row.episode)
            val cur = cache[key]
            if (cur == null || row.updatedAt >= cur.optLong("updatedAt")) cache[key] = rowJson(row)
            dirty += key
        }
        flushJob?.cancel()
        flushJob = scope.launch { delay(7000); flush() }
    }

    fun deleteAnime(animeId: Int) {
        if (!configured()) return
        scope.launch {
            lock.withLock {
                val id = ensureGistId() ?: return@withLock
                val (rows, deleted) = loadRemote(id)
                mergeRemote(rows, deleted)
                tombstones[animeId.toString()] = System.currentTimeMillis()
                cache.keys.removeAll { it.substringBefore(':') == animeId.toString() }
                writeGist(id)
            }
        }
    }

    suspend fun flush() {
        if (!configured()) return
        lock.withLock {
            val pending = synchronized(this) { dirty.toList().also { dirty.clear() } }
            if (pending.isEmpty()) return
            val id = ensureGistId() ?: run { synchronized(this) { dirty += pending }; return }
            val (rows, deleted) = loadRemote(id)
            mergeRemote(rows, deleted)
            if (!writeGist(id)) synchronized(this) { dirty += pending }
        }
    }

    /** Two-way reconcile: pull newer remote rows into the DB, apply tombstones,
     *  push back local rows the gist is missing. Returns true if local changed. */
    suspend fun pullAndMerge(): Boolean {
        if (!configured()) return false
        lock.withLock {
            val id = ensureGistId() ?: return false
            val (rows, deleted) = loadRemote(id)
            mergeRemote(rows, deleted)
            var changed = false

            for ((k, v) in cache) {
                val animeId = k.substringBefore(':').toIntOrNull() ?: continue
                val episode = k.substringAfter(':').toFloatOrNull() ?: continue
                val remoteAt = v.optLong("updatedAt")
                val localAt = Db.updatedAtFor(animeId, episode)
                if (localAt == null || remoteAt > localAt) {
                    val session = v.optString("animePaheSession", "")
                    // Only anikoto slugs are useful to Next; pahe UUIDs aren't.
                    val slug = session.takeIf {
                        it.isNotEmpty() && !Regex("^[a-f0-9-]{36}$", RegexOption.IGNORE_CASE).matches(it)
                    }
                    Db.save(
                        animeId, episode,
                        v.optDouble("positionSec", 0.0), v.optDouble("durationSec", 0.0),
                        v.optString("animeTitle", "Unknown"),
                        v.optString("animeCoverUrl").takeIf { it.isNotEmpty() && it != "null" },
                        slug, updatedAt = remoteAt,
                    )
                    changed = true
                }
            }

            // Tombstones dismiss locally too — unless watched here afterwards.
            for ((idStr, ts) in tombstones) {
                val animeId = idStr.toIntOrNull() ?: continue
                val newest = Db.newestUpdatedAtFor(animeId) ?: continue
                if (newest <= ts) { Db.dismiss(animeId); changed = true }
            }

            // Push back local rows the gist is missing or has stale.
            var needWrite = false
            for (r in Db.allRows()) {
                if (tombstoneCovers(r.animeId, r.updatedAt)) continue
                val key = keyOf(r.animeId, r.episode)
                val cur = cache[key]
                if (cur == null || r.updatedAt > cur.optLong("updatedAt")) {
                    cache[key] = rowJson(r)
                    needWrite = true
                }
            }
            if (needWrite) writeGist(id)
            return changed
        }
    }
}
