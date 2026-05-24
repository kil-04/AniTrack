package com.sanjay.anitrack.plugins

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
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
 * OAuth flow mirrors the desktop Electron app:
 *   1. Show a full-screen in-app WebView dialog loading the MAL auth URL.
 *   2. User logs in at myanimelist.net (including Google sign-in).
 *   3. MAL redirects to https://malsync.moe/mal/oauth?code=XXX.
 *   4. shouldOverrideUrlLoading intercepts that redirect, extracts code, closes dialog.
 *   5. Exchange code for tokens via OkHttp.
 *
 * Uses the same client ID and redirect URI as the desktop app.
 */

@CapacitorPlugin(name = "AniTrackMal")
class AniTrackMalPlugin : Plugin() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val prefs get() = context.getSharedPreferences("anitrack_mal", Context.MODE_PRIVATE)
    // Single shared client with sensible timeouts — building per call is expensive.
    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
            .build()
    }

    // Same as the Electron desktop app — registered with https://malsync.moe/mal/oauth
    private val DEFAULT_CLIENT_ID = "10093a3f9f0174b6b5577c40e9accdae"
    private val REDIRECT_URI      = "https://malsync.moe/mal/oauth"

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
        val verifier = generateVerifier()
        prefs.edit()
            .putString("pkce_verifier",     verifier)
            .putString("pending_client_id", clientId)
            .apply()

        val authUrl = "https://myanimelist.net/v1/oauth2/authorize" +
            "?response_type=code" +
            "&client_id=$clientId" +
            "&code_challenge=$verifier" +
            "&code_challenge_method=plain" +
            "&redirect_uri=${Uri.encode(REDIRECT_URI)}"

        activity.runOnUiThread { showAuthDialog(authUrl) }

        val ret = JSObject(); ret.put("ok", true)
        call.resolve(ret)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showAuthDialog(authUrl: String) {
        val dialog = android.app.Dialog(
            activity,
            android.R.style.Theme_Black_NoTitleBar_Fullscreen
        )

        val layout = android.widget.LinearLayout(activity).apply {
            orientation = android.widget.LinearLayout.VERTICAL
        }

        // Minimal toolbar: "× MyAnimeList Login"
        val toolbar = android.widget.LinearLayout(activity).apply {
            orientation  = android.widget.LinearLayout.HORIZONTAL
            setBackgroundColor(android.graphics.Color.parseColor("#1a1a2e"))
            setPadding(32, 24, 32, 24)
        }
        val titleView = android.widget.TextView(activity).apply {
            text      = "MyAnimeList Login"
            textSize  = 16f
            setTextColor(android.graphics.Color.WHITE)
            layoutParams = android.widget.LinearLayout.LayoutParams(0,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val closeBtn = android.widget.TextView(activity).apply {
            text     = "✕"
            textSize = 18f
            setTextColor(android.graphics.Color.WHITE)
            setOnClickListener { dialog.dismiss() }
        }
        toolbar.addView(titleView)
        toolbar.addView(closeBtn)

        val webView = WebView(activity).apply {
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // Spoof a real Chrome desktop user-agent so MAL doesn't block the WebView
            settings.userAgentString = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            webViewClient = object : WebViewClient() {
                // Catches user-initiated navigations (clicks, JS redirects, custom schemes).
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url.toString()
                    android.util.Log.d("AniTrackMAL", "shouldOverride: $url")
                    if (handleOAuthRedirect(url, dialog)) return true
                    return false
                }

                // Catches server-side HTTP redirects: fires when any page starts loading.
                // We just log here — don't stop loading so the MAL login page can render normally.
                override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                    android.util.Log.d("AniTrackMAL", "onPageStarted: $url")
                    super.onPageStarted(view, url, favicon)
                }

                // Fires after a page fully loads. If we've landed on malsync.moe/anitrack:// with a code,
                // extract it now. The page may already have rendered briefly, but we close the dialog immediately.
                override fun onPageFinished(view: WebView, url: String) {
                    android.util.Log.d("AniTrackMAL", "onPageFinished: $url")
                    handleOAuthRedirect(url, dialog)
                    super.onPageFinished(view, url)
                }
            }
        }

        layout.addView(toolbar)
        layout.addView(webView)
        dialog.setContentView(layout)
        dialog.show()
        webView.loadUrl(authUrl)
    }

    /** Returns true and starts the exchange if [url] is our OAuth redirect, false otherwise. */
    private fun handleOAuthRedirect(url: String, dialog: android.app.Dialog): Boolean {
        val isMalsync  = url.startsWith("https://malsync.moe/mal/oauth")
        val isAnitrack = url.startsWith("anitrack://mal-callback")
        if (!isMalsync && !isAnitrack) return false

        val uri  = Uri.parse(url)
        val code = uri.getQueryParameter("code") ?: run {
            android.util.Log.w("AniTrackMAL", "OAuth redirect hit but no code: $url")
            return true // still intercept to prevent malsync page from loading
        }
        android.util.Log.d("AniTrackMAL", "OAuth code captured, length=${code.length}")
        if (dialog.isShowing) dialog.dismiss()
        val verifier = prefs.getString("pkce_verifier",     null) ?: return true
        val clientId = prefs.getString("pending_client_id", null) ?: clientId()
        scope.launch { exchangeCode(code, verifier, clientId) }
        return true
    }

    /** Still called from MainActivity for the legacy anitrack:// deep-link path (custom clients). */
    fun handleCallback(code: String) {
        val verifier = prefs.getString("pkce_verifier",     null) ?: return
        val clientId = prefs.getString("pending_client_id", null) ?: clientId()
        scope.launch { exchangeCode(code, verifier, clientId) }
    }

    private suspend fun exchangeCode(code: String, verifier: String, clientId: String) {
        try {
            android.util.Log.d("AniTrackMAL", "exchangeCode: clientId=$clientId redirectUri=$REDIRECT_URI verifierLen=${verifier.length} codeLen=${code.length}")
            val body = FormBody.Builder()
                .add("client_id",     clientId)
                .add("code",          code)
                .add("code_verifier", verifier)
                .add("grant_type",    "authorization_code")
                .add("redirect_uri",  REDIRECT_URI)
                .build()
            val resp = http.newCall(
                Request.Builder().url("https://myanimelist.net/v1/oauth2/token").post(body).build()
            ).execute()
            val respBody = resp.body?.string() ?: ""
            android.util.Log.d("AniTrackMAL", "exchangeCode response: code=${resp.code} body=$respBody")
            if (!resp.isSuccessful) return
            val json      = JSONObject(respBody)
            val access    = json.getString("access_token")
            val refresh   = json.getString("refresh_token")
            val expiresIn = json.getInt("expires_in")
            val username  = fetchUsername(access)
            saveTokens(access, refresh, expiresIn, username)
            // Notify JS that auth is complete so the Settings page refreshes immediately.
            val event = JSObject(); event.put("state", loadState().toString())
            notifyListeners("mal:auth-complete", event)
        } catch (e: Exception) {
            android.util.Log.e("AniTrackMAL", "exchangeCode FAILED: ${e.message}", e)
            val event = JSObject(); event.put("error", e.message ?: "unknown")
            notifyListeners("mal:auth-error", event)
        }
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
            var dbHelper: android.database.sqlite.SQLiteDatabase? = null
            try {
                val token = refreshIfNeeded() ?: run {
                    call.resolve(JSObject().apply { put("imported", 0) }); return@launch
                }
                var offset = 0; var imported = 0
                // Open the same SQLite file the DbPlugin uses. SQLite handles concurrent
                // connections from the same process safely for the simple writes we do here.
                dbHelper = android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(
                    context.getDatabasePath("anitrack.db"), null
                )
                val db = dbHelper
                // Wrap all inserts in a single transaction — ~10× faster than autocommit per row.
                db.beginTransaction()
                while (true) {
                    val url = "https://api.myanimelist.net/v2/users/@me/animelist" +
                        "?fields=list_status{status,score,num_episodes_watched,updated_at},num_episodes,main_picture&limit=100&offset=$offset&nsfw=true"
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
                        // Use MAL's own updated_at so Library sorts by most-recently-updated entry.
                        val malUpdatedAt = status.optString("updated_at", "")
                        val entryTs = if (malUpdatedAt.isNotEmpty()) {
                            try { java.time.Instant.parse(malUpdatedAt).toEpochMilli() }
                            catch (_: Exception) { System.currentTimeMillis() }
                        } else System.currentTimeMillis()

                        val cv = android.content.ContentValues().apply {
                            put("anime_id",  -malId)
                            put("status",    malStatusToLocal(status.getString("status")))
                            put("progress",  status.optInt("num_episodes_watched", 0))
                            put("score",     status.optInt("score", 0).let { if (it == 0) null else it.toDouble() })
                            put("mal_dirty", 0)
                            put("updated_at", entryTs)
                        }
                        db.insertWithOnConflict("list_entry", null, cv, android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE)
                        // Upsert anime — REPLACE so cover_image is always updated on re-pull.
                        val pic = node.optJSONObject("main_picture")
                        val coverUrl = pic?.optString("large") ?: pic?.optString("medium")
                        val acv = android.content.ContentValues().apply {
                            put("id",          -malId)
                            put("title",       node.optString("title", ""))
                            put("mal_id",      malId)
                            if (coverUrl != null) put("cover_image", coverUrl)
                            put("updated_at",  entryTs)
                        }
                        db.insertWithOnConflict("anime", null, acv, android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE)
                        imported++
                    }
                    if (json.isNull("paging") || !json.getJSONObject("paging").has("next")) break
                    offset += 100
                }
                db.setTransactionSuccessful()
                call.resolve(JSObject().apply { put("imported", imported) })
            } catch (e: Exception) {
                call.reject("pull failed: ${e.message}")
            } finally {
                try { dbHelper?.let { if (it.inTransaction()) it.endTransaction() } } catch (_: Exception) {}
                try { dbHelper?.close() } catch (_: Exception) {}
            }
        }
    }

    // ── push (dirty entries → MAL) ────────────────────────────────────────────

    @PluginMethod
    fun push(call: PluginCall) {
        scope.launch {
            var db: android.database.sqlite.SQLiteDatabase? = null
            var c: android.database.Cursor? = null
            try {
                val token = refreshIfNeeded() ?: run {
                    call.resolve(JSObject().apply { put("pushed", 0); put("errors", 0) }); return@launch
                }
                val dbFile = context.getDatabasePath("anitrack.db")
                db = android.database.sqlite.SQLiteDatabase.openDatabase(dbFile.path, null, android.database.sqlite.SQLiteDatabase.OPEN_READWRITE)
                c  = db.rawQuery("SELECT le.anime_id, le.status, le.progress, le.score, a.mal_id FROM list_entry le LEFT JOIN anime a ON a.id = le.anime_id WHERE le.mal_dirty = 1", null)
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
                call.resolve(JSObject().apply { put("pushed", pushed); put("errors", errors) })
            } catch (e: Exception) {
                call.reject("push failed: ${e.message}")
            } finally {
                try { c?.close() } catch (_: Exception) {}
                try { db?.close() } catch (_: Exception) {}
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
        "watching"      -> "watching"
        "completed"     -> "completed"
        "on_hold"       -> "on_hold"
        "dropped"       -> "dropped"
        "plan_to_watch" -> "plan_to_watch"
        else            -> "watching"
    }

    private fun localStatusToMal(s: String) = when (s) {
        "watching"      -> "watching"
        "completed"     -> "completed"
        "on_hold"       -> "on_hold"
        "dropped"       -> "dropped"
        "plan_to_watch" -> "plan_to_watch"
        else            -> "watching"
    }

    override fun handleOnDestroy() { scope.cancel() }
}
