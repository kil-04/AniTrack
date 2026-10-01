package com.sanjay.anitrack.next.data.providers.connectors.anikoto

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

class AnikotoSourceTest {
    // Synthetic public-player fixture, mirroring tests/anikoto-source.test.mjs.
    // Never store live decoding keys or signed URLs.
    private val metadata = """function decoder(){var k=(new TextEncoder).encode("abcdefghijklmnop");var v=(new TextEncoder).encode("0123456789abcdef"); return crypto.subtle.decrypt({name:"AES-CBC",iv:v},k,input)};resolveUrlSync:decode;"""
    private val cipher = AnikotoSource.parseCipher(metadata)

    private fun encrypt(text: String): String {
        val aes = Cipher.getInstance("AES/CBC/PKCS5Padding")
        aes.init(Cipher.ENCRYPT_MODE, SecretKeySpec(cipher.key, "AES"), IvParameterSpec(cipher.iv))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(aes.doFinal(text.toByteArray()))
    }

    private fun assertFails(message: Regex, block: () -> Unit) {
        try {
            block()
            fail("expected failure matching $message")
        } catch (error: IllegalStateException) {
            assertTrue("${error.message} !~ $message", message.containsMatchIn(error.message.orEmpty()))
        }
    }

    @Test
    fun currentEncryptedSourcesAndBothLegacyShapesDecodeAsData() {
        val file = "https://cdn.example.test/show/master.m3u8"
        val encrypted = JSONObject().put("enc", encrypt(JSONObject().put("file", file).toString()))
        assertTrue(AnikotoSource.needsCipher(encrypted))
        assertEquals(file, AnikotoSource.sourceUrl(encrypted, cipher))
        assertEquals(file, AnikotoSource.sourceUrl(JSONObject("""{"sources":{"file":"$file"}}""")))
        assertEquals(file, AnikotoSource.sourceUrl(JSONObject("""{"sources":[{"file":"$file"}]}""")))
        assertFalse(AnikotoSource.needsCipher(JSONObject("""{"sources":{"file":"$file"},"enc":"ignored"}""")))
        assertEquals(32, cipher.key.size)
        assertArrayEquals(ByteArray(16), cipher.key.copyOfRange(16, 32))
    }

    @Test
    fun standardBase64CiphertextIsAccepted() {
        val urlSafe = encrypt("https://cdn.example.test/a.m3u8")
        val standard = urlSafe.replace('-', '+').replace('_', '/')
        assertEquals("https://cdn.example.test/a.m3u8", AnikotoSource.decode(standard, cipher))
    }

    @Test
    fun playerMetadataIsParsedOnlyFromTheDecoderModule() {
        assertFails(Regex("format changed")) { AnikotoSource.parseCipher("""eval("cipher")""") }
        assertFails(Regex("invalid")) { AnikotoSource.parseCipher("x".repeat(2_000_001)) }
        // A third literal after the decoder module cannot change the parameters.
        val trailing = metadata + """var z=(new TextEncoder).encode("zzzzzzzzzzzzzzzz");"""
        assertArrayEquals(cipher.iv, AnikotoSource.parseCipher(trailing).iv)
    }

    @Test
    fun malformedBlobsAndUnsupportedFormatsFailCleanly() {
        assertFails(Regex("could not be decoded")) { AnikotoSource.sourceUrl(JSONObject().put("enc", encrypt("{not json}")), cipher) }
        assertFails(Regex("could not be decoded")) { AnikotoSource.sourceUrl(JSONObject().put("enc", "not*base64"), cipher) }
        assertFails(Regex("require player metadata")) { AnikotoSource.sourceUrl(JSONObject().put("enc", "abc")) }
        assertFails(Regex("invalid")) { AnikotoSource.decode("x".repeat(128_001), cipher) }
        assertFails(Regex("invalid media URL")) { AnikotoSource.sourceUrl(JSONObject()) }
    }

    @Test
    fun decodedSourceCannotTargetCredentialsPrivateNetworksOrPlainHttp() {
        for (value in listOf(
            "file:///C:/private", "http://public.example.test/x", "https://127.0.0.1/x", "https://10.1.2.3/x",
            "https://[::1]/x", "https://localhost/x", "https://localhost./x", "https://secret.internal./x",
            "https://secret.internal/x", "https://u:p@cdn.example.test/x", "https://cdn.example.test:1234/x",
        )) {
            assertFails(Regex("unsafe|invalid")) { AnikotoSource.assertMediaUrl(value) }
            assertFails(Regex("unsafe|invalid")) {
                AnikotoSource.sourceUrl(JSONObject().put("enc", encrypt(JSONObject().put("file", value).toString())), cipher)
            }
        }
        assertEquals("https://cdn.example.test/x.m3u8", AnikotoSource.assertMediaUrl("https://cdn.example.test/x.m3u8#frag"))
    }

    @Test
    fun videoJsPlayersUseTheirPackageRelativeRoutes() {
        assertEquals("/videojs/stream/getSources?id=1", AnikotoSource.sourcesPath("/stream/getSources?id=1", "/videojs/e/abc"))
        assertEquals("/stream/getSources?id=1", AnikotoSource.sourcesPath("/stream/getSources?id=1", "/stream/s-2/abc"))
        assertEquals(listOf("/videojs/lib/newclient.min.js"), AnikotoSource.clientScriptPaths("/videojs/e/abc"))
        assertEquals(
            listOf("/lib/newclient.min.js", "/videojs/lib/newclient.min.js"),
            AnikotoSource.clientScriptPaths("/stream/s-2/abc"),
        )
    }

    @Test
    fun telemetryOnlyClientsHaveNoReadableDecoder() {
        // Shape observed live in the /stream/ client: its only AES code is a
        // telemetry encryptor without literal decoder parameters.
        val telemetry = """function t(e){var k=e.pick(["a","b"],"c");return crypto.subtle.importKey("raw",k,{name:"AES-CBC"},!1,["encrypt"])}"""
        assertFails(Regex("format changed")) { AnikotoSource.parseCipher(telemetry) }
    }
}
