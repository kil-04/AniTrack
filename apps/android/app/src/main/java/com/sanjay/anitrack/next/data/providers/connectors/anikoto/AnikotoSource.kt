package com.sanjay.anitrack.next.data.providers.connectors.anikoto

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Anikoto player sources, ported from the desktop connector
 * (apps/desktop/main/services/providers/anikoto-source.ts).
 *
 * Current players answer getSources with an AES-CBC `enc` payload instead of
 * `sources.file`. The key and IV are literal strings in the public player
 * client; they are read as data — the downloaded script is never executed.
 */
object AnikotoSource {
    class Cipher256(val key: ByteArray, val iv: ByteArray)

    private const val MAX_SCRIPT_CHARS = 2_000_000
    private const val MAX_CIPHERTEXT_CHARS = 128_000
    private val ENCODER_LITERAL = Regex(
        """(?:new\s+TextEncoder\s*\(\s*\)|\(new\s+TextEncoder\s*\))\.encode\(\s*("(?:[^"\\]|\\.)*")\s*\)""",
    )
    private val BASE64 = Regex("""^[A-Za-z0-9_+/-]+={0,2}$""")

    /**
     * Player clients to read decoder constants from, in order. /stream/ players
     * decode in an obfuscated bundle (never read) and their own client holds
     * only a telemetry cipher; live sources from both player kinds decode with
     * the same origin's readable videojs client constants.
     */
    fun clientScriptPaths(iframePath: String): List<String> =
        if (iframePath.startsWith("/videojs/")) listOf("/videojs/lib/newclient.min.js")
        else listOf("/lib/newclient.min.js", "/videojs/lib/newclient.min.js")

    /** The legacy signed /stream route lives under the videojs player package. */
    fun sourcesPath(sourcesRoute: String, iframePath: String): String =
        if (iframePath.startsWith("/videojs/") && sourcesRoute.startsWith("/stream/")) "/videojs$sourcesRoute" else sourcesRoute

    fun parseCipher(script: String): Cipher256 {
        if (script.isEmpty() || script.length > MAX_SCRIPT_CHARS) throw IllegalStateException("Anikoto player metadata is invalid")
        // The segment decoder is the first, non-obfuscated module; unrelated
        // modules later in the bundle cannot supply parameters.
        val module = script.take(12_000).substringBefore("resolveUrlSync:")
        val literals = ENCODER_LITERAL.findAll(module).map { match ->
            runCatching { JSONArray("[${match.groupValues[1]}]").getString(0) }.getOrDefault("")
        }.toList()
        if (!module.contains("AES-CBC") || literals.size != 2) {
            throw IllegalStateException("Anikoto player format changed; its connector needs an update")
        }
        val keyBytes = literals[0].toByteArray(Charsets.UTF_8)
        val iv = literals[1].toByteArray(Charsets.UTF_8)
        if (keyBytes.size !in 16..32 || iv.size != 16) throw IllegalStateException("Anikoto player cipher parameters are invalid")
        return Cipher256(keyBytes.copyOf(32), iv)
    }

    fun decode(value: String, cipher: Cipher256): String {
        if (value.isEmpty() || value.length > MAX_CIPHERTEXT_CHARS || !BASE64.matches(value)) {
            throw IllegalStateException("Anikoto encrypted source is invalid")
        }
        return try {
            val normalized = value.replace('+', '-').replace('/', '_').trimEnd('=')
            val input = Base64.getUrlDecoder().decode(normalized)
            require(input.isNotEmpty() && input.size % 16 == 0)
            val aes = Cipher.getInstance("AES/CBC/PKCS5Padding")
            aes.init(Cipher.DECRYPT_MODE, SecretKeySpec(cipher.key, "AES"), IvParameterSpec(cipher.iv))
            String(aes.doFinal(input), Charsets.UTF_8)
        } catch (_: Exception) {
            throw IllegalStateException("Anikoto source could not be decoded; its player format may have changed")
        }
    }

    /** True when the response carries only an encrypted source and needs the player client. */
    fun needsCipher(json: JSONObject): Boolean = directFile(json).isEmpty() && json.optString("enc").isNotEmpty()

    fun sourceUrl(json: JSONObject, cipher: Cipher256? = null): String {
        var file = directFile(json)
        val enc = json.optString("enc")
        if (file.isEmpty() && enc.isNotEmpty()) {
            if (cipher == null) throw IllegalStateException("Anikoto encrypted sources require player metadata")
            file = try {
                JSONObject(decode(enc, cipher)).optString("file")
            } catch (_: Exception) {
                throw IllegalStateException("Anikoto encrypted source response could not be decoded")
            }
        }
        return assertMediaUrl(file)
    }

    private fun directFile(json: JSONObject): String =
        json.optJSONArray("sources")?.optJSONObject(0)?.optString("file").orEmpty()
            .ifEmpty { json.optJSONObject("sources")?.optString("file").orEmpty() }

    /** Provider data must never point the player at local or non-HTTPS targets. */
    fun assertMediaUrl(raw: String?): String {
        if (raw.isNullOrEmpty() || raw.length > 16_384) throw IllegalStateException("Anikoto returned an invalid media URL")
        val uri = try { URI(raw) } catch (_: Exception) { throw IllegalStateException("Anikoto returned an invalid media URL") }
        val host = uri.host?.lowercase()?.removePrefix("[")?.removeSuffix("]")?.removeSuffix(".")
            ?: throw IllegalStateException("Anikoto returned an invalid media URL")
        if (uri.scheme != "https" || uri.rawUserInfo != null || (uri.port != -1 && uri.port != 443)
            || !host.contains('.') || host.endsWith(".local") || host.endsWith(".localhost")
            || host.endsWith(".internal") || host.matches(Regex("""^[\d.]+$""")) || host.contains(':')
        ) throw IllegalStateException("Anikoto returned an unsafe media URL")
        return if (uri.rawFragment != null) raw.substringBefore('#') else raw
    }
}
