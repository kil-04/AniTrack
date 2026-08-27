package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
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
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.ui.layout.ContentScale as CS
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.AniList
import kotlinx.coroutines.delay

private val Accent = Color(0xFFE50914)

// ── Nav search box with a live results dropdown (desktop header search) ───────

@Composable
fun NavSearchBox(modifier: Modifier = Modifier, onOpen: (Anime) -> Unit, onViewAll: () -> Unit = {}) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Anime>>(emptyList()) }
    var open by remember { mutableStateOf(false) }

    LaunchedEffect(query) {
        if (query.isBlank()) { results = emptyList(); open = false; return@LaunchedEffect }
        delay(350)
        runCatching { results = AniList.search(query.trim()) }
        open = results.isNotEmpty()
    }

    Box(modifier) {
        OutlinedTextField(
            value = query, onValueChange = { query = it },
            placeholder = { Text("Search anime…", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.4f)) },
            singleLine = true,
            shape = RoundedCornerShape(50),   // pill, like the desktop header
            leadingIcon = { Icon(Icons.Filled.Search, null, tint = Color.White.copy(alpha = 0.5f)) },
            trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Close, "Clear", tint = Color.White.copy(alpha = 0.6f), modifier = Modifier.size(16.dp)) } },
            modifier = Modifier.fillMaxWidth().height(52.dp),
            textStyle = MaterialTheme.typography.bodyMedium,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Accent,
                unfocusedBorderColor = Color.White.copy(alpha = 0.15f),
                focusedContainerColor = Color.White.copy(alpha = 0.06f),
                unfocusedContainerColor = Color.White.copy(alpha = 0.06f),
                cursorColor = Accent,
            ),
        )
        // Aligned flush under the bar, same width — like the desktop dropdown.
        DropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            properties = androidx.compose.ui.window.PopupProperties(focusable = false),
            offset = androidx.compose.ui.unit.DpOffset(0.dp, 6.dp),
            shape = RoundedCornerShape(14.dp),
            containerColor = Color(0xFF16161C),
            modifier = Modifier.width(320.dp).heightIn(max = 500.dp),
        ) {
            results.take(9).forEach { a ->
                DropdownMenuItem(
                    onClick = { open = false; query = ""; onOpen(a) },
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            AsyncImage(
                                model = a.cover, contentDescription = a.title, contentScale = CS.Crop,
                                modifier = Modifier.width(38.dp).height(52.dp).clip(RoundedCornerShape(5.dp)).background(Color.White.copy(alpha = 0.06f)),
                            )
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(a.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Spacer(Modifier.height(2.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    a.year?.let {
                                        Box(Modifier.clip(RoundedCornerShape(4.dp)).background(Color.White.copy(alpha = 0.1f)).padding(horizontal = 5.dp, vertical = 1.dp)) {
                                            Text("$it", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.7f))
                                        }
                                    }
                                    a.score?.let { Text("★ ${it / 10.0}", style = MaterialTheme.typography.labelSmall, color = Color(0xFF7CD07C)) }
                                    a.status?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.5f)) }
                                }
                            }
                        }
                    },
                )
            }
            HorizontalDivider(color = Color.White.copy(alpha = 0.08f))
            DropdownMenuItem(
                onClick = { open = false; onViewAll() },
                text = {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("View all results for \"$query\"", style = MaterialTheme.typography.labelLarge, color = Color.White.copy(alpha = 0.8f), modifier = Modifier.weight(1f))
                        Icon(Icons.AutoMirrored.Filled.ArrowForward, null, tint = Color.White.copy(alpha = 0.6f), modifier = Modifier.size(16.dp))
                    }
                },
            )
        }
    }
}
