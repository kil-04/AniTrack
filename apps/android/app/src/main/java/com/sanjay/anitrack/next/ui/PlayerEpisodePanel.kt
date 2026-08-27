package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
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
import com.sanjay.anitrack.next.data.PlaySession
import com.sanjay.anitrack.next.data.providers.ProviderDescriptor

private val EpisodePanelAccent = Color(0xFFE50914)
private const val EPISODE_RANGE_SIZE = 100

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PlayerEpisodePanel(
    modifier: Modifier,
    provider: String,
    providers: List<ProviderDescriptor>,
    subType: String,
    current: Int,
    watched: Map<Float, Int>,
    switching: Boolean,
    switchError: String?,
    canSwitch: Boolean,
    onSelect: (Int) -> Unit,
    onServer: (String) -> Unit,
    onSubType: (String) -> Unit,
) {
    val count = PlaySession.count
    val rangeCount = ((count + EPISODE_RANGE_SIZE - 1) / EPISODE_RANGE_SIZE).coerceAtLeast(1)
    var range by remember(current, count) { mutableStateOf(current / EPISODE_RANGE_SIZE) }
    var find by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(current, range) {
        val start = range * EPISODE_RANGE_SIZE
        if (current in start until minOf(start + EPISODE_RANGE_SIZE, count)) {
            runCatching { listState.animateScrollToItem((current - start - 2).coerceAtLeast(0)) }
        }
    }

    Column(modifier.background(Color(0xFF0E0E12))) {
        Text(
            "SERVERS",
            style = MaterialTheme.typography.labelSmall,
            color = Color.White.copy(alpha = 0.45f),
            modifier = Modifier.padding(start = 14.dp, top = 10.dp, bottom = 6.dp),
        )
        Row(
            Modifier.padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            providers.forEach { descriptor ->
                FilterChip(
                    selected = provider == descriptor.id,
                    enabled = canSwitch && !switching,
                    onClick = { onServer(descriptor.id) },
                    label = { Text(descriptor.name) },
                )
            }
            if (switching) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = EpisodePanelAccent)
            }
        }
        switchError?.let {
            Text(
                it,
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFFFF6B6B),
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 2.dp),
            )
        }

        if (providers.firstOrNull { it.id == provider }?.capabilities?.subtitleModes == true) {
            Spacer(Modifier.height(8.dp))
            Text(
                "SUB TYPE",
                style = MaterialTheme.typography.labelSmall,
                color = Color.White.copy(alpha = 0.45f),
                modifier = Modifier.padding(start = 14.dp, bottom = 6.dp),
            )
            Row(Modifier.padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = subType == "soft", onClick = { onSubType("soft") }, label = { Text("Soft Sub") })
                FilterChip(selected = subType == "hard", onClick = { onSubType("hard") }, label = { Text("Hard Sub") })
            }
        }
        Spacer(Modifier.height(8.dp))

        Row(
            Modifier.padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (rangeCount > 1) {
                LazyRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(rangeCount) { index ->
                        val first = index * EPISODE_RANGE_SIZE + 1
                        val last = minOf((index + 1) * EPISODE_RANGE_SIZE, count)
                        FilterChip(
                            selected = range == index,
                            onClick = { range = index },
                            label = { Text("$first–$last", style = MaterialTheme.typography.labelSmall) },
                        )
                    }
                }
            } else {
                Spacer(Modifier.weight(1f))
            }
            Box(
                Modifier.width(110.dp).height(34.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(Color.White.copy(alpha = 0.05f))
                    .border(1.dp, Color.White.copy(alpha = 0.15f), RoundedCornerShape(6.dp))
                    .padding(horizontal = 10.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                androidx.compose.foundation.text.BasicTextField(
                    value = find,
                    onValueChange = { value ->
                        find = value.filter(Char::isDigit).take(4)
                        find.toIntOrNull()?.let { number ->
                            val index = (0 until count).firstOrNull {
                                PlaySession.episodeNumber(it).toInt() == number
                            }
                            if (index != null) range = index / EPISODE_RANGE_SIZE
                        }
                    },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.labelMedium.copy(color = Color.White),
                    cursorBrush = androidx.compose.ui.graphics.SolidColor(EpisodePanelAccent),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (find.isEmpty()) {
                    Text(
                        "Find number",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White.copy(alpha = 0.35f),
                    )
                }
            }
        }
        Spacer(Modifier.height(6.dp))

        val start = range * EPISODE_RANGE_SIZE
        val visible = minOf(start + EPISODE_RANGE_SIZE, count) - start
        val findNumber = find.toIntOrNull()
        LazyColumn(state = listState, modifier = Modifier.weight(1f)) {
            items(visible) { offset ->
                val index = start + offset
                val number = PlaySession.episodeNumber(index)
                val watchedPercent = watched[number] ?: 0
                val isCurrent = index == current
                val isFound = findNumber != null && number.toInt() == findNumber
                Row(
                    Modifier.fillMaxWidth()
                        .background(
                            when {
                                isCurrent -> EpisodePanelAccent.copy(alpha = 0.16f)
                                isFound -> Color.White.copy(alpha = 0.10f)
                                else -> Color.Transparent
                            },
                        )
                        .clickable { onSelect(index) }
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "${if (number % 1f == 0f) number.toInt() else number}",
                        modifier = Modifier.width(40.dp),
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal,
                        color = when {
                            isCurrent -> EpisodePanelAccent
                            watchedPercent >= 85 -> Color.White.copy(alpha = 0.35f)
                            else -> Color.White.copy(alpha = 0.85f)
                        },
                    )
                    Text(
                        PlaySession.episodeTitle(index)
                            ?: "Episode ${if (number % 1f == 0f) number.toInt() else number}",
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = when {
                            isCurrent -> Color.White
                            watchedPercent >= 85 -> Color.White.copy(alpha = 0.35f)
                            else -> Color.White.copy(alpha = 0.7f)
                        },
                    )
                    if (watchedPercent >= 85) {
                        Text("✓", style = MaterialTheme.typography.labelSmall, color = EpisodePanelAccent.copy(alpha = 0.8f))
                    } else if (watchedPercent > 0) {
                        Text(
                            "$watchedPercent%",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.White.copy(alpha = 0.4f),
                        )
                    }
                }
            }
        }
    }
}
