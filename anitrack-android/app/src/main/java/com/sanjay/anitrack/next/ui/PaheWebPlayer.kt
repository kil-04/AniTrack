package com.sanjay.anitrack.next.ui

import android.annotation.SuppressLint
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
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
    val ended = mutableStateOf(false)
    val error = mutableStateOf<String?>(null)

    private fun js(code: String) { webView?.post { webView?.evaluateJavascript(code, null) } }

    fun load(url: String, startSec: Double = 0.0) {
        ended.value = false; error.value = null
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
    modifier: Modifier = Modifier,
    onEnded: () -> Unit,
) {
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
                    mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
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
                    fun onEnded() { controller.ended.value = true; post { onEnded() } }
                    @JavascriptInterface
                    fun onError(msg: String) { controller.error.value = msg }
                }
                controller.bridge = bridge
                addJavascriptInterface(bridge, "Android")
                webViewClient = object : android.webkit.WebViewClient() {
                    // Serve hls.js from assets (correct MIME) — a relative
                    // <script src> resolves to the kwik baseURL and 404s.
                    override fun shouldInterceptRequest(
                        view: WebView, request: android.webkit.WebResourceRequest,
                    ): android.webkit.WebResourceResponse? {
                        if (request.url.toString().endsWith("/hls.min.js")) {
                            return android.webkit.WebResourceResponse(
                                "application/javascript", "utf-8", ctx.assets.open("hls.min.js"),
                            )
                        }
                        return null
                    }
                    // The kwik CDN serves an incomplete cert chain the WebView
                    // can't validate (net_error -202); the full-browser apps
                    // tolerate it. Proceed so segments load.
                    override fun onReceivedSslError(
                        view: WebView, handler: android.webkit.SslErrorHandler, error: android.net.http.SslError,
                    ) { handler.proceed() }
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
