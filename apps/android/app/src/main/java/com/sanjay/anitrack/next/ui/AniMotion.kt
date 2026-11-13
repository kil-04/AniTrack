package com.sanjay.anitrack.next.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp

/*
 * Small motion pieces shared by the app's screens. They only scale or move an element
 * in its graphics layer (nothing is laid out again), like the desktop's motion rules
 * (renderer/index.css "Motion").
 *
 * Screen-to-screen transitions are deliberately NOT here: the navigation library's own
 * cross-fade (old screen out as the new one comes in, over the same time) is what the
 * app uses. A quicker fade that moved in steps in Pixel mode was tried on 13 Nov 2026;
 * on the tablet it lost the flow between screens, and it was removed.
 */

/**
 * What a pressed card or button does: it gives a little under the finger and springs back; in
 * Pixel mode it steps down and to the right, into its hard shadow. Put it first in the chain so
 * the whole element moves, and give the same [interaction] to its `clickable`.
 */
fun Modifier.pressScale(interaction: InteractionSource): Modifier = composed {
    val pressed by interaction.collectIsPressedAsState()
    val pixel = AniColors.pixelMode.value
    val amount by animateFloatAsState(
        if (pressed) 1f else 0f,
        if (pixel) snap() else spring(dampingRatio = 0.62f, stiffness = 650f),
        label = "press",
    )
    graphicsLayer {
        if (pixel) {
            translationX = amount * 2.dp.toPx()
            translationY = amount * 2.dp.toPx()
        } else {
            val scale = 1f - 0.035f * amount
            scaleX = scale
            scaleY = scale
        }
    }
}

/** `clickable` with [pressScale]: for cards whose whole surface is the tap target. [shape] clips the ripple. */
fun Modifier.pressable(shape: Shape? = null, enabled: Boolean = true, onClick: () -> Unit): Modifier = composed {
    val interaction = remember { MutableInteractionSource() }
    pressScale(interaction)
        .then(if (shape != null) Modifier.clip(shape) else Modifier)
        .clickable(interactionSource = interaction, indication = LocalIndication.current, enabled = enabled, onClick = onClick)
}
