package com.sanjay.anitrack.next

import android.os.Bundle
import android.content.res.Configuration
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController

// AniTrack Next — native Kotlin/Compose rewrite of the Android client.
// Port order: shell (this) → AniList browse → provider search/episodes →
// media3 player → downloads → gist sync. The provider/downloader/DB logic
// ports from the proven Kotlin plugins in ../android.

// Desktop parity: the app background is pure black (index.css #000000),
// and the top/bottom bars blend into it (no gray strip).
private val Bg = Color(0xFF000000)
private val BgElev = Color(0xFF000000)
private val Accent = Color(0xFFE50914)

object PipState {
    val active = mutableStateOf(false)
}

private val DarkColors = darkColorScheme(
    primary = Accent,
    background = Bg,
    surface = BgElev,
    onBackground = Color.White,
    onSurface = Color.White,
)

data class Dest(val route: String, val label: String, val icon: ImageVector)

private val destinations = listOf(
    Dest("home", "Home", Icons.Filled.Home),
    Dest("search", "Search", Icons.Filled.Search),
    Dest("mylist", "My List", Icons.Filled.Bookmark),
    Dest("schedule", "Schedule", Icons.Filled.CalendarMonth),
    Dest("downloads", "Downloads", Icons.Filled.Download),
    Dest("settings", "Settings", Icons.Filled.Settings),
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PipState.active.value = isInPictureInPictureMode
        com.sanjay.anitrack.next.update.AppUpdater.init(applicationContext)
        com.sanjay.anitrack.next.data.RemoteConfig.init(applicationContext)
        com.sanjay.anitrack.next.data.Db.init(applicationContext)
        com.sanjay.anitrack.next.data.GistSync.init(applicationContext)
        com.sanjay.anitrack.next.data.Downloads.init(applicationContext)
        com.sanjay.anitrack.next.data.Mal.init(applicationContext)
        com.sanjay.anitrack.next.data.Pahe.attach(this)
        // ExoPlayer's HttpURLConnection stack consults this for cookies — the
        // pahe/kwik CDN rejects segment requests without the WebView's cookies.
        java.net.CookieHandler.setDefault(com.sanjay.anitrack.next.data.WebkitCookieHandler())
        enableEdgeToEdge()
        hideSystemBars()
        setContent {
            MaterialTheme(colorScheme = DarkColors) {
                AppShell()
            }
        }
    }

    // Hide the Android status + taskbar app-wide; a swipe from an edge reveals
    // them transiently, then they auto-hide again.
    private fun hideSystemBars() {
        val c = androidx.core.view.WindowCompat.getInsetsController(window, window.decorView)
        c.systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        c.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()   // re-hide after dialogs / app switches
    }

    override fun onResume() {
        super.onResume()
        com.sanjay.anitrack.next.update.AppUpdater.resumePendingInstall(this)
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration,
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        PipState.active.value = isInPictureInPictureMode
    }

    // YouTube behaviour: leaving the app while watching drops into PiP.
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (com.sanjay.anitrack.next.data.PlaySession.playerActive) {
            try {
                enterPictureInPictureMode(
                    android.app.PictureInPictureParams.Builder()
                        .setAspectRatio(android.util.Rational(16, 9))
                        .build(),
                )
            } catch (e: Exception) { /* PiP unavailable */ }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing) PipState.active.value = false
        // The shared player outlives the player screen (mini player) — free it
        // when the whole activity goes away.
        if (isFinishing) com.sanjay.anitrack.next.data.PlayerHolder.release()
    }
}

@Composable
fun AppShell() {
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val current = backStack?.destination?.route
    // Tablet (or landscape phone) gets a nav rail; portrait phone a bottom bar.
    val wideLayout = LocalConfiguration.current.screenWidthDp >= 820
    val hideChrome = current == "player"

    val go: (String) -> Unit = { r -> nav.navigate(r) { launchSingleTop = true; popUpTo("home") } }
    val openDetail: (com.sanjay.anitrack.next.data.Anime) -> Unit = { a -> nav.navigate("anime/${a.id}") }

    Surface(color = Bg, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // Wide screens: horizontal top nav bar (desktop-style) with a
            // profile chip on the right that opens Settings.
            if (wideLayout && !hideChrome) {
                Row(
                    Modifier.fillMaxWidth().background(BgElev).padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("AniTrack", color = Accent, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    Spacer(Modifier.width(24.dp))
                    destinations.filter { it.route != "settings" }.forEach { d ->
                        Text(
                            d.label,
                            modifier = Modifier.clickable { go(d.route) }.padding(horizontal = 12.dp, vertical = 6.dp),
                            color = if (current == d.route) Color.White else Color.White.copy(alpha = 0.55f),
                            fontWeight = if (current == d.route) FontWeight.Bold else FontWeight.Normal,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    // Inline search with a live results dropdown (desktop-style).
                    com.sanjay.anitrack.next.ui.NavSearchBox(
                        modifier = Modifier.width(320.dp),
                        onOpen = openDetail,
                        onViewAll = { go("search") },
                    )
                    Spacer(Modifier.width(12.dp))
                    // Profile → Settings (rounded square, like the desktop).
                    Box(
                        Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(Accent)
                            .clickable { go("settings") },
                        contentAlignment = Alignment.Center,
                    ) { Text("A", color = Color.White, fontWeight = FontWeight.Bold) }
                }
            }
            // Portrait: same top bar, compact (logo + search pill + profile);
            // nav items stay in the bottom bar.
            if (!wideLayout && !hideChrome) {
                Row(
                    Modifier.fillMaxWidth().background(BgElev).padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("AniTrack", color = Accent, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    Spacer(Modifier.width(12.dp))
                    Row(
                        Modifier.weight(1f).height(38.dp)
                            .clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.07f))
                            .clickable { nav.navigate("quicksearch") { launchSingleTop = true } }
                            .padding(horizontal = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.Search, null, tint = Color.White.copy(alpha = 0.5f), modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Search anime…", color = Color.White.copy(alpha = 0.45f), style = MaterialTheme.typography.bodySmall)
                    }
                    Spacer(Modifier.width(10.dp))
                    Box(
                        Modifier.size(34.dp).clip(RoundedCornerShape(10.dp)).background(Accent)
                            .clickable { go("settings") },
                        contentAlignment = Alignment.Center,
                    ) { Text("A", color = Color.White, fontWeight = FontWeight.Bold) }
                }
            }
            Box(Modifier.weight(1f)) {
                NavHost(nav, startDestination = "home") {
                    composable("home") {
                        com.sanjay.anitrack.next.ui.HomeScreen(
                            openDetail,
                            onPlay = { nav.navigate("player") },
                            onOpenSearch = { nav.navigate("quicksearch") { launchSingleTop = true } },
                            onOpenContinue = { go("continue") },
                            onOpenLatest = { go("latest") },
                        )
                    }
                    composable("search") { com.sanjay.anitrack.next.ui.SearchScreen(openDetail) }
                    composable("quicksearch") { com.sanjay.anitrack.next.ui.QuickSearchScreen(onOpen = openDetail, onBack = { nav.popBackStack() }) }
                    composable("continue") { com.sanjay.anitrack.next.ui.ContinueWatchingScreen(onPlay = { nav.navigate("player") }) }
                    composable("latest") { com.sanjay.anitrack.next.ui.LatestScreen(onOpen = openDetail) }
                    composable("anime/{id}") { entry ->
                        val id = entry.arguments?.getString("id")?.toIntOrNull() ?: 0
                        com.sanjay.anitrack.next.ui.DetailScreen(
                            id,
                            onPlay = { nav.navigate("player") },
                            onOpenAnime = { other -> nav.navigate("anime/$other") },
                        )
                    }
                    composable("player") {
                        com.sanjay.anitrack.next.ui.PlayerScreen(
                            onBack = { nav.popBackStack() },
                            onHome = { nav.navigate("home") { launchSingleTop = true; popUpTo("home") } },
                            onOpenDetail = { id -> nav.navigate("anime/$id") },
                        )
                    }
                    composable("mylist") {
                        com.sanjay.anitrack.next.ui.MyListScreen(onOpen = { id -> nav.navigate("anime/$id") })
                    }
                    composable("schedule") {
                        com.sanjay.anitrack.next.ui.ScheduleScreen(onOpen = { id -> nav.navigate("anime/$id") })
                    }
                    composable("downloads") {
                        com.sanjay.anitrack.next.ui.DownloadsScreen(
                            onPlay = { nav.navigate("player") },
                            onOpenAnime = { id -> nav.navigate("anime/$id") },
                        )
                    }
                    composable("settings") { com.sanjay.anitrack.next.ui.SettingsScreen() }
                }
                // Floating mini player (the desktop's bottom-right persistent player).
                val miniOn by com.sanjay.anitrack.next.data.PlayerHolder.miniActive
                if (miniOn && current != "player") {
                    Box(Modifier.align(Alignment.BottomEnd).padding(16.dp)) {
                        com.sanjay.anitrack.next.ui.MiniPlayer(
                            onExpand = { nav.navigate("player") { launchSingleTop = true } },
                            onClose = { com.sanjay.anitrack.next.data.PlayerHolder.release() },
                        )
                    }
                }
            }
            // Phones: bottom nav bar.
            if (!wideLayout && !hideChrome) {
                NavigationBar(containerColor = BgElev) {
                    destinations.forEach { d ->
                        NavigationBarItem(
                            selected = current == d.route,
                            onClick = { go(d.route) },
                            icon = { Icon(d.icon, d.label) },
                            label = { Text(d.label) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun PlaceholderScreen(title: String, subtitle: String) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = MaterialTheme.typography.headlineLarge)
        Spacer(Modifier.height(8.dp))
        Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.5f))
        Spacer(Modifier.height(24.dp))
        Text("AniTrack Next — native Compose shell", color = Accent, style = MaterialTheme.typography.labelLarge)
    }
}
