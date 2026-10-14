package com.sanjay.anitrack.next.data.providers.connectors.miruro

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

class MiruroV1ProtocolTest {
    @Test fun routesUseExactAllowedPageSizesOpaqueShowAndNumericEpisode() {
        assertEquals("${MiruroProtocol.ORIGIN}/api/v1/anime?anilist_id_in=1&limit=100", MiruroV1Protocol.requestUrl(MiruroV1ReadRequest.Lookup(1)))
        assertEquals("${MiruroProtocol.ORIGIN}/api/v1/anime/synthetic-show/episodes?limit=10000", MiruroV1Protocol.requestUrl(MiruroV1ReadRequest.Episodes("synthetic-show")))
        assertEquals("${MiruroProtocol.ORIGIN}/api/v1/anime/synthetic-show/episodes/1/play", MiruroV1Protocol.requestUrl(MiruroV1ReadRequest.Play("synthetic-show", 1.0)))
        assertEquals("${MiruroProtocol.ORIGIN}/api/v1/anime/synthetic-show/episodes/1.5/play", MiruroV1Protocol.requestUrl(MiruroV1ReadRequest.Play("synthetic-show", 1.5)))
        listOf(MiruroV1ReadRequest.Lookup(1), MiruroV1ReadRequest.Episodes("synthetic-show"),
            MiruroV1ReadRequest.Play("synthetic-show", 1.5), MiruroV1ReadRequest.Play("synthetic-show", 0.0000001))
            .forEach { assertNotNull(MiruroRequestPolicy.request(MiruroV1Protocol.requestUrl(it))) }
        listOf(MiruroV1ReadRequest.Lookup(0), MiruroV1ReadRequest.Episodes("../other"),
            MiruroV1ReadRequest.Play("valid", -1.0), MiruroV1ReadRequest.Play("valid", Double.NaN),
            MiruroV1ReadRequest.Play("valid", Double.POSITIVE_INFINITY), MiruroV1ReadRequest.Play("valid", 100_001.0))
            .forEach { assertThrows(MiruroProtocolException::class.java) { MiruroV1Protocol.requestUrl(it) } }
    }

    @Test fun arbitraryRoutesAndQueryChangesAreDeniedBeforeSessionAccess() {
        var accesses = 0
        listOf("/api/v1/anime?anilist_id_in=1&limit=12", "/api/v1/anime?anilist_id_in=1&limit=100&limit=100",
            "/api/v1/anime?anilist_id_in=01&limit=100", "/api/v1/anime/show/episodes",
            "/api/v1/anime/show/episodes?limit=10000&cursor=x", "/api/v1/anime/show/episodes/100001/play",
            "/api/v1/anime/show/episodes/1/play?track=dub", "/api/v1/anime/show/episodes/1/play#fragment",
            "/api/v1/anime/show/episodes/opaque-id/play").forEach { route ->
            assertThrows(MiruroProtocolException::class.java) {
                MiruroRequestPolicy.request(MiruroProtocol.ORIGIN + route) { accesses++; MiruroRequestSession("test", null) }
            }
        }
        assertEquals(0, accesses)
    }

    @Test fun binaryPublicCodecPreservesUnicodeWithoutMutatingInput() {
        val value = """{"title":"テスト – café 🎬","nested":{"values":[true,null,1.5]}}"""
        val bytes = wire(value)
        val original = bytes.copyOf()
        val payload = MiruroV1Protocol.decode(bytes, "Application/Octet-Stream; charset=binary")
        assertEquals("テスト – café 🎬", payload.getString("title"))
        assertArrayEquals(original, bytes)
        assertEquals(3, payload.getJSONObject("nested").getJSONArray("values").length())
        assertEquals("テスト – café 🎬", MiruroV1Protocol.decode(value.toByteArray(Charsets.UTF_8), "application/json").getString("title"))
    }

    @Test fun rejectsMalformedJsonBadUtf8WrongCodecAndBoundedDecompression() {
        listOf("[]", "null", "{} trailing", "{unquoted:1}", "{'key':1}", "{\"key\":01}", "{\"key\":NaN}",
            "{\"key\":1,}", "{\"key\":[1,]}", "{\"key\":\"bad\nstring\"}", "{\"key\":\"\\x41\"}",
            "[".repeat(1000) + "]".repeat(1000)).forEach { text ->
            assertThrows(MiruroProtocolException::class.java) { MiruroV1Protocol.decode(text.toByteArray(Charsets.UTF_8), "application/json") }
        }
        listOf(byteArrayOf(0xc3.toByte(), 0x28), byteArrayOf(1, 2, 3),
            ByteArray(MiruroProtocol.MAX_RESPONSE_BYTES + 1)).forEach { bytes ->
            assertThrows(MiruroProtocolException::class.java) { MiruroV1Protocol.decode(bytes, "application/octet-stream") }
        }
        assertThrows(MiruroProtocolException::class.java) {
            MiruroV1Protocol.decode(byteArrayOf(0xc3.toByte(), 0x28), "application/json")
        }
        assertThrows(MiruroProtocolException::class.java) {
            MiruroV1Protocol.decode(wire(JSONObject().put("padding", "a".repeat(MiruroProtocol.MAX_RESPONSE_BYTES)).toString()), "application/octet-stream")
        }
    }

    @Test fun playIsFreshDoesNotReadRetiredEnvironmentOrCacheMedia() = runBlocking {
        val calls = mutableListOf<String>()
        val client = MiruroClient(MiruroTransport { url, cap ->
            calls += url
            assertEquals(MiruroProtocol.MAX_RESPONSE_BYTES, cap)
            MiruroHttpResponse(200, bytes = wire("""{"version":${calls.size}}"""), contentType = "application/octet-stream")
        })
        val request = MiruroV1ReadRequest.Play("synthetic-show", 1.5)
        assertEquals(1, client.read(request).getInt("version"))
        assertEquals(2, client.read(request).getInt("version"))
        assertEquals(2, calls.size)
        assertTrue(calls.all { it.endsWith("/episodes/1.5/play") })
        assertFalse(calls.any { it.contains("pipe") || it.contains("env2") })
    }

    @Test fun queuedAccessRejectionStopsFanOutButNewManualAttemptIsAllowed() = runBlocking {
        for (status in listOf(403, 429)) {
            val started = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            var calls = 0
            val client = MiruroClient(MiruroTransport { _, _ ->
                calls++
                if (calls == 1) { started.complete(Unit); release.await(); MiruroHttpResponse(status) }
                else MiruroHttpResponse(200, "{}")
            })
            val first = async { failure { client.read(MiruroV1ReadRequest.Lookup(1)) } }
            started.await()
            val second = async { failure { client.read(MiruroV1ReadRequest.Play("show", 1.0)) } }
            kotlinx.coroutines.yield()
            release.complete(Unit)
            val expected = if (status == 429) MiruroFailure.RATE_LIMITED else MiruroFailure.SECURITY_CHECK
            assertEquals(expected, first.await())
            assertEquals(expected, second.await())
            assertEquals(1, calls)
            client.read(MiruroV1ReadRequest.Lookup(1))
            assertEquals(2, calls)
        }
    }

    @Test fun htmlAndBinaryStructuredChallengesStopSingleRequest() = runBlocking {
        for (response in listOf(MiruroHttpResponse(503, "<title>Just a moment</title>"),
            MiruroHttpResponse(503, """{"error":"CAPTCHA_REQUIRED"}"""),
            MiruroHttpResponse(200, bytes = wire("""{"code":"CAPTCHA_REQUIRED"}"""), contentType = "application/octet-stream"))) {
            var calls = 0
            val client = MiruroClient(MiruroTransport { _, _ -> calls++; response })
            assertEquals(MiruroFailure.SECURITY_CHECK, failure { client.read(MiruroV1ReadRequest.Lookup(1)) })
            assertEquals(1, calls)
        }
    }

    @Test fun ordinaryCatalogueTextIsNotAChallengeAndRedirectsDoNotRetry() = runBlocking {
        val client = MiruroClient(MiruroTransport { _, _ -> MiruroHttpResponse(200, """{"title":"Security Check"}""") })
        assertEquals("Security Check", client.read(MiruroV1ReadRequest.Lookup(1)).getString("title"))
        var calls = 0
        val redirect = MiruroClient(MiruroTransport { _, _ -> calls++; MiruroHttpResponse(302) })
        assertEquals(MiruroFailure.INVALID_RESPONSE, failure { redirect.read(MiruroV1ReadRequest.Lookup(1)) })
        assertEquals(1, calls)
    }

    @Test fun v1SessionGenerationAndRejectionRemainUserOperated() = runBlocking {
        var calls = 0
        val session = MiruroSession(now = { 1L })
        assertEquals(MiruroFailure.INVALID_RESPONSE, failure { session.read(MiruroV1ReadRequest.Lookup(1)) })
        session.begin()
        session.accept(MiruroTransport { _, _ -> calls++; MiruroHttpResponse(403) }, "verified identity")
        assertEquals(MiruroFailure.SECURITY_CHECK, failure { session.read(MiruroV1ReadRequest.Lookup(1)) })
        assertFalse(session.state.value.ready)
        assertEquals(1, calls)
        session.begin()
        session.accept(MiruroTransport { _, _ -> calls++; MiruroHttpResponse(200, bytes = wire("{}"), contentType = "application/octet-stream") }, "verified identity")
        session.read(MiruroV1ReadRequest.Lookup(1))
        assertTrue(session.state.value.ready)
        session.playbackRejected(403)
        assertTrue(session.state.value.ready)
        assertEquals(2, calls)
    }

    private suspend fun failure(operation: suspend () -> Unit): MiruroFailure {
        try { operation() } catch (error: MiruroProtocolException) { return error.failure }
        throw AssertionError("Expected a Miruro protocol failure")
    }
    private fun wire(text: String): ByteArray {
        val output = ByteArrayOutputStream()
        GZIPOutputStream(output).use { it.write(text.toByteArray(Charsets.UTF_8)) }
        val bytes = output.toByteArray()
        val mask = "miruro/catalog".toByteArray(Charsets.UTF_8)
        bytes.indices.forEach { index -> bytes[index] = (bytes[index].toInt() xor mask[index % mask.size].toInt()).toByte() }
        return bytes
    }
}
