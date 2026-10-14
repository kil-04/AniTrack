package com.sanjay.anitrack.next.data.providers.connectors.mkissa

import com.sanjay.anitrack.next.data.providers.StreamAuthorizationScope
import com.sanjay.anitrack.next.data.providers.connectors.MkissaProvider
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class MkissaByseTest {
    @Test
    fun publicCodecSupportsVersionMapAndUnknownVersionAllPartsWithoutRemoteCode() {
        for (version in listOf("1", "15", "20", "unknown")) {
            val decoded = MkissaByse.decodePlayback(encrypt(PLAYBACK, version))
            assertEquals(JSONObject(PLAYBACK).toString(), decoded.toString())
            val media = MkissaByse.media(JSONObject().put("playback", encrypt(PLAYBACK, version))
                .put("skip_intro", JSONObject().put("from_seconds", 5).put("to_seconds", 95)))
            assertEquals("https://video.example/episode/master.m3u8", media.url)
            assertEquals(MkissaMediaKind.HLS, media.kind)
            assertEquals(MkissaSkipRange(5.0, 95.0), media.intro)
            assertEquals(1, media.subtitles.size)
            assertEquals("English", media.subtitles.single().label)
            assertTrue(media.subtitles.single().default)
        }
    }

    @Test
    fun codecRejectsAlgorithmTamperingBrokenAuthenticationAndMalformedData() {
        val algorithm = encrypt(PLAYBACK).put("algorithm", "AES-CBC")
        val parts = encrypt(PLAYBACK).put("key_parts", JSONArray(List(65) { "AA" }))
        val iv = encrypt(PLAYBACK).put("iv", "%%")
        val shortPayload = encrypt(PLAYBACK).put("payload", "AA")
        val corrupted = encrypt(PLAYBACK)
        val bytes = Base64.getUrlDecoder().decode(corrupted.getString("payload"))
        bytes[0] = (bytes[0].toInt() xor 1).toByte()
        corrupted.put("payload", Base64.getUrlEncoder().withoutPadding().encodeToString(bytes))
        for (envelope in listOf(algorithm, parts, iv, shortPayload, corrupted, encrypt("[]"), encrypt("not-json"))) {
            assertThrows(MkissaUnsupportedSourceException::class.java) { MkissaByse.decodePlayback(envelope) }
        }
        assertThrows(MkissaUnsupportedSourceException::class.java) {
            MkissaByse.decodePlayback(encryptBytes(byteArrayOf(0x80.toByte())))
        }
    }

    @Test
    fun sourceAndCaptionParserRejectsEmbedsPrivateUrlsAndMismatchedMime() {
        for (source in listOf(
            """{"url":"https://embed.example/e/token","mime_type":"text/html"}""",
            """{"url":"https://video.example/master.m3u8","mime_type":"video/mp4"}""",
        )) {
            assertThrows(MkissaUnsupportedSourceException::class.java) {
                MkissaByse.media(JSONObject().put("playback", encrypt("""{"sources":[$source]}""")))
            }
        }
        assertThrows(IllegalArgumentException::class.java) {
            MkissaByse.media(JSONObject().put("playback", encrypt(
                """{"sources":[{"url":"https://127.0.0.1/private.mp4","mime_type":"video/mp4"}]}""",
            )))
        }
        val mp4 = MkissaByse.media(JSONObject().put("playback", encrypt(
            """{"sources":[{"url":"https://video.example/opaque","mime_type":"video/mp4"}]}""",
        )))
        assertEquals(MkissaMediaKind.MP4, mp4.kind)
        assertEquals("video/mp4", MkissaProvider.toResolvedMedia(MkissaMediaSource(mp4.url, "Fm-Hls", mp4.kind, emptyMap())).mimeType)
    }

    @Test
    fun fixedRoutesAndExplicitVerificationPremiumAndProcessingGatesFailClosed() {
        assertEquals("https://bysekoze.com/api/videos/fixture_video/embed/playback",
            MkissaByse.apiUrl(EMBED, MkissaByse.Operation.PLAYBACK))
        assertThrows(MkissaUnsupportedSourceException::class.java) {
            MkissaByse.apiUrl("https://bysekoze.com/e/a/b", MkissaByse.Operation.SETTINGS)
        }
        MkissaByse.assertAccess(JSONObject("""{"code":"fixture_video","captcha_required":false}"""))
        for (gate in listOf(
            """{"captcha_required":true}""", """{"captcha_required":1}""",
            """{"fingerprint_required":true}""", """{"error":"Fingerprint attestation required"}""",
            """{"pow_token":"fixture"}""", """{"pow_nonce":"fixture"}""",
            """{"code":"NEED_CAPTCHA"}""",
        )) {
            assertThrows(MkissaRateLimitedException::class.java) { MkissaByse.assertAccess(JSONObject(gate)) }
        }
        for (gate in listOf("""{"premium_only":true}""", """{"processing":{"locked":true}}""")) {
            assertThrows(MkissaUnsupportedSourceException::class.java) { MkissaByse.assertAccess(JSONObject(gate)) }
        }
    }

    @Test
    fun frontendUsesOnlyReviewedSameOriginOperationsAndHandsOffNativeMedia() = runBlocking {
        val requests = mutableListOf<MkissaHttpRequest>()
        val service = MkissaService(transport = MkissaHttpTransport { request ->
            requests += request
            when {
                request.url.endsWith("/settings") -> MkissaHttpResponse(200, """{"code":"fixture_video","captcha_required":false}""")
                request.url.endsWith("/playback") -> MkissaHttpResponse(200, JSONObject()
                    .put("playback", encrypt(PLAYBACK))
                    .put("skip_intro", JSONObject().put("from_seconds", 5).put("to_seconds", 95)).toString())
                request.url == EMBED -> MkissaHttpResponse(200, "<title>Byse Frontend</title><script src='/assets/untrusted.js'></script>")
                else -> error("Unreviewed operation")
            }
        })
        val media = service.resolve(SOURCE).single()
        assertEquals(3, requests.size)
        assertTrue(requests.none { it.url.contains(".js") || it.url.contains("fingerprint") || it.url.contains("captcha") })
        assertTrue(requests.all { it.url.startsWith("https://bysekoze.com/") })
        requests.drop(1).forEach {
            assertEquals(EMBED, it.headers["Referer"])
            assertEquals("https://bysekoze.com", it.headers["Origin"])
            assertEquals("mkissa.to", it.headers["X-Embed-Origin"])
            assertEquals("https://mkissa.to/", it.headers["X-Embed-Referer"])
        }
        val native = MkissaProvider.toResolvedMedia(media)
        assertEquals("https://video.example/episode/master.m3u8", native.url)
        assertEquals(StreamAuthorizationScope.DIRECTORY, native.authorizationScope)
        assertEquals(EMBED, native.referer)
        assertEquals("https://bysekoze.com", native.requestHeaders["Origin"])
        assertFalse(native.requestHeaders.containsKey("X-Embed-Origin"))
        assertEquals(5L, native.intro?.startSeconds)
        assertEquals(95L, native.intro?.endSeconds)
        assertEquals("en", native.subtitles.single().language)
        assertTrue(native.subtitles.single().default)
        assertTrue(native.conservativeNetwork)
    }

    @Test
    fun verificationSettingsStopsBeforePlaybackAndFallbackButAllowsManualRetry() = runBlocking {
        for (gate in listOf("""{"captcha_required":true}""", """{"error":"Fingerprint attestation required"}""")) {
            var calls = 0
            val service = MkissaService(transport = MkissaHttpTransport { request ->
                calls++
                if (request.url.endsWith("/settings")) MkissaHttpResponse(200, gate)
                else MkissaHttpResponse(200, "<title>Byse Frontend</title>")
            })
            val fallback = MkissaSourceCandidate("https://media.example/never-played.mp4", "Fallback", "player", 1f)
            assertTrue(runCatching { service.resolveFirst(listOf(SOURCE, fallback)) }.exceptionOrNull() is MkissaRateLimitedException)
            assertEquals(2, calls)
            assertTrue(runCatching { service.resolve(SOURCE) }.exceptionOrNull() is MkissaRateLimitedException)
            assertEquals("A distinct manual retry remains immediately available", 4, calls)
        }
    }

    @Test
    fun apiRedirectDoesNotLeakCatalogueContext() = runBlocking {
        var calls = 0
        val service = MkissaService(transport = MkissaHttpTransport { request ->
            calls++
            if (request.url.endsWith("/settings")) MkissaHttpResponse(302, "", mapOf("Location" to "https://other.example/api"))
            else MkissaHttpResponse(200, "<title>Byse Frontend</title>")
        })
        assertTrue(runCatching { service.resolve(SOURCE) }.exceptionOrNull() is MkissaUnsupportedSourceException)
        assertEquals(2, calls)
    }

    private fun encrypt(value: String, version: String = "1") = encryptBytes(value.toByteArray(), version)

    private fun encryptBytes(value: ByteArray, version: String = "1"): JSONObject {
        val key = ByteArray(32) { 7 }
        val iv = ByteArray(12) { 3 }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        val encoded = Base64.getUrlEncoder().withoutPadding()
        val numeric = version.toIntOrNull()
        val parts = if (numeric in 1..20) {
            MutableList(30) { encoded.encodeToString(ByteArray(16) { 9 }) }.apply {
                this[numeric!! - 1] = encoded.encodeToString(key.copyOfRange(0, 16))
                this[30 - numeric] = encoded.encodeToString(key.copyOfRange(16, 32))
            }
        } else listOf(encoded.encodeToString(key.copyOfRange(0, 16)), encoded.encodeToString(key.copyOfRange(16, 32)))
        return JSONObject().put("version", version).put("algorithm", "AES-GCM")
            .put("key_parts", JSONArray(parts)).put("iv", encoded.encodeToString(iv))
            .put("payload", encoded.encodeToString(cipher.doFinal(value)))
    }

    companion object {
        private const val EMBED = "https://bysekoze.com/e/fixture_video"
        private val SOURCE = MkissaSourceCandidate(EMBED, "Fm-Hls", "iframe", 3f)
        private const val PLAYBACK = """{"sources":[{"url":"https://video.example/episode/master.m3u8","mime_type":"application/vnd.apple.mpegurl","height":1080},{"url":"https://video.example/episode/video.mp4","mime_type":"video/mp4","height":720}],"tracks":[{"url":"https://captions.example/episode/en.vtt","mime_type":"text/vtt","title":"English","language":"en","default":true},{"url":"https://captions.example/episode/thumbs.vtt","kind":"thumbnails"}]}"""
    }
}
