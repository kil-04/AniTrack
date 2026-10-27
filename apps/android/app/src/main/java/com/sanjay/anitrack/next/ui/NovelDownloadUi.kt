package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.DownloadForOffline
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.WarningAmber
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.sanjay.anitrack.next.data.novel.NovelChapter
import com.sanjay.anitrack.next.data.novel.NovelDownloads
import kotlinx.coroutines.launch

/**
 * Save chapters offline: quick picks from the chapter you're on, a position range,
 * live progress with Stop, and what's saved with Remove all.
 */
@Composable
internal fun NovelDownloadDialog(
    chapters: List<NovelChapter>,
    startIndex: Int,
    saved: Set<String>,
    state: NovelDownloads.Title?,
    onDownload: (List<NovelChapter>) -> Unit,
    onStop: () -> Unit,
    onRemoveAll: () -> Unit,
    onDismiss: () -> Unit,
) {
    var from by remember(startIndex) { mutableStateOf((startIndex + 1).toString()) }
    var to by remember(startIndex, chapters.size) { mutableStateOf(minOf(chapters.size, startIndex + 50).toString()) }
    fun unsaved(list: List<NovelChapter>) = list.filter { it.id !in saved }
    val range = run {
        val a = from.toIntOrNull()
        val b = to.toIntOrNull()
        if (a == null || b == null) emptyList() else chapters.subList((minOf(a, b) - 1).coerceIn(0, chapters.size), maxOf(a, b).coerceIn(0, chapters.size))
    }
    val busy = (state?.queued ?: 0) > 0

    Dialog(onDismissRequest = onDismiss) {
        AniCard(Modifier.widthIn(max = 460.dp), padding = PaddingValues(18.dp)) {
            Text("Save offline", style = MaterialTheme.typography.titleMedium, color = AniColors.Text)
            Text("Saved chapters open without a connection.", style = MaterialTheme.typography.bodySmall, color = AniColors.TextTertiary)
            Spacer(Modifier.height(12.dp))
            if (busy) {
                Column(Modifier.fillMaxWidth().clip(aniShape(14.dp)).background(AniColors.AccentSoft).padding(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(state!!.current?.let { "Saving $it" } ?: "Waiting…", color = AniColors.Text, style = MaterialTheme.typography.bodyMedium,
                            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        PillButton("Stop", onStop, icon = Icons.Rounded.Stop, style = PillStyle.Ghost, compact = true)
                    }
                    Text("%,d left · %,d saved".format(state!!.queued, state.saved), color = AniColors.TextTertiary, style = MaterialTheme.typography.labelMedium)
                }
                Spacer(Modifier.height(10.dp))
            }
            if (!busy && state?.error != null) {
                Text(state.error, color = Color(0xFFFCD34D), style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(bottom = 10.dp))
            }
            val start = chapters.getOrNull(startIndex)?.label ?: "here"
            listOf(
                "Next 10 from $start" to unsaved(chapters.drop(startIndex).take(10)),
                "Next 50 from $start" to unsaved(chapters.drop(startIndex).take(50)),
                "Everything from here" to unsaved(chapters.drop(startIndex)),
                "Every chapter" to unsaved(chapters),
            ).forEach { (label, list) ->
                Row(
                    Modifier.fillMaxWidth().clip(aniShape(12.dp)).clickable(enabled = list.isNotEmpty()) { onDownload(list) }.padding(horizontal = 10.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(label, color = if (list.isEmpty()) AniColors.TextTertiary else AniColors.Text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    Text(if (list.isEmpty()) "saved" else "+%,d".format(list.size), color = AniColors.TextTertiary, style = MaterialTheme.typography.labelMedium)
                }
            }
            HorizontalDivider(Modifier.padding(vertical = 10.dp), color = AniColors.BorderSoft)
            Text("Or by position in the list (1–%,d)".format(chapters.size), color = AniColors.TextTertiary, style = MaterialTheme.typography.labelMedium)
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                NumberBox(from) { from = it }
                Text("–", color = AniColors.TextTertiary, modifier = Modifier.padding(horizontal = 8.dp))
                NumberBox(to) { to = it }
                Spacer(Modifier.weight(1f))
                val pick = unsaved(range)
                PillButton(if (pick.isEmpty()) "Save" else "Save +%,d".format(pick.size), { onDownload(pick) }, style = PillStyle.Primary, enabled = pick.isNotEmpty(), compact = true)
            }
            if ((state?.saved ?: 0) > 0) {
                HorizontalDivider(Modifier.padding(vertical = 10.dp), color = AniColors.BorderSoft)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("%,d saved · %s".format(state!!.saved, NovelDownloads.humanSize(state.sizeBytes)), color = AniColors.TextTertiary,
                        style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                    PillButton("Remove all", onRemoveAll, icon = Icons.Rounded.Delete, style = PillStyle.Ghost, compact = true)
                }
            }
        }
    }
}

@Composable
private fun NumberBox(value: String, onChange: (String) -> Unit) {
    Box(
        Modifier.width(84.dp).height(40.dp).clip(aniShape(10.dp)).background(AniColors.SurfaceHigh)
            .border(1.dp, AniColors.BorderSoft, aniShape(10.dp)),
        contentAlignment = Alignment.Center,
    ) {
        BasicTextField(
            value = value,
            onValueChange = { onChange(it.filter(Char::isDigit).take(6)) },
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyMedium.copy(color = AniColors.Text, textAlign = TextAlign.Center),
            cursorBrush = SolidColor(AniColors.Accent),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
        )
    }
}

/** Novels saved to read offline, with live progress for the ones still downloading. */
@Composable
fun NovelDownloadsScreen(onOpen: OpenNovel, onBrowse: () -> Unit) {
    val titles = NovelDownloads.titles
    val scope = rememberCoroutineScope()
    var confirm by remember { mutableStateOf<NovelDownloads.Title?>(null) }
    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 20.dp)) {
        ScreenHeader(
            "Novel Downloads", scene = PixelScene.BEDROOM,
            subtitle = if (titles.isEmpty()) "Chapters you save read without a connection."
            else "%,d chapters offline · %s".format(titles.sumOf { it.saved }, NovelDownloads.humanSize(titles.sumOf { it.sizeBytes })),
            icon = Icons.Rounded.DownloadForOffline,
        )
        Spacer(Modifier.height(18.dp))
        if (titles.isEmpty()) {
            EmptyState(
                Icons.Rounded.DownloadForOffline, "Nothing saved yet",
                "Use Download on a novel's page to save its next chapters, a range, or everything.",
                actionLabel = "Find a novel", onAction = onBrowse,
            )
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(titles, key = { "${it.source.key}:${it.titleId}" }) { t ->
                val busy = t.queued > 0
                AniCard(padding = PaddingValues(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        NovelCover(t.cover, t.title, Modifier.width(64.dp).aspectRatio(1f / POSTER_RATIO).clip(aniShape(10.dp)).clickable { onOpen(t.source, t.titleId) })
                        Spacer(Modifier.width(16.dp))
                        Column(Modifier.weight(1f)) {
                            Text(t.title, style = MaterialTheme.typography.titleSmall, color = AniColors.Text, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.clickable { onOpen(t.source, t.titleId) })
                            Text(
                                metaLine(t.source.label, "%,d chapters".format(t.saved), NovelDownloads.humanSize(t.sizeBytes), if (t.failed > 0) "${t.failed} failed" else null),
                                style = MaterialTheme.typography.labelMedium, color = AniColors.TextTertiary,
                            )
                            if (busy) {
                                Spacer(Modifier.height(8.dp))
                                Text((t.current?.let { "Saving $it" } ?: "Waiting…") + " · %,d left".format(t.queued), style = MaterialTheme.typography.labelMedium, color = AniColors.TextSecondary,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Spacer(Modifier.height(6.dp))
                                ProgressStrip(t.saved.toFloat() / (t.saved + t.queued).coerceAtLeast(1), Modifier.fillMaxWidth(), track = AniColors.SurfaceHigh)
                            } else if (t.error != null) {
                                Spacer(Modifier.height(6.dp))
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Rounded.WarningAmber, null, tint = Color(0xFFFCD34D), modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text(t.error, style = MaterialTheme.typography.labelMedium, color = Color(0xFFFCD34D), maxLines = 2)
                                }
                            }
                        }
                        Spacer(Modifier.width(12.dp))
                        if (busy) PillButton("Stop", { scope.launch { NovelDownloads.cancel(t.source, t.titleId) } }, icon = Icons.Rounded.Stop, style = PillStyle.Tonal, compact = true)
                        Spacer(Modifier.width(8.dp))
                        PillButton("Remove", { confirm = t }, icon = Icons.Rounded.Delete, style = PillStyle.Ghost, compact = true)
                    }
                }
            }
        }
    }
    confirm?.let { t ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text("Remove downloads?") },
            text = { Text("The %,d saved chapters of \"%s\" will be deleted.".format(t.saved, t.title)) },
            confirmButton = { TextButton({ scope.launch { NovelDownloads.remove(t.source, t.titleId) }; confirm = null }) { Text("Remove") } },
            dismissButton = { TextButton({ confirm = null }) { Text("Cancel") } },
        )
    }
}
