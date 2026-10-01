package com.sanjay.anitrack.next.data.providers.connectors.mkissa

import org.json.JSONObject
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Pure wire primitives for MKissa's build-bound request token and encrypted response envelope. */
internal object MkissaCrypto {
    private const val HASH_ALGORITHM = "SHA-256"
    private const val HMAC_ALGORITHM = "HmacSHA256"
    private const val CIPHER_ALGORITHM = "AES/GCM/NoPadding"
    private const val LEGACY_SECRET = "Xot36i3lK3"
    private const val KEY_SIZE = 32
    const val SEED_COUNT = 4
    private const val SEED_SIZE = KEY_SIZE / SEED_COUNT
    private const val IV_SIZE = 12
    private const val HEADER_SIZE = 1 + IV_SIZE
    private const val TOKEN_WINDOW_MS = 5 * 60 * 1000L
    private const val EPOCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000L
    private const val EPOCH_GRACE_MS = 24 * 60 * 60 * 1000L

    data class CryptoScheme(
        val saltMultiplier: Int,
        val saltOffset: Int,
        val fragmentMultiplier: Int,
        val fragmentOffset: Int,
        val bootPrefix: String,
        val separator: String,
        val fields: List<String>,
        val omitEmptyLane: Boolean,
        val epochWindowMs: Long = EPOCH_WINDOW_MS,
        val epochGraceMs: Long = EPOCH_GRACE_MS,
    ) {
        init {
            require(listOf(saltMultiplier, saltOffset, fragmentMultiplier, fragmentOffset).all { it in 0..255 })
            require(bootPrefix.matches(Regex("[A-Za-z0-9_-]{2,40}:")))
            require(separator.length == 1 && !separator[0].isLetterOrDigit())
            require(fields.size == 5 && fields.toSet() == setOf("buildId", "group", "host", "epoch", "lane"))
            require(epochWindowMs in 60_000L..31_536_000_000L)
            require(epochGraceMs in 0 until epochWindowMs)
        }
    }

    private data class MaskParameters(
        val saltMultiplier: Int,
        val saltOffset: Int,
        val fragmentMultiplier: Int,
        val fragmentOffset: Int,
    )

    private val fallbackMaskParameters = listOf(
        // Current public web-client scheme. Keep retired schemes below it for
        // the short overlap window around provider build rollovers.
        MaskParameters(180, 34, 228, 118),
        MaskParameters(105, 199, 68, 109),
        MaskParameters(250, 54, 16, 217),
        MaskParameters(211, 222, 200, 176),
        MaskParameters(17, 31, 41, 7),
    )

    fun sha256Hex(value: String): String = MessageDigest.getInstance(HASH_ALGORITHM)
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    fun maskCandidates(
        buildId: String,
        seeds: List<String>,
        liveScheme: CryptoScheme? = null,
    ): List<ByteArray> {
        if (buildId.isBlank() || seeds.size != SEED_COUNT) return emptyList()
        val parameters = buildList {
            liveScheme?.let {
                add(MaskParameters(it.saltMultiplier, it.saltOffset, it.fragmentMultiplier, it.fragmentOffset))
            }
            addAll(fallbackMaskParameters)
        }.distinct()
        return parameters.mapNotNull { params ->
            val stream = ByteArray(KEY_SIZE) { index ->
                (buildId[index % buildId.length].code xor
                    ((index * params.saltMultiplier + params.saltOffset) and 0xff)).toByte()
            }
            val mask = ByteArray(KEY_SIZE)
            for ((seedIndex, seed) in seeds.withIndex()) {
                val bytes = runCatching { Base64.getDecoder().decode(seed) }.getOrNull()
                    ?.takeIf { it.size >= SEED_SIZE }
                    ?: return@mapNotNull null
                val base = seedIndex * SEED_SIZE
                repeat(SEED_SIZE) { offset ->
                    mask[base + offset] = (
                        (bytes[offset].toInt() and 0xff) xor
                            (stream[base + offset].toInt() and 0xff) xor
                            ((seedIndex * params.fragmentMultiplier +
                                offset * params.fragmentOffset) and 0xff)
                        ).toByte()
                }
            }
            mask.takeIf { bytes -> bytes.any { it != 0.toByte() } }
        }
    }

    fun deriveKey(mask: ByteArray, partB: ByteArray): SecretKeySpec {
        require(mask.isNotEmpty() && partB.size >= KEY_SIZE) { "Invalid MKissa key material" }
        return SecretKeySpec(
            ByteArray(KEY_SIZE) { index ->
                ((partB[index].toInt() and 0xff) xor
                    (mask[index % mask.size].toInt() and 0xff)).toByte()
            },
            "AES",
        )
    }

    fun bootTokenCandidates(
        mask: ByteArray,
        buildId: String,
        epoch: Long,
        keyGroup: String,
        refererHost: String,
        lane: String,
        liveScheme: CryptoScheme? = null,
    ): List<String> {
        fun token(prefix: String, message: String): String {
            val inner = hmac(mask, "$prefix$buildId")
            return hmac(inner, message).joinToString("") { "%02x".format(it.toInt() and 0xff) }
        }
        val fields = mapOf(
            "buildId" to buildId,
            "group" to keyGroup,
            "host" to refererHost,
            "epoch" to epoch.toString(),
            "lane" to lane,
        )
        val liveToken = liveScheme?.let { scheme ->
            val selected = if (scheme.omitEmptyLane && lane.isEmpty()) {
                scheme.fields.filterNot { it == "lane" }
            } else scheme.fields
            token(scheme.bootPrefix, selected.mapNotNull(fields::get).joinToString(scheme.separator))
        }
        return listOfNotNull(
            liveToken,
            token(
                "nQoBmFr:",
                listOf(refererHost, epoch.toString(), keyGroup, lane, buildId).joinToString("~"),
            ),
            token(
                "3CPUb1AFbS:",
                listOf(refererHost, epoch.toString(), keyGroup, lane, buildId).joinToString("|"),
            ),
            token(
                "4X2PsZc2r:",
                listOf(keyGroup, refererHost, lane, buildId, epoch.toString()).joinToString("."),
            ),
            token(
                "kNk1YgwkSI:",
                listOf(epoch.toString(), keyGroup, refererHost, buildId, lane).joinToString("."),
            ),
            token(
                "aa-boot:",
                "$buildId:$keyGroup:$refererHost:$epoch${if (lane.isEmpty()) "" else ":$lane"}",
            ),
        ).distinct()
    }

    fun epochCandidates(nowMillis: Long, liveScheme: CryptoScheme? = null): List<Long> {
        val window = liveScheme?.epochWindowMs ?: EPOCH_WINDOW_MS
        val grace = liveScheme?.epochGraceMs ?: EPOCH_GRACE_MS
        val current = nowMillis / window
        val inGrace = nowMillis - current * window < grace && current > 0
        return if (inGrace) listOf(current - 1, current) else listOf(current)
    }

    fun skewedEpochCandidates(nowMillis: Long, liveScheme: CryptoScheme? = null): List<Long> {
        val window = liveScheme?.epochWindowMs ?: EPOCH_WINDOW_MS
        val current = nowMillis / window
        return listOf(current + 1, current - 1)
            .filter { it > 0 }
            .filterNot { it in epochCandidates(nowMillis, liveScheme) }
    }

    fun buildAaReq(
        key: SecretKeySpec,
        epoch: Long,
        buildId: String,
        queryHash: String,
        lane: String,
        nowMillis: Long,
    ): String {
        val timestamp = nowMillis / TOKEN_WINDOW_MS * TOKEN_WINDOW_MS
        val iv = MessageDigest.getInstance(HASH_ALGORITHM)
            .digest("$epoch:$buildId:$queryHash:$timestamp:$lane".toByteArray(Charsets.UTF_8))
            .copyOfRange(0, IV_SIZE)
        val payload = JSONObject()
            .put("v", 1)
            .put("ts", timestamp)
            .put("epoch", epoch)
            .put("buildId", buildId)
            .put("qh", queryHash)
            .put("k", lane)
            .toString()
        return encryptPayload(payload, key, iv)
    }

    internal fun encryptPayload(plainText: String, key: SecretKeySpec, iv: ByteArray): String {
        require(iv.size == IV_SIZE) { "MKissa AES-GCM IV must be 12 bytes" }
        val cipher = Cipher.getInstance(CIPHER_ALGORITHM)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        val encrypted = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
        val blob = ByteArray(HEADER_SIZE + encrypted.size)
        blob[0] = 1
        System.arraycopy(iv, 0, blob, 1, IV_SIZE)
        System.arraycopy(encrypted, 0, blob, HEADER_SIZE, encrypted.size)
        return Base64.getEncoder().encodeToString(blob)
    }

    fun decrypt(payload: String, key: SecretKeySpec): String? {
        val blob = runCatching { Base64.getDecoder().decode(payload) }.getOrNull() ?: return null
        if (blob.size <= HEADER_SIZE) return null
        val version = blob[0].toInt() and 0xff
        val iv = blob.copyOfRange(1, HEADER_SIZE)
        val encrypted = blob.copyOfRange(HEADER_SIZE, blob.size)
        for (candidate in listOf(key, legacyKey(version))) {
            val decoded = runCatching {
                val cipher = Cipher.getInstance(CIPHER_ALGORITHM)
                cipher.init(Cipher.DECRYPT_MODE, candidate, GCMParameterSpec(128, iv))
                String(cipher.doFinal(encrypted), Charsets.UTF_8)
            }.getOrNull()
            if (decoded != null) return decoded
        }
        return null
    }

    private fun hmac(key: ByteArray, value: String): ByteArray = Mac.getInstance(HMAC_ALGORITHM).run {
        init(SecretKeySpec(key, HMAC_ALGORITHM))
        doFinal(value.toByteArray(Charsets.UTF_8))
    }

    private fun legacyKey(version: Int): SecretKeySpec = SecretKeySpec(
        MessageDigest.getInstance(HASH_ALGORITHM)
            .digest("$LEGACY_SECRET:v$version".toByteArray(Charsets.UTF_8)),
        "AES",
    )
}
