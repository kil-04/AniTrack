package com.sanjay.anitrack.next.data.manga.comix

import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

/** Allow a closing loading window to return focus, but never launch from the background. */
internal suspend fun awaitComixForeground(timeoutMillis: Long = 2_000, ready: () -> Boolean) {
    check(withTimeoutOrNull(timeoutMillis) {
        while (!ready()) delay(25)
        true
    } == true) { "Return to AniTrack and retry Comix." }
}
