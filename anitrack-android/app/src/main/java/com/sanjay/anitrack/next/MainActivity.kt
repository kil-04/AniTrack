package com.sanjay.anitrack.next

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController

// AniTrack Next — native Kotlin/Compose rewrite of the Android client.
// Port order: shell (this) → AniList browse → provider search/episodes →
// media3 player → downloads → gist sync. The provider/downloader/DB logic
// ports from the proven Kotlin plugins in ../android.

private val Bg = Color(0xFF0B0B0F)
private val BgElev = Color(0xFF141419)
private val Accent = Color(0xFFE50914)

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
        com.sanjay.anitrack.next.data.Db.init(applicationContext)
        com.sanjay.anitrack.next.data.GistSync.init(applicationContext)
        com.sanjay.anitrack.next.data.Pahe.attach(this)
        // ExoPlayer's HttpURLConnection stack consults this for cookies — the
        // pahe/kwik CDN rejects segment requests without the WebView's cookies.
        java.net.CookieHandler.setDefault(com.sanjay.anitrack.next.data.WebkitCookieHandler())
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = DarkColors) {
                AppShell()
            }
        }
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
}

@Composable
fun AppShell() {
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val current = backStack?.destination?.route
    // Tablet (or landscape phone) gets a nav rail; portrait phone a bottom bar.
    val wideLayout = LocalConfiguration.current.screenWidthDp >= 820
    val hideChrome = current == "player"

    Surface(color = Bg, modifier = Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxSize()) {
            if (wideLayout && !hideChrome) {
                NavigationRail(containerColor = BgElev) {
                    Spacer(Modifier.height(8.dp))
                    destinations.forEach { d ->
                        NavigationRailItem(
                            selected = current == d.route,
                            onClick = { nav.navigate(d.route) { launchSingleTop = true; popUpTo("home") } },
                            icon = { Icon(d.icon, d.label) },
                            label = { Text(d.label) },
                        )
                    }
                }
            }
            Column(Modifier.weight(1f)) {
                Box(Modifier.weight(1f)) {
                    val openDetail: (com.sanjay.anitrack.next.data.Anime) -> Unit = { a -> nav.navigate("anime/${a.id}") }
                    NavHost(nav, startDestination = "home") {
                        composable("home") { com.sanjay.anitrack.next.ui.HomeScreen(openDetail, onPlay = { nav.navigate("player") }) }
                        composable("search") { com.sanjay.anitrack.next.ui.SearchScreen(openDetail) }
                        composable("anime/{id}") { entry ->
                            val id = entry.arguments?.getString("id")?.toIntOrNull() ?: 0
                            com.sanjay.anitrack.next.ui.DetailScreen(id, onPlay = { nav.navigate("player") })
                        }
                        composable("player") {
                            com.sanjay.anitrack.next.ui.PlayerScreen(onBack = { nav.popBackStack() })
                        }
                        composable("mylist") {
                            com.sanjay.anitrack.next.ui.MyListScreen(onOpen = { id -> nav.navigate("anime/$id") })
                        }
                        composable("schedule") {
                            com.sanjay.anitrack.next.ui.ScheduleScreen(onOpen = { id -> nav.navigate("anime/$id") })
                        }
                        composable("downloads") { PlaceholderScreen("Downloads", "Offline HLS library (ports from the Kotlin downloader)") }
                        composable("settings") { com.sanjay.anitrack.next.ui.SettingsScreen() }
                    }
                }
                if (!wideLayout && !hideChrome) {
                    NavigationBar(containerColor = BgElev) {
                        destinations.forEach { d ->
                            NavigationBarItem(
                                selected = current == d.route,
                                onClick = { nav.navigate(d.route) { launchSingleTop = true; popUpTo("home") } },
                                icon = { Icon(d.icon, d.label) },
                                label = { Text(d.label) },
                            )
                        }
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
