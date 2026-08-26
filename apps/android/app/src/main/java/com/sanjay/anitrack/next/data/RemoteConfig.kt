package com.sanjay.anitrack.next.data

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.compose.runtime.mutableStateOf
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.sanjay.anitrack.next.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.ResponseBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.concurrent.TimeUnit

data class ProviderRuntimeConfig(
    val enabled: Boolean,
    val baseUrls: List<String>,
    val streamHostFragments: List<String>,
    val mediaExtensions: List<String>,
    val routes: Map<String, String>,
    val selectors: Map<String, String>,
)

private val disabledProviderRuntimeConfig = ProviderRuntimeConfig(
    enabled = false,
    baseUrls = emptyList(),
    streamHostFragments = emptyList(),
    mediaExtensions = emptyList(),
    routes = emptyMap(),
    selectors = emptyMap(),
)

data class RuntimeFeatures(
    val anikotoStreaming: Boolean,
    val animepaheStreaming: Boolean,
    val downloads: Boolean,
    val malSync: Boolean,
    val gistSync: Boolean,
)

data class AndroidRuntimeConfig(
    val revision: Long,
    val issuedAt: String,
    val providerOrder: List<String>,
    val providers: Map<String, ProviderRuntimeConfig>,
    val features: RuntimeFeatures,
    val notice: String?,
) {
    // Backward-compatible accessors while callers migrate to the provider map.
    val anikoto: ProviderRuntimeConfig get() = providers["anikoto"] ?: disabledProviderRuntimeConfig
    val animepahe: ProviderRuntimeConfig get() = providers["animepahe"] ?: disabledProviderRuntimeConfig
}

data class RemoteConfigStatus(
    val revision: Long,
    val source: String,
    val lastCheckedAt: Long?,
    val lastUpdatedAt: Long?,
    val error: String?,
)

object AutomationTrust {
    fun readBounded(body: ResponseBody?, maxBytes: Int, label: String): ByteArray {
        val source = body ?: error("$label was empty")
        val declared = source.contentLength()
        require(declared < 0 || declared <= maxBytes) { "$label was too large" }
        return source.byteStream().use { input ->
            val output = ByteArrayOutputStream(minOf(maxBytes, 8192))
            val buffer = ByteArray(8192)
            var total = 0
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                require(total <= maxBytes) { "$label was too large" }
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        }
    }

    fun verify(bytes: ByteArray, signatureBase64: String): Boolean = runCatching {
        val keyBytes = Base64.decode(BuildConfig.AUTOMATION_PUBLIC_KEY_B64, Base64.DEFAULT)
        val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(keyBytes))
        Signature.getInstance("SHA256withECDSA").run {
            initVerify(key)
            update(bytes)
            verify(Base64.decode(signatureBase64.trim(), Base64.DEFAULT))
        }
    }.getOrDefault(false)
}

object RemoteConfig {
    private const val PREFS = "automation_config"
    private const val KEY_JSON = "verified_json"
    private const val KEY_SIGNATURE = "verified_signature"
    private const val KEY_ETAG = "etag"
    private const val KEY_LAST_CHECK = "last_check"
    private const val KEY_LAST_UPDATE = "last_update"
    private const val MAX_BYTES = 128 * 1024
    private const val PERIODIC_WORK = "anitrack_automation_refresh"

    private val defaultProvider = ProviderRuntimeConfig(
        enabled = true,
        baseUrls = listOf("https://anikototv.to", "https://anikoto.cz"),
        streamHostFragments = listOf(
            "megap.", "megaplay", "vidtube", "mewcdn", "mewstream",
            "nekostream", "vibeplayer", "lostproject", "streamzone",
        ),
        mediaExtensions = listOf(".m3u8", ".mp4", ".ts", ".m4s", ".vtt", ".key"),
        routes = mapOf(
            "home" to "/home",
            "search" to "/filter?keyword={query}&page={page}",
            "watch" to "/watch/{animeId}",
            "episodeList" to "/ajax/episode/list/{showId}",
            "serverList" to "/ajax/server/list?servers={servers}",
            "serverResolve" to "/ajax/server?get={linkId}",
            "sources" to "/stream/getSources?id={playerId}",
        ),
        selectors = mapOf(
            "searchItemClass" to "item", "searchTitleAttribute" to "data-jp",
            "totalClass" to "total", "subClass" to "sub", "dubClass" to "dub",
            "watchContainerId" to "watch-main", "showIdAttribute" to "data-id",
            "episodeIdAttribute" to "data-id", "episodeSlugAttribute" to "data-slug",
            "episodeNumberAttribute" to "data-num", "episodeServersAttribute" to "data-ids",
            "malIdAttribute" to "data-mal", "serverLinkAttribute" to "data-link-id",
            "playerContainerId" to "megaplay-player", "playerIdAttribute" to "data-id",
        ),
    )
    private val defaults = AndroidRuntimeConfig(
        revision = 0,
        issuedAt = "2026-08-17T00:00:00.000Z",
        providerOrder = listOf("anikoto", "animepahe"),
        providers = linkedMapOf(
            "anikoto" to defaultProvider,
            "animepahe" to ProviderRuntimeConfig(
                true,
                listOf("https://animepahe.pw"),
                listOf("owocdn.top", "owocdn.com", "uwucdn.top", "llnwi.net", "kwik.si", "kwik.cx"),
                listOf(".m3u8", ".mp4", ".ts", ".m4s", ".vtt", ".key"),
                mapOf(
                    "home" to "/", "search" to "/api?m=search&q={query}",
                    "latest" to "/api?m=airing&l={count}&sort=session_id_desc&page={page}",
                    "episodes" to "/api?m=release&id={animeId}&sort=episode_asc&page={page}",
                    "anime" to "/anime/{session}", "play" to "/play/{animeId}/{episodeId}",
                ),
                mapOf(
                    "streamUrlAttribute" to "data-src",
                    "resolutionAttribute" to "data-resolution",
                    "audioAttribute" to "data-audio",
                ),
            ),
        ),
        features = RuntimeFeatures(true, true, true, true, true),
        notice = null,
    )

    private val http = OkHttpClient.Builder()
        .callTimeout(15, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()
    private val mutex = Mutex()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var appContext: Context? = null
    @Volatile private var active = defaults
    @Volatile private var activeJson: String? = null
    private var initialized = false

    val status = mutableStateOf(RemoteConfigStatus(0, "built-in", null, null, null))

    fun init(context: Context) {
        synchronized(this) {
            if (initialized) return
            initialized = true
            appContext = context.applicationContext
            loadCache(context.applicationContext)
            schedule(context.applicationContext)
        }
        scope.launch {
            refresh()
            com.sanjay.anitrack.next.update.AppUpdater.init(context.applicationContext)
            com.sanjay.anitrack.next.update.AppUpdater.checkForUpdate()
        }
    }

    fun current(): AndroidRuntimeConfig = active

    private fun schedule(context: Context) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = PeriodicWorkRequestBuilder<AutomationRefreshWorker>(6, TimeUnit.HOURS)
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    private fun loadCache(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val json = prefs.getString(KEY_JSON, null)
        val signature = prefs.getString(KEY_SIGNATURE, null)
        if (json == null || signature == null) {
            prefs.edit().remove(KEY_JSON).remove(KEY_SIGNATURE).remove(KEY_ETAG).apply()
            return
        }
        runCatching {
            if (!AutomationTrust.verify(json.toByteArray(Charsets.UTF_8), signature)) error("signature invalid")
            parse(json)
        }.onSuccess { config ->
            active = config
            activeJson = json
            publish(
                RemoteConfigStatus(
                    config.revision,
                    "cache",
                    prefs.getLong(KEY_LAST_CHECK, 0).takeIf { it > 0 },
                    prefs.getLong(KEY_LAST_UPDATE, 0).takeIf { it > 0 },
                    null,
                ),
            )
        }.onFailure {
            activeJson = null
            prefs.edit().remove(KEY_JSON).remove(KEY_SIGNATURE).remove(KEY_ETAG).apply()
            publish(status.value.copy(error = "Cached automation rules were ignored: ${it.message}"))
        }
    }

    suspend fun refresh(): RemoteConfigStatus = withContext(Dispatchers.IO) { mutex.withLock {
        val context = appContext ?: return@withLock status.value
        val checkedAt = System.currentTimeMillis()
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        try {
            val builder = Request.Builder().url(BuildConfig.AUTOMATION_CONFIG_URL)
                .header("Accept", "application/json")
                .header("Cache-Control", "no-cache")
            if (activeJson != null) {
                prefs.getString(KEY_ETAG, null)?.let { builder.header("If-None-Match", it) }
            }
            val response = withContext(Dispatchers.IO) { http.newCall(builder.build()).execute() }
            response.use { configResponse ->
                if (configResponse.code == 304) {
                    prefs.edit().putLong(KEY_LAST_CHECK, checkedAt).apply()
                    val next = status.value.copy(lastCheckedAt = checkedAt, error = null)
                    publish(next)
                    return@withLock next
                }
                if (!configResponse.isSuccessful) error("Config server returned HTTP ${configResponse.code}")
                val bytes = AutomationTrust.readBounded(configResponse.body, MAX_BYTES, "Config response")
                val signatureResponse = withContext(Dispatchers.IO) {
                    http.newCall(Request.Builder().url(BuildConfig.AUTOMATION_CONFIG_SIGNATURE_URL).build()).execute()
                }
                val signature = signatureResponse.use {
                    if (!it.isSuccessful) error("Signature server returned HTTP ${it.code}")
                    AutomationTrust.readBounded(it.body, 4 * 1024, "Config signature")
                        .toString(Charsets.UTF_8).trim()
                }
                if (!AutomationTrust.verify(bytes, signature)) error("Config signature is invalid")
                val json = bytes.toString(Charsets.UTF_8)
                val nextConfig = parse(json)
                if (nextConfig.revision < active.revision) error("Config rollback was rejected")
                if (nextConfig.revision == active.revision && activeJson != null && json != activeJson) {
                    error("Config changed without a revision increase")
                }
                val updatedAt = if (nextConfig.revision > active.revision || activeJson == null) checkedAt
                    else status.value.lastUpdatedAt
                if (updatedAt == checkedAt) {
                    if (!prefs.edit()
                            .putString(KEY_JSON, json)
                            .putString(KEY_SIGNATURE, signature)
                            .putString(KEY_ETAG, configResponse.header("ETag"))
                            .putLong(KEY_LAST_CHECK, checkedAt)
                            .putLong(KEY_LAST_UPDATE, checkedAt)
                            .commit()) error("Could not cache verified config")
                    active = nextConfig
                    activeJson = json
                } else {
                    prefs.edit().putLong(KEY_LAST_CHECK, checkedAt).apply()
                }
                val next = RemoteConfigStatus(nextConfig.revision, "remote", checkedAt, updatedAt, null)
                publish(next)
                return@withLock next
            }
        } catch (error: Exception) {
            prefs.edit().putLong(KEY_LAST_CHECK, checkedAt).apply()
            val next = status.value.copy(lastCheckedAt = checkedAt, error = error.message ?: "Refresh failed")
            publish(next)
            return@withLock next
        }
    } }

    internal fun parse(json: String): AndroidRuntimeConfig {
        val root = JSONObject(json)
        require(root.optInt("schemaVersion") == 1) { "Unsupported config schema" }
        val revision = root.optLong("revision", -1)
        require(revision >= 1) { "Invalid config revision" }
        val providers = root.getJSONObject("providers")
        val features = root.getJSONObject("features")
        val orderJson = root.getJSONArray("providerOrder")
        val providerOrder = (0 until orderJson.length()).map { orderJson.getString(it) }
        val providerId = Regex("^[a-z][a-z0-9-]{1,31}$")
        require(providerOrder.size in 1..16 && providerOrder.distinct().size == providerOrder.size &&
            providerOrder.all { it.matches(providerId) }) {
            "Invalid provider order"
        }
        val configuredProviderIds = providers.keys().asSequence().toSet()
        require(configuredProviderIds == providerOrder.toSet()) {
            "Provider configuration must exactly match provider order"
        }
        val parsedProviders = providerOrder.associateWith { id ->
            parseProvider(providers.getJSONObject(id), id)
        }
        return AndroidRuntimeConfig(
            revision = revision,
            issuedAt = root.getString("issuedAt"),
            providerOrder = providerOrder,
            providers = parsedProviders,
            features = RuntimeFeatures(
                features.getBoolean("anikotoStreaming"),
                features.getBoolean("animepaheStreaming"),
                features.getBoolean("downloads"),
                features.getBoolean("malSync"),
                features.getBoolean("gistSync"),
            ),
            notice = root.optString("notice").takeIf { !root.isNull("notice") && it.length <= 500 },
        )
    }

    private fun parseProvider(raw: JSONObject, provider: String): ProviderRuntimeConfig {
        val expectedFields = setOf("enabled", "baseUrls", "streamHostFragments", "mediaExtensions", "routes", "selectors")
        require(raw.keys().asSequence().toSet() == expectedFields) { "$provider contains unsupported fields" }
        fun array(name: String, max: Int = 32, validator: (String) -> Boolean): List<String> {
            val values = raw.getJSONArray(name)
            require(values.length() in 1..max) { "$name has invalid size" }
            return (0 until values.length()).map { values.getString(it).lowercase() }.also { list ->
                require(list.all { it.length <= 120 && validator(it) }) { "$name contains an invalid value" }
            }.distinct()
        }
        val configKey = Regex("[A-Za-z][A-Za-z0-9]{0,63}")
        val routesJson = raw.getJSONObject("routes")
        val routeNames = routesJson.keys().asSequence().toSet()
        require(routeNames.size in 1..32 && routeNames.all { it.matches(configKey) }) {
            "$provider routes have invalid names or size"
        }
        val routes = routeNames.associateWith { name ->
            routesJson.getString(name).also { route ->
                require(route.length in 1..240 && route.startsWith('/') && !route.contains("\\") &&
                    !route.contains("://") && !route.contains(Regex("[\\r\\n\\u0000]"))) {
                    "$provider route $name is invalid"
                }
                val placeholders = Regex("""\{([A-Za-z][A-Za-z0-9]*)\}""").findAll(route)
                    .map { it.groupValues[1] }.toList()
                require(placeholders.size <= 16 && placeholders.distinct().size == placeholders.size &&
                    !route.replace(Regex("""\{[A-Za-z][A-Za-z0-9]*\}"""), "").let {
                        it.contains('{') || it.contains('}')
                    }) {
                    "$provider route $name has invalid placeholders"
                }
            }
        }
        val selectorsJson = raw.getJSONObject("selectors")
        val selectorNames = selectorsJson.keys().asSequence().toSet()
        require(selectorNames.size <= 32 && selectorNames.all { it.matches(configKey) }) {
            "$provider selectors have invalid names or size"
        }
        val selectors = selectorNames.associateWith { name ->
            selectorsJson.getString(name).also {
                require(it.matches(Regex("[A-Za-z][A-Za-z0-9_-]{0,63}"))) { "$provider selector $name is invalid" }
            }
        }
        return ProviderRuntimeConfig(
            enabled = raw.getBoolean("enabled"),
            baseUrls = array("baseUrls", 8, ::safeHttpsOrigin).map { it.trimEnd('/') },
            streamHostFragments = array("streamHostFragments") {
                val domain = Regex("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+")
                val hostFamily = Regex("[a-z0-9][a-z0-9-]{4,61}\\.?")
                it.matches(domain) || it.matches(hostFamily)
            },
            mediaExtensions = array("mediaExtensions") { it.matches(Regex("\\.[a-z0-9]{1,8}")) },
            routes = routes,
            selectors = selectors,
        )
    }

    private fun safeHttpsUrl(value: String): Boolean = runCatching {
        val uri = java.net.URI(value)
        val host = uri.host?.lowercase().orEmpty()
        uri.scheme == "https" && uri.userInfo == null && host.isNotBlank() &&
            host != "localhost" && host != "::1" && !host.endsWith(".local") &&
            !host.startsWith("127.") && !host.startsWith("10.") && !host.startsWith("192.168.") &&
            !(host.startsWith("172.") && host.split('.').getOrNull(1)?.toIntOrNull() in 16..31)
    }.getOrDefault(false)

    private fun safeHttpsOrigin(value: String): Boolean = safeHttpsUrl(value) && runCatching {
        val uri = java.net.URI(value)
        (uri.path.isNullOrEmpty() || uri.path == "/") && uri.query == null && uri.fragment == null
    }.getOrDefault(false)

    private fun publish(next: RemoteConfigStatus) {
        if (Looper.myLooper() == Looper.getMainLooper()) status.value = next
        else main.post { status.value = next }
    }
}

class AutomationRefreshWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        RemoteConfig.init(applicationContext)
        val config = RemoteConfig.refresh()
        com.sanjay.anitrack.next.update.AppUpdater.init(applicationContext)
        val updateOk = com.sanjay.anitrack.next.update.AppUpdater.checkForUpdate()
        return if (config.error == null && updateOk) Result.success() else Result.retry()
    }
}
