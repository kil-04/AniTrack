package com.sanjay.anitrack.next.diagnostics

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.sanjay.anitrack.next.data.manga.comix.ComixProtocol
import java.io.ByteArrayInputStream

/**
 * Debug-only: opens the Comix homepage in a brand-new WebView profile (its own
 * `:comixprobe` process and data directory), with the production engine's settings
 * and network policy, so a profile-state failure can be told apart from a
 * WebView-client rejection without touching the real `comix` profile.
 * Logs fixed metadata only: statuses, selected header values, page kind. No cookies or bodies.
 */
class ComixProfileProbeActivity : Activity() {
    private lateinit var web: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            javaScriptCanOpenWindowsAutomatically = false
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.webViewClient = object : WebViewClient() {
            private fun allowed(r: WebResourceRequest) =
                ComixProtocol.allowedWebsiteRequest(r.url.toString(), r.method, r.isForMainFrame, true, false)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = !allowed(request)

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.isForMainFrame) {
                    val names = request.requestHeaders.keys.sorted().joinToString(",")
                    Log.d(TAG, "main-frame request ${request.method} ${request.url.path}; headers=[$names]; allowed=${allowed(request)}")
                }
                return if (allowed(request)) null else WebResourceResponse(ComixProtocol.BLOCKED_MIME, "utf-8", 403, "Blocked",
                    emptyMap(), ByteArrayInputStream(ComixProtocol.BLOCKED_BODY.toByteArray()))
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (!request.isForMainFrame && request.url.path?.startsWith("/api/v1/") != true) return
                val h = response.responseHeaders.orEmpty().mapKeys { it.key.lowercase() }
                Log.d(TAG, "HTTP ${response.statusCode} ${if (request.isForMainFrame) "main-frame" else "api"} ${request.url.path?.take(60)}; " +
                    "server=${h["server"]}; retry-after=${h["retry-after"]}; cf-mitigated=${h["cf-mitigated"]}; " +
                    "type=${response.mimeType}; cf-ray=${if (h.containsKey("cf-ray")) "present" else "absent"}")
            }

            override fun onPageFinished(view: WebView, url: String) {
                val cookieNames = CookieManager.getInstance().getCookie(ComixProtocol.ORIGIN)
                    ?.split(';')?.map { it.substringBefore('=').trim() }?.sorted()?.joinToString(",").orEmpty()
                view.evaluateJavascript("""(() => JSON.stringify({
                    path: location.pathname, title: document.title.slice(0, 80),
                    initialData: !!document.querySelector('script#initial-data'),
                    hostError: /bad gateway|host error|error code 5\d\d/i.test((document.body?.innerText || '').slice(0, 2000)),
                    ua: navigator.userAgent,
                    brands: (navigator.userAgentData?.brands || []).map(b => b.brand + '/' + b.version).join(', '),
                    webdriver: navigator.webdriver === true
                }))()""") { Log.d(TAG, "page finished: $it; cookie-names=[$cookieNames]") }
            }
        }
        Log.d(TAG, "fresh probe profile; process=${android.app.Application.getProcessName()}")
        web.loadUrl("${ComixProtocol.ORIGIN}/")
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    private companion object { const val TAG = "ComixProfileProbe" }
}
