package com.sanjay.anitrack.next.diagnostics

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Message
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Debug-only feasibility check for mangadot.net as a manga source: a normal
 * WebView where the user completes any Cloudflare check themselves. Nothing is
 * solved or bypassed automatically, and no AniTrack data is exposed to the page.
 * Remote debugging is enabled (debug builds only) so the page structure can be
 * inspected from a connected computer.
 */
class MangaDotProbeActivity : Activity() {
    private var web: WebView? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(true)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
        }
        layout.addView(TextView(this).apply {
            text = "mangadot.net check (AniTrack test) · If a \"Verify you are human\" box appears, tick it yourself. " +
                "Leave this screen open once the site loads."
            setTextColor(Color.WHITE)
            textSize = 15f
            setPadding(24, 16, 24, 16)
        })
        val browser = WebView(this)
        web = browser
        layout.addView(browser, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(layout)
        browser.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(true)
            // Genuine WebView identity: no user-agent, fingerprint or client-hint overrides.
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false)
        browser.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) = request.deny()
            override fun onCreateWindow(view: WebView, dialog: Boolean, gesture: Boolean, result: Message) = false
        }
        browser.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                val host = url.host?.lowercase() ?: return true
                val allowed = url.scheme == "https" &&
                    (host == "mangadot.net" || host.endsWith(".mangadot.net") || host == "challenges.cloudflare.com")
                return !allowed
            }
        }
        load(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        load(intent)
    }

    /**
     * `--ez native true`: checks whether the JSON API answers a plain HTTP client
     * carrying this WebView's own cookies and user agent (the AnimePahe pattern).
     * Logs only status and content type; never cookies or bodies.
     */
    private fun nativeCheck() {
        val ua = web?.settings?.userAgentString ?: return
        Thread {
            val client = okhttp3.OkHttpClient.Builder().callTimeout(20, java.util.concurrent.TimeUnit.SECONDS).build()
            for (path in listOf("/api/manga/99", "/api/search/suggestions?q=frieren&limit=8")) {
                val url = "https://mangadot.net$path"
                val cookies = CookieManager.getInstance().getCookie(url).orEmpty()
                val names = cookies.split(';').map { it.substringBefore('=').trim() }.filter { it.isNotEmpty() }
                val request = okhttp3.Request.Builder().url(url)
                    .header("User-Agent", ua)
                    .header("Accept", "application/json")
                    .apply { if (cookies.isNotEmpty()) header("Cookie", cookies) }
                    .build()
                val line = runCatching {
                    client.newCall(request).execute().use { r ->
                        "HTTP ${r.code} ${r.header("Content-Type")} cf-mitigated=${r.header("cf-mitigated")}"
                    }
                }.getOrElse { "failed: ${it.javaClass.simpleName}" }
                android.util.Log.i("MangaDotProbe", "native $path -> $line (cookie names: $names)")
            }
        }.start()
    }

    /** Optional `path` extra opens another page of the same site (e.g. a title or chapter). */
    private fun load(intent: Intent?) {
        if (intent?.getBooleanExtra("native", false) == true) {
            nativeCheck()
            return
        }
        if (intent?.getBooleanExtra("forget", false) == true) {
            // `--ez forget true`: drops this debug app's mangadot.net Cloudflare cookie
            // so the first-use "Connect MangaDot" flow can be tested again.
            val cookies = CookieManager.getInstance()
            val expired = "Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure; HttpOnly; SameSite=None"
            for (variant in listOf("Domain=.mangadot.net; $expired", "Domain=.mangadot.net; $expired; Partitioned", expired)) {
                cookies.setCookie("https://mangadot.net", "cf_clearance=; $variant")
            }
            cookies.flush()
            android.util.Log.i("MangaDotProbe", "cleared mangadot.net clearance")
            finish()
            return
        }
        val path = intent?.getStringExtra("path")
            ?.takeIf { it.startsWith("/") && !it.startsWith("//") && it.length <= 300 && it.none { c -> c.isWhitespace() } }
            ?: "/"
        web?.loadUrl("https://mangadot.net$path")
    }

    override fun onDestroy() {
        web?.apply {
            stopLoading()
            destroy()
        }
        web = null
        super.onDestroy()
    }
}
