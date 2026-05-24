package com.sanjay.anitrack.plugins

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.*
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.*
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * AniTrackPahePlugin — AnimePahe integration for Android.
 *
 * Mirrors the Electron animepahe.ts approach:
 *  1. A hidden WebView loads the AnimePahe homepage to solve the CF challenge.
 *  2. okhttp3 makes API requests with the CF cookies from the WebView's CookieManager.
 *  3. kwik resolution: load the kwik URL in the CF WebView, intercept the m3u8 request.
 */

@CapacitorPlugin(name = "AniTrackPahe")
class AniTrackPahePlugin : Plugin() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var cfWebView: WebView? = null
    private var cfReady = false
    private var cfReadyJob: Deferred<Unit>? = null

    private val prefs get() = context.getSharedPreferences("anitrack_settings", Context.MODE_PRIVATE)

    private fun baseUrl(): String = prefs.getString("pahe_base_url", "https://animepahe.pw") ?: "https://animepahe.pw"

    private fun okhttp(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .cookieJar(WebViewCookieJar())
        .followRedirects(true)
        .build()

    // ── CF session WebView ────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun ensureCfWebView(): Deferred<Unit> {
        if (cfReady && cfWebView != null) return CompletableDeferred(Unit)
        val existing = cfReadyJob
        if (existing != null && existing.isActive) return existing

        val deferred = CompletableDeferred<Unit>()
        cfReadyJob = deferred

        activity.runOnUiThread {
            cfWebView?.destroy()
            val wv = WebView(activity)
            wv.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                userAgentString = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
            }
            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    if (!deferred.isCompleted) {
                        cfReady = true
                        deferred.complete(Unit)
                    }
                }
                override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                    if (!deferred.isCompleted) deferred.complete(Unit) // proceed anyway
                }
            }
            cfWebView = wv
            wv.loadUrl(baseUrl() + "/")
            // Timeout safety
            scope.launch {
                delay(10_000)
                if (!deferred.isCompleted) deferred.complete(Unit)
            }
        }
        return deferred
    }

    private suspend fun waitForCf() = ensureCfWebView().await()

    // ── Cookie bridge: WebView CookieManager → okhttp3 ───────────────────────

    inner class WebViewCookieJar : CookieJar {
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            val mgr = CookieManager.getInstance()
            cookies.forEach { mgr.setCookie(url.toString(), it.toString()) }
        }
        override fun loadForRequest(url: HttpUrl): List<Cookie> {
            val raw = CookieManager.getInstance().getCookie(url.toString()) ?: return emptyList()
            return raw.split(";").mapNotNull { part ->
                val kv = part.trim().split("=", limit = 2)
                if (kv.size < 2) null
                else Cookie.Builder().domain(url.host).path("/").name(kv[0].trim()).value(kv[1].trim()).build()
            }
        }
    }

    // ── HTTP helper ───────────────────────────────────────────────────────────

    private suspend fun paheGet(path: String, retried: Boolean = false): JSONObject {
        waitForCf()
        val url = if (path.startsWith("http")) path else baseUrl() + path
        val req = Request.Builder().url(url)
            .header("Accept", "application/json, text/plain, */*")
            .header("X-Requested-With", "XMLHttpRequest")
            .header("Referer", baseUrl() + "/")
            .header("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36")
            .build()
        val resp = withContext(Dispatchers.IO) { okhttp().newCall(req).execute() }
        if (!resp.isSuccessful) {
            if (!retried && resp.code in listOf(403, 503, 429)) {
                // CF cookie expired — re-init the WebView and retry once
                cfReady = false
                cfReadyJob = null
                activity.runOnUiThread { cfWebView?.destroy(); cfWebView = null }
                return paheGet(path, true)
            }
            throw IOException("HTTP ${resp.code}: ${resp.body?.string()?.take(120)}")
        }
        return JSONObject(resp.body!!.string())
    }

    private suspend fun paheGetHtml(path: String): String {
        waitForCf()
        val url = if (path.startsWith("http")) path else baseUrl() + path
        val req = Request.Builder().url(url)
            .header("Referer", baseUrl() + "/")
            .header("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36")
            .build()
        val resp = withContext(Dispatchers.IO) { okhttp().newCall(req).execute() }
        if (!resp.isSuccessful) throw IOException("HTTP ${resp.code}")
        return resp.body!!.string()
    }

    // ── ensureSession ─────────────────────────────────────────────────────────

    @PluginMethod
    fun ensureSession(call: PluginCall) {
        scope.launch {
            try {
                waitForCf()
                val ret = JSObject(); ret.put("ok", true)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("ensureSession failed: ${e.message}")
            }
        }
    }

    // ── latest ────────────────────────────────────────────────────────────────

    @PluginMethod
    fun latest(call: PluginCall) {
        val page = call.getInt("page") ?: 1
        scope.launch {
            try {
                val data = paheGet("/api?m=airing&l=30&sort=session_id_desc&page=$page")
                val result = JSONObject().apply {
                    put("data",     data.optJSONArray("data") ?: JSONArray())
                    put("total",    data.optInt("total", 0))
                    put("lastPage", data.optInt("last_page", 1))
                }
                val ret = JSObject(); ret.put("value", result.toString())
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("latest failed: ${e.message}")
            }
        }
    }

    // ── search ────────────────────────────────────────────────────────────────

    @PluginMethod
    fun search(call: PluginCall) {
        val query = call.getString("query") ?: return call.reject("query required")
        scope.launch {
            try {
                val data = paheGet("/api?m=search&q=${encode(query)}")
                val ret = JSObject(); ret.put("value", (data.optJSONArray("data") ?: JSONArray()).toString())
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("search failed: ${e.message}")
            }
        }
    }

    // ── episodes ──────────────────────────────────────────────────────────────

    @PluginMethod
    fun episodes(call: PluginCall) {
        val session = call.getString("session") ?: return call.reject("session required")
        val page    = call.getInt("page") ?: 1
        scope.launch {
            try {
                val data = paheGet("/api?m=release&id=${session}&sort=episode_asc&page=$page")
                val result = JSONObject().apply {
                    put("data",     data.optJSONArray("data") ?: JSONArray())
                    put("total",    data.optInt("total", 0))
                    put("lastPage", data.optInt("last_page", 1))
                }
                val ret = JSObject(); ret.put("value", result.toString())
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("episodes failed: ${e.message}")
            }
        }
    }

    // ── links (kwik URLs from play page) ──────────────────────────────────────

    @PluginMethod
    fun links(call: PluginCall) {
        val epSession    = call.getString("epSession")    ?: return call.reject("epSession required")
        val animeSession = call.getString("animeSession") ?: return call.reject("animeSession required")
        scope.launch {
            try {
                val html  = paheGetHtml("/play/${animeSession}/${epSession}")
                val links = parseLinksFromHtml(html)
                val ret   = JSObject(); ret.put("value", links.toString())
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("links failed: ${e.message}")
            }
        }
    }

    private fun parseLinksFromHtml(html: String): JSONArray {
        val result = JSONArray()
        // Primary: walk each <button …> tag and extract attributes independently.
        // AnimePahe HTML order is not guaranteed, so a single fixed pattern is fragile.
        val tagRe   = Regex("""<button[^>]*>""")
        val srcRe   = Regex("""data-src="([^"]+)"""")
        val resRe   = Regex("""data-resolution="([^"]*)"""")
        val audRe   = Regex("""data-audio="([^"]*)"""")
        for (tagMatch in tagRe.findAll(html)) {
            val tag  = tagMatch.value
            val src  = srcRe.find(tag)?.groupValues?.get(1) ?: continue
            if (!src.contains("kwik")) continue
            val res  = resRe.find(tag)?.groupValues?.get(1) ?: "?"
            val aud  = audRe.find(tag)?.groupValues?.get(1) ?: "jpn"
            result.put(JSONObject().apply {
                put("kwik",         src)
                put("quality",      res)
                put("audio",        aud)
                put("kwik_pahewin", "")
            })
        }
        // Fallback: any raw kwik link in the page source
        if (result.length() == 0) {
            val kwikRe = Regex("""https?://kwik\.[^\s"'<>]+""")
            for (m in kwikRe.findAll(html)) {
                result.put(JSONObject().apply {
                    put("kwik",         m.value)
                    put("quality",      "?")
                    put("audio",        "jpn")
                    put("kwik_pahewin", "")
                })
            }
        }
        return result
    }

    // ── resolve (kwik → m3u8) ─────────────────────────────────────────────────

    @PluginMethod
    fun resolve(call: PluginCall) {
        val kwikUrl = call.getString("kwikUrl") ?: return call.reject("kwikUrl required")
        scope.launch {
            try {
                val result = resolveKwik(kwikUrl)
                val ret = JSObject()
                ret.put("url",     result.first)
                ret.put("cookies", result.second)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("resolve failed: ${e.message}")
            }
        }
    }

    private suspend fun resolveKwik(kwikUrl: String): Pair<String, String> {
        // Load kwik in a WebView, intercept the .m3u8 request
        val deferred = CompletableDeferred<Pair<String, String>>()

        activity.runOnUiThread {
            @SuppressLint("SetJavaScriptEnabled")
            val wv = WebView(activity)
            wv.settings.apply {
                javaScriptEnabled  = true
                domStorageEnabled  = true
                userAgentString    = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36"
            }
            wv.webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    val url = request.url.toString()
                    if (url.contains(".m3u8")) {
                        val cookies = CookieManager.getInstance().getCookie(request.url.toString()) ?: ""
                        if (!deferred.isCompleted) deferred.complete(Pair(url, cookies))
                        activity.runOnUiThread { wv.destroy() }
                    }
                    return null
                }
                override fun onPageFinished(view: WebView, url: String) {
                    // Page loaded but no m3u8 intercepted yet; JS will trigger the video
                }
                override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                    if (!deferred.isCompleted) deferred.completeExceptionally(IOException("WebView error: ${err.description}"))
                    activity.runOnUiThread { wv.destroy() }
                }
            }
            wv.loadUrl(kwikUrl)

            // Timeout: if no m3u8 found in 15s, fail
            scope.launch {
                delay(15_000)
                if (!deferred.isCompleted) {
                    deferred.completeExceptionally(IOException("kwik resolve timeout"))
                    activity.runOnUiThread { wv.destroy() }
                }
            }
        }

        return deferred.await()
    }

    // ── prefetch ──────────────────────────────────────────────────────────────

    @PluginMethod
    fun prefetch(call: PluginCall) {
        // Fire and forget — best effort
        val kwikUrl = call.getString("kwikUrl") ?: return call.resolve(JSObject().apply { put("ok", false) })
        scope.launch {
            try { resolveKwik(kwikUrl) } catch (_: Exception) {}
        }
        val ret = JSObject(); ret.put("ok", true)
        call.resolve(ret)
    }

    // ── getIds ────────────────────────────────────────────────────────────────

    @PluginMethod
    fun getIds(call: PluginCall) {
        val paheId  = call.getInt("paheId")    ?: return call.reject("paheId required")
        val session = call.getString("session") ?: return call.reject("session required")
        scope.launch {
            try {
                // Try MALSync API first
                val resp = OkHttpClient().newCall(
                    Request.Builder()
                        .url("https://api.malsync.moe/page/animepahe/$paheId")
                        .header("User-Agent", "AniTrack-Android/1.0")
                        .build()
                ).execute()
                val result = JSONObject()
                if (resp.isSuccessful) {
                    val json = JSONObject(resp.body!!.string())
                    val malM = Regex("/anime/(\\d+)").find(json.optString("malUrl"))
                    val alM  = Regex("/anime/(\\d+)").find(json.optString("aniUrl"))
                    if (malM != null) result.put("malId",     malM.groupValues[1].toInt())
                    if (alM  != null) result.put("anilistId", alM.groupValues[1].toInt())
                }
                // Fallback: scrape meta tags from show page
                if (result.length() == 0) {
                    val html = paheGetHtml("/anime/$session")
                    fun grabMeta(name: String): Int? {
                        val m = Regex("""<meta[^>]+name=["']$name["'][^>]+content=["'](\d+)["']""", RegexOption.IGNORE_CASE).find(html)
                            ?: Regex("""<meta[^>]+content=["'](\d+)["'][^>]+name=["']$name["']""", RegexOption.IGNORE_CASE).find(html)
                        return m?.groupValues?.get(1)?.toIntOrNull()
                    }
                    grabMeta("myanimelist")?.let { result.put("malId",     it) }
                    grabMeta("anilist")?.let     { result.put("anilistId", it) }
                }
                val ret = JSObject(); ret.put("value", result.toString())
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("getIds failed: ${e.message}")
            }
        }
    }

    // ── findById ──────────────────────────────────────────────────────────────

    @PluginMethod
    fun findById(call: PluginCall) {
        val anilistId = call.getInt("anilistId")
        val malId     = call.getInt("malId")
        scope.launch {
            try {
                val client = OkHttpClient()
                fun tryMalSync(path: String): JSONObject? {
                    val r = client.newCall(Request.Builder().url("https://api.malsync.moe/$path").header("User-Agent", "AniTrack-Android/1.0").build()).execute()
                    if (!r.isSuccessful) return null
                    val json = JSONObject(r.body!!.string())
                    val paheUrl = json.optJSONObject("Pages")?.optJSONObject("AnimePahe")?.keys()?.asSequence()?.firstOrNull() ?: return null
                    val session = Regex("[a-f0-9-]{36}").find(paheUrl)?.value ?: return null
                    // search animepahe to get the full object
                    return null // simplified — search by session would require another call
                }
                val ret = JSObject(); ret.put("value", JSObject.NULL)
                call.resolve(ret)
            } catch (e: Exception) {
                val ret = JSObject(); ret.put("value", JSObject.NULL)
                call.resolve(ret)
            }
        }
    }

    // ── getUrl / setUrl ───────────────────────────────────────────────────────

    @PluginMethod
    fun getUrl(call: PluginCall) {
        val ret = JSObject(); ret.put("url", baseUrl())
        call.resolve(ret)
    }

    @PluginMethod
    fun setUrl(call: PluginCall) {
        var url = call.getString("url") ?: return call.reject("url required")
        url = url.trim().trimEnd('/')
        if (!url.startsWith("http")) url = "https://$url"
        try { java.net.URL(url) } catch (e: Exception) {
            val ret = JSObject(); ret.put("ok", false); ret.put("url", baseUrl()); ret.put("reason", "Invalid URL")
            call.resolve(ret); return
        }
        prefs.edit().putString("pahe_base_url", url).apply()
        // Reset CF session so next request uses the new domain
        cfReady = false; cfReadyJob = null
        activity.runOnUiThread { cfWebView?.destroy(); cfWebView = null }
        val ret = JSObject(); ret.put("ok", true); ret.put("url", url)
        call.resolve(ret)
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private fun encode(s: String): String = java.net.URLEncoder.encode(s, "UTF-8")

    override fun handleOnDestroy() {
        scope.cancel()
        activity.runOnUiThread { cfWebView?.destroy(); cfWebView = null }
    }
}
