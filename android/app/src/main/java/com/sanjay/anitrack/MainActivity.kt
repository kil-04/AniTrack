package com.sanjay.anitrack

import android.annotation.SuppressLint
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.webkit.*
import com.getcapacitor.BridgeActivity
import com.sanjay.anitrack.plugins.AniTrackDbPlugin
import com.sanjay.anitrack.plugins.AniTrackMalPlugin
import com.sanjay.anitrack.plugins.AniTrackPahePlugin
import com.sanjay.anitrack.plugins.AniTrackSettingsPlugin
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

class MainActivity : BridgeActivity() {

    private lateinit var malPlugin: AniTrackMalPlugin

    // Native ExoPlayer used ONLY for Picture-in-Picture. The WebView's HTML5 <video>
    // is drawn on a SurfaceView hole-punch that Android does not composite into the PiP
    // window (black frame). So on PiP we pause the WebView video and play the same HLS
    // stream in a native ExoPlayer overlay (a real view that DOES render in PiP), then
    // hand the position back to the WebView when PiP ends.
    private var exoPlayer: androidx.media3.exoplayer.ExoPlayer? = null
    private var exoView: android.view.View? = null
    private var pipReceiver: android.content.BroadcastReceiver? = null
    private val PIP_ACTION = "com.sanjay.anitrack.PIP_CONTROL"

    // Shared OkHttp client for HLS proxy — reuses connections for segment fetching.
    private val hlsClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .followRedirects(true)
            .build()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        // Register all custom plugins BEFORE super.onCreate
        registerPlugin(AniTrackDbPlugin::class.java)
        registerPlugin(AniTrackSettingsPlugin::class.java)
        registerPlugin(AniTrackPahePlugin::class.java)
        registerPlugin(AniTrackMalPlugin::class.java)

        super.onCreate(savedInstanceState)

        // Allow scripted play()/resume without a user gesture (needed so playback
        // auto-resumes when returning from PiP, where there's no fresh user activation).
        bridge.webView.settings.mediaPlaybackRequiresUserGesture = false

        // Wrap Capacitor's WebViewClient to inject CORS + Referer headers on kwik/HLS requests.
        // This mirrors what Electron does with onBeforeSendHeaders / onHeadersReceived.
        val capacitorClient = bridge.webView.webViewClient
        bridge.webView.webViewClient = object : WebViewClient() {

            // ── Delegate everything Capacitor needs ──────────────────────────────

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) =
                capacitorClient.shouldOverrideUrlLoading(view, request)

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) =
                capacitorClient.onPageStarted(view, url, favicon)

            override fun onPageFinished(view: WebView, url: String) =
                capacitorClient.onPageFinished(view, url)

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) =
                capacitorClient.onReceivedError(view, request, error)

            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) =
                capacitorClient.onReceivedSslError(view, handler, error)

            // ── HLS/kwik proxy ───────────────────────────────────────────────────

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                // Always let Capacitor handle its own asset requests first (localhost/capacitor protocol)
                val capacitorResponse = capacitorClient.shouldInterceptRequest(view, request)
                if (capacitorResponse != null) return capacitorResponse

                val url = request.url.toString()
                val host = request.url.host ?: ""

                // Only intercept kwik CDN and HLS manifest/segment requests.
                // Added owocdn.top and other patterns used by AnimePahe CDNs.
                val isHlsRequest = url.contains(".m3u8") || url.contains(".ts")
                val isCdnDomain = host.contains("kwik") || host.contains("cdnfile") ||
                                  host.contains("owocdn.top") || host.contains("animepahe")
                if (!isHlsRequest && !isCdnDomain) return null

                // Use the dynamically-tracked kwik origin (kwik.cx, kwik.si, etc.)
                // so the CDN Referer check matches the actual embed domain.
                val referer = if (host.contains("animepahe")) "https://animepahe.pw/"
                              else "${AniTrackPahePlugin.lastKwikOrigin}/"

                return try {
                    val cookies  = CookieManager.getInstance().getCookie(url) ?: ""
                    val rangeHdr = request.requestHeaders["Range"]
                    val nativeReq = Request.Builder()
                        .url(url)
                        .header("Referer",    referer)
                        .header("Origin",     referer.trimEnd('/'))
                        .header("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36")
                        .apply { if (cookies.isNotEmpty())  header("Cookie", cookies) }
                        .apply { if (rangeHdr != null)      header("Range",  rangeHdr) }
                        .build()

                    val resp = hlsClient.newCall(nativeReq).execute()
                    val contentType = resp.header("Content-Type") ?: "application/octet-stream"
                    val mime = contentType.substringBefore(";").trim()

                    // Inject CORS headers so hls.js (XHR inside WebView) can read the response
                    val headers = mapOf(
                        "Access-Control-Allow-Origin"  to "*",
                        "Access-Control-Allow-Headers" to "*",
                        "Access-Control-Allow-Methods" to "GET, HEAD, OPTIONS"
                    )
                    WebResourceResponse(mime, "UTF-8", resp.code, "OK", headers, resp.body?.byteStream())
                } catch (_: Exception) {
                    null // fall back to normal WebView request on any error
                }
            }
        }

        // Hold a reference to MalPlugin to forward OAuth deep-link callbacks
        malPlugin = bridge.getPlugin("AniTrackMal").instance as AniTrackMalPlugin

        // Handle cold-start deep link (app opened via anitrack:// while not running)
        intent?.data?.let { handleDeepLink(it) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let { handleDeepLink(it) }
    }

    // ── Picture-in-Picture (native ExoPlayer) ────────────────────────────────
    // The WebView's HTML5 <video> renders on a SurfaceView hole-punch that Android
    // does not composite into the PiP window (black frame). So for PiP we pause the
    // WebView video and play the same HLS stream in a native ExoPlayer overlay, which
    // renders correctly in PiP, then hand the position back to the WebView on exit.
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    fun startNativePip(url: String, referer: String?, positionSec: Double) {
        runOnUiThread {
            try {
                // Pause the WebView video so we don't get double audio.
                bridge.webView.evaluateJavascript(
                    "(function(){var v=document.querySelector('video');if(v){try{v.pause()}catch(e){}}})();", null
                )

                tearDownExo(syncBack = false)

                // AnimePahe CDNs (owocdn/kwik) enforce a Referer hotlink check. The
                // renderer only passes a referer for Anikoto, so for AnimePahe fall back
                // to the kwik origin the WebView proxy uses, else the CDN returns 403.
                val ref = when {
                    !referer.isNullOrEmpty() -> referer.trimEnd('/')
                    url.contains("animepahe") -> "https://animepahe.pw"
                    else -> AniTrackPahePlugin.lastKwikOrigin.trimEnd('/')
                }
                val cookie = try { CookieManager.getInstance().getCookie(url) } catch (_: Exception) { null }
                val headers = HashMap<String, String>()
                if (ref.isNotEmpty()) { headers["Referer"] = "$ref/"; headers["Origin"] = ref }
                if (!cookie.isNullOrEmpty()) headers["Cookie"] = cookie

                val httpFactory = androidx.media3.datasource.DefaultHttpDataSource.Factory()
                    .setUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36")
                    .setAllowCrossProtocolRedirects(true)
                    .setDefaultRequestProperties(headers)

                val player = androidx.media3.exoplayer.ExoPlayer.Builder(this)
                    .setMediaSourceFactory(androidx.media3.exoplayer.hls.HlsMediaSource.Factory(httpFactory))
                    .build()
                player.addListener(object : androidx.media3.common.Player.Listener {
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        Log.e("AniTrackPip", "ExoPlayer error: ${error.errorCodeName} - ${error.message}")
                    }
                    override fun onIsPlayingChanged(isPlaying: Boolean) {
                        // Refresh the PiP play/pause button icon when state changes.
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode) {
                            setPictureInPictureParams(buildPipParams())
                        }
                    }
                })

                // TextureView (NOT a PlayerView/SurfaceView) so the native video composites
                // ON TOP of the WebView in the normal view hierarchy — a SurfaceView would
                // render behind the opaque WebView window and show only black.
                val view = android.view.TextureView(this)
                addContentView(
                    view,
                    android.view.ViewGroup.LayoutParams(
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT
                    )
                )
                player.setVideoTextureView(view)

                player.setMediaItem(androidx.media3.common.MediaItem.fromUri(android.net.Uri.parse(url)))
                player.prepare()
                if (positionSec > 0) player.seekTo((positionSec * 1000).toLong())
                player.playWhenReady = true

                exoPlayer = player
                exoView = view

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    registerPipReceiver()
                    enterPictureInPictureMode(buildPipParams())
                }
            } catch (e: Exception) {
                Log.e("AniTrackPip", "startNativePip failed", e)
                tearDownExo(syncBack = false)
            }
        }
    }

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.O)
    private fun pipAction(iconRes: Int, title: String, control: String, reqCode: Int): android.app.RemoteAction {
        val pi = android.app.PendingIntent.getBroadcast(
            this, reqCode,
            Intent(PIP_ACTION).setPackage(packageName).putExtra("control", control),
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        )
        return android.app.RemoteAction(
            android.graphics.drawable.Icon.createWithResource(this, iconRes), title, title, pi
        )
    }

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.O)
    private fun buildPipParams(): android.app.PictureInPictureParams {
        val playing = exoPlayer?.isPlaying ?: false
        val ppIcon = if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val ppTitle = if (playing) "Pause" else "Play"
        return android.app.PictureInPictureParams.Builder()
            .setAspectRatio(android.util.Rational(16, 9))
            .setActions(listOf(
                pipAction(android.R.drawable.ic_media_rew, "Rewind 10s", "rewind", 1),
                pipAction(ppIcon, ppTitle, "playpause", 2),
                pipAction(android.R.drawable.ic_media_ff, "Forward 10s", "forward", 3)
            ))
            .build()
    }

    private fun registerPipReceiver() {
        if (pipReceiver != null) return
        val r = object : android.content.BroadcastReceiver() {
            override fun onReceive(c: android.content.Context?, i: Intent?) {
                val p = exoPlayer ?: return
                when (i?.getStringExtra("control")) {
                    "playpause" -> p.playWhenReady = !p.playWhenReady
                    "rewind" -> p.seekTo(maxOf(0L, p.currentPosition - 10_000))
                    "forward" -> p.seekTo(p.currentPosition + 10_000)
                }
            }
        }
        val filter = android.content.IntentFilter(PIP_ACTION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(r, filter, android.content.Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(r, filter)
        }
        pipReceiver = r
    }

    private fun tearDownExo(syncBack: Boolean) {
        val player = exoPlayer ?: return
        val posSec = player.currentPosition / 1000.0
        try { player.release() } catch (_: Exception) {}
        exoView?.let { v -> (v.parent as? android.view.ViewGroup)?.removeView(v) }
        pipReceiver?.let { try { unregisterReceiver(it) } catch (_: Exception) {} }
        pipReceiver = null
        exoPlayer = null
        exoView = null
        if (syncBack) resumeWebViewVideo(posSec)
    }

    // Returning from PiP: resume the WebView and let the renderer rebuild the player
    // (the WebView's MediaSource is destroyed while suspended in PiP).
    private fun resumeWebViewVideo(posSec: Double) {
        bridge.webView.onResume()
        bridge.webView.resumeTimers()
        val js = "window.__anitrackPipResume && window.__anitrackPipResume($posSec);"
        bridge.webView.postDelayed({ bridge.webView.evaluateJavascript(js, null) }, 300)
        bridge.webView.postDelayed({ bridge.webView.evaluateJavascript(js, null) }, 1000)
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        // Expanded back from PiP → rebuild the WebView player at the ExoPlayer position.
        if (!isInPictureInPictureMode && exoPlayer != null) tearDownExo(syncBack = true)
    }

    override fun onStop() {
        super.onStop()
        // PiP window dismissed / app fully backgrounded → release the native player.
        val inPip = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode
        if (exoPlayer != null && !inPip) tearDownExo(syncBack = false)
    }

    private fun handleDeepLink(uri: Uri) {
        if (uri.scheme == "anitrack" && uri.host == "mal-callback") {
            val code = uri.getQueryParameter("code") ?: return
            malPlugin.handleCallback(code)
        }
        // anitrack://anilist-callback token fragment is handled by the JS shim
    }
}
