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
import kotlinx.coroutines.withContext
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
        runCatching {
            val saved = JSONObject(prefs.getString("gist_pending_deletes", "{}") ?: "{}")
            for (key in saved.keys()) {
                val timestamp = saved.getLong(key)
                pendingDeletes[key] = timestamp
                tombstones[key] = timestamp
            }
        }
    }

    var token: String
        get() = prefs.getString("gist_token", "") ?: ""
        set(v) {
            if (v == token) return
            prefs.edit().putString("gist_token", v).remove("gist_id").apply()
            synchronized(this) {
                cache.clear()
                tombstones.clear()
                pendingDeletes.clear()
                dirty.clear()
                cacheLoaded = false
                persistPendingDeletes()
            }
        }
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
    private val dirty = mutableMapOf<String, Long>()
    private var dirtyGeneration = 0L
    private val pendingDeletes = mutableMapOf<String, Long>()
    private var cacheLoaded = false

    private fun req(url: String) = Request.Builder().url(url)
        .header("Authorization", "token $token")
        .header("Accept", "application/vnd.github+json")

    private fun persistPendingDeletes() {
        val json = JSONObject()
        for ((animeId, timestamp) in pendingDeletes) json.put(animeId, timestamp)
        prefs.edit().putString("gist_pending_deletes", json.toString()).apply()
    }

    private fun ensureGistId(): String? {
        if (gistId.isNotEmpty()) return gistId
        try {
            http.newCall(req("$GH/gists?per_page=100").build()).execute().use { res ->
                if (!res.isSuccessful) return null
                val arr = org.json.JSONArray(res.body?.string() ?: return null)
                for (i in 0 until arr.length()) {
                    val g = arr.getJSONObject(i)
                    if (g.optJSONObject("files")?.has(FILE) == true) {
                        gistId = g.getString("id"); return gistId
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

    private data class RemoteDoc(val rows: Map<String, JSONObject>, val deleted: Map<String, Long>)

    /** A failed/partial GET is not an empty document. Callers must never PATCH
     *  after null, otherwise a transient GitHub error can erase remote history. */
    private fun loadRemote(id: String): RemoteDoc? {
        try {
            http.newCall(req("$GH/gists/$id").build()).execute().use { res ->
                if (!res.isSuccessful) {
                    if (res.code == 404 && gistId == id) gistId = ""
                    return null
                }
                val file = JSONObject(res.body?.string() ?: "{}").optJSONObject("files")?.optJSONObject(FILE)
                    ?: return null
                var content = file.optString("content", "")
                if (file.optBoolean("truncated", false)) {
                    val raw = file.optString("raw_url", "")
                    if (raw.isEmpty()) return null
                    http.newCall(req(raw).build()).execute().use { r2 ->
                        if (!r2.isSuccessful) return null
                        content = r2.body?.string() ?: return null
                    }
                }
                if (content.isBlank()) return null
                val doc = JSONObject(content)
                val playback = doc.optJSONObject("playback") ?: return null
                val rows = mutableMapOf<String, JSONObject>()
                for (k in playback.keys()) rows[k] = playback.getJSONObject(k)
                val deleted = mutableMapOf<String, Long>()
                if (doc.has("deleted") && !doc.isNull("deleted")) {
                    val d = doc.optJSONObject("deleted") ?: return null
                    for (k in d.keys()) deleted[k] = d.getLong(k)
                }
                return RemoteDoc(rows, deleted)
            }
        } catch (e: Exception) {
            return null
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
        // Build a pruned snapshot without mutating memory before PATCH succeeds.
        // Unsent deletions are never pruned.
        val cutoff = System.currentTimeMillis() - 90L * 24 * 3600 * 1000
        val sentTombstones = tombstones.filter { (key, value) -> value >= cutoff || pendingDeletes[key] == value }
        val pb = JSONObject(); for ((k, v) in cache) pb.put(k, v)
        val del = JSONObject(); for ((k, v) in sentTombstones) del.put(k, v)
        val content = JSONObject().put("playback", pb).put("deleted", del).toString()
        val body = JSONObject().put("files", JSONObject().put(FILE, JSONObject().put("content", content)))
        val success = try {
            http.newCall(
                req("$GH/gists/$id").patch(body.toString().toRequestBody("application/json".toMediaType())).build(),
            ).execute().use { it.isSuccessful }
        } catch (e: Exception) { false }
        if (success) tombstones.entries.removeAll { (key, value) -> value < cutoff && pendingDeletes[key] != value }
        return success
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
            if (ts != null && row.updatedAt > ts) {
                tombstones.remove(row.animeId.toString())
                pendingDeletes.remove(row.animeId.toString())
                persistPendingDeletes()
            }
            val key = keyOf(row.animeId, row.episode)
            val cur = cache[key]
            if (cur == null || row.updatedAt >= cur.optLong("updatedAt")) cache[key] = rowJson(row)
            dirty[key] = ++dirtyGeneration
        }
        flushJob?.cancel()
        flushJob = scope.launch { delay(7000); flush() }
    }

    fun deleteAnime(animeId: Int) {
        if (!configured()) return
        synchronized(this) {
            val key = animeId.toString()
            val timestamp = System.currentTimeMillis()
            tombstones[key] = timestamp
            pendingDeletes[key] = timestamp
            cache.keys.removeAll { it.substringBefore(':') == key }
            persistPendingDeletes()
        }
        flushJob?.cancel()
        flushJob = scope.launch { flush() }
    }

    suspend fun flush() {
        if (!configured() || !RemoteConfig.current().features.gistSync) return
        lock.withLock {
            val pending = synchronized(this) { dirty.toMap() }
            val deleteSnapshot = synchronized(this) { pendingDeletes.toMap() }
            if (pending.isEmpty() && deleteSnapshot.isEmpty()) return
            val id = ensureGistId() ?: return
            val remote = loadRemote(id) ?: return
            mergeRemote(remote.rows, remote.deleted)
            if (writeGist(id)) synchronized(this) {
                for ((key, generation) in pending) if (dirty[key] == generation) dirty.remove(key)
                for ((key, timestamp) in deleteSnapshot) {
                    if (pendingDeletes[key] == timestamp) pendingDeletes.remove(key)
                }
                persistPendingDeletes()
            }
        }
    }

    /** Two-way reconcile: pull newer remote rows into the DB, apply tombstones,
     *  push back local rows the gist is missing. Returns true if local changed. */
    suspend fun pullAndMerge(): Boolean = withContext(Dispatchers.IO) {
        if (!configured() || !RemoteConfig.current().features.gistSync) return@withContext false
        lock.withLock {
            val id = ensureGistId() ?: throw java.io.IOException("Could not find or create the sync gist")
            val remote = loadRemote(id) ?: throw java.io.IOException("Could not read the sync gist")
            mergeRemote(remote.rows, remote.deleted)
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
            val deleteSnapshot = synchronized(this) { pendingDeletes.toMap() }
            if ((needWrite || deleteSnapshot.isNotEmpty()) && !writeGist(id)) {
                throw java.io.IOException("Could not upload merged sync data")
            }
            if (deleteSnapshot.isNotEmpty()) synchronized(this) {
                for ((key, timestamp) in deleteSnapshot) {
                    if (pendingDeletes[key] == timestamp) pendingDeletes.remove(key)
                }
                persistPendingDeletes()
            }
            return@withLock changed
        }
    }
}
