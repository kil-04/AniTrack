package com.sanjay.anitrack.next.diagnostics

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Db
import com.sanjay.anitrack.next.data.manga.comix.ComixSource
import com.sanjay.anitrack.next.ui.MangaDetailScreen
import com.sanjay.anitrack.next.ui.MangaReaderScreen

/** Debug-only entry to the real detail/reader screens. No tokens or URLs in intents. */
class ComixMangaActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Db.init(applicationContext)
        AniList.init(applicationContext)
        ComixSource.attach(this)
        val mangaId = intent.getIntExtra("manga_id",30002).takeIf { it > 0 } ?: 30002
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                Surface {
                    var reader by remember { mutableStateOf(false) }
                    if (reader) MangaReaderScreen(onBack = { reader = false })
                    else MangaDetailScreen(mangaId,onRead = { reader = true })
                }
            }
        }
    }

    override fun onDestroy() { ComixSource.detach(this); super.onDestroy() }
}
