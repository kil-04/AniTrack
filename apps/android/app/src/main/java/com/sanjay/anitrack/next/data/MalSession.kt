package com.sanjay.anitrack.next.data

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.Response

/**
 * The MAL sign-in's access token, apart from Android so it can be unit tested.
 * MAL rotates refresh tokens, so refreshes never run side by side. MAL can also
 * refuse an access token before its recorded expiry (HTTP 401): that token is
 * refreshed once and the request sent once more, instead of being reused on
 * every flush while nothing reaches MAL.
 */
internal class MalSession(
    private val tokens: Tokens,
    private val refresh: suspend (refreshToken: String) -> Refresh,
    private val now: () -> Long = System::currentTimeMillis,
) {
    interface Tokens {
        val access: String?
        val refresh: String?
        val expiresAt: Long
        fun save(access: String, refresh: String, expiresAt: Long)
        /** MAL refused the sign-in: only connecting again can fix it. */
        fun signOut()
    }

    sealed interface Refresh {
        class Granted(val access: String, val refresh: String, val expiresInSeconds: Long) : Refresh
        /** 400/401 from the token endpoint: the refresh token is dead. */
        data object Refused : Refresh
        /** Offline or a server error: keep the sign-in, fail this request. */
        data object Failed : Refresh
    }

    private val lock = Mutex()

    /** The access token, refreshed first when it is about to expire. */
    suspend fun accessToken(): String? = lock.withLock {
        val access = tokens.access ?: return null
        if (now() < tokens.expiresAt - 60_000) access else refreshLocked()
    }

    /** Sends [request] with the access token. Null: no usable sign-in. */
    suspend fun send(request: suspend (token: String) -> Response): Response? {
        val token = accessToken() ?: return null
        val first = request(token)
        if (first.code != 401) return first
        first.close()
        val fresh = replace(token) ?: return null
        val second = request(fresh)
        if (second.code != 401) return second
        second.close()
        // Refused straight after MAL issued it: only a new sign-in can fix that.
        lock.withLock { if (tokens.access == fresh) tokens.signOut() }
        return null
    }

    /** A token MAL refused: refresh it, unless another request already did. */
    private suspend fun replace(refused: String): String? = lock.withLock {
        val access = tokens.access ?: return null
        if (access != refused) access else refreshLocked()
    }

    private suspend fun refreshLocked(): String? {
        val refreshToken = tokens.refresh ?: return null
        return when (val result = refresh(refreshToken)) {
            is Refresh.Granted -> {
                tokens.save(result.access, result.refresh, now() + result.expiresInSeconds * 1000)
                result.access
            }
            Refresh.Refused -> {
                tokens.signOut()
                null
            }
            Refresh.Failed -> null
        }
    }
}
