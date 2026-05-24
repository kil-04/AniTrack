package com.sanjay.anitrack

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
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

    private fun handleDeepLink(uri: Uri) {
        if (uri.scheme == "anitrack" && uri.host == "mal-callback") {
            val code = uri.getQueryParameter("code") ?: return
            malPlugin.handleCallback(code)
        }
        // anitrack://anilist-callback token fragment is handled by the JS shim
    }
}
