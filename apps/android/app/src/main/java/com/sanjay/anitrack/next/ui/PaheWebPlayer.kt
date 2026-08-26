package com.sanjay.anitrack.next.ui

import android.annotation.SuppressLint
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import java.io.ByteArrayInputStream
import java.util.ArrayDeque

/**
 * Controller for AnimePahe's WebView + hls.js backend. The WebView is kept
 * alive while episodes change; only hls.js is reloaded. Recreating Samsung's
 * renderer and hardware decoder for every episode caused the previous blank
 * screen/render-process crashes.
 */
class WebController {
    private data class Source(
        val url: String,
        val referer: String,
        val userAgent: String,
        val startMs: Long,
        val playWhenReady: Boolean,
        val reloadToken: Int,
    )

    var webView: WebView? = null
        private set
    var bridge: Any? = null
        private set

    val positionMs = mutableStateOf(0L)
    val durationMs = mutableStateOf(0L)
    val bufferedMs = mutableStateOf(0L)
    val paused = mutableStateOf(true)
    val error = mutableStateOf<String?>(null)
    internal val renderGeneration = mutableStateOf(0)

    @Volatile private var source: Source? = null
    private var loadedSource: Source? = null
    private var pageReady = false
    private val rendererCrashes = ArrayDeque<Long>()

    private fun js(code: String) {
        webView?.post { webView?.evaluateJavascript(code, null) }
    }

    fun play() = js("play();")
    fun pause() = js("pause();")
    fun seekTo(ms: Long) {
        positionMs.value = ms
        js("seek(${ms / 1000.0});")
    }
    fun setRate(rate: Float) = js("rate($rate);")
    fun setVolume(volume: Float) = js("vol($volume);")

    internal fun bindSource(
        url: String,
        referer: String,
        userAgent: String,
        startMs: Long,
        playWhenReady: Boolean,
        reloadToken: Int,
    ) {
        val next = Source(url, referer, userAgent, startMs, playWhenReady, reloadToken)
        val previous = source
        if (previous == next) return
        val wasError = error.value != null
        source = next
        if (previous?.url != next.url || (wasError && previous.reloadToken != next.reloadToken)) {
            rendererCrashes.clear()
        }
        error.value = null
        positionMs.value = startMs
        durationMs.value = 0L
        bufferedMs.value = 0L
        paused.value = true
        webView?.post { loadIfReady() }
    }

    internal fun credentials(): Pair<String, String>? =
        source?.let { it.referer to it.userAgent }

    internal fun attach(view: WebView, strongBridge: Any) {
        webView = view
        bridge = strongBridge
        pageReady = false
        loadedSource = null
    }

    internal fun detach(view: WebView) {
        if (webView === view) {
            webView = null
            bridge = null
            pageReady = false
            loadedSource = null
        }
    }

    internal fun onPageReady(view: WebView, url: String?) {
        if (webView !== view || url == "about:blank") return
        pageReady = true
        loadIfReady()
    }

    private fun loadIfReady() {
        val view = webView ?: return
        val next = source ?: return
        if (!pageReady || loadedSource == next || error.value != null) return
        loadedSource = next
        view.settings.userAgentString = next.userAgent
        val quotedUrl = org.json.JSONObject.quote(next.url)
        val startSeconds = next.startMs / 1000.0
        val shouldPlay = next.playWhenReady
        // The page's load() creates hls.js synchronously. Start at zero so the
        // first TS fragment supplies PAT/PMT + codec initialization, then apply
        // resume only after that fragment reaches MSE (FRAG_BUFFERED/canplay).
        view.evaluateJavascript(
            "if(window.MediaSource&&!MediaSource.prototype.__anitrackCodecShim){" +
                "var origAddSourceBuffer=MediaSource.prototype.addSourceBuffer;" +
                "MediaSource.prototype.addSourceBuffer=function(mime){" +
                "return origAddSourceBuffer.call(this,mime.replace(/mp4a\\.40\\.1\\b/g,'mp4a.40.2'));};" +
                "MediaSource.prototype.__anitrackCodecShim=true;}" +
                // Samsung WebView decodes AnimePahe H.264 frames but presents
                // its accelerated <video> layer as black inside a Compose
                // AndroidView. A software-backed canvas (willReadFrequently)
                // is the reliable compositor; cap it at 1280x720 so drawing
                // one frame does not create 1080p-sized transient buffers.
                "if(!window.__anitrackCanvasStarted){window.__anitrackCanvasStarted=true;" +
                "var canvas=document.createElement('canvas');canvas.id='anitrack-video-canvas';" +
                "canvas.style.cssText='position:fixed;inset:0;width:100%;height:100%;object-fit:contain;" +
                "z-index:2147483647;background:#000;pointer-events:none;display:block';" +
                "document.body.appendChild(canvas);" +
                "var canvasContext=canvas.getContext('2d',{alpha:false,willReadFrequently:true});" +
                "var resizeCanvas=function(){var w=v.videoWidth||1280,h=v.videoHeight||720;" +
                "var scale=Math.min(1,1280/w,720/h);canvas.width=Math.max(2,Math.round(w*scale));" +
                "canvas.height=Math.max(2,Math.round(h*scale));};" +
                "v.addEventListener('loadedmetadata',resizeCanvas);resizeCanvas();" +
                "v.style.cssText='position:fixed;left:-2px;top:-2px;width:1px;height:1px;" +
                "opacity:0.01;z-index:-2147483647';" +
                "var drawFrame=function(){try{if(v.readyState>=2)canvasContext.drawImage(v,0,0,canvas.width,canvas.height);}catch(e){}" +
                "if(v.requestVideoFrameCallback)v.requestVideoFrameCallback(drawFrame);" +
                "else setTimeout(drawFrame,42);};drawFrame();}" +
                "if(window.Hls&&Hls.DefaultConfig){" +
                "Hls.DefaultConfig.enableWorker=false;" +
                "Hls.DefaultConfig.preferManagedMediaSource=false;" +
                "Hls.DefaultConfig.backBufferLength=12;" +
                "Hls.DefaultConfig.maxBufferLength=20;" +
                "Hls.DefaultConfig.maxMaxBufferLength=30;" +
                "Hls.DefaultConfig.maxBufferSize=20971520;" +
                "Hls.DefaultConfig.maxBufferHole=0.5;" +
                "Hls.DefaultConfig.highBufferWatchdogPeriod=1;" +
                "Hls.DefaultConfig.nudgeOffset=0.2;" +
                "Hls.DefaultConfig.nudgeMaxRetry=10;" +
                "Hls.DefaultConfig.maxFragLookUpTolerance=0.25;}" +
                "load($quotedUrl,0,$shouldPlay);" +
                "if(window.hls){hls.config.maxBufferLength=20;" +
                "hls.config.maxMaxBufferLength=30;hls.config.backBufferLength=12;" +
                "hls.config.maxBufferSize=20971520;hls.config.maxBufferHole=0.5;" +
                "hls.config.highBufferWatchdogPeriod=1;hls.config.nudgeOffset=0.2;" +
                "hls.config.nudgeMaxRetry=10;hls.config.maxFragLookUpTolerance=0.25;}" +
                "(function(t){if(!(t>0))return;var done=false;" +
                "var apply=function(){if(done)return;done=true;" +
                "try{if(window.hls&&window.Hls)hls.off(Hls.Events.FRAG_BUFFERED,apply);}catch(e){}" +
                "try{v.currentTime=t;if($shouldPlay)v.play().catch(function(){});else v.pause();}catch(e){}};" +
                "try{if(window.hls&&window.Hls)hls.on(Hls.Events.FRAG_BUFFERED,apply);" +
                "v.addEventListener('canplay',apply,{once:true});}catch(e){apply();}})($startSeconds);",
            null,
        )
    }

    internal fun onState(pos: Double, dur: Double, isPaused: Int, buffered: Double) {
        positionMs.value = (pos * 1000).toLong()
        durationMs.value = (dur * 1000).toLong()
        bufferedMs.value = (buffered * 1000).toLong()
        paused.value = isPaused == 1
    }

    internal fun onJsError(message: String) {
        error.value = when {
            message.contains("network", ignoreCase = true) -> "AnimePahe stream connection failed. Tap Retry."
            message.contains("media", ignoreCase = true) -> "AnimePahe video could not be decoded. Tap Retry."
            else -> "AnimePahe playback failed. Tap Retry."
        }
    }

    /** Samsung may terminate an overloaded WebView renderer. Recover twice in
     * place at the current position, then show a normal Retry action. */
    internal fun onRenderProcessGone(view: WebView, didCrash: Boolean): Boolean {
        if (webView !== view) return true
        val now = System.currentTimeMillis()
        while (rendererCrashes.isNotEmpty() && now - rendererCrashes.peekFirst()!! > 60_000) {
            rendererCrashes.removeFirst()
        }
        rendererCrashes.addLast(now)
        source = source?.copy(startMs = positionMs.value.coerceAtLeast(0L))
        detach(view)
        if (rendererCrashes.size > 2) {
            error.value = if (didCrash) {
                "Video renderer restarted repeatedly. Close other apps, then tap Retry."
            } else {
                "Video renderer stopped. Tap Retry."
            }
        }
        // A gone WebView can never be reused. Remount it even when automatic
        // playback is paused behind the Retry overlay.
        renderGeneration.value += 1
        return true
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun PaheWebVideo(
    controller: WebController,
    url: String,
    referer: String,
    userAgent: String,
    startMs: Long = 0,
    playWhenReady: Boolean = true,
    reloadToken: Int = 0,
    modifier: Modifier = Modifier,
    onEnded: () -> Unit,
) {
    val currentOnEnded = rememberUpdatedState(onEnded)
    val generation = controller.renderGeneration.value
    key(generation) {
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
                        allowFileAccess = false
                        allowContentAccess = false
                        mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                        cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
                    }
                    keepScreenOn = true
                    android.webkit.CookieManager.getInstance().setAcceptCookie(true)
                    android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

                    val strongBridge = object {
                        @JavascriptInterface
                        fun onState(pos: Double, dur: Double, isPaused: Int, buffered: Double) {
                            post { controller.onState(pos, dur, isPaused, buffered) }
                        }

                        @JavascriptInterface
                        fun onEnded() {
                            post { currentOnEnded.value() }
                        }

                        @JavascriptInterface
                        fun onError(message: String) {
                            post { controller.onJsError(message) }
                        }

                    }
                    controller.attach(this, strongBridge)
                    addJavascriptInterface(strongBridge, "Android")
                    webViewClient = object : android.webkit.WebViewClient() {
                        override fun shouldInterceptRequest(
                            view: WebView,
                            request: android.webkit.WebResourceRequest,
                        ): android.webkit.WebResourceResponse? {
                            val requestUrl = request.url.toString()
                            if (requestUrl.endsWith("/hls.min.js")) {
                                return android.webkit.WebResourceResponse(
                                    "application/javascript",
                                    "utf-8",
                                    ctx.assets.open("hls.min.js"),
                                )
                            }
                            if (!requestUrl.startsWith("http") || request.method != "GET") return null
                            val credentials = controller.credentials() ?: return proxyErrorResponse()
                            val fetched = com.sanjay.anitrack.next.data.Downloads.proxyStream(
                                requestUrl,
                                credentials.first,
                                credentials.second,
                                request.requestHeaders,
                            ) ?: return proxyErrorResponse()
                            val contentType = fetched.headers.entries.firstOrNull {
                                it.key.equals("Content-Type", ignoreCase = true)
                            }?.value
                            val mime = contentType?.substringBefore(';')?.trim()
                                ?: if (requestUrl.contains(".m3u8")) {
                                    "application/vnd.apple.mpegurl"
                                } else {
                                    "application/octet-stream"
                                }
                            val headers = fetched.headers.filterKeys {
                                !it.equals("Content-Encoding", ignoreCase = true) &&
                                    !it.equals("Content-Length", ignoreCase = true) &&
                                    !it.equals("Transfer-Encoding", ignoreCase = true) &&
                                    !it.startsWith("Access-Control-", ignoreCase = true)
                            }.toMutableMap().apply {
                                put("Access-Control-Allow-Origin", "*")
                                put("Access-Control-Allow-Headers", "*")
                                put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
                                put("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges")
                            }
                            val status = if (fetched.status in 200..299 || fetched.status in 400..599) {
                                fetched.status
                            } else {
                                fetched.body.close()
                                return proxyErrorResponse()
                            }
                            return android.webkit.WebResourceResponse(
                                mime,
                                null,
                                status,
                                fetched.reason.ifBlank { if (status < 400) "OK" else "Stream Error" },
                                headers,
                                fetched.body,
                            )
                        }

                        override fun onReceivedSslError(
                            view: WebView,
                            handler: android.webkit.SslErrorHandler,
                            sslError: android.net.http.SslError,
                        ) {
                            handler.cancel()
                            post { controller.onJsError("secure connection") }
                        }

                        override fun onPageFinished(view: WebView, url: String?) {
                            controller.onPageReady(view, url)
                        }

                        override fun onRenderProcessGone(
                            view: WebView,
                            detail: android.webkit.RenderProcessGoneDetail,
                        ): Boolean = controller.onRenderProcessGone(view, detail.didCrash())
                    }

                    val base = referer.trimEnd('/') + "/"
                    val html = ctx.assets.open("pahe_player.html").bufferedReader().use { it.readText() }
                    loadDataWithBaseURL(base, html, "text/html", "utf-8", null)
                }
            },
            update = {
                controller.bindSource(url, referer, userAgent, startMs, playWhenReady, reloadToken)
            },
            onRelease = { view ->
                controller.detach(view)
                runCatching {
                    view.evaluateJavascript(
                        "try{if(window.hls){hls.destroy();hls=null;}v.pause();" +
                            "v.removeAttribute('src');v.load();}catch(e){}",
                        null,
                    )
                }
                runCatching { view.stopLoading() }
                runCatching { view.removeJavascriptInterface("Android") }
                runCatching { view.destroy() }
            },
        )
    }
}

private fun proxyErrorResponse(): android.webkit.WebResourceResponse =
    android.webkit.WebResourceResponse(
        "text/plain",
        "utf-8",
        502,
        "Stream Proxy Error",
        mapOf("Access-Control-Allow-Origin" to "*"),
        ByteArrayInputStream("stream proxy unavailable".toByteArray()),
    )
