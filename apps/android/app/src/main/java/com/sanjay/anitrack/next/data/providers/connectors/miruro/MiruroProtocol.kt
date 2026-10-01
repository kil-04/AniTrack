package com.sanjay.anitrack.next.data.providers.connectors.miruro

import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.Base64
import java.util.zip.GZIPInputStream

internal sealed interface MiruroReadRequest {
    data object Config : MiruroReadRequest
    data class Info(val anilistId: Int) : MiruroReadRequest
    data class Episodes(val anilistId: Int) : MiruroReadRequest
    data class Sources(
        val anilistId: Int,
        val episodeId: String,
        val provider: String,
        val category: String,
    ) : MiruroReadRequest
}

internal enum class MiruroFailure { INVALID_RESPONSE, SECURITY_CHECK, RATE_LIMITED }

internal class MiruroProtocolException(
    message: String = "Miruro returned an unsupported or malformed response",
    val failure: MiruroFailure = MiruroFailure.INVALID_RESPONSE,
) : Exception(message)

/** Read-only protocol observed in the public frontend; not yet a playable connector. */
internal object MiruroProtocol {
    // User-confirmed official working address; no automatic mirror rotation.
    const val ORIGIN = "https://www.miruro.ru"
    const val MAX_RESPONSE_BYTES = 2 * 1024 * 1024
    const val MAX_ENV_BYTES = 64 * 1024
    private val keyPattern = Regex("^(?:[a-fA-F0-9]{2}){1,128}$")
    private val environmentPrefix = Regex("""^window\.env\s*=\s*JSON\.parse\(""")

    fun requestUrl(request: MiruroReadRequest): String {
        val query = JSONObject()
        fun id(value: Int): Int = value.takeIf { it > 0 } ?: invalid()
        val path = when (request) {
            MiruroReadRequest.Config -> "config"
            is MiruroReadRequest.Info -> "info/${id(request.anilistId)}"
            is MiruroReadRequest.Episodes -> {
                query.put("anilistId", id(request.anilistId))
                "episodes"
            }
            is MiruroReadRequest.Sources -> {
                if (request.episodeId.isBlank() || request.episodeId.length > 512 ||
                    request.episodeId.any { it.code < 32 || it.code == 127 } ||
                    !Regex("^[a-zA-Z0-9_-]{1,64}$").matches(request.provider) ||
                    request.category !in listOf("", "sub", "ssub", "dub")
                ) invalid()
                query.put("episodeId", request.episodeId).put("provider", request.provider)
                    .put("category", request.category).put("anilistId", id(request.anilistId))
                "sources"
            }
        }
        val envelope = JSONObject().put("path", path).put("method", "GET")
            .put("query", query).put("body", JSONObject.NULL)
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(envelope.toString().toByteArray(Charsets.UTF_8))
        return "$ORIGIN/api/secure/pipe?e=$encoded"
    }

    /** Parse only the JSON string literal. Never evaluate downloaded JavaScript. */
    fun environmentKey(script: String): String {
        if (script.toByteArray(Charsets.UTF_8).size > MAX_ENV_BYTES) invalid()
        val assignment = script.trim().removeSuffix(";").trimEnd()
        val prefix = environmentPrefix.find(assignment) ?: invalid()
        if (!assignment.endsWith(')')) invalid()
        val literal = assignment.substring(prefix.range.last + 1, assignment.lastIndex).trim()
        if (!literal.startsWith('"') || !literal.endsWith('"')) invalid()
        val json = strictJson(literal) as? String ?: invalid()
        val key = jsonObject(json).opt("VITE_PIPE_OBF_KEY") as? String ?: invalid()
        return key.takeIf(keyPattern::matches) ?: invalid()
    }

    fun decode(text: String, obfuscated: String?, key: String? = null): JSONObject {
        if (text.toByteArray(Charsets.UTF_8).size > MAX_RESPONSE_BYTES) invalid()
        if (obfuscated.isNullOrEmpty()) return jsonObject(text)
        if (obfuscated != "1" && obfuscated != "2") invalid()
        val encoded = text.trim()
        if (!Regex("^[A-Za-z0-9_-]+={0,2}$").matches(encoded)) invalid()
        try {
            val bytes = Base64.getUrlDecoder().decode(encoded)
            if (Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) != encoded.trimEnd('=')) invalid()
            if (obfuscated == "2") {
                if (key == null || !keyPattern.matches(key)) invalid()
                val mask = key.chunked(2).map { it.toInt(16).toByte() }
                bytes.indices.forEach { index -> bytes[index] = (bytes[index].toInt() xor mask[index % mask.size].toInt()).toByte() }
            }
            val decoded = GZIPInputStream(bytes.inputStream()).use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count == -1) break
                    if (output.size() + count > MAX_RESPONSE_BYTES) invalid()
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
            return jsonObject(utf8(decoded))
        } catch (_: Exception) { invalid() }
    }

    fun responseFailure(status: Int, text: String): MiruroProtocolException? {
        if (status == 429) return MiruroProtocolException(
            "Miruro is rate limiting requests. Try another provider for now.", MiruroFailure.RATE_LIMITED,
        )
        if (status == 403 || Regex(
                "cf-chl-|captcha|attention required!.*cloudflare|just a moment|security check", RegexOption.IGNORE_CASE,
            ).containsMatchIn(text.take(32_768))
        ) return MiruroProtocolException(
            "Miruro requires a browser security check. AniTrack will not bypass or repeatedly retry it.",
            MiruroFailure.SECURITY_CHECK,
        )
        return null
    }

    fun utf8(bytes: ByteArray): String = Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes)).toString()

    private fun jsonObject(text: String): JSONObject = strictJson(text) as? JSONObject ?: invalid()
    private fun strictJson(text: String): Any {
        try {
            // JSONObject is recursive on Android. Bound nesting before handing
            // remote data to it, so small deeply nested inputs cannot overflow.
            var depth = 0
            var quoted = false
            var escaped = false
            text.forEach { char ->
                if (quoted) {
                    if (escaped) escaped = false
                    else if (char == '\\') escaped = true
                    else if (char == '"') quoted = false
                } else when (char) {
                    '"' -> quoted = true
                    '{', '[' -> { depth++; if (depth > 64) invalid() }
                    '}', ']' -> { depth--; if (depth < 0) invalid() }
                    '\'' -> invalid()
                }
            }
            if (quoted || depth != 0) invalid()
            val parser = JSONTokener(text)
            val value = parser.nextValue()
            if (parser.nextClean() != '\u0000') invalid()
            return value
        } catch (_: Exception) { invalid() }
    }

    private fun invalid(): Nothing = throw MiruroProtocolException()
}
