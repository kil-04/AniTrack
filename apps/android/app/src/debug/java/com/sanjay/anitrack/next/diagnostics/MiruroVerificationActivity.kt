package com.sanjay.anitrack.next.diagnostics

import android.annotation.SuppressLint
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroWebSessionTransport
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Message
import android.os.SystemClock
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroHttpTransport
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroProtocol
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroRequestSession
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroTransport
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.util.concurrent.CompletableFuture

/** Test-only, user-operated verification. Not a website-player provider. */
class MiruroVerificationActivity : Activity() {
    private var web: WebView? = null
    private var completed = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (completion == null) { finish(); return }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
            setPadding(16, 24, 16, 16)
        }
        val hint = TextView(this).apply {
            text = "Miruro verification test · www.miruro.ru\n" +
                "Complete any verification yourself. When the home page loads, tap Test native access. " +
                "This is not a video player. Cancel if the site keeps blocking you."
            setTextColor(Color.WHITE)
            textSize = 16f
        }
        layout.addView(hint)
        val buttons = LinearLayout(this)
        val cancel = Button(this).apply { text = "Cancel"; setOnClickListener { finish() } }
        val test = Button(this).apply { text = "Test native access" }
        buttons.addView(cancel, LinearLayout.LayoutParams(0, -2, 1f))
        buttons.addView(test, LinearLayout.LayoutParams(0, -2, 1f))
        layout.addView(buttons)
        setContentView(layout)
        val browser = WebView(this)
        web = browser
        browser.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(true)
            // Use the genuine WebView identity. No fingerprint or client-hint overrides.
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false)
        browser.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
            override fun onCreateWindow(view: WebView, dialog: Boolean, gesture: Boolean, result: Message) = false
        }
        browser.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString().toHttpUrlOrNull() ?: return true
                if (url.scheme != "https" || url.port != 443 || url.username.isNotEmpty() || url.password.isNotEmpty()) return true
                return if (request.isForMainFrame) {
                    url.host != "www.miruro.ru" || (url.encodedPath != "/" && !url.encodedPath.startsWith("/cdn-cgi/"))
                } else url.host !in setOf("www.miruro.ru", "challenges.cloudflare.com")
            }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                (view.parent as? ViewGroup)?.removeView(view)
                web = null
                view.destroy()
                finish()
                return true
            }
            // Default SSL-error cancellation is retained. No JS injection or response interception.
        }
        layout.addView(browser, LinearLayout.LayoutParams(-1, 0, 1f))
        test.setOnClickListener {
            mediaUserAgent = browser.settings.userAgentString
            // Explicit user action is the only trigger. A page load or cookie presence
            // is not proof of verification, and never starts an automatic native retry.
            if (inPageRequests) {
                completed = true
                test.isEnabled = false
                hint.text = "Checking native catalogue data inside this verified session. " +
                    "Please leave this page open; Cancel stops the test."
                completion?.complete(MiruroWebSessionTransport(browser) { web === browser && !isFinishing })
                return@setOnClickListener
            }
            val userAgent = browser.settings.userAgentString
            val manager = CookieManager.getInstance()
            val cookieByPath = listOf("/api/secure/pipe", "/env2.js").associateWith {
                manager.getCookie(MiruroProtocol.ORIGIN + it)
            }
            val expiresAt = SystemClock.elapsedRealtime() + 120_000
            val transport = MiruroHttpTransport { url ->
                check(SystemClock.elapsedRealtime() < expiresAt) { "Verification test session expired" }
                MiruroRequestSession(userAgent, cookieByPath[url.toHttpUrlOrNull()?.encodedPath])
            }
            completed = true
            completion?.complete(transport)
            finish()
        }
        browser.loadUrl(MiruroProtocol.ORIGIN + "/")
    }

    override fun onResume() { super.onResume(); web?.onResume() }
    override fun onPause() { web?.onPause(); super.onPause() }
    override fun onDestroy() {
        if (!completed) completion?.complete(null)
        web?.let {
            it.stopLoading()
            (it.parent as? ViewGroup)?.removeView(it)
            it.destroy()
        }
        web = null
        super.onDestroy()
    }

    companion object {
        @Volatile internal var completion: CompletableFuture<MiruroTransport?>? = null
        @Volatile internal var inPageRequests = false
        @Volatile internal var mediaUserAgent = "AniTrack"
    }
}
