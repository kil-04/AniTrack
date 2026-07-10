package com.sanjay.anitrack.next.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * MyAnimeList OAuth + list sync — native port of electron/services/mal.ts.
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

    fun init(ctx: Context) {
        if (::prefs.isInitialized) return
        prefs = ctx.applicationContext.getSharedPreferences("anitrack_mal", Context.MODE_PRIVATE)
    }

    val username: String? get() = prefs.getString("username", null)
    val isConnected: Boolean get() = prefs.getString("refresh_token", null) != null

    fun disconnect() = prefs.edit().clear().apply()

    /** PKCE plain verifier: 64 chars from the allowed set. */
    fun newVerifier(): String {
        val chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
        return (1..64).map { chars.random() }.joinToString("")
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
                    if (it.code == 400 || it.code == 401) disconnect()
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

    data class Entry(val malId: Int, val title: String, val cover: String?, val status: String, val episodesWatched: Int)

    /** Full list pull with paging (same fields as the desktop). */
    suspend fun pullList(): List<Entry> {
        val out = mutableListOf<Entry>()
        var path: String? = "/users/@me/animelist?fields=list_status,num_episodes,main_picture&limit=100&nsfw=true"
        var guard = 0
        while (path != null && guard++ < 30) {
            val j = api(path) ?: break
            val data = j.optJSONArray("data") ?: break
            for (i in 0 until data.length()) {
                val node = data.getJSONObject(i).getJSONObject("node")
                val ls = data.getJSONObject(i).optJSONObject("list_status") ?: continue
                out += Entry(
                    node.getInt("id"),
                    node.optString("title"),
                    node.optJSONObject("main_picture")?.optString("large"),
                    ls.optString("status", "plan_to_watch"),
                    ls.optInt("num_episodes_watched", 0),
                )
            }
            path = j.optJSONObject("paging")?.optString("next")?.takeIf { it.isNotEmpty() }
        }
        return out
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
}
