package com.sanjay.anitrack.next.data.manga.comix

import kotlinx.coroutines.withTimeoutOrNull

/** Only our own deadline becomes an error; enclosing deadlines stay cancellation. */
internal suspend fun <T : Any> comixCatalogueDeadline(
    timeoutMillis: Long = 40_000,
    block: suspend () -> T,
): T = withTimeoutOrNull(timeoutMillis) { block() }
    ?: error("Comix catalogue timed out. Retry manually.")
