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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Search
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Manga
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
    var results by remember(manga) { mutableStateOf<List<SearchHit>>(emptyList()) }
    var open by remember { mutableStateOf(false) }
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    // Leaving the search (a result or "view all") releases the field and closes the keyboard.
    fun leave() {
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
            shape = RoundedCornerShape(50),   // pill, like the desktop header
            leadingIcon = { Icon(Icons.Rounded.Search, null, tint = AniColors.TextTertiary) },
            // No trailing slot while empty, so the placeholder gets the full width.
            trailingIcon = if (query.isEmpty()) null else {
                { IconButton(onClick = { query = "" }) { Icon(Icons.Rounded.Close, "Clear", tint = AniColors.TextSecondary, modifier = Modifier.size(18.dp)) } }
            },
            modifier = Modifier.fillMaxWidth().height(50.dp),
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
            modifier = Modifier.width(360.dp).heightIn(max = 520.dp)
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
