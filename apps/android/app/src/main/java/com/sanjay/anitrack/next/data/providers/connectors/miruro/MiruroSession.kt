package com.sanjay.anitrack.next.data.providers.connectors.miruro

import com.sanjay.anitrack.next.data.providers.ProviderAccessState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

/** Main-thread owned session policy, independently testable without a WebView. */
internal class MiruroSession(
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val mutable = MutableStateFlow(ProviderAccessState())
    val state = mutable.asStateFlow()
    private var client: MiruroClient? = null
    private var expiresAt = 0L
    var userAgent = "AniTrack"
        private set

    fun begin() {
        clear("Complete verification yourself, then tap Continue to AniTrack.")
        mutable.value = mutable.value.copy(verifying = true)
    }

    fun accept(transport: MiruroTransport, identity: String) {
        check(state.value.verifying) { "Verification is no longer open" }
        val generation = state.value.generation
        userAgent = identity
        expiresAt = now() + 30 * 60_000
        client = MiruroClient(MiruroTransport { url, cap ->
            requireReady(generation)
            transport.get(url, cap)
        }, now)
        mutable.value = state.value.copy(ready = true, verifying = false, message = "Connected · native playback")
    }

    fun clear(message: String = "Connect to Miruro before watching.") {
        client = null
        expiresAt = 0
        userAgent = "AniTrack"
        mutable.value = ProviderAccessState(message = message, generation = state.value.generation + 1)
    }

    fun reject(status: Int) {
        if (status !in listOf(403, 429)) return
        clear("Miruro rejected the request. You can reconnect or choose another provider now.")
    }

    fun playbackRejected(status: Int) {
        if (status in listOf(403, 429)) mutable.value = state.value.copy(
            message = "This stream server rejected playback. Try another server or retry manually.",
        )
    }

    suspend fun read(request: MiruroReadRequest): JSONObject {
        val generation = state.value.generation
        requireReady(generation)
        val active = client ?: throw MiruroProtocolException("Connect to Miruro before watching.")
        try {
            val result = active.read(request)
            requireReady(generation) // Discard a response after cancellation, closure or reconnection.
            expiresAt = now() + 30 * 60_000
            return result
        } catch (error: MiruroProtocolException) {
            if (state.value.generation == generation) when (error.failure) {
                MiruroFailure.SECURITY_CHECK -> reject(403)
                MiruroFailure.RATE_LIMITED -> reject(429)
                else -> Unit
            }
            throw error
        }
    }

    private fun requireReady(generation: Int) {
        if (generation != state.value.generation || !state.value.ready) throw MiruroProtocolException("Connect to Miruro before watching.")
        if (now() >= expiresAt) {
            clear("Miruro's session expired. Reconnect to continue.")
            throw MiruroProtocolException(state.value.message)
        }
    }

}
