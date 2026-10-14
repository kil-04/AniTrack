package com.sanjay.anitrack.next.data.manga.comix

import android.annotation.SuppressLint
import android.content.Context
import android.os.Message
import android.webkit.*
import java.io.ByteArrayInputStream
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.json.JSONTokener

/** Typed across the process boundary so the native UI can offer Connect Comix. */
internal class ComixConnectionRequired : IllegalStateException("Connect Comix to load its catalogue.")

/** Exists only in :comix. The website sees no JavascriptInterface or app tokens. */
@SuppressLint("SetJavaScriptEnabled")
internal class ComixSessionEngine private constructor(context: Context) {
    @Volatile var ready = false
        private set
    @Volatile private var rejected = false
    private var loaded = false
    private var destroyed = false
    @Volatile private var connecting = false
    private var generation = 0
    private var lastChapterPageAt = 0L
    /** Set from the website's own Retry-After; reads fail fast until then, with no automatic retry. */
    @Volatile private var cooldownUntil = 0L
    private val transport = context.assets.open("comix_transport.js").bufferedReader().use { it.readText() }
    private val connectionHelp = context.assets.open("comix_connection_help.js").bufferedReader().use { it.readText() }
    val web: WebView

    init {
        web = WebView(context).apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                safeBrowsingEnabled = true
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(true)
            }
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) = request.deny()
                override fun onCreateWindow(view: WebView, dialog: Boolean, gesture: Boolean, result: Message) = false
                override fun onShowFileChooser(view: WebView, callback: android.webkit.ValueCallback<Array<android.net.Uri>>, params: FileChooserParams): Boolean {
                    callback.onReceiveValue(null)
                    return true
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    !allowed(request)

                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    val permitted = allowed(request)
                    if (com.sanjay.anitrack.next.BuildConfig.DEBUG && request.url.path?.startsWith("/api/v1/") == true) {
                        val route = request.url.path.orEmpty().replace(Regex("/[0-9]+"),"/{id}")
                        android.util.Log.d("ComixDiagnostics", "Website catalogue path ${route.take(80)}: allowed=$permitted")
                    }
                    return if (permitted) null else WebResourceResponse(
                        ComixProtocol.BLOCKED_MIME, "utf-8", 403, "Blocked", emptyMap(),
                        ByteArrayInputStream(ComixProtocol.BLOCKED_BODY.toByteArray(Charsets.UTF_8)))
                }

                override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                    loaded = false
                    if (!connecting) { ready = false; generation++ }
                }

                override fun onPageFinished(view: WebView, url: String) {
                    loaded = ComixProtocol.isPublicConnectionPage(url)
                    if (loaded && connecting) {
                        rejected = false
                        view.evaluateJavascript(connectionHelp, null)
                    }
                }

                override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                    val uri = request.url
                    if (uri.path?.startsWith("/api/v1/") == true && allowed(request)) {
                        val header = response.responseHeaders?.entries?.firstOrNull { it.key.equals("retry-after", ignoreCase = true) }?.value
                        ComixProtocol.retryAfterMillis(response.statusCode, header)?.let { wait ->
                            cooldownUntil = maxOf(cooldownUntil, System.currentTimeMillis() + wait)
                        }
                    }
                    if (com.sanjay.anitrack.next.BuildConfig.DEBUG && uri.path?.startsWith("/api/v1/") == true) {
                        // Fixed metadata only: never print bodies, URLs, cookies,
                        // signature fields or source-decoding values.
                        val challenge = response.responseHeaders?.entries?.any {
                            it.key.equals("cf-mitigated", ignoreCase = true) && it.value.equals("challenge", ignoreCase = true)
                        } == true
                        val kind = when {
                            challenge -> "challenge"
                            response.mimeType?.contains("json", ignoreCase = true) == true -> "json"
                            response.mimeType?.contains("html", ignoreCase = true) == true -> "html"
                            else -> "other"
                        }
                        android.util.Log.d("ComixDiagnostics", "Website catalogue HTTP ${response.statusCode}; permitted=${allowed(request)}; kind=$kind")
                    }
                    if ((request.isForMainFrame || (uri.path?.startsWith("/api/v1/") == true && allowed(request))) && response.statusCode in setOf(401,403,429)) {
                        ready = false
                        // In the visible connection screen the website may ask
                        // the user to finish its own WAF modal. Do not block that
                        // normal flow; hidden/native catalogue reads still stop.
                        if (!connecting) { rejected = true; view.stopLoading() }
                    }
                }

                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    rejected = true; loaded = false
                    destroy()
                    return true
                }
            }
            setDownloadListener { _, _, _, _, _ -> } // No site-initiated downloads.
        }
    }

    private fun allowed(request: WebResourceRequest): Boolean = !destroyed &&
        ComixProtocol.allowedWebsiteRequest(request.url.toString(), request.method,
            request.isForMainFrame, connecting, rejected)

    fun beginConnection() {
        check(!destroyed) { "Return to AniTrack and connect Comix again." }
        ready = false; rejected = false; loaded = false; connecting = true; generation++
        web.onResume()
        web.loadUrl("${ComixProtocol.ORIGIN}/")
    }

    suspend fun acceptConnection() = withContext(Dispatchers.Main) {
        check(!destroyed && connecting && loaded && ComixProtocol.isPublicConnectionPage(web.url.orEmpty())) {
            "Wait for a normal Comix homepage, browse or title page. Finish any website check yourself before continuing."
        }
        val current = generation
        ready = false
        try {
            withTimeout(30_000) {
                check(evaluate(normalPublicPageScript) == "true") {
                    "Complete the website verification yourself, then return to a normal Comix page before continuing."
                }
                if (web.url != "${ComixProtocol.ORIGIN}/" || evaluate(homepageDataScript) != "true") {
                    // Explicit Continue returns to the normal homepage in this
                    // same profile; it never retries a refused native API call.
                    loaded = false
                    web.loadUrl("${ComixProtocol.ORIGIN}/")
                }
                while (true) {
                    check(!destroyed && connecting && current == generation) { "Comix connection was closed. Connect again." }
                    if (loaded && web.url == "${ComixProtocol.ORIGIN}/" && evaluate(homepageDataScript) == "true") break
                    delay(200)
                }
                evaluate(transport)
                val initialized = evaluate("typeof window.__anitrackComix === 'object'") == "true"
                check(!destroyed && connecting && current == generation && web.url == "${ComixProtocol.ORIGIN}/" &&
                    initialized) { "Comix connection could not be initialized." }
                evaluate("window.__anitrackComixConnectionHelp?.disable?.()")
                rejected = false
                connecting = false
                ready = true
            }
        } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
            ready = false
            error("Comix did not return to its homepage in time. Complete any visible website check yourself, then continue again.")
        } catch (e: CancellationException) {
            ready = false
            throw e
        } catch (e: Exception) {
            ready = false
            throw e
        }
    }

    // These locally reviewed probes return booleans only, never website data,
    // cookies, WAF parameters or verification tokens.
    private val normalPublicPageScript = """
        (() => {
            if (location.origin !== '${ComixProtocol.ORIGIN}') return false;
            if (location.pathname === '/@waf/challenge' || location.pathname.startsWith('/cdn-cgi/')) return false;
            if (/just a moment|verify you are human|attention required|performing security verification/i.test(
                document.title + ' ' + (document.body?.innerText || '').slice(0,1500))) return false;
            return !Array.from(document.querySelectorAll('iframe')).some(frame => {
                try {
                    const url = new URL(frame.src,location.href);
                    const bounds = frame.getBoundingClientRect();
                    const challengeFrame = (url.origin === location.origin && url.pathname === '/@waf/challenge') ||
                        url.origin === 'https://challenges.cloudflare.com';
                    return challengeFrame &&
                        bounds.width > 0 && bounds.height > 0 && getComputedStyle(frame).visibility !== 'hidden';
                } catch { return false; }
            });
        })()
    """.trimIndent()

    private val homepageDataScript = """
        (() => {
            if (location.origin !== '${ComixProtocol.ORIGIN}' || location.pathname !== '/' || !($normalPublicPageScript)) return false;
            const node = document.querySelector('script#initial-data');
            if (!node || !node.textContent || node.textContent.length > 2000000) return false;
            try {
                const queries = JSON.parse(node.textContent)?.queries;
                return !!queries && typeof queries === 'object' && !Array.isArray(queries);
            } catch { return false; }
        })()
    """.trimIndent()

    fun cancelConnection() {
        connecting = false; ready = false; generation++
        if (!destroyed) {
            web.evaluateJavascript("window.__anitrackComixConnectionHelp?.disable?.()", null)
            web.stopLoading()
        }
    }

    private fun checkCooldown() {
        val left = cooldownUntil - System.currentTimeMillis()
        check(left <= 0) { "Comix is limiting requests. Try again in ${maxOf(1, (left + 999) / 1000)} s." }
    }

    suspend fun read(path: String, params: JSONObject, lease: String): JSONObject = withContext(Dispatchers.Main) {
        check(ComixProtocol.validRequest(path, params)) { "Unsupported Comix request." }
        if (destroyed || !ready || rejected || web.url != "${ComixProtocol.ORIGIN}/") throw ComixConnectionRequired()
        checkCooldown()
        if (ComixProtocol.isChapterList(path)) {
            delay(lastChapterPageAt + ComixProtocol.CHAPTER_PAGE_INTERVAL_MS - System.currentTimeMillis())
            lastChapterPageAt = System.currentTimeMillis()
        }
        val current = generation
        val id = java.util.UUID.randomUUID().toString()
        val qid = JSONObject.quote(id)
        web.onResume()
        try {
            withTimeout(35_000) {
                if (com.sanjay.anitrack.next.BuildConfig.DEBUG) android.util.Log.d("ComixDiagnostics", "Starting isolated catalogue operation")
                check(evaluate("window.__anitrackComix.start($qid,${JSONObject.quote(path)},$params)") == "true") { "Comix is busy. Try again." }
                var lastPhase = ""
                while (true) {
                    check(ComixCatalogueActivity.active(lease)) { "Comix loading was cancelled." }
                    if (!ready || rejected || current != generation) throw ComixConnectionRequired()
                    if (evaluate("typeof window.__anitrackComix === 'object'") != "true") throw ComixConnectionRequired()
                    if (com.sanjay.anitrack.next.BuildConfig.DEBUG) {
                        val phase = evaluate("window.__anitrackComix.phase($qid)")
                        if (phase != lastPhase && phase in setOf("\"website-module\"", "\"catalogue\"", "\"website-decode\"", "\"response-format\"", "\"idle\"")) {
                            android.util.Log.d("ComixDiagnostics", "Catalogue operation phase: $phase")
                            lastPhase = phase
                        }
                    }
                    val result = evaluate("window.__anitrackComix.take($qid)")
                    if (result != "null") {
                        require(result.length <= ComixProtocol.MAX_RESPONSE * 2 + 1000) { "Comix response too large." }
                        val body = JSONTokener(result).nextValue() as? String ?: error("Invalid Comix response.")
                        require(body.length <= ComixProtocol.MAX_RESPONSE) { "Comix response too large." }
                        val value = JSONObject(body)
                        if (!value.optBoolean("ok")) {
                            val status = value.optInt("status")
                            // The header callback can trail the response; never keep asking either way.
                            if (ComixProtocol.isRateLimit(status) && cooldownUntil <= System.currentTimeMillis()) {
                                cooldownUntil = System.currentTimeMillis() + ComixProtocol.DEFAULT_COOLDOWN_MS
                            }
                            checkCooldown()
                            if (status in setOf(401,403,429)) {
                                ready = false; rejected = true; web.stopLoading()
                                throw ComixConnectionRequired()
                            }
                            error(value.optString("error", "Comix failed.").take(150))
                        }
                        return@withTimeout value.getJSONObject("value")
                    }
                    delay(100)
                }
                @Suppress("UNREACHABLE_CODE") JSONObject()
            }
        } finally {
            if (current == generation) withContext(kotlinx.coroutines.NonCancellable) {
                runCatching { withTimeout(1000) { evaluate("window.__anitrackComix?.cancel($qid)") } }
            }
        }
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    private suspend fun evaluate(script: String): String = kotlinx.coroutines.suspendCancellableCoroutine { continuation ->
        web.evaluateJavascript(script) { value -> if (continuation.isActive) continuation.resume(value, null) }
    }

    fun destroy() {
        if (destroyed) return
        destroyed = true
        ready = false; generation++
        web.stopLoading()
        (web.parent as? android.view.ViewGroup)?.removeView(web)
        web.destroy()
        if (instance === this) instance = null
    }

    companion object {
        private var instance: ComixSessionEngine? = null
        fun get(context: Context): ComixSessionEngine = instance ?: ComixSessionEngine(context.applicationContext).also { instance = it }
        fun close() { instance?.destroy() }
    }
}
