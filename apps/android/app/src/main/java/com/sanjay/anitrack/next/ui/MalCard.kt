package com.sanjay.anitrack.next.ui

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Login
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.AccountCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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

/**
 * MyAnimeList card for Settings — OAuth in an in-app WebView (PKCE plain,
 * desktop's shared client id + redirect), Connected-as, Sync from MAL
 * (imports the list into My List via a MAL-id → AniList batch mapping),
 * Disconnect.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MalCard(onProfileChanged: (connected: Boolean, username: String?) -> Unit = { _, _ -> }) {
    var connected by remember { mutableStateOf(Mal.isConnected) }
    var username by remember { mutableStateOf(Mal.username) }
    var authOpen by remember { mutableStateOf(false) }
    var syncMsg by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val verifier = remember { Mal.newVerifier() }

    SettingsSection(
        Icons.Rounded.AccountCircle,
        "MyAnimeList",
        "Two-way sync with your MAL list: import your anime list and push status changes automatically.",
    ) {
        if (connected) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(40.dp).clip(CircleShape).background(AniColors.BrandGradient),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        username?.trim()?.firstOrNull()?.uppercaseChar()?.toString() ?: "M",
                        color = Color.White, fontWeight = FontWeight.Bold,
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Connected as", style = MaterialTheme.typography.labelSmall, color = AniColors.TextSecondary)
                    Text(username ?: "MAL user", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                }
            }
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton(
                    "Sync from MAL",
                    onClick = {
                        busy = true; syncMsg = "Syncing…"
                        scope.launch {
                            runCatching {
                                val result = Mal.importList { fetched ->
                                    syncMsg = "Fetched $fetched MAL entries, matching…"
                                }
                                syncMsg = "Imported ${result.imported} of ${result.fetched} entries into My List."
                            }.onFailure { syncMsg = "Sync failed: ${it.message}" }
                            busy = false
                        }
                    },
                    icon = Icons.Rounded.Sync,
                    style = PillStyle.Primary,
                    loading = busy,
                )
                PillButton(
                    "Disconnect",
                    onClick = {
                        Mal.disconnect(); connected = false; username = null; syncMsg = null
                        onProfileChanged(false, null)
                    },
                    icon = Icons.AutoMirrored.Rounded.Logout,
                    style = PillStyle.Outline,
                )
            }
        } else {
            PillButton("Connect MyAnimeList", { authOpen = true }, icon = Icons.AutoMirrored.Rounded.Login, style = PillStyle.Primary)
        }
        syncMsg?.let {
            Spacer(Modifier.height(10.dp))
            StatusLine(it, if (it.startsWith("Sync failed")) false else if (it.startsWith("Imported")) true else null)
        }
    }

    // OAuth WebView — intercepts the redirect and exchanges the code.
    if (authOpen) {
        Dialog(
            onDismissRequest = { authOpen = false },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Column(
                Modifier.fillMaxSize().padding(12.dp).clip(RoundedCornerShape(16.dp)).background(AniColors.Surface),
            ) {
                Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Sign in to MyAnimeList", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    IconButton(onClick = { authOpen = false }) {
                        Icon(Icons.Rounded.Close, "Close", tint = AniColors.TextSecondary)
                    }
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
                                                if (ok) {
                                                    connected = true
                                                    username = Mal.username
                                                    onProfileChanged(true, username)
                                                }
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
