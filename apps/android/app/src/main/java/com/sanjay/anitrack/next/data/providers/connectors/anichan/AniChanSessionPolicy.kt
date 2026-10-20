package com.sanjay.anitrack.next.data.providers.connectors.anichan

import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlin.math.ceil

internal object AniChanSessionPolicy {
    /** A source-owned timeout is an ordinary load failure; outside cancellation still propagates. */
    suspend fun <T : Any> timed(milliseconds: Long, message: String, operation: suspend () -> T): T =
        withTimeoutOrNull(milliseconds) { operation() } ?: throw AniChanException(message)

    /** Finish the active request's abort before a serialized successor is allowed to run. */
    suspend fun finishRequest(abort: suspend () -> Unit) = withContext(NonCancellable) { abort() }

    fun retryAfterSeconds(value: Any?): Long = (value as? Number)?.toDouble()?.takeIf { it.isFinite() }
        ?.coerceIn(1.0, 300.0)?.let { ceil(it).toLong() } ?: 60L
}
