package com.sanjay.anitrack.next.data.providers

import kotlinx.coroutines.flow.StateFlow

data class ProviderAccessState(
    val ready: Boolean = false,
    val verifying: Boolean = false,
    val message: String = "Connect to verify this provider before watching.",
    val generation: Int = 0,
)

/** UI invokes connect only after a user action; match/resume must never launch verification. */
interface ProviderAccess {
    val state: StateFlow<ProviderAccessState>
    suspend fun connect(): Boolean
    fun disconnect()
    fun playbackRejected(status: Int) { }
}
