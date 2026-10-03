package com.sanjay.anitrack.next.data.manga.comix

import android.annotation.SuppressLint
import android.content.Context
import android.os.Message
import android.webkit.*
import java.io.ByteArrayInputStream
import java.net.URI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.json.JSONTokener

/** Exists only in :comix. The website sees no JavascriptInterface or app tokens. */
@SuppressLint("SetJavaScriptEnabled")
internal class ComixSessionEngine private constructor(context: Context) {
    @Volatile var ready = false
        private set
    @Volatile private var rejected = false
    private var loaded = false
    @Volatile private var connecting = false
    private var generation = 0
    private val transport = context.assets.open("comix_transport.js").bufferedReader().use { it.readText() }
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
                    loaded = url == "${ComixProtocol.ORIGIN}/"
                    if (loaded && connecting) rejected = false
                }

                override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                    val uri = request.url
                    if (com.sanjay.anitrack.next.BuildConfig.DEBUG && uri.path?.startsWith("/api/v1/") == true) {
                        android.util.Log.d("ComixDiagnostics", "Website catalogue HTTP ${response.statusCode}; permitted=${allowed(request)}")
                    }
                    if ((request.isForMainFrame || (uri.path?.startsWith("/api/v1/") == true && allowed(request))) && response.statusCode in setOf(401,403,429)) {
                        rejected = true
                        ready = false
                        if (!connecting) view.stopLoading()
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

    private fun allowed(request: WebResourceRequest): Boolean {
        val u = runCatching { URI(request.url.toString()) }.getOrNull() ?: return false
        if (u.scheme != "https" || u.userInfo != null || u.port !in listOf(-1,443)) return false
        if (u.host == "challenges.cloudflare.com") return connecting && !request.isForMainFrame && request.method in setOf("GET","POST")
        if (u.host != "comix.to") return false
        if (connecting && u.path.startsWith("/cdn-cgi/challenge-platform/") && request.method == "POST") return !request.isForMainFrame
        if (request.method != "GET") return false
        if (request.isForMainFrame) return (connecting || !rejected) && (u.path == "/" || (connecting && u.path.startsWith("/cdn-cgi/")))
        if (u.path.startsWith("/api/v1/")) return !rejected && (
            u.path == "/api/v1/manga" || Regex("/api/v1/manga/[a-zA-Z0-9]{1,32}(/chapters)?").matches(u.path) ||
                Regex("/api/v1/chapters/[0-9]{1,15}").matches(u.path))
        return u.path.startsWith("/assets/") || (connecting && u.path.startsWith("/cdn-cgi/")) || u.path == "/favicon.ico"
    }

    fun beginConnection() {
        ready = false; rejected = false; loaded = false; connecting = true; generation++
        web.loadUrl("${ComixProtocol.ORIGIN}/")
    }

    suspend fun acceptConnection() {
        check(loaded && web.url == "${ComixProtocol.ORIGIN}/") { "Wait for the Comix homepage to load, then continue." }
        val challenge = evaluate("(/just a moment|verify you are human|attention required/i.test(document.title + ' ' + (document.body?.innerText || '').slice(0,1500)))")
        check(challenge != "true") { "Complete the website verification yourself before continuing." }
        connecting = false
        rejected = false
        evaluate(transport)
        check(evaluate("typeof window.__anitrackComix === 'object'") == "true") { "Comix connection could not be initialized." }
        ready = true
    }

    fun cancelConnection() { connecting = false; ready = false; web.stopLoading() }

    suspend fun read(path: String, params: JSONObject): JSONObject = withContext(Dispatchers.Main) {
        check(ComixProtocol.validRequest(path, params)) { "Unsupported Comix request." }
        check(ready && !rejected && web.url == "${ComixProtocol.ORIGIN}/") { "Connect Comix to load manga chapters." }
        val current = generation
        val id = java.util.UUID.randomUUID().toString()
        val qid = JSONObject.quote(id)
        web.onResume()
        try {
            withTimeout(25_000) {
                if (com.sanjay.anitrack.next.BuildConfig.DEBUG) android.util.Log.d("ComixDiagnostics", "Starting isolated catalogue operation")
                check(evaluate("window.__anitrackComix.start($qid,${JSONObject.quote(path)},$params)") == "true") { "Comix is busy. Try again." }
                var lastPhase = ""
                while (true) {
                    check(ready && !rejected && current == generation) { "Comix requires a fresh connection. Complete any check yourself." }
                    check(evaluate("typeof window.__anitrackComix === 'object'") == "true") { "Comix session reloaded. Connect again." }
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
                            if (value.optInt("status") in setOf(401,403,429)) { ready = false; rejected = true; web.stopLoading() }
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
