package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Search
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.SearchHistory
import kotlinx.coroutines.delay

/** One search result row, for anime or manga. */
internal data class SearchHit(
    val title: String,
    val cover: String?,
    val year: Int?,
    val score: Int?,
    val status: String?,
    val open: () -> Unit,
)

internal suspend fun searchHits(query: String, manga: Boolean, onOpen: (Anime) -> Unit, onOpenManga: (Manga) -> Unit): List<SearchHit> =
    if (manga) {
        AniList.searchManga(query).map { m -> SearchHit(m.title, m.cover, m.year, m.score, m.kind ?: m.status) { onOpenManga(m) } }
    } else {
        AniList.search(query).map { a -> SearchHit(a.title, a.cover, a.year, a.score, a.status) { onOpen(a) } }
    }

// ── Nav search box with a live results dropdown (desktop header search) ───────

@Composable
fun NavSearchBox(
    modifier: Modifier = Modifier,
    onOpen: (Anime) -> Unit,
    onViewAll: (String) -> Unit = {},
    manga: Boolean = false,
    onOpenManga: (Manga) -> Unit = {},
) {
    var query by remember(manga) { mutableStateOf("") }
    val context = androidx.compose.ui.platform.LocalContext.current
    var recent by remember(manga) { mutableStateOf(SearchHistory.recent(context, manga)) }
    var results by remember(manga) { mutableStateOf<List<SearchHit>>(emptyList()) }
    var open by remember { mutableStateOf(false) }
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    // The dropdown fits between the field and the keyboard; taller, it was pushed up over the field.
    val density = androidx.compose.ui.platform.LocalDensity.current
    val windowHeight = androidx.compose.ui.platform.LocalView.current.rootView.height
    val imeBottom = WindowInsets.ime.getBottom(density)
    var fieldBottom by remember { mutableIntStateOf(0) }
    // Closing the keyboard (back or its hide key) also lets go of the field, so it
    // doesn't stay highlighted with a cursor on every screen afterwards.
    var focused by remember { mutableStateOf(false) }
    val imeVisible = imeBottom > 0
    var imeWasVisible by remember { mutableStateOf(false) }
    LaunchedEffect(imeVisible) {
        if (imeWasVisible && !imeVisible && focused) focus.clearFocus()
        imeWasVisible = imeVisible
    }
    val menuMax = with(density) {
        // Less the 6dp offset and the 48dp edge margin Material keeps around menus.
        (windowHeight - imeBottom - fieldBottom - 60.dp.roundToPx()).toDp().coerceIn(180.dp, 520.dp)
    }
    // Leaving the search (a result or "view all") releases the field and closes the keyboard.
    fun leave() {
        SearchHistory.remember(context, manga, query)
        recent = SearchHistory.recent(context, manga)
        open = false
        query = ""
        focus.clearFocus()
        keyboard?.hide()
    }

    LaunchedEffect(query, manga) {
        if (query.isBlank()) { results = emptyList(); open = false; return@LaunchedEffect }
        delay(350)
        runCatching { results = searchHits(query.trim(), manga, onOpen, onOpenManga) }
        open = results.isNotEmpty()
    }

    Box(modifier) {
        OutlinedTextField(
            value = query, onValueChange = { query = it },
            placeholder = {
                Text(
                    if (manga) "Search manga…" else "Search anime…",
                    style = MaterialTheme.typography.bodyMedium,
                    color = AniColors.TextTertiary,
                    maxLines = 1,
                )
            },
            singleLine = true,
            // The keyboard's Search key shows all results, like "View all results" (which
            // sits below the previews and can be hidden by the mini player).
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Search),
            keyboardActions = androidx.compose.foundation.text.KeyboardActions(onSearch = {
                val q = query.trim()
                if (q.isNotEmpty()) { leave(); onViewAll(q) }
            }),
            shape = RoundedCornerShape(50),   // pill, like the desktop header
            leadingIcon = { Icon(Icons.Rounded.Search, null, tint = AniColors.TextTertiary) },
            // No trailing slot while empty, so the placeholder gets the full width.
            trailingIcon = if (query.isEmpty()) null else {
                { IconButton(onClick = { query = "" }) { Icon(Icons.Rounded.Close, "Clear", tint = AniColors.TextSecondary, modifier = Modifier.size(18.dp)) } }
            },
            modifier = Modifier.fillMaxWidth().height(50.dp)
                .onGloballyPositioned { fieldBottom = it.boundsInWindow().bottom.toInt() }
                .onFocusChanged { focused = it.isFocused },
            textStyle = MaterialTheme.typography.bodyMedium,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = AniColors.Accent.copy(alpha = 0.8f),
                unfocusedBorderColor = AniColors.BorderSoft,
                focusedContainerColor = AniColors.SurfaceHigh,
                unfocusedContainerColor = AniColors.SurfaceHigh,
                cursorColor = AniColors.Accent,
            ),
        )
        // Aligned flush under the bar, same width — like the desktop dropdown.
        DropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            properties = androidx.compose.ui.window.PopupProperties(focusable = false),
            offset = androidx.compose.ui.unit.DpOffset(0.dp, 6.dp),
            shape = RoundedCornerShape(16.dp),
            containerColor = AniColors.Surface,
            modifier = Modifier.width(360.dp).heightIn(max = menuMax)
                .border(1.dp, AniColors.Border, RoundedCornerShape(16.dp)),
        ) {
            results.take(9).forEach { hit ->
                DropdownMenuItem(
                    onClick = { leave(); hit.open() },
                    text = {
                        SearchHitRow(hit)
                    },
                )
            }
            HorizontalDivider(color = AniColors.BorderSoft)
            DropdownMenuItem(
                onClick = { val q = query.trim(); leave(); onViewAll(q) },
                text = {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("View all results for \"$query\"", style = MaterialTheme.typography.labelLarge, color = AniColors.Text, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, tint = AniColors.Accent, modifier = Modifier.size(18.dp))
                    }
                },
            )
        }
        DropdownMenu(
            expanded = focused && query.isEmpty() && recent.isNotEmpty(),
            onDismissRequest = { focus.clearFocus() },
            properties = androidx.compose.ui.window.PopupProperties(focusable = false),
            offset = androidx.compose.ui.unit.DpOffset(0.dp, 6.dp),
            shape = RoundedCornerShape(16.dp),
            containerColor = AniColors.Surface,
            modifier = Modifier.width(360.dp).heightIn(max = menuMax)
                .border(1.dp, AniColors.Border, RoundedCornerShape(16.dp)),
        ) {
            Text(
                "Recent searches",
                style = MaterialTheme.typography.labelLarge,
                color = AniColors.TextSecondary,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            recent.forEach { past ->
                DropdownMenuItem(
                    onClick = { query = past },
                    leadingIcon = { Icon(Icons.Rounded.History, null, tint = AniColors.TextTertiary) },
                    text = { Text(past, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                )
            }
            HorizontalDivider(color = AniColors.BorderSoft)
            DropdownMenuItem(
                onClick = { SearchHistory.clear(context, manga); recent = emptyList() },
                text = { Text("Clear recent searches", color = AniColors.TextSecondary) },
            )
        }
    }
}

/** A search result: cover, title, year tag, score and status (top-bar dropdown and quick search). */
@Composable
internal fun SearchHitRow(hit: SearchHit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        PosterImage(hit.cover, hit.title, Modifier.width(40.dp).height(56.dp).clip(RoundedCornerShape(6.dp)))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(hit.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                hit.year?.let { Tag("$it") }
                ScoreBadge(aniScore(hit.score))
                hit.status?.let { Text(airingLabel(it) ?: it, style = MaterialTheme.typography.labelSmall, color = AniColors.TextTertiary, maxLines = 1) }
            }
        }
    }
}
