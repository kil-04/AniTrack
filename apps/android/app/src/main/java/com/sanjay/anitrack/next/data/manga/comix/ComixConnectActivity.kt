package com.sanjay.anitrack.next.data.manga.comix

import android.app.Activity
import android.graphics.Color
import android.os.*
import android.view.ViewGroup
import android.widget.*
import kotlinx.coroutines.*

/** User-visible ordinary homepage; never opens advertising or reader embeds. */
class ComixConnectActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var engine: ComixSessionEngine
    private var accepted = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT < 28) { finish(); return }
        engine = ComixSessionEngine.get(this)
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK) }
        val note = TextView(this).apply {
            text = "Connect Comix · comix.to\nWait for the homepage. Complete any verification yourself, then continue. No sign-in needed. Manga opens in AniTrack’s reader."
            setTextColor(Color.WHITE); textSize = 16f; setPadding(24,24,24,12)
        }
        layout.addView(note)
        val buttons = LinearLayout(this)
        buttons.addView(Button(this).apply { text = "Cancel"; setOnClickListener { finish() } }, LinearLayout.LayoutParams(0,-2,1f))
        buttons.addView(Button(this).apply {
            text = "Continue to AniTrack"
            setOnClickListener {
                isEnabled = false
                scope.launch {
                    try {
                        engine.acceptConnection()
                        accepted = true
                        setResult(RESULT_OK)
                        finish()
                    } catch (e: CancellationException) { throw e }
                    catch (e: Exception) { note.text = e.message ?: "Comix could not connect."; isEnabled = true }
                }
            }
        }, LinearLayout.LayoutParams(0,-2,1f))
        layout.addView(buttons)
        (engine.web.parent as? ViewGroup)?.removeView(engine.web)
        layout.addView(engine.web, LinearLayout.LayoutParams(-1,0,1f))
        setContentView(layout)
        engine.beginConnection()
    }

    override fun onDestroy() {
        scope.cancel()
        if (::engine.isInitialized) {
            (engine.web.parent as? ViewGroup)?.removeView(engine.web)
            if (!accepted && !isChangingConfigurations) engine.cancelConnection()
        }
        super.onDestroy()
    }
}
