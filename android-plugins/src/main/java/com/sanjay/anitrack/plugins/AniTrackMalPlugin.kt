package com.sanjay.anitrack.plugins

import android.content.Context
import android.net.Uri
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import android.util.Base64

/**
 * AniTrackMalPlugin — MAL OAuth 2.0 PKCE + list sync for Android.
 *
 * OAuth flow: opens Chrome Custom Tab via intent → user authorises → deep link
 * anitrack://mal-callback?code=XXX returns to app → exchange code for tokens.
 *
 * The browser step uses Android intent (startActivity) to open the MAL auth URL.
 * The callback is handled by MainActivity registering an intent-filter for anitrack://.
 */

@CapacitorPlugin(name = "AniTrackMal")
class AniTrackMalPlugin : Plugin() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val prefs get() = context.getSharedPreferences("anitrack_mal", Context.MODE_PRIVATE)
    private val http  = OkHttpClient()

    private val DEFAULT_CLIENT_ID = "6114d00ca681b7701d1e15fe11a4987e"

    private fun clientId(): String = prefs.getString("custom_client_id", null) ?: DEFAULT_CLIENT_ID

    // ── PKCE helpers ──────────────────────────────────────────────────────────

    private fun generateVerifier(): String {
        val bytes = ByteArray(32); SecureRandom().nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    // MAL uses "plain" PKCE method (challenge = verifier)
    private fun generateChallenge(verifier: String) = verifier

    // ── Auth state ────────────────────────────────────────────────────────────

    private fun loadState(): JSONObject {
        val connected  = prefs.getBoolean("connected", false)
        val username   = prefs.getString("username", null)
        val expiresAt  = prefs.getLong("expires_at", 0)
        return JSONObject().apply {
            put("connected", connected)
            put("username",  username ?: JSONObject.NULL)
            put("expiresAt", expiresAt)
        }
    }

    private fun saveTokens(access: String, refresh: String, expiresIn: Int, username: String?) {
        prefs.edit()
            .putBoolean("connected",    true)
            .putString("access_token",  access)
            .putString("refresh_token", refresh)
            .putLong("expires_at",      System.currentTimeMillis() + expiresIn * 1000L)
            .apply()
        if (username != null) prefs.edit().putString("username", username).apply()
    }

    private fun accessToken(): String? = prefs.getString("access_token", null)
    private fun refreshToken(): String? = prefs.getString("refresh_token", null)

    // ── beginAuth ─────────────────────────────────────────────────────────────

    @PluginMethod
    fun beginAuth(call: PluginCall) {
        val clientId = call.getString("clientId") ?: clientId()
        val verifier  = generateVerifier()
        val challenge = generateChallenge(verifier)
        // Persist verifier so the callback can exchange it
        prefs.edit().putString("pkce_verifier", verifier).putString("pending_client_id", clientId).apply()

        val authUrl = "https://myanimelist.net/v1/oauth2/authorize" +
            "?response_type=code" +
            "&client_id=$clientId" +
            "&code_challenge=$challenge" +
            "&code_challenge_method=plain" +
            "&redirect_uri=${Uri.encode("anitrack://mal-callback")}"

        // Open in system browser (or Chrome Custom Tab via intent)
        val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(authUrl))
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)

        val ret = JSObject(); ret.put("ok", true)
        call.resolve(ret)
    }

    /** Called from MainActivity when anitrack://mal-callback?code=XXX is received. */
    fun handleCallback(code: String) {
        val verifier  = prefs.getString("pkce_verifier", null)     ?: return
        val clientId  = prefs.getString("pending_client_id", null) ?: clientId()
        scope.launch { exchangeCode(code, verifier, clientId) }
    }

    private suspend fun exchangeCode(code: String, verifier: String, clientId: String) {
        try {
            val body = FormBody.Builder()
                .add("client_id",     clientId)
                .add("code",          code)
                .add("code_verifier", verifier)
                .add("grant_type",    "authorization_code")
                .add("redirect_uri",  "anitrack://mal-callback")
                .build()
            val resp = http.newCall(
                Request.Builder().url("https://myanimelist.net/v1/oauth2/token").post(body).build()
            ).execute()
            if (!resp.isSuccessful) return
            val json      = JSONObject(resp.body!!.string())
            val access    = json.getString("access_token")
            val refresh   = json.getString("refresh_token")
            val expiresIn = json.getInt("expires_in")
            // Fetch username
            val username = fetchUsername(access)
            saveTokens(access, refresh, expiresIn, username)
        } catch (_: Exception) {}
    }

    private suspend fun fetchUsername(accessToken: String): String? {
        return try {
            val resp = http.newCall(
                Request.Builder()
                    .url("https://api.myanimelist.net/v2/users/@me")
                    .header("Authorization", "Bearer $accessToken")
                    .build()
            ).execute()
            if (!resp.isSuccessful) return null
            JSONObject(resp.body!!.string()).optString("name")
        } catch (_: Exception) { null }
    }

    // ── getState / disconnect ─────────────────────────────────────────────────

    @PluginMethod
    fun getState(call: PluginCall) {
        val ret = JSObject(); ret.put("value", loadState().toString())
        call.resolve(ret)
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        prefs.edit().clear().apply()
        val ret = JSObject(); ret.put("value", loadState().toString())
        call.resolve(ret)
    }

    // ── pull (MAL → local DB) ─────────────────────────────────────────────────

    @PluginMethod
    fun pull(call: PluginCall) {
        scope.launch {
            try {
                val token = refreshIfNeeded() ?: run {
                    call.resolve(JSObject().apply { put("imported", 0) }); return@launch
                }
                var offset = 0; var imported = 0
                // Open the same SQLite file the DbPlugin uses. SQLite handles concurrent
                // connections from the same process safely for the simple writes we do here.
                val dbHelper = android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(
                    context.getDatabasePath("anitrack.db"), null
                )
                while (true) {
                    val url = "https://api.myanimelist.net/v2/users/@me/animelist" +
                        "?fields=list_status,num_episodes&limit=100&offset=$offset&nsfw=true"
                    val resp = http.newCall(
                        Request.Builder().url(url).header("Authorization", "Bearer $token").build()
                    ).execute()
                    if (!resp.isSuccessful) break
                    val json  = JSONObject(resp.body!!.string())
                    val items = json.optJSONArray("data") ?: break
                    for (i in 0 until items.length()) {
                        val item   = items.getJSONObject(i)
                        val node   = item.getJSONObject("node")
                        val status = item.getJSONObject("list_status")
                        val malId  = node.getInt("id")
                        val cv = android.content.ContentValues().apply {
                            // We store by malId as negative key when no AniList ID known
                            put("anime_id",  -malId)
                            put("status",    malStatusToLocal(status.getString("status")))
                            put("progress",  status.optInt("num_episodes_watched", 0))
                            put("score",     status.optInt("score", 0).let { if (it == 0) null else it.toDouble() })
                            put("mal_dirty", 0)
                            put("updated_at",System.currentTimeMillis())
                        }
                        dbHelper.insertWithOnConflict("list_entry", null, cv, android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE)
                        // Upsert anime title
                        val acv = android.content.ContentValues().apply {
                            put("id",     -malId)
                            put("title",  node.optString("title", ""))
                            put("mal_id", malId)
                            put("updated_at", System.currentTimeMillis())
                        }
                        dbHelper.insertWithOnConflict("anime", null, acv, android.database.sqlite.SQLiteDatabase.CONFLICT_IGNORE)
                        imported++
                    }
                    if (json.isNull("paging") || !json.getJSONObject("paging").has("next")) break
                    offset += 100
                }
                dbHelper.close()
                call.resolve(JSObject().apply { put("imported", imported) })
            } catch (e: Exception) {
                call.reject("pull failed: ${e.message}")
            }
        }
    }

    // ── push (dirty entries → MAL) ────────────────────────────────────────────

    @PluginMethod
    fun push(call: PluginCall) {
        scope.launch {
            try {
                val token = refreshIfNeeded() ?: run {
                    call.resolve(JSObject().apply { put("pushed", 0); put("errors", 0) }); return@launch
                }
                val dbFile = context.getDatabasePath("anitrack.db")
                val db     = android.database.sqlite.SQLiteDatabase.openDatabase(dbFile.path, null, android.database.sqlite.SQLiteDatabase.OPEN_READWRITE)
                val c      = db.rawQuery("SELECT le.anime_id, le.status, le.progress, le.score, a.mal_id FROM list_entry le LEFT JOIN anime a ON a.id = le.anime_id WHERE le.mal_dirty = 1", null)
                var pushed = 0; var errors = 0
                while (c.moveToNext()) {
                    val animeId = c.getInt(0)
                    val status  = c.getString(1)
                    val prog    = c.getInt(2)
                    val score   = if (c.isNull(3)) 0 else c.getDouble(3).toInt()
                    val malId   = if (c.isNull(4)) -animeId else c.getInt(4)
                    if (malId <= 0) continue
                    val body = FormBody.Builder()
                        .add("status",              localStatusToMal(status))
                        .add("num_watched_episodes", prog.toString())
                        .apply { if (score > 0) add("score", score.toString()) }
                        .build()
                    val resp = http.newCall(
                        Request.Builder()
                            .url("https://api.myanimelist.net/v2/anime/$malId/my_list_status")
                            .header("Authorization", "Bearer $token")
                            .patch(body)
                            .build()
                    ).execute()
                    if (resp.isSuccessful) {
                        db.execSQL("UPDATE list_entry SET mal_dirty=0 WHERE anime_id=?", arrayOf(animeId))
                        pushed++
                    } else errors++
                }
                c.close(); db.close()
                call.resolve(JSObject().apply { put("pushed", pushed); put("errors", errors) })
            } catch (e: Exception) {
                call.reject("push failed: ${e.message}")
            }
        }
    }

    // ── setClientId / clientInfo ──────────────────────────────────────────────

    @PluginMethod
    fun setClientId(call: PluginCall) {
        val id = call.getString("clientId") ?: return call.reject("clientId required")
        if (id.isEmpty()) {
            prefs.edit().remove("custom_client_id").apply()
            call.resolve(JSObject().apply { put("ok", true); put("usingCustom", false) })
        } else {
            prefs.edit().putString("custom_client_id", id).apply()
            call.resolve(JSObject().apply { put("ok", true); put("usingCustom", true) })
        }
    }

    @PluginMethod
    fun clientInfo(call: PluginCall) {
        val custom = prefs.getString("custom_client_id", null)
        call.resolve(JSObject().apply {
            put("usingCustom", custom != null)
            if (custom != null) put("clientId", custom)
        })
    }

    // ── token refresh ─────────────────────────────────────────────────────────

    private suspend fun refreshIfNeeded(): String? {
        val access    = accessToken()    ?: return null
        val expiresAt = prefs.getLong("expires_at", 0)
        if (System.currentTimeMillis() < expiresAt - 60_000) return access
        val refresh = refreshToken() ?: return null
        return try {
            val body = FormBody.Builder()
                .add("grant_type",    "refresh_token")
                .add("refresh_token", refresh)
                .add("client_id",     clientId())
                .build()
            val resp = http.newCall(
                Request.Builder().url("https://myanimelist.net/v1/oauth2/token").post(body).build()
            ).execute()
            if (!resp.isSuccessful) {
                if (resp.code in 400..401) prefs.edit().clear().apply()
                return null
            }
            val json = JSONObject(resp.body!!.string())
            val newAccess  = json.getString("access_token")
            val newRefresh = json.getString("refresh_token")
            val expiresIn  = json.getInt("expires_in")
            saveTokens(newAccess, newRefresh, expiresIn, null)
            newAccess
        } catch (_: Exception) { null }
    }

    // ── Status mapping ────────────────────────────────────────────────────────

    private fun malStatusToLocal(s: String) = when (s) {
        "watching"    -> "CURRENT"
        "completed"   -> "COMPLETED"
        "on_hold"     -> "PAUSED"
        "dropped"     -> "DROPPED"
        "plan_to_watch" -> "PLANNING"
        else          -> "CURRENT"
    }

    private fun localStatusToMal(s: String) = when (s) {
        "CURRENT"   -> "watching"
        "COMPLETED" -> "completed"
        "PAUSED"    -> "on_hold"
        "DROPPED"   -> "dropped"
        "PLANNING"  -> "plan_to_watch"
        else        -> "watching"
    }

    override fun handleOnDestroy() { scope.cancel() }
}
