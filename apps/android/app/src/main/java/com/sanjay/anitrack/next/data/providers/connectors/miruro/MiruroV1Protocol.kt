package com.sanjay.anitrack.next.data.providers.connectors.miruro

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPInputStream

/** Current catalogue coordinates. Episode numbers, not opaque episode IDs, address /play. */
internal sealed interface MiruroV1ReadRequest {
    data class Lookup(val anilistId: Int) : MiruroV1ReadRequest
    data class Episodes(val showId: String) : MiruroV1ReadRequest
    data class Play(val showId: String, val episode: Double) : MiruroV1ReadRequest
}

internal object MiruroV1Protocol {
    private val showPattern = Regex("[A-Za-z0-9_-]{1,256}")
    private val publicMask = "miruro/catalog".toByteArray(Charsets.UTF_8)

    fun requestUrl(request: MiruroV1ReadRequest): String {
        if (request is MiruroV1ReadRequest.Lookup) {
            if (request.anilistId <= 0) throw MiruroProtocolException("Invalid Miruro AniList reference")
            return "${MiruroProtocol.ORIGIN}/api/v1/anime?anilist_id_in=${request.anilistId}&limit=100"
        }
        val showId = when (request) {
            is MiruroV1ReadRequest.Episodes -> request.showId
            is MiruroV1ReadRequest.Play -> request.showId
            else -> throw MiruroProtocolException()
        }
        if (!showPattern.matches(showId)) throw MiruroProtocolException("Invalid Miruro catalogue reference")
        val root = "${MiruroProtocol.ORIGIN}/api/v1/anime/$showId/episodes"
        if (request is MiruroV1ReadRequest.Episodes) return "$root?limit=10000"
        val number = (request as MiruroV1ReadRequest.Play).episode
        if (!number.isFinite() || number < 0 || number > 100_000) throw MiruroProtocolException("Invalid Miruro episode reference")
        val coordinate = java.math.BigDecimal.valueOf(number).stripTrailingZeros().toPlainString()
        return "$root/$coordinate/play"
    }

    /** Public fixed XOR + gzip wire format, implemented locally; no downloaded code runs. */
    fun decode(bytes: ByteArray, contentType: String): JSONObject {
        if (bytes.size > MiruroProtocol.MAX_RESPONSE_BYTES) throw MiruroProtocolException("Miruro response exceeded its size limit")
        try {
            val decoded = if (contentType.substringBefore(';').trim().equals("application/octet-stream", true)) {
                val compressed = bytes.copyOf()
                compressed.indices.forEach { index ->
                    compressed[index] = (compressed[index].toInt() xor publicMask[index % publicMask.size].toInt()).toByte()
                }
                GZIPInputStream(compressed.inputStream()).use { input ->
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = input.read(buffer)
                        if (count == -1) break
                        if (output.size() + count > MiruroProtocol.MAX_RESPONSE_BYTES) throw MiruroProtocolException()
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
            } else bytes
            val text = MiruroProtocol.utf8(decoded)
            MiruroStrictJson(text).validate()
            return MiruroProtocol.decode(text, null)
        } catch (error: MiruroProtocolException) { throw error }
        catch (_: Exception) { throw MiruroProtocolException("Miruro returned an unsupported catalogue response") }
    }
}
