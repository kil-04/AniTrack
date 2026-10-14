package com.sanjay.anitrack.next.data.providers.connectors.mkissa

import org.json.JSONObject
import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Reviewed data-only port of Byse's readable public video response codec, never remote code. */
internal object MkissaByse {
    enum class Operation(val route: String) { SETTINGS("settings"), PLAYBACK("playback") }

    data class Media(
        val url: String,
        val kind: MkissaMediaKind,
        val subtitles: List<MkissaSubtitle>,
        val intro: MkissaSkipRange?,
    )

    fun apiUrl(embedUrl: String, operation: Operation): String {
        val uri = URI(MkissaUrlPolicy.requireMediaUrl(embedUrl))
        val identifier = EMBED_ROUTE.matchEntire(uri.path)?.groupValues?.get(1)
            ?: invalid("MKissa HLS server embed route changed")
        return MkissaUrlPolicy.requireMediaUrl("${uri.scheme}://${uri.host}/api/videos/$identifier/embed/${operation.route}")
    }

    /** No synthesized fingerprint/CAPTCHA tokens, upstream account, or verification operations. */
    fun assertAccess(payload: JSONObject) {
        val messages = listOf("error", "message").mapNotNull { payload.opt(it) as? String }
        val codes = messages + listOfNotNull(payload.opt("code") as? String)
        MkissaChallengePolicy.classifyMessages(200, codes)?.let { throw MkissaRateLimitedException(it) }
        if (truthy(payload.opt("captcha_required")) || truthy(payload.opt("fingerprint_required")) ||
            messages.any(VERIFICATION_GATE::containsMatchIn) ||
            (payload.has("pow_nonce") && !payload.isNull("pow_nonce")) ||
            (payload.has("pow_token") && !payload.isNull("pow_token"))
        ) {
            throw MkissaRateLimitedException(
                MkissaChallengeKind.CAPTCHA,
                "This MKissa HLS server requires a website check. No automatic verification was attempted; you may retry manually.",
            )
        }
        if (truthy(payload.opt("premium_only"))) invalid("This MKissa HLS server requires an upstream account")
        if (truthy(payload.optJSONObject("processing")?.opt("locked"))) invalid("This MKissa HLS server's video is still processing")
        if (messages.isNotEmpty()) invalid(messages.first().replace(CONTROL_CHARS, " ").take(200))
    }

    fun decodePlayback(encrypted: JSONObject): JSONObject {
        val parts = encrypted.optJSONArray("key_parts")
            ?: invalid("MKissa HLS server returned unsupported playback data")
        if (parts.length() !in 1..64 ||
            (encrypted.has("algorithm") && !encrypted.isNull("algorithm") && encrypted.opt("algorithm") != "AES-GCM")
        ) invalid("MKissa HLS server returned unsupported playback data")
        val version = (encrypted.opt("version") as? String)?.trim().orEmpty()
        val indexes = if (VERSION.matches(version)) listOf(version.toInt(), 31 - version.toInt()) else emptyList()
        val chosen = if (indexes.isNotEmpty() && indexes.all { it <= parts.length() }) {
            indexes.map { parts.opt(it - 1) }
        } else (0 until parts.length()).map { parts.opt(it) }
        val key = chosen.map { base64(it, 64) }.fold(ByteArray(0)) { result, part -> result + part }
        if (key.size !in setOf(16, 24, 32)) invalid("MKissa HLS server returned an unsupported key length")
        val iv = base64(encrypted.opt("iv"), 32)
        val bytes = base64(encrypted.opt("payload"), MAX_PAYLOAD_BYTES + 16)
        if (iv.size != 12 || bytes.size < 16) invalid("MKissa HLS server returned invalid encrypted data")
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
            val decoded = cipher.doFinal(bytes)
            if (decoded.size > MAX_PAYLOAD_BYTES) invalid("MKissa HLS server playback data is too large")
            val text = Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(decoded)).toString()
            JSONObject(text)
        } catch (error: MkissaUnsupportedSourceException) {
            throw error
        } catch (_: Exception) {
            invalid("MKissa HLS server playback data could not be decoded")
        }
    }

    fun media(payload: JSONObject): Media {
        assertAccess(payload)
        val playback = payload.optJSONObject("playback")?.let(::decodePlayback)
            ?: invalid("MKissa HLS server returned unsupported playback data")
        assertAccess(playback)
        val sources = playback.optJSONArray("sources")
            ?: invalid("MKissa HLS server returned no supported media")
        if (sources.length() > 32) invalid("MKissa HLS server returned too many sources")
        data class Choice(val url: String, val kind: MkissaMediaKind, val height: Double, val index: Int)
        val choices = (0 until sources.length()).mapNotNull { index ->
            val source = sources.optJSONObject(index) ?: return@mapNotNull null
            val rawUrl = source.opt("url") as? String ?: return@mapNotNull null
            if (rawUrl.length > 8192) return@mapNotNull null
            val url = MkissaUrlPolicy.requireMediaUrl(rawUrl)
            val mime = (source.opt("mime_type") as? String)?.lowercase()?.substringBefore(';')?.trim().orEmpty()
            val hls = URI(url).path.orEmpty().endsWith(".m3u8", ignoreCase = true)
            val mp4 = URI(url).path.orEmpty().endsWith(".mp4", ignoreCase = true) || mime == "video/mp4"
            if ((!hls && !mp4) || (mime.isNotEmpty() && mime !in MEDIA_MIMES) ||
                (hls && mime == "video/mp4") || (!hls && mime.contains("mpegurl"))
            ) return@mapNotNull null
            val height = (source.opt("height") ?: source.opt("quality"))?.toString()?.toDoubleOrNull()
                ?.takeIf { it.isFinite() && it > 0 } ?: 0.0
            Choice(url, if (hls) MkissaMediaKind.HLS else MkissaMediaKind.MP4, height, index)
        }.sortedWith(compareByDescending<Choice> { it.kind == MkissaMediaKind.HLS }
            .thenByDescending { it.height }.thenBy { it.index })
        val selected = choices.firstOrNull() ?: invalid("MKissa HLS server returned no supported direct media")
        val subtitles = mutableListOf<MkissaSubtitle>()
        playback.optJSONArray("tracks")?.let { tracks ->
            if (tracks.length() > 32) invalid("MKissa HLS server returned too many captions")
            for (index in 0 until tracks.length()) {
                val track = tracks.optJSONObject(index) ?: continue
                val rawUrl = track.opt("url") as? String ?: continue
                if (rawUrl.length > 8192) continue
                val kind = (track.opt("kind") as? String)?.lowercase() ?: "captions"
                if (kind !in setOf("captions", "subtitles")) continue
                val url = MkissaUrlPolicy.requireMediaUrl(rawUrl)
                val mime = (track.opt("mime_type") as? String)?.lowercase().orEmpty()
                if (!URI(url).path.orEmpty().endsWith(".vtt", ignoreCase = true) && mime != "text/vtt") continue
                if (subtitles.none { it.url == url }) {
                    val language = (track.opt("language") as? String)?.replace(CONTROL_CHARS, " ")?.trim()?.take(30)
                    val label = (track.opt("title") as? String)?.replace(CONTROL_CHARS, " ")?.trim()?.take(100)
                        ?.takeIf { it.isNotEmpty() } ?: language?.takeIf { it.isNotEmpty() } ?: "Subtitles"
                    subtitles += MkissaSubtitle(url, label, language, default = track.opt("default") == true)
                }
            }
        }
        val skip = payload.optJSONObject("skip_intro")
        val start = skip?.optDouble("from_seconds", Double.NaN) ?: Double.NaN
        val end = skip?.optDouble("to_seconds", Double.NaN) ?: Double.NaN
        val intro = if (start.isFinite() && end.isFinite() && start >= 0 && end > start && end <= 3600) {
            MkissaSkipRange(start, end)
        } else null
        return Media(selected.url, selected.kind, subtitles, intro)
    }

    private fun base64(value: Any?, maximumBytes: Int): ByteArray {
        val encoded = value as? String ?: invalid("MKissa HLS server returned invalid encrypted data")
        if (encoded.isEmpty() || encoded.length > (maximumBytes * 4 + 2) / 3 + 4 ||
            !BASE64.matches(encoded) || encoded.trimEnd('=').length % 4 == 1
        ) invalid("MKissa HLS server returned invalid encrypted data")
        val normalized = encoded.replace('+', '-').replace('/', '_').trimEnd('=')
        val decoded = runCatching { Base64.getUrlDecoder().decode(normalized) }.getOrNull()
            ?: invalid("MKissa HLS server returned invalid encrypted data")
        if (decoded.size > maximumBytes || Base64.getUrlEncoder().withoutPadding().encodeToString(decoded) != normalized) {
            invalid("MKissa HLS server returned invalid encrypted data")
        }
        return decoded
    }

    private fun truthy(value: Any?): Boolean = value != null && value !== JSONObject.NULL && value != false &&
        (value !is Number || value.toDouble() != 0.0) && value != ""

    private fun invalid(message: String): Nothing = throw MkissaUnsupportedSourceException(message)
    private const val MAX_PAYLOAD_BYTES = 1024 * 1024
    private val EMBED_ROUTE = Regex("/e/([A-Za-z0-9_-]{1,200})/?")
    private val VERSION = Regex("[1-9]|1[0-9]|20")
    private val BASE64 = Regex("[A-Za-z0-9+/_-]+={0,2}")
    private val CONTROL_CHARS = Regex("[\\u0000-\\u001f\\u007f]")
    private val VERIFICATION_GATE = Regex("fingerprint|attestation|proof.of.work|verification.required", RegexOption.IGNORE_CASE)
    private val MEDIA_MIMES = setOf("video/mp4", "application/vnd.apple.mpegurl", "application/x-mpegurl")
}
