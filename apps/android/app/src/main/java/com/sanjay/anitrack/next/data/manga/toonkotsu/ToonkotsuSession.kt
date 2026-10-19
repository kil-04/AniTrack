package com.sanjay.anitrack.next.data.manga.toonkotsu

import android.annotation.SuppressLint
import android.content.Context
import android.os.Message
import android.view.ViewGroup
import android.webkit.*
import com.sanjay.anitrack.next.data.manga.MangaSourceException
import com.sanjay.anitrack.next.data.manga.MangaVerificationRequired
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayInputStream
import java.util.UUID
import kotlin.coroutines.resume

/** Website-owned decoding in a restricted WebView. No JavascriptInterface, app tokens or file access. */
internal object ToonkotsuSession {
    private lateinit var context: Context
    private lateinit var program: String
    private var web: WebView? = null
    private var loaded = false
    private val lane = Mutex()
    private var cooldownUntil = 0L
    var verificationNeeded = false
        private set
    var connectionUrl = "${ToonkotsuParser.ORIGIN}/"
        private set
    fun init(context: Context) { this.context = context.applicationContext; program = context.assets.open("toonkotsu_page.js").bufferedReader().use { it.readText() } }
    private fun allowed(raw: String): Boolean = runCatching {
        val u = java.net.URI(raw)
        u.scheme == "https" && u.host in setOf("toonkotsu.com", "challenges.cloudflare.com") && u.userInfo == null && u.port in listOf(-1,443)
    }.getOrDefault(false)
    @SuppressLint("SetJavaScriptEnabled")
    fun view(): WebView = web ?: WebView(context).also { browser ->
        web = browser
        browser.settings.apply { javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = false; allowContentAccess = false; mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW; safeBrowsingEnabled = true; javaScriptCanOpenWindowsAutomatically = false; setSupportMultipleWindows(true) }
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false)
        browser.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) = request.deny()
            override fun onCreateWindow(v: WebView, dialog: Boolean, gesture: Boolean, result: Message) = false
            override fun onShowFileChooser(v: WebView, callback: ValueCallback<Array<android.net.Uri>>, params: FileChooserParams): Boolean { callback.onReceiveValue(null); return true }
        }
        browser.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest) = !allowed(request.url.toString())
            override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse? =
                if (allowed(request.url.toString())) null else WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(byteArrayOf()))
            override fun onPageStarted(v: WebView, url: String, icon: android.graphics.Bitmap?) { loaded = false }
            override fun onPageFinished(v: WebView, url: String) { loaded = allowed(url) }
            override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean { loaded = false; (v.parent as? ViewGroup)?.removeView(v); v.destroy(); web = null; return true }
        }
        browser.setDownloadListener { _,_,_,_,_ -> }
    }
    fun connectView(): WebView = view().also { (it.parent as? ViewGroup)?.removeView(it); loaded = false; it.loadUrl(connectionUrl); it.onResume() }
    fun detach() { web?.let { (it.parent as? ViewGroup)?.removeView(it) }; CookieManager.getInstance().flush(); verificationNeeded = false }
    private suspend fun evaluate(browser: WebView, code: String): String? = suspendCancellableCoroutine { next ->
        browser.evaluateJavascript(code) { value -> if (next.isActive) next.resume(value) }
    }
    suspend fun get(url: String): String = read(null, JSONObject().put("operation", "get").put("path", url.removePrefix(ToonkotsuParser.ORIGIN))).getString("body")
    suspend fun image(url: String): JSONObject {
        val ref = ToonkotsuParser.pageRef(url) ?: throw MangaSourceException("Unrecognised Toonkotsu page.")
        connectionUrl = url
        return read(url, JSONObject().put("operation", "image").put("ref", ref.ref).put("chapterId", ref.chapterId).put("page", ref.page))
    }
    private suspend fun read(url: String?, request: JSONObject): JSONObject = lane.withLock {
        if (System.currentTimeMillis() < cooldownUntil) throw MangaSourceException("Toonkotsu is limiting requests. Wait a minute, then retry.")
        withContext(Dispatchers.Main) {
            withTimeoutOrNull(60_000) {
                val browser = view()
                val target = url ?: "${ToonkotsuParser.ORIGIN}/"
                if (!allowed(browser.url.orEmpty()) || (url != null && browser.url != target)) { loaded = false; browser.loadUrl(target) }
                if (withTimeoutOrNull(25_000) { while (!loaded) delay(100) } == null) {
                    verificationNeeded = true
                    throw MangaVerificationRequired("Toonkotsu")
                }
                val key = "__anitrack_" + UUID.randomUUID().toString().replace("-", "")
                val quoted = JSONObject.quote(key)
                val code = program.replace("/*ANITRACK_REQUEST*/", request.toString())
                evaluate(browser, "window[$quoted]=null;($code).then(r=>window[$quoted]=r).catch(()=>window[$quoted]={error:'failed'});void 0")
                try {
                    withTimeoutOrNull(30_000) {
                        var answer: JSONObject? = null
                        while (answer == null) {
                            delay(100)
                            val raw = evaluate(browser, "JSON.stringify(window[$quoted]??null)")
                            val value = raw?.let { runCatching { JSONTokener(it).nextValue() as? String }.getOrNull() }
                            if (value != null && value != "null") {
                                if (value.length > ToonkotsuParser.MAX_BYTES * 1.34 + 1000) throw MangaSourceException("Toonkotsu sent an oversized page.")
                                answer = JSONObject(value)
                            }
                        }
                        val result = answer
                        if (result.optString("error") == "check") { verificationNeeded = true; throw MangaVerificationRequired("Toonkotsu") }
                        if (result.optString("error") == "rate") {
                            val retry = result.optString("retryAfter")
                            val wait = retry.toLongOrNull()?.takeIf { it in 0..86_400 }?.times(1000)
                                ?: runCatching { java.time.ZonedDateTime.parse(retry, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() - System.currentTimeMillis() }.getOrNull()
                            cooldownUntil = System.currentTimeMillis() + (wait ?: 60_000).coerceIn(60_000,86_400_000)
                        }
                        if (result.has("error")) throw MangaSourceException(if (result.optString("error") == "rate") "Toonkotsu is limiting requests. Wait a minute, then retry." else "Toonkotsu could not load this page. Retry or choose another source.")
                        result
                    } ?: throw MangaSourceException("Toonkotsu took too long. Retry or choose another source.")
                } finally { evaluate(browser, "delete window[$quoted]") }
            } ?: throw MangaSourceException("Toonkotsu took too long. Retry or choose another source.")
        }
    }
}
