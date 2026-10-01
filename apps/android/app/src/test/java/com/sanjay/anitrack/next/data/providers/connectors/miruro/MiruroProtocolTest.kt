package com.sanjay.anitrack.next.data.providers.connectors.miruro

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Base64
import java.util.zip.GZIPOutputStream

class MiruroProtocolTest {
    // One synthetic wire fixture shared with Node; no real video links or site keys.
    private val fixture = JSONObject(generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
        .map { File(it, "tests/fixtures/miruro-protocol.json") }.first { it.isFile }.readText(Charsets.UTF_8))
    private val key = fixture.getString("syntheticKey")
    private val env = "window.env=JSON.parse(${JSONObject.quote(JSONObject().put("VITE_PIPE_OBF_KEY", key).toString())});"

    @Test
    fun requestsPreserveEpisodeServerAudioAndAniListCoordinates() {
        val url = MiruroProtocol.requestUrl(MiruroReadRequest.Sources(80, "series/1?track=dub", "bee", "dub"))
        assertTrue(url.startsWith("${MiruroProtocol.ORIGIN}/api/secure/pipe?e="))
        val envelope = JSONObject(String(Base64.getUrlDecoder().decode(url.substringAfter("?e=")), Charsets.UTF_8))
        assertEquals("sources", envelope.getString("path"))
        assertEquals("GET", envelope.getString("method"))
        assertTrue(envelope.isNull("body"))
        assertEquals(80, envelope.getJSONObject("query").getInt("anilistId"))
        assertEquals("series/1?track=dub", envelope.getJSONObject("query").getString("episodeId"))
        assertEquals("bee", envelope.getJSONObject("query").getString("provider"))
        assertEquals("dub", envelope.getJSONObject("query").getString("category"))
        val softSubUrl = MiruroProtocol.requestUrl(MiruroReadRequest.Sources(80, "episode1", "bee", "ssub"))
        val softSub = JSONObject(String(Base64.getUrlDecoder().decode(softSubUrl.substringAfter("?e=")), Charsets.UTF_8))
        assertEquals("ssub", softSub.getJSONObject("query").getString("category"))
        listOf(
            MiruroReadRequest.Info(-1), MiruroReadRequest.Episodes(0),
            MiruroReadRequest.Sources(80, "1\n", "bee", "sub"),
            MiruroReadRequest.Sources(80, "1", "../config", "sub"),
            MiruroReadRequest.Sources(80, "1", "bee", "unknown"),
        ).forEach { request -> assertThrows(MiruroProtocolException::class.java) { MiruroProtocol.requestUrl(request) } }
    }

    @Test
    fun environmentParserNeverExecutesJavascript() {
        assertEquals(key, MiruroProtocol.environmentKey(env))
        assertEquals(key, MiruroProtocol.environmentKey(" \n$env \n"))
        listOf(
            "${env}globalThis.executed=true", "window.env=JSON.parse(globalThis.executed=true)",
            "window.env=JSON.parse('{}' + alert(1));", "window.env=JSON.parse(\"{}\");", " ".repeat(65_537),
        ).forEach { script -> assertThrows(MiruroProtocolException::class.java) { MiruroProtocol.environmentKey(script) } }
        // Large public env files must not overflow the JVM regular-expression stack.
        val large = JSONObject().put("VITE_PIPE_OBF_KEY", key).put("irrelevant", "x".repeat(40_000))
        assertEquals(key, MiruroProtocol.environmentKey("window.env=JSON.parse(${JSONObject.quote(large.toString())});"))
    }

    @Test
    fun plainGzipAndXorGzipMatchSharedUnicodeFixture() {
        listOf(
            MiruroProtocol.decode(fixture.getJSONObject("payload").toString(), null),
            MiruroProtocol.decode(fixture.getString("gzipBase64url"), "1"),
            MiruroProtocol.decode(fixture.getString("xorGzipBase64url"), "2", key),
        ).forEach { payload ->
            assertEquals("テスト", payload.getString("testLabel"))
            assertEquals(0, payload.getJSONArray("providerOrder").length())
            assertEquals(0, payload.getJSONObject("streaming").length())
        }
    }

    @Test
    fun rejectsBadPayloadsUnknownCodecsAndDecompressionBombs() {
        listOf("[]", "null", "{} trailing", "<html>not JSON</html>", "[".repeat(1000) + "]".repeat(1000))
            .forEach { text -> assertThrows(MiruroProtocolException::class.java) { MiruroProtocol.decode(text, null) } }
        listOf(
            Triple(fixture.getString("gzipBase64url"), "3", key),
            Triple(fixture.getString("xorGzipBase64url"), "2", null),
            Triple(fixture.getString("xorGzipBase64url"), "2", "xyz"),
            Triple("%%%", "1", null),
            Triple(gzip(" ".repeat(MiruroProtocol.MAX_RESPONSE_BYTES + 1)), "1", null),
        ).forEach { (text, codec, mask) ->
            assertThrows(MiruroProtocolException::class.java) { MiruroProtocol.decode(text, codec, mask) }
        }
    }

    @Test
    fun environmentIsLazyExpiresAndSourceResponsesAreNotCached() = runBlocking {
        var time = 0L
        val calls = mutableListOf<String>()
        val client = MiruroClient(MiruroTransport { url, _ ->
            calls += url
            if (url.endsWith("/env2.js")) MiruroHttpResponse(200, env)
            else MiruroHttpResponse(200, fixture.getString("xorGzipBase64url"), "2")
        }, now = { time })
        assertEquals(0, calls.size)
        val request = MiruroReadRequest.Sources(80, "1", "bee", "sub")
        client.read(request)
        client.read(request)
        assertEquals(3, calls.size)
        time = 30 * 60_000L
        client.read(request)
        assertEquals(5, calls.size)
        assertEquals(2, calls.count { it.endsWith("/env2.js") })
    }

    @Test
    fun plainJsonDoesNotFetchAnEnvironment() = runBlocking {
        var calls = 0
        val client = MiruroClient(MiruroTransport { _, _ -> calls++; MiruroHttpResponse(200, "{}") })
        client.read(MiruroReadRequest.Config)
        assertEquals(1, calls)
    }

    @Test
    fun catalogueTextIsNotMistakenForAChallenge() = runBlocking {
        val client = MiruroClient(MiruroTransport { _, _ ->
            MiruroHttpResponse(200, """{"title":"Security Check","description":"Just a moment"}""")
        })
        assertEquals("Security Check", client.read(MiruroReadRequest.Config).getString("title"))
        assertEquals("Security Check", client.read(MiruroReadRequest.Config).getString("title"))
    }

    @Test
    fun securityBlockStopsAttemptButAllowsImmediateManualRetry() = runBlocking {
        val time = 1_000L
        var calls = 0
        val client = MiruroClient(MiruroTransport { _, _ ->
            calls++
            if (calls == 1) MiruroHttpResponse(403, "blocked") else MiruroHttpResponse(200, "{}")
        }, now = { time })
        assertEquals(MiruroFailure.SECURITY_CHECK, failure { client.read(MiruroReadRequest.Config) })
        assertEquals(1, calls)
        client.read(MiruroReadRequest.Config)
        assertEquals(2, calls)
    }

    @Test
    fun rateLimitsHtmlAndEncodedChallengesStopEachAttemptWithoutAutomaticRetry() = runBlocking {
        listOf(
            MiruroHttpResponse(429, ""),
            MiruroHttpResponse(200, "<title>Attention Required! | Cloudflare</title>"),
            MiruroHttpResponse(200, gzip("""{"error":"CAPTCHA_REQUIRED"}"""), "1"),
        ).forEach { response ->
            var calls = 0
            val client = MiruroClient(MiruroTransport { _, _ -> calls++; response })
            val expected = if (response.status == 429) MiruroFailure.RATE_LIMITED else MiruroFailure.SECURITY_CHECK
            assertEquals(expected, failure { client.read(MiruroReadRequest.Config) })
            assertEquals(1, calls)
            assertEquals(expected, failure { client.read(MiruroReadRequest.Config) })
            assertEquals(2, calls)
        }
    }

    @Test
    fun redirectsAndOversizedBodiesAreRejectedWithoutRetry() = runBlocking {
        listOf(MiruroHttpResponse(302, ""), MiruroHttpResponse(200, " ".repeat(MiruroProtocol.MAX_RESPONSE_BYTES + 1)))
            .forEach { response ->
                var calls = 0
                val client = MiruroClient(MiruroTransport { _, _ -> calls++; response })
                assertEquals(MiruroFailure.INVALID_RESPONSE, failure { client.read(MiruroReadRequest.Config) })
                assertEquals(1, calls)
            }
    }

    private suspend fun failure(block: suspend () -> Unit): MiruroFailure {
        try { block() } catch (error: MiruroProtocolException) { return error.failure }
        throw AssertionError("Expected a Miruro protocol failure")
    }

    private fun gzip(text: String): String {
        val output = ByteArrayOutputStream()
        GZIPOutputStream(output).use { it.write(text.toByteArray(Charsets.UTF_8)) }
        return Base64.getUrlEncoder().withoutPadding().encodeToString(output.toByteArray())
    }
}
