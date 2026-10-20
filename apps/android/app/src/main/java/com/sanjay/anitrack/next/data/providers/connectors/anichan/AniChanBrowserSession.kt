package com.sanjay.anitrack.next.data.providers.connectors.anichan

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.os.Message
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import android.widget.Button
import android.widget.LinearLayout
import android.widget.FrameLayout
import android.widget.TextView
import com.sanjay.anitrack.next.BuildConfig
import com.sanjay.anitrack.next.data.providers.ProviderAccess
import com.sanjay.anitrack.next.data.providers.ProviderAccessState
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayInputStream
import java.util.UUID
import kotlin.coroutines.resume

/**
 * User-owned, ordinary watch-page verification, followed by bounded native reads.
 * There is no JavaScript/native bridge, cookie export, embed discovery or automatic check.
 */
internal class AniChanBrowserSession : ProviderAccess {
    private var owner: Activity? = null
    private var foreground = false
    private var web: WebView? = null
    private var dialog: Dialog? = null
    private var retainedHost: FrameLayout? = null
    private var pending: CompletableDeferred<Boolean>? = null
    private var pageLoaded: CompletableDeferred<Unit>? = null
    private var pageTarget: String? = null
    private var source = ""
    private var animeId = 1
    private var rateUntil = 0L
    private val lock = Mutex()
    private val mutableState = MutableStateFlow(ProviderAccessState(message = "Connect AniChan before watching."))
    override val state = mutableState.asStateFlow()
    var userAgent = ""
        private set

    fun prepare(id: Int) { if (id > 0) animeId = id }
    fun attach(activity: Activity) {
        if (owner === activity) return
        disconnect()
        owner = activity
        source = activity.assets.open("anichan_page.js").bufferedReader(Charsets.UTF_8).use { it.readText() }
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
        source = ""
    }

    override fun disconnect() {
        mutableState.value = ProviderAccessState(message = "Connect AniChan before watching.", generation = state.value.generation + 1)
        pending?.complete(false)
        pending = null
        pageLoaded?.cancel()
        pageLoaded = null
        destroyPage()
    }

    override suspend fun connect(): Boolean = withContext(Dispatchers.Main) {
        if (pending != null) return@withContext false
        val activity = owner?.takeIf { !it.isFinishing && !it.isDestroyed && foreground }
            ?: throw AniChanException("Return to AniTrack to connect AniChan.")
        if (System.currentTimeMillis() < rateUntil) throw AniChanException("AniChan is limiting requests. Wait a little, then connect again.")
        destroyPage()
        val completion = CompletableDeferred<Boolean>()
        pending = completion
        mutableState.value = state.value.copy(ready = false, verifying = true, message = "Complete any AniChan check in the connection window.")
        try {
            val browser = showVerification(activity)
            withTimeoutOrNull(180_000) {
                // Clear only AniChan's three expired watch-session keys, never the profile.
                loadPage(browser, "${AniChan.ORIGIN}/")
                read(browser, JSONObject().put("operation", "reset"))
                loadPage(browser, "${AniChan.ORIGIN}/anime/$animeId/watch/1")
                while (!completion.isCompleted) {
                    val result = read(browser, JSONObject().put("operation", "state"))
                    if (result.optString("status") == "ok" && result.optBoolean("ready")) {
                        // Retain the watch document: its route chunk declares this session's protocol.
                        // The page reader pauses/mutes video and foreign media hosts are blocked.
                        retainInForeground(activity, browser)
                        mutableState.value = state.value.copy(ready = true, verifying = false, message = "AniChan connected.", generation = state.value.generation + 1)
                        completion.complete(true)
                    } else delay(1_000)
                }
                completion.await()
            } ?: false
        } finally {
            if (pending === completion) pending = null
            if (!state.value.ready) {
                mutableState.value = state.value.copy(ready = false, verifying = false, message = "Connection closed. Connect AniChan again when ready.")
                destroyPage()
            }
        }
    }

    suspend fun servers(id: Int, episode: Int, category: String, tier: String): JSONObject = withContext(Dispatchers.Main) {
        if (id <= 0 || episode !in 1..AniChan.MAX_EPISODES || category !in setOf("sub", "dub") || tier !in setOf("fast", "rest"))
            throw AniChanException("Invalid AniChan episode.")
        if (!foreground) throw AniChanException("Return to AniTrack to load AniChan.")
        if (System.currentTimeMillis() < rateUntil) throw AniChanException("AniChan is limiting requests. Wait a little, then retry.")
        val browser = web?.takeIf { state.value.ready } ?: throw AniChanException("Connect AniChan before watching.")
        lock.withLock {
            if (web !== browser || !state.value.ready) throw AniChanException("Connect AniChan again before watching.")
            // A preceding queued read may have received 429 while this one waited.
            if (System.currentTimeMillis() < rateUntil) throw AniChanException("AniChan is limiting requests. Wait a little, then retry.")
            debug("read start category=$category tier=$tier")
            val result = try {
                read(browser, JSONObject().put("operation", "servers").put("animeId", id)
                    .put("episode", episode).put("category", category).put("tier", tier))
            } catch (cancelled: CancellationException) {
                // A replaced UI operation is not proof this website session expired.
                // read() aborts only its requestId before releasing this mutex.
                debug("read cancelled type=${cancelled.javaClass.simpleName}")
                throw cancelled
            } catch (failure: AniChanException) {
                // AniChanException carries locally authored messages, never page exception text.
                debug("read failed type=${failure.javaClass.simpleName} reason=${failure.message}")
                throw failure
            } catch (failure: Exception) {
                debug("read failed type=${failure.javaClass.simpleName}")
                throw failure
            }
            debug("read complete status=${result.optString("status")}")
            when (result.optString("status")) {
                "ok" -> result.optJSONObject("data") ?: throw AniChanException("AniChan sent an unreadable server list.")
                "connect" -> {
                    disconnect()
                    throw AniChanException("AniChan needs a fresh connection. Connect again, then retry.")
                }
                "rate-limit" -> {
                    val seconds = AniChanSessionPolicy.retryAfterSeconds(result.opt("retryAfter"))
                    rateUntil = System.currentTimeMillis() + seconds * 1_000
                    throw AniChanException("AniChan is limiting requests. Wait $seconds seconds, then retry.")
                }
                else -> throw AniChanException("AniChan couldn't load this episode. Try again later.")
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showVerification(activity: Activity): WebView {
        val panel = Dialog(activity)
        dialog = panel
        val layout = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK) }
        layout.addView(TextView(activity).apply {
            text = "Connect AniChan · anichan.to\nComplete any website check yourself. AniTrack continues when the page is ready."
            setTextColor(Color.WHITE); textSize = 16f; setPadding(24, 24, 24, 12)
        })
        layout.addView(Button(activity).apply { text = "Cancel"; setOnClickListener { disconnect() } })
        val browser = WebView(activity)
        web = browser
        browser.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true
            allowFileAccess = false; allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true; mediaPlaybackRequiresUserGesture = true
            javaScriptCanOpenWindowsAutomatically = false; setSupportMultipleWindows(true)
        }
        userAgent = browser.settings.userAgentString
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false)
        browser.setDownloadListener { _, _, _, _, _ -> }
        browser.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) { callback.invoke(origin, false, false) }
            override fun onCreateWindow(view: WebView, dialog: Boolean, gesture: Boolean, result: Message) = false
            override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean { result.cancel(); return true }
            override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean { result.cancel(); return true }
            override fun onShowFileChooser(view: WebView, result: ValueCallback<Array<android.net.Uri>>, params: FileChooserParams): Boolean { result.onReceiveValue(null); return true }
        }
        browser.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = !allowed(request.url.toString(), request.isForMainFrame)
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                if (allowed(request.url.toString(), request.isForMainFrame)) null
                else WebResourceResponse("text/plain", "UTF-8", 204, "No Content", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            override fun onPageFinished(view: WebView, url: String) {
                if (web === view && pageTarget?.let { AniChanPagePolicy.loaded(url, it, animeId) } == true) pageLoaded?.complete(Unit)
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) { handler.cancel() }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean { disconnect(); return true }
        }
        layout.addView(browser, LinearLayout.LayoutParams(-1, 0, 1f))
        panel.setContentView(layout)
        panel.setOnCancelListener { disconnect() }
        panel.show()
        panel.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        return browser
    }

    private fun allowed(raw: String, main: Boolean): Boolean {
        return AniChanPagePolicy.allowed(raw, main, animeId)
    }

    /**
     * Hiding a Dialog marks its WebView document hidden and eventually suspends
     * even fetch/abort timers. As with ComixCatalogueActivity, retain the ordinary
     * visible WebView under opaque native content in the real foreground window.
     * The website never receives touches/focus and its content cannot show through
     * transparent native-player surfaces. The source's media hosts stay blocked.
     */
    private fun retainInForeground(activity: Activity, browser: WebView) {
        val root = activity.findViewById<ViewGroup>(android.R.id.content)
            ?: throw AniChanException("AniChan's connection window could not be retained. Connect again.")
        val host = FrameLayout(activity).apply {
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
            isFocusable = false
        }
        (browser.parent as? ViewGroup)?.removeView(browser)
        host.addView(browser, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        host.addView(View(activity).apply {
            setBackgroundColor(Color.BLACK)
            isClickable = true
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // Compose's existing content is above this host, including all app controls.
        root.addView(host, 0, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        retainedHost = host
        browser.visibility = View.VISIBLE
        browser.alpha = 1f
        // WebView exposes a virtual accessibility subtree; mark the view itself
        // as well as its native parent so covered website controls cannot be read.
        browser.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        browser.clearFocus()
        browser.isFocusable = false
        browser.isFocusableInTouchMode = false
        browser.onResume()
        dialog?.setOnCancelListener(null)
        dialog?.dismiss()
        dialog = null
        debug("session retained in foreground window")
    }

    private suspend fun loadPage(browser: WebView, url: String) {
        if (web !== browser || !foreground) throw AniChanException("AniChan connection was closed.")
        val loaded = CompletableDeferred<Unit>()
        pageLoaded = loaded
        pageTarget = url
        browser.loadUrl(url)
        AniChanSessionPolicy.timed(30_000, "AniChan's page took too long to load. Connect again when ready.") { loaded.await() }
    }

    /** Promise completion is polled locally; it never repeats a request or returns session secrets. */
    private suspend fun read(browser: WebView, request: JSONObject): JSONObject {
        if (web !== browser || source.isEmpty()) throw AniChanException("AniChan connection was closed.")
        val requestId = "__anitrack_anichan_" + UUID.randomUUID().toString().replace("-", "")
        val slot = JSONObject.quote(requestId)
        val readingServers = request.optString("operation") == "servers"
        val operation = JSONObject(request.toString()).apply { if (readingServers) put("requestId", requestId) }
        val origin = JSONObject.quote(AniChan.ORIGIN)
        try {
            return AniChanSessionPolicy.timed(25_000, "AniChan took too long to respond. Retry or reconnect.") {
                val started = evaluate(browser, """
                    (() => {
                      if (location.origin !== $origin) return false;
                      $source
                      const state = {done:false}; window[$slot] = state;
                      Promise.resolve(globalThis.AniTrackAniChan.read($operation)).then(
                        result => { state.result=result; state.done=true; },
                        () => { state.result={status:'error'}; state.done=true; });
                      return true;
                    })()
                """.trimIndent())
                if (started != "true") return@timed JSONObject().put("status", "connect")
                var answer: JSONObject? = null
                while (answer == null) {
                    if (web !== browser || !foreground) throw AniChanException("AniChan connection was closed.")
                    val encoded = evaluate(browser, """
                        (() => { if(location.origin !== $origin) return JSON.stringify({status:'connect'});
                          const s=window[$slot]; return s && s.done ? JSON.stringify(s.result) : null; })()
                    """.trimIndent())
                    if (encoded != "null") {
                        if (encoded.length > AniChan.MAX_RESPONSE_BYTES * 2) throw AniChanException("AniChan response was too large.")
                        val text = JSONTokener(encoded).nextValue() as? String ?: throw AniChanException("AniChan sent an unreadable response.")
                        if (text.toByteArray(Charsets.UTF_8).size > AniChan.MAX_RESPONSE_BYTES) throw AniChanException("AniChan response was too large.")
                        answer = JSONObject(text)
                    } else delay(200)
                }
                answer
            }
        } finally {
            AniChanSessionPolicy.finishRequest {
                if (web === browser) {
                    // Complete the source-specific abort before the next queued read starts.
                    // A dead renderer must not leave cancellation cleanup waiting forever.
                    withTimeoutOrNull(1_000) {
                        val cancel = if (readingServers)
                            "globalThis.AniTrackAniChan?.read({operation:'cancel',requestId:$slot});" else ""
                        evaluate(browser, "(() => { $cancel delete window[$slot]; return true; })()")
                    }
                }
            }
        }
    }

    private suspend fun evaluate(browser: WebView, script: String): String = suspendCancellableCoroutine { continuation ->
        browser.evaluateJavascript(script) { if (continuation.isActive) continuation.resume(it) }
    }
    private fun debug(event: String) {
        if (BuildConfig.DEBUG) android.util.Log.d("AniTrackAniChan", event)
    }
    private fun destroyPage() {
        val old = web
        web = null
        old?.stopLoading()
        (old?.parent as? ViewGroup)?.removeView(old)
        old?.destroy()
        retainedHost?.let { host ->
            (host.parent as? ViewGroup)?.removeView(host)
            host.removeAllViews()
        }
        retainedHost = null
        dialog?.setOnCancelListener(null)
        dialog?.dismiss()
        dialog = null
    }
}
