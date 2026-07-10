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
                addJavascriptInterface(object {
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
                }, "Android")
                webViewClient = android.webkit.WebViewClient()
                controller.webView = this
                // Load with the kwik origin as base URL so hls.js requests carry
                // the Referer the CDN validates. hls.js is INLINED — a relative
                // <script src> would resolve to kwik.cx and 404.
                val base = referer.trimEnd('/') + "/"
                val hlsJs = ctx.assets.open("hls.min.js").bufferedReader().use { it.readText() }
                val html = ctx.assets.open("pahe_player.html").bufferedReader().use { it.readText() }
                    .replace("<!--HLS_JS-->", "<script>$hlsJs</script>")
                loadDataWithBaseURL(base, html, "text/html", "utf-8", null)
            }
        },
        update = { /* controller.load() is driven from the resolve effect */ },
    )
}
