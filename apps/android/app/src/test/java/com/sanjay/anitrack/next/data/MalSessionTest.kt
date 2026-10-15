package com.sanjay.anitrack.next.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MalSessionTest {
    // Like 15 Oct 2026: MAL refuses a token whose recorded expiry is still a day away.
    private class Tokens : MalSession.Tokens {
        override var access: String? = "dead"
        override var refresh: String? = "r1"
        override var expiresAt = NOW + 86_400_000
        var signOuts = 0
        override fun save(access: String, refresh: String, expiresAt: Long) {
            this.access = access
            this.refresh = refresh
            this.expiresAt = expiresAt
        }
        override fun signOut() {
            access = null
            refresh = null
            signOuts++
        }
    }

    private val tokens = Tokens()
    private val refreshes = mutableListOf<String>()
    private val sent = mutableListOf<String>()

    private fun session(refresh: suspend () -> MalSession.Refresh) =
        MalSession(tokens, { refreshes += it; refresh() }, now = { NOW })

    private fun reply(code: Int): Response = Response.Builder()
        .request(Request.Builder().url("https://api.myanimelist.net/v2/anime/1/my_list_status").build())
        .protocol(Protocol.HTTP_1_1)
        .code(code)
        .message("")
        .body("{}".toResponseBody())
        .build()

    /** MAL refuses the old token, and every token when [refuseAll]. */
    private fun mal(refuseAll: Boolean = false): suspend (String) -> Response = { token ->
        sent += token
        reply(if (token == "dead" || refuseAll) 401 else 200)
    }

    @Test fun refusedTokenIsRefreshedOnceAndTheRequestSentAgain() = runBlocking {
        val session = session { MalSession.Refresh.Granted("fresh", "r2", 2_678_400) }
        assertEquals(200, session.send(mal())?.code)
        assertEquals(listOf("dead", "fresh"), sent)
        assertEquals(listOf("r1"), refreshes)
        assertEquals("fresh", tokens.access)
        assertEquals("r2", tokens.refresh)
        assertEquals(NOW + 2_678_400_000, tokens.expiresAt)
        // Later requests use the new token straight away.
        assertEquals(200, session.send(mal())?.code)
        assertEquals(listOf("dead", "fresh", "fresh"), sent)
        assertEquals(1, refreshes.size)
    }

    @Test fun requestsRefusedTogetherShareOneRefresh() = runBlocking {
        // MAL rotates refresh tokens: refreshing r1 twice would sign the user out.
        val bothSent = CompletableDeferred<Unit>()
        val session = session {
            yield() // still refreshing when the other request is refused
            MalSession.Refresh.Granted("fresh", "r2", 3600)
        }
        val request: suspend (String) -> Response = { token ->
            sent += token
            if (token == "dead") {
                if (sent.size == 2) bothSent.complete(Unit)
                bothSent.await()
                reply(401)
            } else reply(200)
        }
        val first = async { session.send(request)?.code }
        val second = async { session.send(request)?.code }
        assertEquals(200, first.await())
        assertEquals(200, second.await())
        assertEquals(listOf("r1"), refreshes)
        assertEquals(listOf("dead", "dead", "fresh", "fresh"), sent)
    }

    @Test fun refusedRefreshSignsOutOnceWithoutRetrying() = runBlocking {
        val session = session { MalSession.Refresh.Refused }
        assertNull(session.send(mal()))
        assertEquals(listOf("dead"), sent)
        assertEquals(1, tokens.signOuts)
        // No loop: nothing more is sent or refreshed.
        assertNull(session.send(mal()))
        assertEquals(listOf("dead"), sent)
        assertEquals(1, refreshes.size)
        assertEquals(1, tokens.signOuts)
    }

    @Test fun tokenRefusedRightAfterRefreshingSignsOutInsteadOfRefreshingAgain() = runBlocking {
        val session = session { MalSession.Refresh.Granted("fresh", "r2", 3600) }
        assertNull(session.send(mal(refuseAll = true)))
        assertEquals(listOf("dead", "fresh"), sent)
        assertEquals(1, tokens.signOuts)
        assertNull(session.send(mal(refuseAll = true)))
        assertEquals(listOf("dead", "fresh"), sent)
        assertEquals(1, refreshes.size)
    }

    @Test fun refreshThatCannotReachMalKeepsTheSignIn() = runBlocking {
        val session = session { MalSession.Refresh.Failed }
        assertNull(session.send(mal()))
        assertEquals(listOf("dead"), sent)
        assertEquals(0, tokens.signOuts)
        assertEquals("dead", tokens.access)
        assertEquals("r1", tokens.refresh)
    }

    @Test fun otherFailuresAreSentBackWithoutARefresh() = runBlocking {
        val session = session { error("only a 401 refreshes") }
        val response = session.send { token -> sent += token; reply(500) }
        assertEquals(500, response?.code)
        assertEquals(listOf("dead"), sent)
        assertTrue(refreshes.isEmpty())
    }

    @Test fun expiringTokenIsStillRefreshedBeforeSending() = runBlocking {
        tokens.expiresAt = NOW + 30_000
        val session = session { MalSession.Refresh.Granted("fresh", "r2", 3600) }
        assertEquals(200, session.send(mal())?.code)
        assertEquals(listOf("fresh"), sent)
        assertEquals(listOf("r1"), refreshes)
    }

    private companion object {
        const val NOW = 1_792_022_400_000L // 15 Oct 2026
    }
}
