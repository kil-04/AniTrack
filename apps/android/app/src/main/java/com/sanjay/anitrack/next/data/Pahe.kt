package com.sanjay.anitrack.next.data

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * AnimePahe provider — port of the proven AniTrackPahePlugin machinery:
 *  1. A WebView solves the Cloudflare challenge (interactively when Turnstile
 *     demands it); cookies live in CookieManager.
 *  2. okhttp3 calls the JSON API with those cookies (retry once with a forced
 *     re-solve on 403/503/429 — clearance expires).
 *  3. The /play/ document is fingerprint-bound: it's fetched by NAVIGATING the
 *     WebView there (marker-checked), expanding to full-screen if challenged.
 *  4. kwik → m3u8 by loading kwik in a throwaway WebView and intercepting the
 *     manifest request; the kwik origin is remembered for the CDN Referer.
 */
object Pahe {
    // Public: the player must present the SAME UA the kwik WebView used —
    // the CDN binds the session to it.
    const val MOBILE_UA =
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"

    @Volatile var lastKwikOrigin: String = "https://kwik.cx"
        private set

    private var activity: Activity? = null
    private lateinit var prefs: SharedPreferences
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    fun attach(act: Activity) {
        activity = act
        prefs = act.applicationContext.getSharedPreferences("anitrack_next", Context.MODE_PRIVATE)
    }

    private fun baseUrl(): String {
        val config = RemoteConfig.current()
        check(config.animepahe.enabled && config.features.animepaheStreaming) {
            "AnimePahe is temporarily disabled by the automation configuration."
        }
        val configured = config.animepahe.baseUrls.first()
        val discoveredAtRevision = prefs.getLong("pahe_base_revision", -1)
        return if (discoveredAtRevision == config.revision) {
            prefs.getString("pahe_base_url", configured) ?: configured
        } else configured
    }

    private fun configuredBases(): List<String> = RemoteConfig.current().animepahe.baseUrls.map { it.trimEnd('/') }

    private fun route(name: String, values: Map<String, Any> = emptyMap()): String {
        var value = RemoteConfig.current().animepahe.routes[name]
            ?: error("Missing signed AnimePahe route: $name")
        Regex("""\{([A-Za-z][A-Za-z0-9]*)\}""").findAll(value).toList().forEach { match ->
            val key = match.groupValues[1]
            val replacement = values[key] ?: error("Missing AnimePahe route value: $key")
            value = value.replace(match.value, android.net.Uri.encode(replacement.toString()))
        }
        check(!value.contains('{')) { "Unresolved AnimePahe route: $name" }
        return value
    }

    private fun selector(name: String): String = RemoteConfig.current().animepahe.selectors[name]
        ?: error("Missing signed AnimePahe selector: $name")

    private fun attribute(tag: String, name: String): String? = Regex(
        "(?:^|\\s)${Regex.escape(name)}\\s*=\\s*([\"'])(.*?)\\1",
        RegexOption.IGNORE_CASE,
    ).find(tag)?.groupValues?.get(2)

    private fun rememberRedirectedBase(url: String) {
        prefs.edit()
            .putString("pahe_base_url", url)
            .putLong("pahe_base_revision", RemoteConfig.current().revision)
            .apply()
    }

    // ── CF session ────────────────────────────────────────────────────────────

    private var cfWebView: WebView? = null
    private var cfOverlay: android.view.ViewGroup? = null
    @Volatile private var cfReady = false
    @Volatile private var cfUserCancelled = false
    private var cfReadyJob: CompletableDeferred<Unit>? = null

    private fun hasValidCookies(): Boolean {
        val cookies = CookieManager.getInstance().getCookie(baseUrl()) ?: return false
        return cookies.contains("cf_clearance") || cookies.contains("__ddg5_")
    }

    private fun clearanceValue(): String? {
        val cookies = CookieManager.getInstance().getCookie(baseUrl()) ?: return null
        return cookies.split(";").map { it.trim() }
            .firstOrNull { it.startsWith("cf_clearance=") || it.startsWith("__ddg5_") }
    }

    private fun ensureCfWebView(forceSolve: Boolean = false, interactive: Boolean = true): Deferred<Unit> {
        if (!forceSolve && cfReady && cfWebView != null) return CompletableDeferred(Unit)
        if (!forceSolve && hasValidCookies()) { cfReady = true; return CompletableDeferred(Unit) }
        if (interactive && cfUserCancelled) return CompletableDeferred(Unit)
        cfReadyJob?.let { if (it.isActive) return it }

        val deferred = CompletableDeferred<Unit>()
        cfReadyJob = deferred
        val act = activity ?: run { deferred.completeExceptionally(IOException("no activity")); return deferred }
        val priorClearance = if (forceSolve) clearanceValue() else null

        act.runOnUiThread {
            cfOverlay?.let { (it.parent as? android.view.ViewGroup)?.removeView(it) }; cfOverlay = null
            cfWebView?.let { old -> (old.parent as? android.view.ViewGroup)?.removeView(old); old.destroy() }
            @SuppressLint("SetJavaScriptEnabled")
            val wv = WebView(act)
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)
            wv.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                userAgentString = MOBILE_UA
            }
            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    // AnimePahe hops domains — follow it.
                    try {
                        val p = java.net.URL(url)
                        val redirected = "${p.protocol}://${p.host}"
                        if (p.host.contains("animepahe") && redirected != baseUrl()) {
                            rememberRedirectedBase(redirected)
                        }
                    } catch (e: Exception) { /* ignore */ }
                }
                override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                    /* let the cookie poll decide */
                }
            }
            wv.addJavascriptInterface(Bridge, "AndroidPahe")
            val root = act.findViewById<android.view.ViewGroup>(android.R.id.content)
            cfWebView = wv

            fun teardown(@Suppress("UNUSED_PARAMETER") keepWv: Boolean) {
                (wv.parent as? android.view.ViewGroup)?.removeView(wv)
                cfOverlay?.let { (it.parent as? android.view.ViewGroup)?.removeView(it) }; cfOverlay = null
                // Keep the WebView alive 1x1 so in-page/play fetches can use it.
                wv.layoutParams = android.view.ViewGroup.LayoutParams(1, 1)
                try { root?.addView(wv) } catch (e: Exception) { /* ignore */ }
            }

            if (interactive) {
                val container = android.widget.LinearLayout(act)
                container.orientation = android.widget.LinearLayout.VERTICAL
                container.setBackgroundColor(0xFF0B0B0F.toInt())
                val bar = android.widget.LinearLayout(act)
                bar.orientation = android.widget.LinearLayout.HORIZONTAL
                bar.gravity = android.view.Gravity.CENTER_VERTICAL
                bar.setPadding(32, 48, 32, 24)
                val hint = android.widget.TextView(act)
                hint.text = "Verify you're human to load AnimePahe"
                hint.setTextColor(0xFFFFFFFF.toInt()); hint.textSize = 14f
                hint.layoutParams = android.widget.LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                bar.addView(hint)
                val closeBtn = android.widget.Button(act)
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
                wv.layoutParams = android.view.ViewGroup.LayoutParams(1, 1)
                try { root?.addView(wv) } catch (e: Exception) { /* ignore */ }
            }

            wv.loadUrl(baseUrl() + route("home"))

            scope.launch {
                var waited = 0
                val cap = if (interactive) 120_000 else 20_000
                while (waited < cap && !deferred.isCompleted) {
                    val solved = if (forceSolve) {
                        val now = clearanceValue(); now != null && now != priorClearance
                    } else hasValidCookies()
                    if (solved) {
                        cfUserCancelled = false
                        act.runOnUiThread { teardown(true) }
                        cfReady = true
                        deferred.complete(Unit)
                        break
                    }
                    delay(700); waited += 700
                }
                if (!deferred.isCompleted) {
                    act.runOnUiThread { teardown(false) }
                    cfReady = true
                    deferred.complete(Unit)
                }
            }
        }
        return deferred
    }

    private suspend fun waitForCf(forceSolve: Boolean = false, interactive: Boolean = true) =
        ensureCfWebView(forceSolve, interactive).await()

    // ── In-page fetch bridge (kept for future needs, e.g. ids scraping) ───────

    private val inPageResults = java.util.concurrent.ConcurrentHashMap<String, CompletableDeferred<String>>()

    private object Bridge {
        @android.webkit.JavascriptInterface
        fun onResult(id: String, ok: Boolean, data: String) {
            val d = Pahe.inPageResults.remove(id) ?: return
            if (ok) d.complete(data) else d.completeExceptionally(IOException(data))
        }
    }

    // ── Navigate-to-page fetch for the CF-fingerprint-bound /play/ document ──

    private suspend fun navFetchHtml(path: String, marker: String): String =
        suspendCancellableCoroutine { cont ->
            val act = activity ?: run { cont.resumeWith(Result.failure(IOException("no activity"))); return@suspendCancellableCoroutine }
            act.runOnUiThread {
                val root = act.findViewById<android.view.ViewGroup>(android.R.id.content)
                cfOverlay?.let { (it.parent as? android.view.ViewGroup)?.removeView(it) }; cfOverlay = null
                cfWebView?.let { (it.parent as? android.view.ViewGroup)?.removeView(it); it.destroy() }
                @SuppressLint("SetJavaScriptEnabled")
                val wv = WebView(act)
                CookieManager.getInstance().setAcceptCookie(true)
                CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)
                wv.settings.apply { javaScriptEnabled = true; domStorageEnabled = true; userAgentString = MOBILE_UA }
                cfWebView = wv

                // Starts hidden; expands only if Cloudflare challenges this page.
                val container = android.widget.LinearLayout(act)
                container.orientation = android.widget.LinearLayout.VERTICAL
                container.setBackgroundColor(0xFF0B0B0F.toInt())
                val bar = android.widget.LinearLayout(act)
                bar.orientation = android.widget.LinearLayout.HORIZONTAL
                bar.gravity = android.view.Gravity.CENTER_VERTICAL
                bar.setPadding(32, 48, 32, 24)
                val hint = android.widget.TextView(act)
                hint.text = "Verify you're human to load AnimePahe"
                hint.setTextColor(0xFFFFFFFF.toInt()); hint.textSize = 14f
                hint.layoutParams = android.widget.LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                bar.addView(hint)
                val closeBtn = android.widget.Button(act)
                closeBtn.text = "Close"
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
                    try { root?.addView(wv) } catch (e: Exception) { /* ignore */ }
                    if (html != null) cont.resumeWith(Result.success(html))
                    else cont.resumeWith(Result.failure(IOException("play page fetch failed/timeout")))
                }
                fun expand() {
                    cfUserCancelled = false
                    container.layoutParams = android.view.ViewGroup.LayoutParams(
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    container.requestLayout()
                }
                closeBtn.setOnClickListener { cfUserCancelled = true; finish(null) }

                wv.webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, u: String) {
                        if (done) return
                        view.evaluateJavascript(
                            "(function(){var h=document.documentElement.outerHTML;return h.indexOf('$marker')>-1?h:'__CHALLENGE__'})()",
                        ) { result ->
                            if (done || result == null) return@evaluateJavascript
                            if (result == "\"__CHALLENGE__\"" || result == "null") {
                                act.runOnUiThread { expand() }
                            } else {
                                try {
                                    val html = JSONObject("{\"h\":$result}").getString("h")
                                    if (html.contains(marker)) finish(html) else act.runOnUiThread { expand() }
                                } catch (e: Exception) { act.runOnUiThread { expand() } }
                            }
                        }
                    }
                }
                wv.loadUrl(if (path.startsWith("http")) path else baseUrl() + path)
                scope.launch { delay(120_000); act.runOnUiThread { finish(null) } }
            }
        }

    // ── Cookie bridge + HTTP ─────────────────────────────────────────────────

    private class WebViewCookieJar : CookieJar {
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

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .cookieJar(WebViewCookieJar())
            .callTimeout(25, TimeUnit.SECONDS)
            .build()
    }

    private fun resetCfSession() {
        cfReady = false
        cfReadyJob = null
        activity?.runOnUiThread { cfWebView?.destroy(); cfWebView = null }
    }

    private suspend fun paheGet(
        path: String,
        retried: Boolean = false,
        interactive: Boolean = true,
        attemptedBases: Set<String> = emptySet(),
    ): JSONObject {
        val currentBase = baseUrl()
        val attempted = attemptedBases + currentBase
        try {
            waitForCf(forceSolve = retried, interactive = interactive)
            val url = if (path.startsWith("http")) path else currentBase + path
            val req = Request.Builder().url(url)
                .header("Accept", "application/json, text/plain, */*")
                .header("X-Requested-With", "XMLHttpRequest")
                .header("Referer", currentBase + route("home"))
                .header("User-Agent", MOBILE_UA)
                .build()
            val resp = withContext(Dispatchers.IO) { client.newCall(req).execute() }
            if (!resp.isSuccessful) {
                val code = resp.code
                resp.close()
                if (!retried && code in listOf(403, 503, 429)) {
                    resetCfSession()
                    return paheGet(path, retried = true, interactive = interactive, attemptedBases = attemptedBases)
                }
                throw IOException("AnimePahe HTTP $code")
            }
            return JSONObject(resp.body!!.string())
        } catch (error: Exception) {
            if (!path.startsWith("http")) {
                val fallback = configuredBases().firstOrNull { it !in attempted }
                if (fallback != null) {
                    rememberRedirectedBase(fallback)
                    resetCfSession()
                    return paheGet(path, retried = false, interactive = interactive, attemptedBases = attempted)
                }
            }
            throw error
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    data class SearchResult(val session: String, val title: String, val year: Int?, val episodes: Int?, val poster: String?)
    data class Episode(val session: String, val number: Float, val snapshot: String?)
    data class Link(val kwik: String, val quality: String, val audio: String)
    data class Stream(val url: String, val referer: String)

    suspend fun search(query: String): List<SearchResult> {
        val data = paheGet(route("search", mapOf("query" to query)))
        val arr = data.optJSONArray("data") ?: JSONArray()
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            SearchResult(
                o.optString("session"), o.optString("title"),
                if (o.isNull("year")) null else o.optInt("year"),
                if (o.isNull("episodes")) null else o.optInt("episodes"),
                o.optString("poster").takeIf { it.isNotEmpty() },
            )
        }
    }

    /** All episodes, paginated 30/page — capped at 12 pages (360 eps) for now. */
    suspend fun episodesAll(session: String, maxPages: Int = 12): List<Episode> {
        val out = mutableListOf<Episode>()
        var page = 1
        var lastPage = 1
        while (page <= minOf(lastPage, maxPages)) {
            val data = paheGet(route("episodes", mapOf("animeId" to session, "page" to page)))
            lastPage = data.optInt("last_page", 1)
            val arr = data.optJSONArray("data") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                out += Episode(o.optString("session"), o.optDouble("episode", 0.0).toFloat(), o.optString("snapshot"))
            }
            page++
        }
        return out
    }

    suspend fun links(animeSession: String, epSession: String): List<Link> {
        val html = navFetchHtml(
            route("play", mapOf("animeId" to animeSession, "episodeId" to epSession)),
            selector("streamUrlAttribute"),
        )
        val out = mutableListOf<Link>()
        for (tag in Regex("""<button[^>]*>""").findAll(html)) {
            val t = tag.value
            val src = attribute(t, selector("streamUrlAttribute")) ?: continue
            if (!src.contains("kwik")) continue
            out += Link(
                src,
                attribute(t, selector("resolutionAttribute")) ?: "?",
                attribute(t, selector("audioAttribute")) ?: "jpn",
            )
        }
        if (out.isEmpty()) {
            for (m in Regex("""https?://kwik\.[^\s"'<>]+""").findAll(html)) {
                out += Link(m.value, "?", "jpn")
            }
        }
        return out
    }

    /** kwik → m3u8 by intercepting the manifest request in a throwaway WebView. */
    suspend fun resolveKwik(kwikUrl: String): Stream {
        try {
            val p = java.net.URL(kwikUrl)
            lastKwikOrigin = "${p.protocol}://${p.host}"
        } catch (e: Exception) { /* keep previous */ }

        var lastFailure: Throwable? = null
        repeat(2) { attempt ->
            try {
                return Stream(resolveKwikOnce(kwikUrl), lastKwikOrigin)
            } catch (e: CancellationException) {
                // Retry a resolver-local timeout, but stop immediately when
                // the player/download that requested it has gone away.
                if (!currentCoroutineContext().isActive) throw e
                lastFailure = e
                Log.w("AniTrack/AnimePahe", "Kwik resolve attempt ${attempt + 1} failed: ${e.message}")
                if (attempt == 0) delay(350)
            } catch (e: Exception) {
                lastFailure = e
                Log.w("AniTrack/AnimePahe", "Kwik resolve attempt ${attempt + 1} failed: ${e.message}")
                if (attempt == 0) delay(350)
            }
        }
        throw IOException(lastFailure?.message ?: "kwik resolve failed", lastFailure)
    }

    private suspend fun resolveKwikOnce(kwikUrl: String): String {
        val act = activity ?: throw IOException("no activity")
        val deferred = CompletableDeferred<String>()
        act.runOnUiThread {
            @SuppressLint("SetJavaScriptEnabled")
            val wv = WebView(act)
            var cleanupScheduled = false
            fun cleanup() {
                if (cleanupScheduled) return
                cleanupScheduled = true
                // Destroying from shouldInterceptRequest races Chromium's
                // in-flight callback and produced destroyed-WebView crashes.
                // Give that callback a moment to return first.
                wv.postDelayed({
                    runCatching { wv.stopLoading(); wv.loadUrl("about:blank"); wv.destroy() }
                }, 500)
            }
            wv.settings.apply { javaScriptEnabled = true; domStorageEnabled = true; userAgentString = MOBILE_UA }
            wv.webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    val url = request.url.toString()
                    if (url.contains(".m3u8") && !deferred.isCompleted) {
                        deferred.complete(url)
                        act.runOnUiThread { cleanup() }
                    }
                    return null
                }
                override fun onPageFinished(view: WebView, url: String) {
                    view.evaluateJavascript(
                        "(function(){var b=document.querySelector('button')||document.querySelector('.video-js');if(b)b.click();})();",
                        null,
                    )
                }
                override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                    if (!req.isForMainFrame || deferred.isCompleted) return
                    deferred.completeExceptionally(IOException("kwik error: ${err.description}"))
                    act.runOnUiThread { cleanup() }
                }
                override fun onRenderProcessGone(
                    view: WebView,
                    detail: android.webkit.RenderProcessGoneDetail,
                ): Boolean {
                    if (!deferred.isCompleted) {
                        deferred.completeExceptionally(IOException("kwik renderer stopped"))
                    }
                    cleanup()
                    return true
                }
            }
            wv.loadUrl(kwikUrl, mutableMapOf("Referer" to baseUrl() + route("home")))
            scope.launch {
                delay(18_000)
                if (!deferred.isCompleted) {
                    deferred.completeExceptionally(IOException("kwik resolve timeout"))
                    act.runOnUiThread { cleanup() }
                }
            }
        }
        return withTimeout(22_000) { deferred.await() }
    }

    // ── Matching ──────────────────────────────────────────────────────────────

    data class Matched(val source: SearchResult, val episodes: List<Episode>)

    /** Best AnimePahe entry for an AniList anime. Pahe's search returns real
     *  year + episode metadata, so title scoring with the year gate is
     *  reliable here (no embedded MAL id to verify against). */
    suspend fun matchFor(anime: Anime): Matched? {
        val queries = buildList {
            add(anime.title)
            anime.titleRomaji?.let { if (it.lowercase() != anime.title.lowercase()) add(it) }
        }
        val candidates = LinkedHashMap<String, SearchResult>()
        var successfulSearches = 0
        var lastSearchError: Throwable? = null
        for (q in queries) {
            val result = runCatching { search(q) }
                .onSuccess { successfulSearches++ }
                .onFailure {
                    lastSearchError = it
                    Log.w("AniTrack/AnimePahe", "Search failed for '$q': ${it.message}")
                }
            for (r in result.getOrDefault(emptyList())) {
                candidates.putIfAbsent(r.session, r)
            }
        }
        if (successfulSearches == 0 && lastSearchError != null) {
            throw IOException("AnimePahe search failed: ${lastSearchError?.message}", lastSearchError)
        }
        if (candidates.isEmpty()) return null
        val airing = anime.status == "RELEASING"
        val best = candidates.values
            .map { r ->
                r to queries.maxOf { q -> Match.score(r.title, r.year, r.episodes, q, anime.year, anime.episodes, airing) }
            }
            .filter { it.second >= 20 }
            .maxByOrNull { it.second }?.first ?: return null
        val eps = runCatching { episodesAll(best.session) }
            .onFailure { Log.w("AniTrack/AnimePahe", "Episode lookup failed: ${it.message}") }
            .getOrElse { throw IOException("AnimePahe episode lookup failed: ${it.message}", it) }
        if (eps.isEmpty()) return null
        return Matched(best, eps)
    }
}
