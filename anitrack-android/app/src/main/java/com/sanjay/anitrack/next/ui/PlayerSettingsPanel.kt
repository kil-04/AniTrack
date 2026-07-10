package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.Hd
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

private val Accent = Color(0xFFE50914)

/**
 * Desktop-style layered settings panel: main menu (speed / quality /
 * subtitles + Autoplay / Auto-next toggles) with slide-in submenus,
 * anchored above the player control bar.
 */
@Composable
internal fun PlayerSettingsPanel(
    menu: String,
    onMenu: (String?) -> Unit,
    speed: Float, onSpeed: (Float) -> Unit,
    hasSubs: Boolean,
    ccOn: Boolean, onCc: (Boolean) -> Unit,
    capSize: Float, onCapSize: (Float) -> Unit,
    capFont: String, onCapFont: (String) -> Unit,
    capBg: Int, onCapBg: (Int) -> Unit,
    capColor: Int, onCapColor: (Int) -> Unit,
    autoplay: Boolean, onAutoplay: (Boolean) -> Unit,
    autoNext: Boolean, onAutoNext: (Boolean) -> Unit,
) {
    val panelBg = Color(0xF2141419)
    val speedLabel = if (speed == 1f) "Normal" else "${speed}x"

    @Composable
    fun MenuRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, value: String, target: String) {
        Row(
            Modifier.fillMaxWidth().clickable { onMenu(target) }.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, null, tint = Color.White.copy(alpha = 0.85f), modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(12.dp))
            Text(label, color = Color.White, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Text(value, color = Color.White.copy(alpha = 0.5f), style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.width(6.dp))
            Text(">", color = Color.White.copy(alpha = 0.5f))
        }
    }

    @Composable
    fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
        Row(
            Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(horizontal = 16.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, color = Color.White, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Switch(
                checked = checked, onCheckedChange = onChange,
                colors = SwitchDefaults.colors(checkedTrackColor = Accent, checkedThumbColor = Color.White),
            )
        }
    }

    @Composable
    fun BackHeader(title: String) {
        Row(
            Modifier.fillMaxWidth().clickable { onMenu("main") }.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("<", color = Color.White, style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.width(10.dp))
            Text(title, color = Color.White, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        }
    }

    @Composable
    fun SectionLabel(text: String) {
        Text(
            text, color = Color.White.copy(alpha = 0.45f), style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(start = 16.dp, top = 10.dp, bottom = 6.dp),
        )
    }

    @Composable
    fun Chip(label: String, selected: Boolean, minWidth: Dp = 44.dp, onClick: () -> Unit) {
        Box(
            Modifier.sizeIn(minWidth = minWidth, minHeight = 34.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(if (selected) Accent else Color.White.copy(alpha = 0.08f))
                .clickable { onClick() }
                .padding(horizontal = 12.dp),
            contentAlignment = Alignment.Center,
        ) { Text(label, color = Color.White, style = MaterialTheme.typography.labelMedium, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal) }
    }

    Column(
        Modifier.width(300.dp).clip(RoundedCornerShape(12.dp)).background(panelBg).padding(vertical = 6.dp),
    ) {
        when (menu) {
            "speed" -> {
                BackHeader("Playback speed")
                listOf(0.25f, 0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f).forEach { sp ->
                    Row(
                        Modifier.fillMaxWidth().clickable { onSpeed(sp); onMenu("main") }.padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            if (sp == 1f) "Normal" else "${sp}x",
                            color = Color.White, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f),
                        )
                        if (sp == speed) Text("*", color = Accent, fontWeight = FontWeight.Bold)
                    }
                }
            }
            "quality" -> {
                BackHeader("Quality")
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Text("Auto", color = Color.White, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    Text("*", color = Accent, fontWeight = FontWeight.Bold)
                }
            }
            "subtitles" -> {
                BackHeader("Subtitles")
                ToggleRow("Show subtitles", ccOn, onCc)
                SectionLabel("FONT SIZE")
                Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("S" to 0.04f, "M" to 0.055f, "L" to 0.07f, "XL" to 0.09f).forEach { (lbl, sz) ->
                        Chip(lbl, kotlin.math.abs(capSize - sz) < 0.001f) { onCapSize(sz) }
                    }
                }
                SectionLabel("FONT")
                Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("Outfit", capFont == "Outfit", minWidth = 128.dp) { onCapFont("Outfit") }
                    Chip("Sans", capFont == "Sans", minWidth = 128.dp) { onCapFont("Sans") }
                }
                Spacer(Modifier.height(8.dp))
                Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("Mono", capFont == "Mono", minWidth = 128.dp) { onCapFont("Mono") }
                    Chip("Serif", capFont == "Serif", minWidth = 128.dp) { onCapFont("Serif") }
                }
                SectionLabel("BACKGROUND")
                Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("0" to 0x00, "25" to 0x40, "50" to 0x80, "85" to 0xD9, "100" to 0xFF).forEach { (lbl, a) ->
                        Chip(lbl, capBg == a) { onCapBg(a) }
                    }
                }
                SectionLabel("COLOR")
                Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    listOf(
                        android.graphics.Color.WHITE,
                        0xFFD9CE5B.toInt(),
                        0xFF6BBE6E.toInt(),
                        0xFF5BC4D9.toInt(),
                    ).forEach { c ->
                        Box(
                            Modifier.size(34.dp).clip(RoundedCornerShape(50))
                                .background(Color(c))
                                .then(
                                    if (capColor == c) Modifier.border(3.dp, Accent, RoundedCornerShape(50))
                                    else Modifier.border(1.dp, Color.White.copy(alpha = 0.2f), RoundedCornerShape(50)),
                                )
                                .clickable { onCapColor(c) },
                        )
                    }
                }
                Spacer(Modifier.height(10.dp))
            }
            else -> {
                MenuRow(Icons.Filled.Speed, "Playback speed", speedLabel, "speed")
                MenuRow(Icons.Filled.Hd, "Quality", "Auto", "quality")
                if (hasSubs) MenuRow(Icons.Filled.ClosedCaption, "Subtitles", if (ccOn) "On" else "Off", "subtitles")
                HorizontalDivider(color = Color.White.copy(alpha = 0.08f), modifier = Modifier.padding(vertical = 4.dp))
                ToggleRow("Autoplay", autoplay, onAutoplay)
                ToggleRow("Auto-next episode", autoNext, onAutoNext)
            }
        }
    }
}
