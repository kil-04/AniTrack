package com.sanjay.anitrack.next.ui

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Db
import com.sanjay.anitrack.next.data.Mal
import kotlinx.coroutines.launch

private val Accent = Color(0xFFE50914)

/**
 * MyAnimeList card for Settings — OAuth in an in-app WebView (PKCE plain,
 * desktop's shared client id + redirect), Connected-as, Sync from MAL
 * (imports the list into My List via a MAL-id → AniList batch mapping),
 * Disconnect.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MalCard() {
    var connected by remember { mutableStateOf(Mal.isConnected) }
    var username by remember { mutableStateOf(Mal.username) }
    var authOpen by remember { mutableStateOf(false) }
    var syncMsg by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val verifier = remember { Mal.newVerifier() }

    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp))
            .background(Color.White.copy(alpha = 0.04f)).padding(16.dp),
    ) {
        Text("MyAnimeList", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(
            "Two-way sync with your MAL list. Sign in to import your anime list and push status changes automatically.",
            style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.5f),
        )
        Spacer(Modifier.height(14.dp))
        if (connected) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Connected as", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.5f))
                    Text(username ?: "MAL user", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                }
                Button(
                    onClick = {
                        if (busy) return@Button
                        busy = true; syncMsg = "Syncing…"
                        scope.launch {
                            runCatching {
                                if (Db.pendingMalOps().isNotEmpty() && !Mal.flushPending()) {
                                    error("Pending local changes could not be uploaded; remote import was not applied.")
                                }
                                val entries = Mal.pullList()
                                syncMsg = "Fetched ${entries.size} MAL entries, matching…"
                                val byMal = AniList.byMalIds(entries.map { it.malId }).associateBy { it.malId }
                                var imported = 0
                                for (e in entries) {
                                    val a = byMal[e.malId] ?: continue
                                    if (Db.applyMalListStatus(a.id, e.malId, e.status, a.title, a.cover)) imported++
                                }
                                syncMsg = "Imported $imported of ${entries.size} entries into My List."
                            }.onFailure { syncMsg = "Sync failed: ${it.message}" }
                            busy = false
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Accent),
                ) {
                    if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White)
                    else Text("Sync from MAL")
                }
                Spacer(Modifier.width(10.dp))
                OutlinedButton(onClick = {
                    Mal.disconnect(); connected = false; username = null; syncMsg = null
                }) { Text("Disconnect") }
            }
        } else {
            Button(onClick = { authOpen = true }, colors = ButtonDefaults.buttonColors(containerColor = Accent)) {
                Text("Connect MyAnimeList")
            }
        }
        syncMsg?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.6f))
        }
    }

    // OAuth WebView — intercepts the redirect and exchanges the code.
    if (authOpen) {
        Dialog(
            onDismissRequest = { authOpen = false },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Column(
                Modifier.fillMaxSize().padding(12.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFF101014)),
            ) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Sign in to MyAnimeList", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    Text(
                        "✕", color = Color.White.copy(alpha = 0.7f),
                        modifier = Modifier.clickable { authOpen = false }.padding(8.dp),
                    )
                }
                AndroidView(
                    factory = { ctx ->
                        WebView(ctx).apply {
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            webViewClient = object : WebViewClient() {
                                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                                    val url = request?.url?.toString() ?: return false
                                    if (url.startsWith(Mal.REDIRECT_URI)) {
                                        val code = android.net.Uri.parse(url).getQueryParameter("code")
                                        if (code != null) {
                                            scope.launch {
                                                val ok = runCatching { Mal.exchange(code, verifier) }.getOrDefault(false)
                                                if (ok) { connected = true; username = Mal.username }
                                                authOpen = false
                                            }
                                        } else authOpen = false
                                        return true
                                    }
                                    return false
                                }
                            }
                            loadUrl(Mal.authUrl(verifier))
                        }
                    },
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                )
            }
        }
    }
}
