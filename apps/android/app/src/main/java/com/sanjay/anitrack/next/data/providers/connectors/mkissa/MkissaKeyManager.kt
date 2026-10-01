package com.sanjay.anitrack.next.data.providers.connectors.mkissa

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import java.net.URI
import java.util.Base64
import javax.crypto.spec.SecretKeySpec

internal interface MkissaBuildStore {
    fun load(): String?
    fun save(serializedBuild: String)
    fun clear()
}

internal class MkissaMemoryBuildStore : MkissaBuildStore {
    @Volatile private var value: String? = null
    override fun load(): String? = value
    override fun save(serializedBuild: String) { value = serializedBuild }
    override fun clear() { value = null }
}

internal class MkissaKeyManager(
    private val transport: MkissaHttpTransport,
    private val buildStore: MkissaBuildStore = MkissaMemoryBuildStore(),
    private val siteUrl: String = SITE_URL,
    private val apiUrl: String = API_URL,
    private val nowMillis: () -> Long = System::currentTimeMillis,
    private val externalBuildResolver: (suspend () -> MkissaBundleParser.BuildInfo?)? = null,
    private val diagnostic: (String) -> Unit = {},
) {
    data class Material(
        val key: SecretKeySpec,
        val epoch: Long,
        val buildId: String,
        val expiresAtMillis: Long,
    )

    @Volatile private var cachedMaterial: Material? = null
    private val refreshMutex = Mutex()

    suspend fun material(forceRefresh: Boolean = false): Material {
        val observed = cachedMaterial
        if (!forceRefresh && observed != null && nowMillis() < observed.expiresAtMillis) return observed

        return refreshMutex.withLock {
            val current = cachedMaterial
            if (current !== observed && current != null && nowMillis() < current.expiresAtMillis) {
                return@withLock current
            }
            if (!forceRefresh && current != null && nowMillis() < current.expiresAtMillis) {
                return@withLock current
            }

            val handshake = handshake()
                ?: throw MkissaProtocolException("Unable to obtain MKissa crypto material")
            val partB = runCatching { Base64.getDecoder().decode(handshake.bootstrap.partB) }
                .getOrElse { throw MkissaProtocolException("MKissa bootstrap contained invalid key material", it) }
            if (partB.size < 32) throw MkissaProtocolException("MKissa bootstrap key material was too short")

            buildStore.save(handshake.build.serialize())
            Material(
                key = MkissaCrypto.deriveKey(handshake.mask, partB),
                epoch = handshake.bootstrap.epoch,
                buildId = handshake.build.buildId,
                expiresAtMillis = nowMillis() + MATERIAL_TTL_MS,
            ).also { cachedMaterial = it }
        }
    }

    fun buildRequestToken(material: Material, queryHash: String): String = MkissaCrypto.buildAaReq(
        key = material.key,
        epoch = material.epoch,
        buildId = material.buildId,
        queryHash = queryHash,
        lane = CONTENT_LANE,
        nowMillis = nowMillis(),
    )

    fun decrypt(payload: String, material: Material): String? = MkissaCrypto.decrypt(payload, material.key)

    fun invalidateMaterial() {
        cachedMaterial = null
    }

    fun invalidateBuild() {
        cachedMaterial = null
        buildStore.clear()
    }

    private data class Bootstrap(val epoch: Long, val partB: String, val lane: String?)
    private data class Handshake(
        val build: MkissaBundleParser.BuildInfo,
        val mask: ByteArray,
        val bootstrap: Bootstrap,
    )
    private data class BootstrapResult(
        val bootstrap: Bootstrap? = null,
        val mask: ByteArray? = null,
        val staleBuild: Boolean = false,
    )

    private suspend fun handshake(): Handshake? {
        val cachedBuild = MkissaBundleParser.BuildInfo.deserialize(buildStore.load())
        diagnostic("key handshake cachedBuild=${cachedBuild?.buildId ?: "none"}")
        if (cachedBuild != null) {
            val masks = MkissaCrypto.maskCandidates(cachedBuild.buildId, cachedBuild.seeds, cachedBuild.cryptoScheme)
            if (masks.isNotEmpty()) {
                val first = bootstrap(
                    cachedBuild.buildId,
                    masks,
                    MkissaCrypto.epochCandidates(nowMillis(), cachedBuild.cryptoScheme),
                    cachedBuild.cryptoScheme,
                )
                if (first.bootstrap != null && first.mask != null) {
                    return Handshake(cachedBuild, first.mask, first.bootstrap)
                }
                if (!first.staleBuild) return null

                val skewed = bootstrap(
                    cachedBuild.buildId,
                    masks,
                    MkissaCrypto.skewedEpochCandidates(nowMillis(), cachedBuild.cryptoScheme),
                    cachedBuild.cryptoScheme,
                )
                if (skewed.bootstrap != null && skewed.mask != null) {
                    return Handshake(cachedBuild, skewed.mask, skewed.bootstrap)
                }
            }
        }

        val freshBuild = externalBuildResolver?.invoke() ?: discoverBuild()
        if (freshBuild == null) {
            diagnostic("key handshake build discovery failed")
            return null
        }
        diagnostic("key handshake discovered build=${freshBuild.buildId}")
        val freshMasks = MkissaCrypto.maskCandidates(freshBuild.buildId, freshBuild.seeds, freshBuild.cryptoScheme)
        if (freshMasks.isEmpty()) {
            diagnostic("key handshake produced no mask candidates")
            return null
        }
        val fresh = bootstrap(
            freshBuild.buildId,
            freshMasks,
            MkissaCrypto.epochCandidates(nowMillis(), freshBuild.cryptoScheme),
            freshBuild.cryptoScheme,
        )
        return if (fresh.bootstrap != null && fresh.mask != null) {
            Handshake(freshBuild, fresh.mask, fresh.bootstrap)
        } else {
            null
        }
    }

    private suspend fun bootstrap(
        buildId: String,
        masks: List<ByteArray>,
        epochs: List<Long>,
        liveScheme: MkissaCrypto.CryptoScheme?,
    ): BootstrapResult {
        if (epochs.isEmpty()) return BootstrapResult()
        val endpoint = "$apiUrl/client-crypto/v1/bootstrap".toHttpUrl().newBuilder()
            .addQueryParameter("buildId", buildId)
            .addQueryParameter("k", CONTENT_LANE)
            .build().toString()
        MkissaUrlPolicy.requireProviderUrl(endpoint)
        var stale = false

        for ((maskIndex, mask) in masks.withIndex()) {
            for ((epochIndex, epoch) in epochs.withIndex()) {
                for ((tokenIndex, token) in MkissaCrypto.bootTokenCandidates(
                    mask,
                    buildId,
                    epoch,
                    KEY_GROUP,
                    MkissaUrlPolicy.requireProviderUrl(siteUrl).toHttpUrl().host,
                    CONTENT_LANE,
                    liveScheme,
                ).withIndex()) {
                    val response = transport.execute(
                        MkissaHttpRequest(
                            method = "GET",
                            url = endpoint,
                            headers = browserHeaders() + mapOf(
                                "Origin" to siteUrl,
                                "Referer" to "$siteUrl/",
                                "x-build-id" to buildId,
                                "x-aa-boot" to token,
                            ),
                        ),
                    )
                    diagnostic(
                        "key bootstrap build=$buildId mask=$maskIndex epoch=$epochIndex " +
                            "scheme=$tokenIndex status=${response.code}",
                    )
                    MkissaChallengePolicy.classify(response.code, response.body)?.let { kind ->
                        throw MkissaRateLimitedException(kind)
                    }
                    if (!response.successful) {
                        if (response.code == 403 || response.code == 404) stale = true
                        continue
                    }
                    val json = runCatching { JSONObject(response.body) }.getOrNull() ?: continue
                    val lane = json.nullableString("k")
                    val partB = json.nullableString("partB") ?: continue
                    if (lane != null && lane != CONTENT_LANE) continue
                    val epochValue = json.optLong("epoch", -1).takeIf { it > 0 } ?: continue
                    return BootstrapResult(Bootstrap(epochValue, partB, lane), mask)
                }
            }
        }
        return BootstrapResult(staleBuild = stale)
    }

    private suspend fun discoverBuild(): MkissaBundleParser.BuildInfo? {
        val html = fetchProviderText("$siteUrl/")
        val entryReference = appEntryRegex.find(html)?.groupValues?.get(1) ?: return null
        val appUrl = MkissaUrlPolicy.resolveProviderUrl("$siteUrl/", entryReference)
        diagnostic("build discovery entry=${URI(appUrl).path}")
        val pending = ArrayDeque<String>().apply { add(appUrl) }
        val visited = mutableSetOf<String>()

        // SvelteKit's entry bundle can import another loader which imports the crypto chunk. Walk
        // that bounded static graph instead of assuming every useful chunk is a direct child of
        // entry/app.*.js. Remote code is still only treated as text and never evaluated.
        while (pending.isNotEmpty() && visited.size < MAX_BUILD_CHUNKS) {
            val chunkUrl = pending.removeFirst()
            if (!visited.add(chunkUrl)) continue
            val body = try {
                fetchProviderText(chunkUrl)
            } catch (error: MkissaRateLimitedException) {
                // A security challenge is a stop signal, not an invitation to probe more chunks.
                throw error
            } catch (_: Exception) {
                continue
            }
            diagnostic(
                "build discovery asset=${visited.size} path=${URI(chunkUrl).path} bytes=${body.length} " +
                    "marker=${body.contains(CRYPTO_MARKER) || body.contains("x-aa-boot")}",
            )
            if (body.contains(CRYPTO_MARKER) || body.contains("x-aa-boot")) {
                MkissaBundleParser.parse(body)?.let {
                    diagnostic(
                        "build discovery parsed build=${it.buildId} assets=${visited.size} " +
                            "liveScheme=${it.cryptoScheme != null}",
                    )
                    return it
                }
            }
            assetReferenceRegexes.asSequence()
                .flatMap { regex -> regex.findAll(body).map { it.groupValues[1] } }
                .filter { it.startsWith(".") || it.startsWith("/") }
                .mapNotNull { reference ->
                    runCatching { MkissaUrlPolicy.resolveProviderUrl(chunkUrl, reference) }.getOrNull()
                }
                .distinct()
                .filterNot(visited::contains)
                .forEach(pending::addLast)
        }
        return null
    }

    private suspend fun fetchProviderText(url: String): String {
        val response = transport.execute(
            MkissaHttpRequest("GET", MkissaUrlPolicy.requireProviderUrl(url), browserHeaders()),
        )
        MkissaChallengePolicy.classify(response.code, response.body)?.let { kind ->
            throw MkissaRateLimitedException(kind)
        }
        if (!response.successful) throw MkissaProtocolException("MKissa returned HTTP ${response.code}")
        return response.body
    }

    companion object {
        const val SITE_URL = "https://mkissa.to"
        const val API_URL = "https://api.mkissa.net"
        const val PLAYER_ORIGIN = "https://allanime.day"
        const val CONTENT_LANE = "k7"
        const val USER_AGENT =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/151.0.0.0 Mobile Safari/537.36"

        private const val KEY_GROUP = "mkissa"
        private const val MATERIAL_TTL_MS = 6 * 60 * 60 * 1000L
        private const val MAX_BUILD_CHUNKS = 64
        private const val CRYPTO_MARKER = "aaReq"
        private val appEntryRegex = Regex(
            """(?:import\(|src\s*=\s*)["']([^"']*/entry/app\.[^"']+\.js)["']""",
        )
        private val assetReferenceRegexes = listOf(
            Regex("""(?:import\s*\(|from\s*)["']([^"'\n]+\.js)["']"""),
            Regex("""["'](\.?\.?/(?:chunks|nodes)/[^"'\n]+\.js)["']"""),
        )

        fun browserHeaders(): Map<String, String> = mapOf(
            "User-Agent" to USER_AGENT,
            "Accept" to "*/*",
            "Accept-Language" to "en-US,en;q=0.9",
        )
    }
}

private fun JSONObject.nullableString(name: String): String? {
    if (!has(name) || isNull(name)) return null
    return optString(name).trim().takeIf { it.isNotEmpty() && it != "null" }
}
