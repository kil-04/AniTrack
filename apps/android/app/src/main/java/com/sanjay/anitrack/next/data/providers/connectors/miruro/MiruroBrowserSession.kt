package com.sanjay.anitrack.next.data.providers.connectors.miruro

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.os.Message
import android.view.ViewGroup
import android.webkit.*
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.sanjay.anitrack.next.data.providers.ProviderAccess
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject

/** Activity-owned ordinary homepage session; never loads player/advertising embeds. */
internal class MiruroBrowserSession : ProviderAccess {
    private var owner: Activity? = null
    private var foreground = false
    private var web: WebView? = null
    private var dialog: Dialog? = null
    private var pending: CompletableDeferred<Boolean>? = null
    private val session = MiruroSession()
    override val state = session.state
    val userAgent get() = session.userAgent

    fun attach(activity: Activity) {
        if (owner === activity) return
        disconnect()
        owner = activity
        // Retire only the old app-imposed timer; keep all other app/session data intact.
        activity.applicationContext.getSharedPreferences("miruro_session_policy", 0)
            .edit().remove("cooldown_until").apply()
    }

    fun foreground(activity: Activity, active: Boolean) {
        if (owner !== activity) return
        foreground = active
        if (active) web?.onResume() else web?.onPause()
    }

    fun detach(activity: Activity) {
        if (owner !== activity) return
        disconnect()
        owner = null
        foreground = false
    }

    override fun disconnect() {
        session.clear()
        pending?.complete(false)
        pending = null
        destroyPage()
    }

    override fun playbackRejected(status: Int) {
        // A media/subtitle host rejection is not proof the catalogue session failed.
        session.playbackRejected(status)
    }

    override suspend fun connect(): Boolean = withContext(Dispatchers.Main) {
        if (pending != null) return@withContext false
        val activity = owner?.takeIf { !it.isFinishing && !it.isDestroyed && foreground }
            ?: throw MiruroProtocolException("Return to AniTrack to connect to Miruro.")
        session.begin()
        destroyPage()
        val completion = CompletableDeferred<Boolean>()
        pending = completion
        try {
            showVerification(activity, completion)
            withTimeoutOrNull(180_000) { completion.await() } ?: false
        } finally {
            if (pending === completion) pending = null
            if (!state.value.ready) {
                session.clear("Verification closed. Connect again when ready.")
                destroyPage()
            }
        }
    }

    suspend fun read(request: MiruroReadRequest): JSONObject = withContext(Dispatchers.Main) {
        if (!foreground) throw MiruroProtocolException("Return to AniTrack to load Miruro episodes.")
        try { session.read(request) }
        finally { if (!state.value.ready) destroyPage() }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showVerification(activity: Activity, completion: CompletableDeferred<Boolean>) {
        val panel = Dialog(activity)
        dialog = panel
        val layout = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK) }
        layout.addView(TextView(activity).apply {
            text = "Connect Miruro · www.miruro.ru\nComplete any verification yourself. Once the homepage loads, continue to AniTrack. Video plays in AniTrack, not here."
            setTextColor(Color.WHITE); textSize = 16f; setPadding(24, 24, 24, 12)
        })
        val browser = WebView(activity)
        web = browser
        browser.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true
            allowFileAccess = false; allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            javaScriptCanOpenWindowsAutomatically = false; setSupportMultipleWindows(true)
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
                return if (request.isForMainFrame) url.host != "www.miruro.ru" ||
                    (url.encodedPath != "/" && !url.encodedPath.startsWith("/cdn-cgi/"))
                else url.host !in setOf("www.miruro.ru", "challenges.cloudflare.com")
            }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                disconnect()
                return true
            }
        }
        val buttons = LinearLayout(activity)
        buttons.addView(Button(activity).apply { text = "Cancel"; setOnClickListener { disconnect() } }, LinearLayout.LayoutParams(0, -2, 1f))
        buttons.addView(Button(activity).apply {
            text = "Continue to AniTrack"
            setOnClickListener {
                if (pending !== completion || web !== browser) return@setOnClickListener
                session.accept(MiruroWebSessionTransport(browser) { web === browser && owner === activity && !activity.isDestroyed }, browser.settings.userAgentString)
                panel.hide() // Retain this app-owned session across routes; never export cookies.
                completion.complete(true)
            }
        }, LinearLayout.LayoutParams(0, -2, 1f))
        layout.addView(buttons)
        layout.addView(browser, LinearLayout.LayoutParams(-1, 0, 1f))
        panel.setContentView(layout)
        panel.setOnCancelListener { disconnect() }
        panel.show()
        panel.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        browser.loadUrl(MiruroProtocol.ORIGIN + "/")
    }

    private fun destroyPage() {
        val old = web
        web = null
        old?.stopLoading()
        (old?.parent as? ViewGroup)?.removeView(old)
        old?.destroy()
        dialog?.setOnCancelListener(null)
        dialog?.dismiss()
        dialog = null
    }
}
