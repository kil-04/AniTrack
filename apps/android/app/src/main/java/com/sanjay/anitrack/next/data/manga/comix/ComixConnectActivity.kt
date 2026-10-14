package com.sanjay.anitrack.next.data.manga.comix

import android.app.Activity
import android.graphics.Color
import android.os.*
import android.view.ViewGroup
import android.widget.*
import kotlinx.coroutines.*

/** User-operated public Comix pages/checks; never exposes an app/account bridge. */
class ComixConnectActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var engine: ComixSessionEngine
    private var accepted = false
    private var host: ViewGroup? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT < 28) { finish(); return }
        engine = ComixSessionEngine.get(this)
        val instructions = "Connect Comix · comix.to\nYou may browse or open a title to finish the website’s normal checks yourself. No sign-in is needed. Wait until any verification screen or popup has closed, then Continue. AniTrack will return to Comix’s homepage in this same session; manga opens in AniTrack’s reader."
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK) }
        val note = TextView(this).apply {
            text = instructions
            setTextColor(Color.WHITE); textSize = 16f; setPadding(24,24,24,12)
        }
        layout.addView(note)
        val buttons = LinearLayout(this)
        buttons.addView(Button(this).apply { text = "Cancel"; setOnClickListener { finish() } }, LinearLayout.LayoutParams(0,-2,1f))
        buttons.addView(Button(this).apply {
            text = "Continue to AniTrack"
            setOnClickListener {
                isEnabled = false
                note.text = "$instructions\n\nReturning to the Comix homepage. Complete any visible website check yourself."
                scope.launch {
                    try {
                        engine.acceptConnection()
                        accepted = true
                        setResult(RESULT_OK)
                        finish()
                    } catch (e: CancellationException) { throw e }
                    catch (e: Exception) {
                        note.text = "$instructions\n\n${e.message?.take(300) ?: "Comix could not connect. Wait for a normal page and try Continue again."}"
                        isEnabled = true
                    }
                }
            }
        }, LinearLayout.LayoutParams(0,-2,1f))
        layout.addView(buttons)
        (engine.web.parent as? ViewGroup)?.removeView(engine.web)
        layout.addView(engine.web, LinearLayout.LayoutParams(-1,0,1f))
        host = layout
        setContentView(layout)
        engine.beginConnection()
    }

    override fun onDestroy() {
        scope.cancel()
        if (::engine.isInitialized) {
            // Android destroys this screen after the next one (often the catalogue host) has
            // taken the shared WebView; detach it only from our own layout.
            if (engine.web.parent === host) host?.removeView(engine.web)
            if (!accepted && !isChangingConfigurations) engine.cancelConnection()
        }
        super.onDestroy()
    }
}
