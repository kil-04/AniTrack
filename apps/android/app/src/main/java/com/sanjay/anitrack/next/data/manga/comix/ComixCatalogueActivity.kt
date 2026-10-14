package com.sanjay.anitrack.next.data.manga.comix

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout

/** Hosts the isolated WebView only while a user-requested catalogue batch runs. */
class ComixCatalogueActivity : Activity() {
    private var lease = ""
    private var hostedWeb: WebView? = null
    private var hostRoot: ViewGroup? = null
    private val handler = Handler(Looper.getMainLooper())
    private val expiry = Runnable { finish() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lease = intent.getStringExtra(LEASE).orEmpty()
        if (!Regex("[a-f0-9-]{36}").matches(lease) || closed.remove(lease)) { finish(); return }
        val engine = ComixSessionEngine.get(this)
        if (!engine.ready) { finish(); return }
        current?.takeIf { it !== this }?.finish()
        current = this
        hostedWeb = engine.web
        val root = FrameLayout(this)
        (engine.web.parent as? ViewGroup)?.removeView(engine.web)
        root.addView(engine.web, FrameLayout.LayoutParams(-1, -1))
        hostRoot = root
        // Keep the ordinary WebView attached to a real foreground window.
        // Its page is covered by native loading UI; no site controls are exposed.
        val loading = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.rgb(14, 14, 18))
            isClickable = true
            addView(ProgressBar(this@ComixCatalogueActivity), LinearLayout.LayoutParams(-2, -2))
            addView(TextView(this@ComixCatalogueActivity).apply {
                text = "Loading Comix…"; textSize = 18f; setTextColor(Color.WHITE)
                setPadding(24, 24, 24, 24)
            }, LinearLayout.LayoutParams(-2, -2))
            addView(Button(this@ComixCatalogueActivity).apply {
                text = "Cancel"; setOnClickListener { finish() }
            }, LinearLayout.LayoutParams(-2, -2))
        }
        root.addView(loading, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        // Outlives a whole paced chapter traversal; the lease still closes as soon as its batch ends.
        handler.postDelayed(expiry, ComixProtocol.CHAPTER_LIST_DEADLINE_MS + 5_000)
    }

    override fun onDestroy() {
        handler.removeCallbacks(expiry)
        rememberClosed(lease)
        if (current === this) {
            current = null
            hostedWeb?.let { web -> (web.parent as? ViewGroup)?.takeIf { it === hostRoot }?.removeView(web) }
        }
        hostedWeb = null; hostRoot = null
        super.onDestroy()
    }

    companion object {
        internal const val LEASE = "comix_catalogue_lease"
        private var current: ComixCatalogueActivity? = null
        private val closed = linkedSetOf<String>()

        internal fun active(lease: String): Boolean = current?.let {
            it.lease == lease && !it.isFinishing && !it.isDestroyed &&
                it.hostedWeb?.isAttachedToWindow == true
        } == true

        internal suspend fun awaitAttached(lease: String) = withTimeout(4_000) {
            while (!active(lease)) {
                check(lease !in closed) { "Comix loading was cancelled." }
                delay(25)
            }
        }

        internal fun close(lease: String) {
            // Closing can arrive before Android has created the requested Activity.
            rememberClosed(lease)
            current?.takeIf { it.lease == lease }?.finish()
        }

        internal fun closeActive() { current?.let { close(it.lease) } }

        private fun rememberClosed(lease: String) {
            if (lease.isEmpty()) return
            if (closed.size >= 20) closed.remove(closed.first())
            closed.add(lease)
        }
    }
}
