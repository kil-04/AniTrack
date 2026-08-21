package com.sanjay.anitrack.next.ui

import android.annotation.SuppressLint
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

/**
 * AnimePahe playback via a WebView + hls.js — the only engine that plays kwik's
 * loosely-muxed TS with working seeks (ExoPlayer's native decoder can't resync
 * after a seek; browsers/hls.js drive MSE which tolerates it). This is what the
 * desktop app and the old Capacitor app do. Anikoto/local still use ExoPlayer.
 */
class WebController {
    var webView: WebView? = null
    var bridge: Any? = null   // strong ref so the JS interface isn't GC'd

    // Latest media state, pushed from JS ~every 300ms.
    val positionMs = mutableStateOf(0L)
    val durationMs = mutableStateOf(0L)
    val bufferedMs = mutableStateOf(0L)
    val paused = mutableStateOf(false)
    val error = mutableStateOf<String?>(null)

    private fun js(code: String) { webView?.post { webView?.evaluateJavascript(code, null) } }

    fun load(url: String, startSec: Double = 0.0) {
        error.value = null
        js("load(${quote(url)}, $startSec);")
    }
    fun play() { js("play();") }
    fun pause() { js("pause();") }
    fun seekTo(ms: Long) {
        positionMs.value = ms                     // optimistic — JS confirms next tick
        js("seek(${ms / 1000.0});")
    }
    fun setRate(r: Float) { js("rate($r);") }
    fun setVolume(x: Float) { js("vol($x);") }

    private fun quote(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun PaheWebVideo(
    controller: WebController,
    url: String,
    referer: String,
    userAgent: String,
    startMs: Long = 0,
    modifier: Modifier = Modifier,
    onEnded: () -> Unit,
) {
    fun q(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
    val currentOnEnded = rememberUpdatedState(onEnded)
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            WebView(ctx).apply {
                setBackgroundColor(android.graphics.Color.BLACK)
                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    mediaPlaybackRequiresUserGesture = false
                    userAgentString = userAgent
                    allowFileAccess = true
                    allowContentAccess = true
                    mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                }
                // Persist kwik cookies so hls.js's segment fetches are accepted.
                android.webkit.CookieManager.getInstance().setAcceptCookie(true)
                android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                // Strong ref to the bridge (addJavascriptInterface alone let it
                // GC → "Java object is gone").
                val bridge = object {
                    @JavascriptInterface
                    fun onState(pos: Double, dur: Double, isPaused: Int, buffered: Double) {
                        controller.positionMs.value = (pos * 1000).toLong()
                        controller.durationMs.value = (dur * 1000).toLong()
                        controller.bufferedMs.value = (buffered * 1000).toLong()
                        controller.paused.value = isPaused == 1
                    }
                    @JavascriptInterface
                    fun onEnded() { post { currentOnEnded.value() } }
                    @JavascriptInterface
                    fun onError(msg: String) { controller.error.value = msg }
                }
                controller.bridge = bridge
                addJavascriptInterface(bridge, "Android")
                webChromeClient = object : android.webkit.WebChromeClient() {
                    override fun onConsoleMessage(m: android.webkit.ConsoleMessage): Boolean {
                        android.util.Log.d("PaheWeb", "${m.messageLevel()} ${m.message()}")
                        return true
                    }
                }
                webViewClient = object : android.webkit.WebViewClient() {
                    // ALL stream traffic (m3u8/keys/segments) is proxied through
                    // Cronet with CORS headers injected — the CDN sends none, so
                    // hls.js's cross-origin XHRs (page origin = kwik, segments on
                    // the vault host) would be silently blocked. This mirrors the
                    // desktop app's Electron webRequest CORS injection.
                    override fun shouldInterceptRequest(
                        view: WebView, request: android.webkit.WebResourceRequest,
                    ): android.webkit.WebResourceResponse? {
                        val u = request.url.toString()
                        if (u.endsWith("/hls.min.js")) {
                            return android.webkit.WebResourceResponse(
                                "application/javascript", "utf-8", ctx.assets.open("hls.min.js"),
                            )
                        }
                        if (!u.startsWith("http") || request.method != "GET") return null
                        val f = com.sanjay.anitrack.next.data.Downloads.proxyGet(
                            u, referer, userAgent, request.requestHeaders,
                        ) ?: return null
                        val contentType = f.headers.entries.firstOrNull {
                            it.key.equals("Content-Type", ignoreCase = true)
                        }?.value
                        val mime = contentType?.substringBefore(';')?.trim()
                            ?: if (u.contains(".m3u8")) "application/vnd.apple.mpegurl" else "application/octet-stream"
                        val headers = f.headers.filterKeys {
                            !it.equals("Content-Encoding", ignoreCase = true) &&
                                !it.equals("Content-Length", ignoreCase = true) &&
                                !it.equals("Transfer-Encoding", ignoreCase = true) &&
                                !it.equals("Access-Control-Allow-Origin", ignoreCase = true) &&
                                !it.equals("Access-Control-Allow-Headers", ignoreCase = true) &&
                                !it.equals("Access-Control-Allow-Methods", ignoreCase = true) &&
                                !it.equals("Access-Control-Expose-Headers", ignoreCase = true)
                        }.toMutableMap().apply {
                            put("Content-Length", f.body.size.toString())
                            put("Access-Control-Allow-Origin", "*")
                            put("Access-Control-Allow-Headers", "*")
                            put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
                            put("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
                        }
                        // WebResourceResponse rejects redirects; Cronet follows
                        // them, so a normal final response should be 200..599.
                        val status = if (f.status in 200..299 || f.status in 400..599) f.status else 500
                        return android.webkit.WebResourceResponse(
                            mime, null, status, if (status == 500) "Proxy Error" else f.reason.ifBlank { "OK" }, headers,
                            java.io.ByteArrayInputStream(f.body),
                        )
                    }
                    override fun onReceivedSslError(
                        view: WebView, handler: android.webkit.SslErrorHandler, error: android.net.http.SslError,
                    ) {
                        // Never bypass certificate validation for an arbitrary
                        // host loaded by JavaScript or a compromised playlist.
                        handler.cancel()
                        controller.error.value = "Secure connection failed for ${error.url}"
                    }
                    // Load the stream only once the page's JS (hls.js + load())
                    // is ready — calling load() from the resolve effect fired
                    // before this and silently no-op'd.
                    override fun onPageFinished(view: WebView, u: String?) {
                        view.evaluateJavascript("load(${q(url)}, ${startMs / 1000.0});", null)
                    }
                }
                controller.webView = this
                // Load with the kwik origin as base URL so hls.js's fetches carry
                // the Referer the CDN validates.
                val base = referer.trimEnd('/') + "/"
                val html = ctx.assets.open("pahe_player.html").bufferedReader().use { it.readText() }
                loadDataWithBaseURL(base, html, "text/html", "utf-8", null)
            }
        },
        update = { /* controller.load() is driven from the resolve effect */ },
        onRelease = { wv ->
            // Stop the old instance's JS timer from calling a gone bridge.
            runCatching { wv.loadUrl("about:blank"); wv.removeJavascriptInterface("Android"); wv.destroy() }
            if (controller.webView === wv) { controller.webView = null; controller.bridge = null }
        },
    )
}
