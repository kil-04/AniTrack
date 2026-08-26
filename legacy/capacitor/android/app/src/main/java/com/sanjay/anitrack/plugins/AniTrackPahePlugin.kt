package com.sanjay.anitrack.plugins

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
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

    companion object {
        // Tracks the last kwik embed origin so CDN requests use the correct Referer.
        // kwik migrates domains frequently (kwik.si → kwik.cx → …); storing dynamically
        // avoids hardcoding a domain that goes stale.
        @Volatile var lastKwikOrigin: String = "https://kwik.cx"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var cfWebView: WebView? = null
    private var cfOverlay: android.view.View? = null
    @Volatile private var cfUserCancelled = false
    private var cfReady = false
    private var cfReadyJob: Deferred<Unit>? = null
    // Pending in-page fetches (play page), keyed by a request id the JS bridge echoes back.
    private val inPageResults = java.util.concurrent.ConcurrentHashMap<String, CompletableDeferred<String>>()

    private val prefs get() = context.getSharedPreferences("anitrack_settings", Context.MODE_PRIVATE)

    private fun baseUrl(): String = prefs.getString("pahe_base_url", "https://animepahe.pw") ?: "https://animepahe.pw"

    // Single shared client — building a new one per request is expensive (thread pool, connection pool, etc.)
    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .cookieJar(WebViewCookieJar())
            .followRedirects(true)
            .build()
    }

    // Separate client without WebView cookie jar for non-pahe calls (MALSync API, etc.)
    private val plainClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }

    // ── CF session WebView ────────────────────────────────────────────────────

    private fun hasValidCookies(): Boolean {
        val cookies = CookieManager.getInstance().getCookie(baseUrl()) ?: return false
        // Only POST-challenge cookies prove the challenge was actually solved.
        // __ddgid_ is set BEFORE solving — including it caused a false positive that
        // completed the poll at 0ms and tore down the solve overlay prematurely.
        return cookies.contains("cf_clearance") || cookies.contains("__ddg5_")
    }

    // The actual clearance cookie pair value — used to detect a FRESH solve (the value
    // changes) vs a stale-but-present clearance that Cloudflare rejects.
    private fun clearanceValue(): String? {
        val cookies = CookieManager.getInstance().getCookie(baseUrl()) ?: return null
        return cookies.split(";").map { it.trim() }
            .firstOrNull { it.startsWith("cf_clearance=") || it.startsWith("__ddg5_") }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun ensureCfWebView(forceSolve: Boolean = false, interactive: Boolean = true): Deferred<Unit> {
        // forceSolve (used on a 403 retry) bypasses the cookie short-circuit so a
        // stale/expired cf_clearance can't keep us from re-solving the challenge.
        if (!forceSolve && cfReady && cfWebView != null) return CompletableDeferred(Unit)
        if (!forceSolve && hasValidCookies()) {
            cfReady = true
            return CompletableDeferred(Unit)
        }
        // Once the user dismisses the challenge, stop showing it (until app restart).
        if (interactive && cfUserCancelled) return CompletableDeferred(Unit)
        val existing = cfReadyJob
        if (existing != null && existing.isActive) return existing

        val deferred = CompletableDeferred<Unit>()
        cfReadyJob = deferred

        // On a re-solve (after a 403), the stale cf_clearance is still in the jar and
        // hasValidCookies() would pass at 0ms — tearing down the overlay before the user
        // can solve. Remember it so the poll waits for a DIFFERENT (fresh) clearance.
        val priorClearance = if (forceSolve) clearanceValue() else null

        activity.runOnUiThread {
            cfOverlay?.let { (it.parent as? android.view.ViewGroup)?.removeView(it) }
            cfOverlay = null
            cfWebView?.let { old -> (old.parent as? android.view.ViewGroup)?.removeView(old); old.destroy() }
            val wv = WebView(activity)
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)
            wv.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                userAgentString = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
            }
            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    try {
                        val parsed = java.net.URL(url)
                        val redirectedBase = "${parsed.protocol}://${parsed.host}"
                        val currentBase = baseUrl()
                        if (parsed.host.contains("animepahe") && redirectedBase != currentBase) {
                            Log.d("AniTrack", "Pahe domain redirect detected: $redirectedBase (was: $currentBase)")
                            prefs.edit().putString("pahe_base_url", redirectedBase).apply()
                        }
                    } catch (e: Exception) {
                        Log.e("AniTrack", "Error parsing redirect URL: ${e.message}")
                    }
                }
                override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                    // Let the cookie poll / timeout resolve to avoid failing on temporary challenge resources
                }
            }
            wv.addJavascriptInterface(PaheBridge(), "AndroidPahe")
            val root = activity.findViewById<android.view.ViewGroup>(android.R.id.content)
            cfWebView = wv

            fun teardown(keepWv: Boolean) {
                // Detach the WebView first so removing the overlay container doesn't take it down.
                (wv.parent as? android.view.ViewGroup)?.removeView(wv)
                cfOverlay?.let { (it.parent as? android.view.ViewGroup)?.removeView(it) }
                cfOverlay = null
                // Always keep the WebView alive (1x1, invisible) so the /play/ page can be
                // fetched INSIDE it. It's replaced (old one destroyed) on the next solve, so
                // it never leaks — and in-page fetch never hits "WebView unavailable".
                wv.layoutParams = android.view.ViewGroup.LayoutParams(1, 1)
                root?.addView(wv)
            }

            if (interactive) {
                // Cloudflare now serves an interactive Turnstile a hidden WebView can't pass,
                // so show the challenge full-screen for a one-time manual solve.
                val container = android.widget.LinearLayout(activity)
                container.orientation = android.widget.LinearLayout.VERTICAL
                container.setBackgroundColor(0xFF141414.toInt())
                val bar = android.widget.LinearLayout(activity)
                bar.orientation = android.widget.LinearLayout.HORIZONTAL
                bar.gravity = android.view.Gravity.CENTER_VERTICAL
                bar.setPadding(32, 24, 32, 24)
                val hint = android.widget.TextView(activity)
                hint.text = "Verify you're human to load AnimePahe"
                hint.setTextColor(0xFFFFFFFF.toInt())
                hint.textSize = 14f
                hint.layoutParams = android.widget.LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                bar.addView(hint)
                val closeBtn = android.widget.Button(activity)
                closeBtn.text = "Close"
                closeBtn.setOnClickListener {
                    cfUserCancelled = true
                    teardown(false)
                    if (!deferred.isCompleted) { cfReady = true; deferred.complete(Unit) }
                }
                bar.addView(closeBtn)
                container.addView(bar, android.widget.LinearLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.WRAP_CONTENT))
                container.addView(wv, android.widget.LinearLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
                root?.addView(container, android.view.ViewGroup.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT))
                cfOverlay = container
            } else {
                // Silent off-screen attempt for background calls (Latest Episodes).
                wv.layoutParams = android.view.ViewGroup.LayoutParams(1, 1)
                try { root?.addView(wv) } catch (e: Exception) { Log.e("AniTrack", "attach CF wv failed: ${e.message}") }
            }

            wv.loadUrl(baseUrl() + "/")

            // Poll for the real clearance cookie (works for both the silent attempt and
            // the interactive overlay — completes as soon as the user passes the check).
            scope.launch {
                var waited = 0
                val cap = if (interactive) 120_000 else 20_000
                while (waited < cap && !deferred.isCompleted) {
                    // On a re-solve, require a NEW clearance value (the stale one is rejected);
                    // otherwise just require any valid clearance cookie.
                    val solved = if (forceSolve) {
                        val now = clearanceValue()
                        now != null && now != priorClearance
                    } else hasValidCookies()
                    if (solved) {
                        cfUserCancelled = false
                        Log.d("AniTrack", "CF clearance acquired after ${waited}ms (interactive=$interactive, force=$forceSolve)")
                        activity.runOnUiThread { teardown(true) }
                        cfReady = true
                        deferred.complete(Unit)
                        break
                    }
                    delay(700); waited += 700
                }
                if (!deferred.isCompleted) {
                    Log.w("AniTrack", "CF clearance not detected within ${cap}ms (interactive=$interactive)")
                    activity.runOnUiThread { teardown(false) }
                    cfReady = true
                    deferred.complete(Unit)
                }
            }
        }
        return deferred
    }

    private suspend fun waitForCf(forceSolve: Boolean = false, interactive: Boolean = true) = ensureCfWebView(forceSolve, interactive).await()

    // ── In-page fetch (CF-fingerprint-bound endpoints like /play/) ────────────
    // okhttp can't pass Cloudflare for the play-page document even with cf_clearance,
    // because the cookie is bound to the browser's TLS fingerprint. So we run fetch()
    // INSIDE the solved WebView (same origin, full browser fingerprint) and bridge the
    // result back via @JavascriptInterface. Mirrors the desktop paheInPageFetch.

    inner class PaheBridge {
        @android.webkit.JavascriptInterface
        fun onResult(id: String, ok: Boolean, data: String) {
            val d = inPageResults.remove(id) ?: return
            if (ok) d.complete(data) else d.completeExceptionally(IOException(data))
        }
    }

    private suspend fun paheInPageFetch(path: String): String {
        // Ensure a live WebView sitting on the AnimePahe origin with cf_clearance.
        // This runs for an explicit play, so re-prompt even if the user dismissed before.
        if (cfWebView == null) {
            cfUserCancelled = false
            ensureCfWebView(forceSolve = true, interactive = true).await()
        } else waitForCf()
        val wv = cfWebView ?: throw IOException("CF WebView unavailable")
        val url = if (path.startsWith("http")) path else baseUrl() + path
        val id  = java.util.UUID.randomUUID().toString()
        val def = CompletableDeferred<String>()
        inPageResults[id] = def
        val js = "fetch('$url',{credentials:'include'})" +
                 ".then(function(r){return r.text();})" +
                 ".then(function(t){AndroidPahe.onResult('$id',true,t);})" +
                 ".catch(function(e){AndroidPahe.onResult('$id',false,String(e));});"
        activity.runOnUiThread { wv.evaluateJavascript(js, null) }
        return try {
            withTimeout(25_000) { def.await() }
        } catch (e: Exception) {
            inPageResults.remove(id)
            throw IOException("in-page fetch failed: ${e.message}")
        }
    }

    // Navigate a WebView straight to the target page (e.g. /play/...). Cloudflare presents
    // its Turnstile ON that page — the homepage often isn't challenged, so no checkbox shows
    // there. The WebView starts hidden (1x1); if the page resolves to real content we read it
    // silently, but if it's the challenge we expand to a full-screen overlay so the user can
    // solve it. Mirrors the desktop paheNavFetchHtml.
    private suspend fun paheNavFetchHtml(path: String, marker: String): String =
        kotlinx.coroutines.suspendCancellableCoroutine { cont ->
            activity.runOnUiThread {
                val url = if (path.startsWith("http")) path else baseUrl() + path
                cfOverlay?.let { (it.parent as? android.view.ViewGroup)?.removeView(it) }; cfOverlay = null
                cfWebView?.let { (it.parent as? android.view.ViewGroup)?.removeView(it); it.destroy() }

                val wv = WebView(activity)
                CookieManager.getInstance().setAcceptCookie(true)
                CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)
                wv.settings.apply {
                    javaScriptEnabled = true; domStorageEnabled = true
                    userAgentString = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
                }
                cfWebView = wv
                val root = activity.findViewById<android.view.ViewGroup>(android.R.id.content)

                // Container holds the WebView; starts 1x1 (hidden) and expands on challenge.
                val container = android.widget.LinearLayout(activity)
                container.orientation = android.widget.LinearLayout.VERTICAL
                container.setBackgroundColor(0xFF000000.toInt())
                val bar = android.widget.LinearLayout(activity)
                bar.gravity = android.view.Gravity.CENTER_VERTICAL
                bar.setPadding(32, 24, 32, 24)
                val hint = android.widget.TextView(activity)
                hint.text = "Verify you're human to load this episode"
                hint.setTextColor(0xFFFFFFFF.toInt()); hint.textSize = 14f
                hint.layoutParams = android.widget.LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                bar.addView(hint)
                val closeBtn = android.widget.Button(activity); closeBtn.text = "Close"
                bar.addView(closeBtn)
                container.addView(bar, android.widget.LinearLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.WRAP_CONTENT))
                container.addView(wv, android.widget.LinearLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
                root?.addView(container, android.view.ViewGroup.LayoutParams(1, 1))
                cfOverlay = container

                var done = false
                fun finish(html: String?) {
                    if (done) return; done = true
                    (wv.parent as? android.view.ViewGroup)?.removeView(wv)
                    cfOverlay?.let { (it.parent as? android.view.ViewGroup)?.removeView(it) }; cfOverlay = null
                    wv.layoutParams = android.view.ViewGroup.LayoutParams(1, 1)
                    try { root?.addView(wv) } catch (e: Exception) {}
                    if (html != null) cont.resumeWith(Result.success(html))
                    else cont.resumeWith(Result.failure(IOException("nav fetch failed/timeout")))
                }
                fun expand() {
                    cfUserCancelled = false
                    container.layoutParams = android.view.ViewGroup.LayoutParams(
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT)
                    container.requestLayout()
                }
                closeBtn.setOnClickListener { cfUserCancelled = true; finish(null) }

                wv.webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, u: String) {
                        if (done) return
                        // Real page contains the kwik marker; challenge page does not.
                        view.evaluateJavascript(
                            "(function(){var h=document.documentElement.outerHTML;return h.indexOf('$marker')>-1?h:'__CHALLENGE__'})()"
                        ) { result ->
                            if (done || result == null) return@evaluateJavascript
                            if (result == "\"__CHALLENGE__\"" || result == "null") {
                                activity.runOnUiThread { expand() }   // needs a manual solve
                            } else {
                                try {
                                    val html = org.json.JSONObject("{\"h\":$result}").getString("h")
                                    if (html.contains(marker)) finish(html) else activity.runOnUiThread { expand() }
                                } catch (e: Exception) { activity.runOnUiThread { expand() } }
                            }
                        }
                    }
                }
                wv.loadUrl(url)
                scope.launch { delay(120_000); activity.runOnUiThread { finish(null) } }
            }
        }

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

    private suspend fun paheGet(path: String, retried: Boolean = false, interactive: Boolean = true): JSONObject {
        waitForCf(forceSolve = retried, interactive = interactive)
        val url = if (path.startsWith("http")) path else baseUrl() + path
        val req = Request.Builder().url(url)
            .header("Accept", "application/json, text/plain, */*")
            .header("X-Requested-With", "XMLHttpRequest")
            .header("Referer", baseUrl() + "/")
            .header("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36")
            .build()
        val resp = withContext(Dispatchers.IO) { client.newCall(req).execute() }
        if (!resp.isSuccessful) {
            if (!retried && resp.code in listOf(403, 503, 429)) {
                // CF cookie expired — re-init the WebView and retry once
                cfReady = false
                cfReadyJob = null
                activity.runOnUiThread { cfWebView?.destroy(); cfWebView = null }
                return paheGet(path, true, interactive)
            }
            throw IOException("HTTP ${resp.code}: ${resp.body?.string()?.take(120)}")
        }
        return JSONObject(resp.body!!.string())
    }

    private suspend fun paheGetHtml(path: String, interactive: Boolean = true): String {
        // The /play/ document is Cloudflare-protected and okhttp can't pass it (403/429).
        // Navigate a WebView straight to it so CF shows its Turnstile on THIS page (the
        // homepage often isn't challenged) — the user solves it, then we read the page.
        try {
            return paheNavFetchHtml(path, "kwik")
        } catch (e: Exception) {
            Log.w("AniTrack", "nav play fetch failed (${e.message}); trying okhttp")
        }
        // Last resort: plain okhttp (usually 403, but try anyway).
        waitForCf(interactive = interactive)
        val url = if (path.startsWith("http")) path else baseUrl() + path
        val req = Request.Builder().url(url)
            .header("Referer", baseUrl() + "/")
            .header("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36")
            .build()
        val resp = withContext(Dispatchers.IO) { client.newCall(req).execute() }
        if (!resp.isSuccessful) { val c = resp.code; resp.close(); throw IOException("HTTP ${resp.code}") }
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
                val data = paheGet("/api?m=airing&l=30&sort=session_id_desc&page=$page", interactive = true)
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
        // Store kwik origin so fetchUrl uses the right Referer for CDN requests
        try {
            val parsed = java.net.URL(kwikUrl)
            lastKwikOrigin = "${parsed.protocol}://${parsed.host}"
            Log.d("AniTrack", "resolveKwik: kwikOrigin=$lastKwikOrigin")
        } catch (_: Exception) {}

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
                    // Inject a click to ensure the video loads/triggers the m3u8 request
                    view.evaluateJavascript("""
                        (function() {
                            const btn = document.querySelector('button') || document.querySelector('.video-js');
                            if (btn) btn.click();
                        })();
                    """.trimIndent(), null)
                }
                override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                    if (!deferred.isCompleted) deferred.completeExceptionally(IOException("WebView error: ${err.description}"))
                    activity.runOnUiThread { wv.destroy() }
                }
            }
            val headers = mutableMapOf<String, String>()
            headers["Referer"] = baseUrl() + "/"
            wv.loadUrl(kwikUrl, headers)

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
                val resp = plainClient.newCall(
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
                // Try to resolve animepahe show details via AniList/MAL mappings (simplified stub)
                val ret = JSObject(); ret.put("value", JSObject.NULL)
                call.resolve(ret)
            } catch (e: Exception) {
                val ret = JSObject(); ret.put("value", JSObject.NULL)
                call.resolve(ret)
            }
        }
    }

    // ── fetchUrl ──────────────────────────────────────────────────────────────

    @PluginMethod
    fun fetchUrl(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url required")
        val binary = call.getBoolean("binary") ?: false
        scope.launch {
            try {
                val urlLower = url.lowercase()
                val isMegaplayStream = urlLower.contains("/anime/") || 
                                       urlLower.contains(".vtt") || 
                                       urlLower.contains("subtitles") || 
                                       urlLower.contains("/public/stream/") || 
                                       urlLower.contains("vibeplayer") || 
                                       urlLower.contains("mewcdn") ||
                                       urlLower.contains("mewstream") ||
                                       urlLower.contains("megaplay") ||
                                       urlLower.contains("vibe") ||
                                       urlLower.contains("lostproject") ||
                                       urlLower.contains("streamzone")

                val defaultReferer = if (urlLower.contains("animepahe")) {
                    "https://animepahe.pw/"
                } else if (isMegaplayStream) {
                    val isMew = urlLower.contains("mewcdn") || 
                                urlLower.contains("vibeplayer") || 
                                urlLower.contains("vibe")
                    if (isMew) "https://mewcdn.online/" else "https://megaplay.buzz/"
                } else {
                    "$lastKwikOrigin/"
                }

                // Separate the caller's Referer from other custom headers so we can vary it.
                var customRef: String? = null
                val extraHeaders = mutableMapOf<String, String>()
                val customHeaders = call.getObject("headers")
                if (customHeaders != null) {
                    val keys = customHeaders.keys()
                    while (keys.hasNext()) {
                        val key = keys.next()
                        val value = customHeaders.getString(key) ?: continue
                        when {
                            key.equals("referer", ignoreCase = true) -> customRef = value
                            key.equals("origin", ignoreCase = true) -> {}
                            else -> extraHeaders[key] = value
                        }
                    }
                }

                // The segment CDNs rotate (nekostream / mewstream / mewcdn / megaplay …) and
                // each hotlink-checks Referer differently, so a single Referer 403s on some.
                // Try the caller's player origin first, then CDN-specific fallbacks.
                val candidates = LinkedHashSet<String>()
                if (customRef != null) candidates.add(customRef!!)
                candidates.add(defaultReferer)
                if (isMegaplayStream) {
                    try {
                        val host = java.net.URI(url).host
                        if (host != null) {
                            candidates.add("https://$host/")
                            val parts = host.split(".")
                            if (parts.size >= 2) candidates.add("https://${parts.takeLast(2).joinToString(".")}/")
                        }
                    } catch (e: Exception) {}
                    candidates.add("https://mewcdn.online/")
                    candidates.add("https://megaplay.buzz/")
                }

                var status = 0
                var bodyBytes = ByteArray(0)
                for (ref in candidates) {
                    val rb = Request.Builder().url(url)
                        .header("Referer",    ref)
                        .header("Origin",     ref.trimEnd('/'))
                        .header("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36")
                    for ((k, v) in extraHeaders) rb.header(k, v)
                    val resp = client.newCall(rb.build()).execute()
                    status = resp.code
                    bodyBytes = resp.body?.bytes() ?: ByteArray(0)
                    resp.close()
                    if (status != 403 && status != 503) break
                    Log.w("AniTrack", "fetchUrl $status with Referer '$ref' — trying next")
                }

                val ret = JSObject()
                ret.put("status", status)
                ret.put("binary", binary)
                ret.put("data", if (binary)
                    android.util.Base64.encodeToString(bodyBytes, android.util.Base64.NO_WRAP)
                else
                    String(bodyBytes, Charsets.UTF_8))
                call.resolve(ret)
            } catch (e: Exception) {
                Log.e("AniTrack", "fetchUrl FAILED: ${e.message}")
                call.reject("fetchUrl failed: ${e.message}")
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
