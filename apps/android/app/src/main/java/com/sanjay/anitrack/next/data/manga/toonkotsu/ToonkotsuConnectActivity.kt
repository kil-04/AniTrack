package com.sanjay.anitrack.next.data.manga.toonkotsu

import android.app.Activity
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** User-operated website check; retains the website's own WebView session. */
class ToonkotsuConnectActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        title = "Connect Toonkotsu"
        setResult(RESULT_CANCELED)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(android.graphics.Color.BLACK) }
        root.addView(TextView(this).apply { text = "Connect Toonkotsu. Complete any Quick Check, then tap Done and retry your chapter."; setTextColor(android.graphics.Color.WHITE); setPadding(24,24,24,12) })
        val buttons = LinearLayout(this)
        buttons.addView(Button(this).apply { text = "Cancel"; setOnClickListener { finish() } })
        buttons.addView(Button(this).apply { text = "Done"; setOnClickListener { setResult(RESULT_OK); finish() } })
        root.addView(buttons)
        root.addView(ToonkotsuSession.connectView(), LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
    }
    override fun onDestroy() { ToonkotsuSession.detach(); super.onDestroy() }
}
