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
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

/**
 * MyAnimeList OAuth + list sync — native port of apps/desktop/main/services/mal.ts.
 * OAuth 2.0 with PKCE (plain method, verifier == challenge), the shared
 * public client id, and the same redirect URL the desktop intercepts.
 */
object Mal {
    private const val CLIENT_ID = "10093a3f9f0174b6b5577c40e9accdae"
    const val REDIRECT_URI = "https://malsync.moe/mal/oauth"
    private const val AUTH_BASE = "https://myanimelist.net/v1/oauth2"
    private const val API_BASE = "https://api.myanimelist.net/v2"

    private lateinit var prefs: SharedPreferences
    private val http = OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build()
    private val refreshLock = Mutex()   // MAL rotates refresh tokens — never race two refreshes
    private val flushLock = Mutex()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var flushJob: Job? = null

    fun init(ctx: Context) {
        if (::prefs.isInitialized) return
        prefs = ctx.applicationContext.getSharedPreferences("anitrack_mal", Context.MODE_PRIVATE)
        requestFlush()
    }

    val username: String? get() = prefs.getString("username", null)
    val isConnected: Boolean get() = prefs.getString("refresh_token", null) != null

    fun disconnect() {
        prefs.edit().clear().apply()
        Db.clearMalOutbox()
    }

    private fun invalidateTokens() {
        prefs.edit()
            .remove("access_token")
            .remove("refresh_token")
            .remove("expires_at")
            .remove("username")
            .apply()
    }

    /** PKCE plain verifier: 64 chars from the allowed set. */
    fun newVerifier(): String {
        val chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
        val random = SecureRandom()
        return buildString(64) { repeat(64) { append(chars[random.nextInt(chars.length)]) } }
    }

    fun authUrl(verifier: String): String =
        "$AUTH_BASE/authorize?response_type=code" +
            "&client_id=$CLIENT_ID" +
            "&code_challenge=$verifier" +
            "&code_challenge_method=plain" +
            "&redirect_uri=" + java.net.URLEncoder.encode(REDIRECT_URI, "UTF-8")

    /** Exchange the auth code; stores tokens + username. */
    suspend fun exchange(code: String, verifier: String): Boolean = withContext(Dispatchers.IO) {
        val body = FormBody.Builder()
            .add("client_id", CLIENT_ID)
            .add("grant_type", "authorization_code")
            .add("code", code)
            .add("code_verifier", verifier)
            .add("redirect_uri", REDIRECT_URI)
            .build()
        val res = http.newCall(Request.Builder().url("$AUTH_BASE/token").post(body).build()).execute()
        res.use {
            if (!it.isSuccessful) return@withContext false
            val j = JSONObject(it.body!!.string())
            saveTokens(j)
        }
        // Grab the display name (non-fatal).
        runCatching {
            api("/users/@me")?.let { me -> prefs.edit().putString("username", me.optString("name")).apply() }
        }
        requestFlush()
        true
    }

    private fun saveTokens(j: JSONObject) {
        prefs.edit()
            .putString("access_token", j.getString("access_token"))
            .putString("refresh_token", j.getString("refresh_token"))
            .putLong("expires_at", System.currentTimeMillis() + j.optLong("expires_in", 3600) * 1000)
            .apply()
    }

    private suspend fun accessToken(): String? = refreshLock.withLock {
        val access = prefs.getString("access_token", null) ?: return null
        if (System.currentTimeMillis() < prefs.getLong("expires_at", 0) - 60_000) return access
        val refresh = prefs.getString("refresh_token", null) ?: return null
        return withContext(Dispatchers.IO) {
            val body = FormBody.Builder()
                .add("client_id", CLIENT_ID)
                .add("grant_type", "refresh_token")
                .add("refresh_token", refresh)
                .build()
            val res = http.newCall(Request.Builder().url("$AUTH_BASE/token").post(body).build()).execute()
            res.use {
                if (!it.isSuccessful) {
                    // Revoked → force reconnect (same as desktop).
                    if (it.code == 400 || it.code == 401) invalidateTokens()
                    return@withContext null
                }
                val j = JSONObject(it.body!!.string())
                saveTokens(j)
                j.getString("access_token")
            }
        }
    }

    private suspend fun api(path: String): JSONObject? {
        val token = accessToken() ?: return null
        return withContext(Dispatchers.IO) {
            val res = http.newCall(
                Request.Builder().url(if (path.startsWith("http")) path else API_BASE + path)
                    .header("Authorization", "Bearer $token").build(),
            ).execute()
            res.use { if (it.isSuccessful) JSONObject(it.body!!.string()) else null }
        }
    }

    data class Entry(
        val malId: Int,
        val title: String,
        val cover: String?,
        val status: String,
        val episodesWatched: Int,
        val score: Double?,
    )

    /** Full list pull with paging (same fields as the desktop). */
    suspend fun pullList(): List<Entry> {
        if (!RemoteConfig.current().features.malSync) {
            throw IOException("MAL sync is temporarily disabled by signed automation rules")
        }
        val out = mutableListOf<Entry>()
        var path: String? = "/users/@me/animelist?fields=list_status,num_episodes,main_picture&limit=100&nsfw=true"
        var guard = 0
        while (path != null && guard++ < 30) {
            val j = api(path) ?: throw IOException("MAL list request failed on page ${guard}")
            val data = j.optJSONArray("data") ?: throw IOException("MAL returned an invalid list page")
            for (i in 0 until data.length()) {
                val node = data.getJSONObject(i).getJSONObject("node")
                val ls = data.getJSONObject(i).optJSONObject("list_status") ?: continue
                out += Entry(
                    node.getInt("id"),
                    node.optString("title"),
                    node.optJSONObject("main_picture")?.optString("large"),
                    ls.optString("status", "plan_to_watch"),
                    ls.optInt("num_episodes_watched", 0),
                    ls.optDouble("score", 0.0).takeIf { it > 0 },
                )
            }
            path = j.optJSONObject("paging")?.optString("next")?.takeIf { it.isNotEmpty() }
        }
        return out
    }

    data class ImportResult(val fetched: Int, val imported: Int)

    /** Refresh MAL list metadata into the local database. Used by Settings and
     * once automatically after the recommendation-schema upgrade. */
    suspend fun importList(onFetched: (Int) -> Unit = {}): ImportResult {
        if (Db.pendingMalOps().isNotEmpty() && !flushPending()) {
            throw IOException("Pending local changes could not be uploaded; remote import was not applied.")
        }
        val entries = pullList()
        onFetched(entries.size)
        val byMal = AniList.byMalIds(entries.map { it.malId }).associateBy { it.malId }
        var imported = 0
        for (entry in entries) {
            val anime = byMal[entry.malId] ?: continue
            if (Db.applyMalListStatus(
                    anime.id,
                    entry.malId,
                    entry.status,
                    anime.title,
                    anime.cover,
                    score = entry.score,
                    year = anime.year,
                    genres = anime.genres,
                    format = anime.format,
                )) imported++
        }
        return ImportResult(entries.size, imported)
    }

    /** Push one status change (fire-and-forget from the status dropdown). */
    suspend fun pushStatus(malId: Int, status: String, episodes: Int? = null): Boolean {
        val token = accessToken() ?: return false
        return withContext(Dispatchers.IO) {
            val form = FormBody.Builder().add("status", status)
            episodes?.let { form.add("num_watched_episodes", "$it") }
            val res = http.newCall(
                Request.Builder().url("$API_BASE/anime/$malId/my_list_status")
                    .header("Authorization", "Bearer $token")
                    .patch(form.build()).build(),
            ).execute()
            res.use { it.isSuccessful }
        }
    }

    private suspend fun deleteStatus(malId: Int): Boolean {
        val token = accessToken() ?: return false
        return withContext(Dispatchers.IO) {
            val response = http.newCall(
                Request.Builder().url("$API_BASE/anime/$malId/my_list_status")
                    .header("Authorization", "Bearer $token")
                    .delete()
                    .build(),
            ).execute()
            response.use { it.isSuccessful || it.code == 404 }
        }
    }

    /** Drain the durable SQLite outbox. An acknowledgement includes the op id,
     *  so an older in-flight PATCH cannot erase a newer DELETE/re-add. */
    suspend fun flushPending(): Boolean = flushLock.withLock {
        if (!isConnected || !RemoteConfig.current().features.malSync) return@withLock false
        for (op in Db.pendingMalOps()) {
            val delivered = if (op.operation == "delete") {
                deleteStatus(op.malId)
            } else {
                pushStatus(op.malId, op.status ?: "plan_to_watch", op.episodesWatched)
            }
            if (!delivered) return@withLock false
            Db.ackMalOp(op.animeId, op.opId)
        }
        // Watched episodes go after explicit status changes, each decided against
        // MAL's entry as it is now: the count never drops, completed stays completed.
        for (progress in Db.pendingMalProgress()) {
            if (Db.listStatusOf(progress.animeId) != "completed") {
                val remote = myListStatus(progress.malId) ?: return@withLock false
                val current = remote.status?.let { WatchProgress.Entry(it, remote.episodesWatched) }
                val next = WatchProgress.after(current, progress.episode, remote.totalEpisodes)
                if (next != null && (next.status != remote.status || next.episodesWatched != remote.episodesWatched)) {
                    if (!pushStatus(progress.malId, next.status, next.episodesWatched)) return@withLock false
                    if (next.status != Db.listStatusOf(progress.animeId)) {
                        Db.setListStatus(progress.animeId, next.status, progress.title, progress.cover, malId = progress.malId)
                    }
                }
            }
            Db.ackMalProgress(progress.animeId, progress.episode)
        }
        true
    }

    private data class MyListStatus(val status: String?, val episodesWatched: Int, val totalEpisodes: Int?)

    /** This account's MAL entry for [malId] (status null: not on the list), or null when MAL could not be read. */
    private suspend fun myListStatus(malId: Int): MyListStatus? {
        val token = accessToken() ?: return null
        return withContext(Dispatchers.IO) {
            runCatching {
                http.newCall(
                    Request.Builder().url("$API_BASE/anime/$malId?fields=num_episodes,my_list_status")
                        .header("Authorization", "Bearer $token").build(),
                ).execute().use { res ->
                    if (!res.isSuccessful) return@use null
                    val json = JSONObject(res.body?.string() ?: return@use null)
                    val list = json.optJSONObject("my_list_status")
                    MyListStatus(
                        list?.optString("status")?.takeIf { it in Db.STATUSES },
                        list?.optInt("num_episodes_watched", 0) ?: 0,
                        json.optInt("num_episodes", 0).takeIf { it > 0 },
                    )
                }
            }.getOrNull()
        }
    }

    /**
     * An episode was watched through: queue it so MAL's episode count can rise.
     * Nothing is sent for a completed show (rewatching keeps it completed), and
     * an earlier episode never lowers the count; MAL is checked before each upload.
     */
    suspend fun episodeWatched(animeId: Int, malId: Int?, episode: Float, title: String, cover: String?) {
        if (!isConnected || episode < 1f || episode % 1f != 0f) return // MAL counts whole episodes.
        val id = (malId ?: Db.malIdOf(animeId))?.takeIf { it > 0 } ?: return
        if (Db.listStatusOf(animeId) == "completed") return
        Db.queueMalProgress(animeId, id, episode.toInt(), title, cover)
        requestFlush()
    }

    fun requestFlush() {
        flushJob?.cancel()
        flushJob = scope.launch {
            var waitMs = 0L
            while (isConnected) {
                if (waitMs > 0) delay(waitMs)
                if (flushPending()) return@launch
                waitMs = if (waitMs == 0L) 30_000L else (waitMs * 2).coerceAtMost(30 * 60_000L)
            }
        }
    }
}
