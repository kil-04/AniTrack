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
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bookmarks
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.DownloadForOffline
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.NewReleases
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.rounded.Bookmarks
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.DownloadForOffline
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.NewReleases
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument

// AniTrack Next — native Kotlin/Compose rewrite of the Android client.
// Port order: shell (this) → AniList browse → provider search/episodes →
// media3 player → downloads → gist sync. The provider/downloader/DB logic
// ports from the proven Kotlin plugins in ../android.

// The app background and bars share the theme's near-black (AniColors.Bg);
// the bars are separated from content by a hairline.
private val Bg = com.sanjay.anitrack.next.ui.AniColors.Bg
private val Accent = com.sanjay.anitrack.next.ui.AniColors.Accent

object PipState {
    val active = mutableStateOf(false)
}

/** A navigation tab: outlined [icon] normally, the filled [selectedIcon] when it's the current page. */
data class Dest(val route: String, val label: String, val icon: ImageVector, val selectedIcon: ImageVector = icon)

private val destinations = listOf(
    Dest("home", "Home", Icons.Outlined.Home, Icons.Rounded.Home),
    Dest("search", "Search", Icons.Rounded.Search),
    Dest("time-machine", "Time Machine", Icons.Rounded.History),
    Dest("mylist", "My List", Icons.Outlined.Bookmarks, Icons.Rounded.Bookmarks),
    Dest("schedule", "Schedule", Icons.Outlined.CalendarMonth, Icons.Rounded.CalendarMonth),
    Dest("downloads", "Downloads", Icons.Outlined.DownloadForOffline, Icons.Rounded.DownloadForOffline),
    Dest("settings", "Settings", Icons.Outlined.Settings, Icons.Rounded.Settings),
)

/** Tabs in manga mode: the anime features' manga counterparts (Updates stands in for Schedule). */
private val mangaDestinations = listOf(
    Dest("home", "Home", Icons.Outlined.Home, Icons.Rounded.Home),
    Dest("manga-search", "Search", Icons.Rounded.Search),
    Dest("manga-list", "My List", Icons.Outlined.Bookmarks, Icons.Rounded.Bookmarks),
    Dest("manga-updates", "Updates", Icons.Outlined.NewReleases, Icons.Rounded.NewReleases),
    Dest("manga-downloads", "Downloads", Icons.Outlined.DownloadForOffline, Icons.Rounded.DownloadForOffline),
    Dest("settings", "Settings", Icons.Outlined.Settings, Icons.Rounded.Settings),
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PipState.active.value = isInPictureInPictureMode
        com.sanjay.anitrack.next.update.AppUpdater.init(applicationContext)
        com.sanjay.anitrack.next.data.RemoteConfig.init(applicationContext)
        com.sanjay.anitrack.next.data.Db.init(applicationContext)
        com.sanjay.anitrack.next.data.AniList.init(applicationContext)
        com.sanjay.anitrack.next.data.GistSync.init(applicationContext)
        com.sanjay.anitrack.next.data.Downloads.init(applicationContext)
        com.sanjay.anitrack.next.data.Mal.init(applicationContext)
        com.sanjay.anitrack.next.data.providers.connectors.MkissaProvider.init(applicationContext)
        com.sanjay.anitrack.next.data.providers.connectors.MiruroAndroidProvider.attach(this)
        com.sanjay.anitrack.next.data.manga.comix.ComixSource.attach(this)
        com.sanjay.anitrack.next.data.Pahe.attach(this)
        // ExoPlayer's HttpURLConnection stack consults this for cookies — the
        // pahe/kwik CDN rejects segment requests without the WebView's cookies.
        java.net.CookieHandler.setDefault(com.sanjay.anitrack.next.data.WebkitCookieHandler())
        enableEdgeToEdge()
        hideSystemBars()
        setContent {
            com.sanjay.anitrack.next.ui.AniTrackTheme {
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
        com.sanjay.anitrack.next.data.providers.connectors.MiruroAndroidProvider.foreground(this, true)
        com.sanjay.anitrack.next.update.AppUpdater.resumePendingInstall(this)
    }

    override fun onPause() {
        com.sanjay.anitrack.next.data.providers.connectors.MiruroAndroidProvider.foreground(this, false)
        super.onPause()
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
        com.sanjay.anitrack.next.data.manga.comix.ComixSource.detach(this)
        com.sanjay.anitrack.next.data.providers.connectors.MiruroAndroidProvider.detach(this)
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
    var malConnected by remember { mutableStateOf(com.sanjay.anitrack.next.data.Mal.isConnected) }
    var malUsername by remember { mutableStateOf(com.sanjay.anitrack.next.data.Mal.username) }
    // Tablet (or landscape phone) gets the top tab bar; portrait phone a bottom bar.
    val widthDp = LocalConfiguration.current.screenWidthDp
    val wideLayout = widthDp >= 820
    // Medium widths keep the bar on one line by showing labels only on the current tab.
    val tabLabels = widthDp >= 1100
    val hideChrome = current == "player" || current == "reader"

    val go: (String) -> Unit = { r -> nav.navigate(r) { launchSingleTop = true; popUpTo("home") } }
    val openDetail: (com.sanjay.anitrack.next.data.Anime) -> Unit = { a -> nav.navigate("anime/${a.id}") }
    val openManga: (com.sanjay.anitrack.next.data.Manga) -> Unit = { m -> nav.navigate("manga/${m.id}") }
    // App-wide Anime/Manga mode (toggled on Home): the search bar, tabs and pages follow it.
    val context = androidx.compose.ui.platform.LocalContext.current
    val modePrefs = remember { context.getSharedPreferences("anitrack_next", android.content.Context.MODE_PRIVATE) }
    var mode by androidx.compose.runtime.saveable.rememberSaveable {
        mutableStateOf(
            runCatching { com.sanjay.anitrack.next.ui.HomeMode.valueOf(modePrefs.getString("home_mode", null) ?: "") }
                .getOrDefault(com.sanjay.anitrack.next.ui.HomeMode.Anime),
        )
    }
    val setMode: (com.sanjay.anitrack.next.ui.HomeMode) -> Unit = {
        mode = it
        modePrefs.edit().putString("home_mode", it.name).apply()
    }
    val manga = mode == com.sanjay.anitrack.next.ui.HomeMode.Manga
    val tabs = if (manga) mangaDestinations else destinations
    val currentTab = current?.substringBefore('?')

    Surface(color = Bg, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // Wide screens: horizontal top nav bar (desktop-style) with icon
            // tabs, the live search and a profile chip that opens Settings.
            if (wideLayout && !hideChrome) {
                Row(
                    Modifier.fillMaxWidth().background(Bg).padding(horizontal = 20.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    com.sanjay.anitrack.next.ui.AniWordmark(
                        Modifier.clip(RoundedCornerShape(10.dp)).clickable { go("home") }.padding(4.dp),
                    )
                    Spacer(Modifier.width(18.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        tabs.filter { it.route != "settings" }.forEach { d ->
                            NavTab(d, selected = currentTab == d.route, showLabel = tabLabels || currentTab == d.route) { go(d.route) }
                        }
                    }
                    // Inline search with a live results dropdown (desktop-style).
                    Box(Modifier.weight(1f).padding(horizontal = 12.dp), contentAlignment = Alignment.CenterEnd) {
                        com.sanjay.anitrack.next.ui.NavSearchBox(
                            modifier = Modifier.widthIn(max = 340.dp).fillMaxWidth(),
                            onOpen = openDetail,
                            onViewAll = { q -> if (manga) go("manga-search?q=${android.net.Uri.encode(q)}") else go("search") },
                            manga = manga,
                            onOpenManga = openManga,
                        )
                    }
                    MalProfileButton(
                        connected = malConnected,
                        username = malUsername,
                        showUsername = tabLabels,
                        selected = currentTab == "settings",
                        onClick = { go("settings") },
                    )
                }
                HorizontalDivider(color = com.sanjay.anitrack.next.ui.AniColors.BorderSoft)
            }
            // Portrait: same top bar, compact (logo + search pill + profile);
            // nav items stay in the bottom bar.
            if (!wideLayout && !hideChrome) {
                Row(
                    Modifier.fillMaxWidth().background(Bg).padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    com.sanjay.anitrack.next.ui.AniWordmark(compact = true)
                    Spacer(Modifier.width(12.dp))
                    Row(
                        Modifier.weight(1f).height(40.dp)
                            .clip(RoundedCornerShape(50)).background(com.sanjay.anitrack.next.ui.AniColors.SurfaceHigh)
                            .border(1.dp, com.sanjay.anitrack.next.ui.AniColors.BorderSoft, RoundedCornerShape(50))
                            .clickable { nav.navigate("quicksearch") { launchSingleTop = true } }
                            .padding(horizontal = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Rounded.Search, null, tint = com.sanjay.anitrack.next.ui.AniColors.TextTertiary, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(
                            if (manga) "Search manga…" else "Search anime…",
                            color = com.sanjay.anitrack.next.ui.AniColors.TextTertiary,
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 1,
                        )
                    }
                    Spacer(Modifier.width(10.dp))
                    MalProfileButton(
                        connected = malConnected,
                        username = malUsername,
                        showUsername = false,
                        selected = currentTab == "settings",
                        onClick = { go("settings") },
                    )
                }
                HorizontalDivider(color = com.sanjay.anitrack.next.ui.AniColors.BorderSoft)
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
                            onOpenManga = openManga,
                            onOpenMangaId = { id -> nav.navigate("manga/$id") },
                            mode = mode,
                            onModeChange = setMode,
                        )
                    }
                    composable("manga/{id}") { entry ->
                        val id = entry.arguments?.getString("id")?.toIntOrNull() ?: 0
                        com.sanjay.anitrack.next.ui.MangaDetailScreen(id, onRead = { nav.navigate("reader") })
                    }
                    composable("reader") {
                        com.sanjay.anitrack.next.ui.MangaReaderScreen(onBack = { nav.popBackStack() })
                    }
                    composable("search") { com.sanjay.anitrack.next.ui.SearchScreen(openDetail) }
                    composable("time-machine") {
                        com.sanjay.anitrack.next.ui.TimeMachineScreen(
                            openDetail,
                            onOpenGenome = { nav.navigate("taste-genome") },
                            onOpenMuseum = { nav.navigate("museum/${it.id}") },
                        )
                    }
                    composable("taste-genome") { com.sanjay.anitrack.next.ui.TasteGenomeScreen(onOpen = { nav.navigate("anime/$it") }, onOpenTimeMachine = { go("time-machine") }) }
                    composable("museum/{id}") { entry ->
                        val id = entry.arguments?.getString("id")?.toIntOrNull() ?: 0
                        com.sanjay.anitrack.next.ui.MuseumScreen(
                            id,
                            onOpenAnime = openDetail,
                            onBack = { nav.popBackStack() },
                        )
                    }
                    composable("quicksearch") {
                        com.sanjay.anitrack.next.ui.QuickSearchScreen(
                            onOpen = openDetail,
                            onBack = { nav.popBackStack() },
                            manga = manga,
                            onOpenManga = openManga,
                        )
                    }
                    composable("manga-search?q={q}", arguments = listOf(navArgument("q") { defaultValue = "" })) { entry ->
                        com.sanjay.anitrack.next.ui.MangaSearchScreen(entry.arguments?.getString("q").orEmpty(), openManga)
                    }
                    composable("manga-list") {
                        com.sanjay.anitrack.next.ui.MangaListScreen(onOpen = { id -> nav.navigate("manga/$id") }, onBrowse = { go("manga-search") })
                    }
                    composable("manga-updates") {
                        com.sanjay.anitrack.next.ui.MangaUpdatesScreen(onOpen = { id -> nav.navigate("manga/$id") })
                    }
                    composable("manga-downloads") {
                        com.sanjay.anitrack.next.ui.MangaDownloadsScreen(
                            onOpenManga = { id -> nav.navigate("manga/$id") },
                            onRead = { nav.navigate("reader") },
                        )
                    }
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
                        com.sanjay.anitrack.next.ui.MyListScreen(onOpen = { id -> nav.navigate("anime/$id") }, onBrowse = { go("search") })
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
                    composable("settings") {
                        com.sanjay.anitrack.next.ui.SettingsScreen { connected, username ->
                            malConnected = connected
                            malUsername = username
                        }
                    }
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
            // Phones: bottom nav bar (Settings lives behind the profile button).
            if (!wideLayout && !hideChrome) {
                val barTabs = tabs.filter { it.route != "settings" }
                HorizontalDivider(color = com.sanjay.anitrack.next.ui.AniColors.BorderSoft)
                NavigationBar(containerColor = Bg, tonalElevation = 0.dp) {
                    barTabs.forEach { d ->
                        val selected = currentTab == d.route
                        NavigationBarItem(
                            selected = selected,
                            onClick = { go(d.route) },
                            icon = { Icon(if (selected) d.selectedIcon else d.icon, d.label) },
                            label = { Text(d.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            alwaysShowLabel = barTabs.size <= 5,
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = Color.White,
                                selectedTextColor = Color.White,
                                indicatorColor = com.sanjay.anitrack.next.ui.AniColors.AccentSoft,
                                unselectedIconColor = com.sanjay.anitrack.next.ui.AniColors.TextSecondary,
                                unselectedTextColor = com.sanjay.anitrack.next.ui.AniColors.TextSecondary,
                            ),
                        )
                    }
                }
            }
        }
    }
}

/** Top-bar tab: icon plus label in a pill; the current page gets a filled icon and a tinted pill. */
@Composable
private fun NavTab(d: Dest, selected: Boolean, showLabel: Boolean, onClick: () -> Unit) {
    val colors = com.sanjay.anitrack.next.ui.AniColors
    Row(
        Modifier.height(40.dp).clip(RoundedCornerShape(50))
            .background(if (selected) Color.White.copy(alpha = 0.1f) else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = if (showLabel) 14.dp else 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            if (selected) d.selectedIcon else d.icon,
            d.label,
            tint = if (selected) Accent else colors.TextSecondary,
            modifier = Modifier.size(20.dp),
        )
        if (showLabel) {
            Spacer(Modifier.width(8.dp))
            Text(
                d.label,
                style = MaterialTheme.typography.labelLarge,
                color = if (selected) colors.Text else colors.TextSecondary,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun MalProfileButton(
    connected: Boolean,
    username: String?,
    showUsername: Boolean,
    selected: Boolean = false,
    onClick: () -> Unit,
) {
    val colors = com.sanjay.anitrack.next.ui.AniColors
    val displayName = if (connected) username?.takeIf { it.isNotBlank() } ?: "MAL user" else "Sign in"
    val initial = username?.trim()?.firstOrNull()?.uppercaseChar()?.toString()

    Row(
        Modifier.clip(RoundedCornerShape(50))
            .background(if (showUsername || selected) colors.SurfaceHigh else Color.Transparent)
            .border(1.dp, if (showUsername || selected) colors.BorderSoft else Color.Transparent, RoundedCornerShape(50))
            .clickable(onClick = onClick)
            .padding(start = 4.dp, end = if (showUsername) 14.dp else 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(32.dp).clip(CircleShape)
                .then(
                    if (connected) Modifier.background(colors.BrandGradient)
                    else Modifier.background(colors.SurfaceHighest),
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (connected && initial != null) Text(initial, color = Color.White, fontWeight = FontWeight.Bold)
            else Icon(Icons.Rounded.Person, "Profile", tint = if (connected) Color.White else colors.TextSecondary, modifier = Modifier.size(19.dp))
        }
        if (showUsername) {
            Spacer(Modifier.width(9.dp))
            Text(
                displayName,
                color = colors.Text,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 150.dp),
            )
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
