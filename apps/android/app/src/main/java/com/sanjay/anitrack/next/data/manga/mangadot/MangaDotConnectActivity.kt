package com.sanjay.anitrack.next.data.manga.mangadot

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Message
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * User-operated MangaDot connection: shows mangadot.net in a normal WebView so
 * the user can pass Cloudflare's check themselves (it usually passes on its
 * own). AniTrack never clicks or solves it. Closes with RESULT_OK once the API
 * answers with this session. No JavaScript bridge, file access, popups,
 * permissions or third-party requests (other than Cloudflare's check) are allowed.
 */
class MangaDotConnectActivity : Activity() {
    private val scope = MainScope()
    private var web: WebView? = null
    private var checking = false
    private var connected = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
        }
        val header = LinearLayout(this).apply {
            setPadding(32, 20, 24, 12)
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        header.addView(
            TextView(this).apply {
                text = "Connecting MangaDot. If a “Verify you are human” box appears, tick it. " +
                    "This screen closes by itself once MangaDot opens."
                setTextColor(Color.WHITE)
                textSize = 15f
            },
            LinearLayout.LayoutParams(0, -2, 1f),
        )
        header.addView(Button(this).apply {
            text = "Cancel"
            setOnClickListener { finish() }
        })
        root.addView(header)
        val browser = WebView(this)
        web = browser
        root.addView(browser, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)

        browser.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(true)
            // Genuine WebView identity: the API later presents this same user agent.
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false)
        browser.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) = request.deny()
            override fun onCreateWindow(view: WebView, dialog: Boolean, gesture: Boolean, result: Message) = false
        }
        browser.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !(request.url.scheme == "https" && allowed(request.url.host))

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.scheme == "https" && allowed(request.url.host)) return null
                return WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), null)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                val onSite = android.net.Uri.parse(url ?: "").host?.lowercase() == "mangadot.net"
                val challenged = view.title.orEmpty().contains("just a moment", ignoreCase = true)
                if (onSite && !challenged) verify()
            }
        }
        browser.loadUrl("${MangaDotParser.ORIGIN}/")
    }

    /** mangadot.net itself and Cloudflare's check; analytics and ad hosts stay blocked. */
    private fun allowed(host: String?): Boolean {
        val h = host?.lowercase() ?: return false
        return h == "mangadot.net" || h == "challenges.cloudflare.com"
    }

    private fun verify() {
        if (checking || connected) return
        checking = true
        CookieManager.getInstance().flush()
        scope.launch {
            val works = MangaDotSource.sessionWorks()
            checking = false
            if (works && !isFinishing) {
                connected = true
                setResult(RESULT_OK)
                finish()
            }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        web?.apply {
            stopLoading()
            destroy()
        }
        web = null
        super.onDestroy()
    }
}
