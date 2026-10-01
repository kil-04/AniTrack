package com.sanjay.anitrack.next.data.providers.connectors.mkissa

import android.util.Log
import com.sanjay.anitrack.next.BuildConfig
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.Match
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.math.max

internal class MkissaService(
    private val transport: MkissaHttpTransport = MkissaOkHttpTransport(),
    private val keyManager: MkissaKeyManager = MkissaKeyManager(
        transport,
        diagnostic = { message -> if (BuildConfig.DEBUG) Log.d("AniTrackMkissa", message) },
    ),
    private val nowMillis: () -> Long = System::currentTimeMillis,
) {

    private val sourceCache = object : LinkedHashMap<MkissaEpisodeRef, CacheEntry>(32, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<MkissaEpisodeRef, CacheEntry>) =
            size > MAX_SOURCE_CACHE_ENTRIES
    }

    suspend fun search(query: String, page: Int = 1): List<MkissaShowSummary> {
        val cleanQuery = query.trim()
        if (cleanQuery.isEmpty()) return emptyList()
        require(page in 1..100) { "Invalid MKissa search page" }

        val variables = JSONObject()
            .put(
                "search",
                JSONObject()
                    .put("query", cleanQuery.take(200))
                    .put("allowAdult", false)
                    .put("allowUnknown", true),
            )
            .put("limit", SEARCH_PAGE_SIZE)
            .put("page", page)
            .put("translationType", "sub")
            .put("countryOrigin", "ALL")

        val rich = graphQl(SEARCH_QUERY, variables, allowErrors = true)
        val usable = if (rich.optJSONArray("errors") != null) {
            graphQl(SEARCH_QUERY_FALLBACK, variables)
        } else {
            rich
        }
        val edges = usable.optJSONObject("data")?.optJSONObject("shows")?.optJSONArray("edges")
        if (edges == null) {
            if (BuildConfig.DEBUG) Log.d(LOG_TAG, "search query=$cleanQuery returned no edges")
            return emptyList()
        }
        val results = (0 until edges.length()).mapNotNull { index -> parseSummary(edges.optJSONObject(index)) }
            .distinctBy(MkissaShowSummary::id)
        if (BuildConfig.DEBUG) {
            Log.d(LOG_TAG, "search query=$cleanQuery edges=${edges.length()} parsed=${results.size}")
        }
        return results
    }

    suspend fun show(id: String, fallback: MkissaShowSummary? = null): MkissaShow {
        require(id.matches(SHOW_ID)) { "Invalid MKissa show id" }
        val variables = JSONObject().put("_id", id)
        val root = graphQl(SHOW_QUERY, variables)
        val raw = root.optJSONObject("data")?.optJSONObject("show")
            ?: throw MkissaProtocolException("MKissa show was missing")
        val episodes = raw.optJSONObject("availableEpisodesDetail")
        return MkissaShow(
            id = raw.nullableString("_id") ?: id,
            title = raw.nullableString("name") ?: fallback?.title ?: id,
            englishTitle = raw.nullableString("englishName") ?: fallback?.englishTitle,
            nativeTitle = raw.nullableString("nativeName") ?: fallback?.nativeTitle,
            thumbnail = raw.nullableString("thumbnail") ?: fallback?.thumbnail,
            aniListId = raw.nullableInt("aniListId") ?: fallback?.aniListId,
            year = raw.seasonYear() ?: fallback?.year,
            description = raw.nullableString("description"),
            genres = raw.stringList("genres"),
            subEpisodes = episodes?.stringList("sub").orEmpty().sortedEpisodeStrings(),
            dubEpisodes = episodes?.stringList("dub").orEmpty().sortedEpisodeStrings(),
        )
    }

    suspend fun match(anime: Anime): MkissaShow? {
        val queries = buildList {
            add(anime.title)
            anime.titleRomaji?.takeIf { !it.equals(anime.title, ignoreCase = true) }?.let(::add)
        }
        val candidates = linkedMapOf<String, MkissaShowSummary>()
        var lastFailure: Throwable? = null
        var successfulSearches = 0
        for (query in queries) {
            for (page in 1..MAX_MATCH_SEARCH_PAGES) {
                try {
                    val results = search(query, page)
                    successfulSearches++
                    results.forEach { candidates.putIfAbsent(it.id, it) }
                    val exactResult = results.any { candidate ->
                        candidate.aniListId == anime.id || queries.any { title ->
                            Match.norm(candidate.title) == Match.norm(title)
                        }
                    }
                    if (exactResult || results.size < SEARCH_PAGE_SIZE) break
                } catch (error: MkissaRateLimitedException) {
                    throw error
                } catch (error: Exception) {
                    lastFailure = error
                    break
                }
            }
            if (candidates.values.any { it.aniListId == anime.id }) break
        }
        if (successfulSearches == 0 && lastFailure != null) {
            throw MkissaException("MKissa search failed", lastFailure)
        }
        if (candidates.isEmpty()) {
            if (BuildConfig.DEBUG) Log.d(LOG_TAG, "match anime=${anime.id} had no candidates")
            return null
        }

        val exact = candidates.values.firstOrNull { it.aniListId == anime.id }
        val scored = candidates.values
            .map { candidate ->
                val score = queries.maxOf { title ->
                    Match.score(
                        candidate.title,
                        candidate.year,
                        candidate.episodeCount,
                        title,
                        anime.year,
                        anime.episodes,
                        anime.status == "RELEASING",
                    )
                }
                candidate to score
            }
        if (BuildConfig.DEBUG) {
            val top = scored.sortedByDescending { it.second }.take(5).joinToString(" | ") { (candidate, score) ->
                "${candidate.title} score=$score year=${candidate.year} eps=${candidate.episodeCount}"
            }
            Log.d(LOG_TAG, "match anime=${anime.id} top=$top")
        }
        val selected = exact ?: scored
            .filter { (_, score) -> score >= 20 }
            .maxByOrNull { (_, score) -> score }
            ?.first
            ?: run {
                if (BuildConfig.DEBUG) {
                    Log.d(LOG_TAG, "match anime=${anime.id} rejected ${candidates.size} candidates")
                }
                return null
            }
        if (BuildConfig.DEBUG) {
            Log.d(LOG_TAG, "match anime=${anime.id} selected=${selected.id} exact=${exact != null}")
        }
        return show(selected.id, selected)
    }

    suspend fun sources(episode: MkissaEpisodeRef): List<MkissaSourceCandidate> {
        synchronized(sourceCache) {
            sourceCache[episode]?.takeIf { nowMillis() < it.expiresAtMillis }?.let { return it.sources }
        }

        var lastError: Throwable? = null
        repeat(MAX_CRYPTO_ATTEMPTS) { attempt ->
            val material = runCatching { keyManager.material(forceRefresh = attempt > 0) }
                .getOrElse {
                    if (it is MkissaRateLimitedException) throw it
                    lastError = it
                    return@repeat
                }
            val response = runCatching { protectedSourceRequest(episode, material) }
                .getOrElse {
                    if (it is MkissaRateLimitedException) throw it
                    lastError = it
                    return@repeat
                }

            MkissaChallengePolicy.classify(response.code, response.body)?.let { kind ->
                throw MkissaRateLimitedException(kind)
            }
            if (!response.successful) {
                lastError = MkissaProtocolException("MKissa stream request returned HTTP ${response.code}")
                if (response.code == 403) keyManager.invalidateBuild()
                return@repeat
            }

            val root = runCatching { JSONObject(response.body) }.getOrElse {
                lastError = MkissaProtocolException("MKissa stream response was not JSON", it)
                return@repeat
            }
            val errors = root.graphQlErrors()
            errors.firstNotNullOfOrNull(MkissaGraphQlError::challengeKind)?.let { kind ->
                throw MkissaRateLimitedException(kind)
            }
            if (errors.any(MkissaGraphQlError::cryptoFailure)) {
                lastError = MkissaProtocolException("MKissa rejected stale crypto material")
                if (attempt >= 1) keyManager.invalidateBuild() else keyManager.invalidateMaterial()
                return@repeat
            }
            if (errors.isNotEmpty()) {
                throw MkissaProtocolException("MKissa: ${errors.first().message ?: errors.first().code}")
            }

            val encrypted = root.optJSONObject("data")?.nullableString("tobeparsed")
            val episodeObject = if (encrypted != null) {
                val decrypted = keyManager.decrypt(encrypted, material)
                val parsed = decrypted?.let { runCatching { JSONObject(it) }.getOrNull() }
                parsed?.optJSONObject("episode")
            } else {
                root.optJSONObject("data")?.optJSONObject("episode")
            }
            val sourceArray = episodeObject?.optJSONArray("sourceUrls")
            val parsedSources = sourceArray?.let(::parseSources).orEmpty()
            if (parsedSources.isNotEmpty()) {
                val sorted = parsedSources.sortedByDescending(MkissaSourceCandidate::priority)
                if (BuildConfig.DEBUG) {
                    sorted.forEach { source ->
                        val uri = runCatching { URI(source.url) }.getOrNull()
                        val extension = uri?.path.orEmpty().substringAfterLast('.', missingDelimiterValue = "none")
                            .take(12)
                        Log.d(
                            LOG_TAG,
                            "source name=${source.name} type=${source.type} host=${uri?.host.orEmpty()} ext=$extension fragment=${!uri?.fragment.isNullOrEmpty()}",
                        )
                    }
                }
                synchronized(sourceCache) {
                    sourceCache[episode] = CacheEntry(nowMillis() + SOURCE_CACHE_TTL_MS, sorted)
                }
                return sorted
            }

            lastError = MkissaProtocolException("MKissa returned no usable servers")
            keyManager.invalidateMaterial()
        }

        throw MkissaProtocolException(
            "MKissa could not resolve this episode after a bounded key refresh",
            lastError,
        )
    }

    /** Resolves just one chosen server. Third-party embed extractors are intentionally not fanned out. */
    suspend fun resolve(candidate: MkissaSourceCandidate): List<MkissaMediaSource> {
        val normalized = normalizeSourceUrl(candidate.url)
        if (normalized.isClockEndpoint()) return resolveClock(candidate.copy(url = normalized))

        val parsed = URI(normalized)
        val host = parsed.host.orEmpty().lowercase().removePrefix("www.")
        when {
            host == "mp4upload.com" -> return listOf(resolveMp4Upload(candidate.copy(url = normalized)))
            host == "ok.ru" -> return listOf(resolveOkRu(candidate.copy(url = normalized)))
            host == "uns.bio" || host.endsWith(".uns.bio") -> return listOf(resolveUns(candidate.copy(url = normalized)))
            host == "bysekoze.com" || host.endsWith(".bysekoze.com") ||
                host == "streamsb.net" || host.endsWith(".streamsb.net") -> {
                return listOf(resolvePackedEmbed(candidate.copy(url = normalized), MkissaMediaKind.HLS))
            }
        }

        val lowerPath = parsed.path.orEmpty().lowercase()
        val kind = when {
            lowerPath.endsWith(".m3u8") -> MkissaMediaKind.HLS
            lowerPath.endsWith(".mp4") -> MkissaMediaKind.MP4
            lowerPath.endsWith(".mpd") -> MkissaMediaKind.DASH
            candidate.type.equals("player", ignoreCase = true) && candidate.name.contains("hls", ignoreCase = true) ->
                MkissaMediaKind.HLS
            candidate.type.equals("player", ignoreCase = true) && candidate.name.contains("mp4", ignoreCase = true) ->
                MkissaMediaKind.MP4
            else -> throw MkissaUnsupportedSourceException(
                "${candidate.name} is an embed host and needs a dedicated safe extractor",
            )
        }
        return listOf(
            MkissaMediaSource(
                url = MkissaUrlPolicy.requireMediaUrl(normalized),
                serverName = candidate.name,
                kind = kind,
                headers = playbackHeaders(legacyPlayerReferer = false),
                downloadable = false,
            ),
        )
    }

    private suspend fun resolveMp4Upload(candidate: MkissaSourceCandidate): MkissaMediaSource {
        val referer = "https://www.mp4upload.com/"
        val response = embedRequest(candidate.url, referer)
        if (!response.successful) throw MkissaUnsupportedSourceException("MP4Upload did not respond")
        val url = extractMediaUrl(response.body, setOf("mp4"))
            ?: throw MkissaUnsupportedSourceException("MP4Upload media was not found")
        return externalMedia(candidate, url, MkissaMediaKind.MP4, referer)
    }

    private suspend fun resolveOkRu(candidate: MkissaSourceCandidate): MkissaMediaSource {
        val referer = "https://ok.ru/"
        val response = embedRequest(candidate.url, referer)
        if (!response.successful) throw MkissaUnsupportedSourceException("OK video did not respond")
        val encoded = OK_HLS.find(response.body)?.groupValues?.getOrNull(1)
            ?: throw MkissaUnsupportedSourceException("OK video media was not found")
        val url = decodedMediaUrl(encoded)
            ?: throw MkissaUnsupportedSourceException("OK video returned an unsafe media URL")
        return externalMedia(candidate, url, MkissaMediaKind.HLS, referer)
    }

    private suspend fun resolveUns(candidate: MkissaSourceCandidate): MkissaMediaSource {
        val embed = URI(candidate.url)
        val identifier = embed.rawFragment.orEmpty().substringBefore('&')
        if (!identifier.matches(UNS_IDENTIFIER)) {
            throw MkissaUnsupportedSourceException("MKissa MP4 server identifier was invalid")
        }
        val origin = "${embed.scheme}://${embed.host}"
        val endpoint = "$origin/api/v1/video?id=$identifier&w=1280&h=720&r="
        val response = transport.execute(
            MkissaHttpRequest(
                method = "GET",
                url = MkissaUrlPolicy.requireMediaUrl(endpoint),
                headers = MkissaKeyManager.browserHeaders() + mapOf(
                    "Accept" to "text/plain",
                    "Origin" to origin,
                    "Referer" to candidate.url,
                ),
            ),
        )
        if (!response.successful) throw MkissaUnsupportedSourceException("MKissa MP4 server did not respond")
        val encrypted = response.body.trim()
        if (encrypted.isEmpty() || encrypted.length % 32 != 0 || !encrypted.matches(HEX)) {
            throw MkissaUnsupportedSourceException("MKissa MP4 server response was invalid")
        }
        val decoded = runCatching {
            val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                SecretKeySpec("kiemtienmua911ca".toByteArray(), "AES"),
                IvParameterSpec("1234567890oiuytr".toByteArray()),
            )
            String(cipher.doFinal(encrypted.chunked(2).map { it.toInt(16).toByte() }.toByteArray()))
        }.getOrElse { throw MkissaUnsupportedSourceException("MKissa MP4 server decryption failed") }
        val payload = runCatching { JSONObject(decoded) }.getOrNull()
            ?: throw MkissaUnsupportedSourceException("MKissa MP4 server response was invalid")
        val url = (payload.nullableString("source") ?: payload.nullableString("cf"))
            ?.let(::decodedMediaUrl)
            ?: throw MkissaUnsupportedSourceException("MKissa MP4 server returned no media")
        val kind = if (URI(url).path.orEmpty().contains(".m3u8", ignoreCase = true)) {
            MkissaMediaKind.HLS
        } else {
            MkissaMediaKind.MP4
        }
        return externalMedia(candidate, url, kind, candidate.url, origin)
    }

    private suspend fun resolvePackedEmbed(
        candidate: MkissaSourceCandidate,
        expectedKind: MkissaMediaKind,
    ): MkissaMediaSource {
        val embed = URI(candidate.url)
        val origin = "${embed.scheme}://${embed.host}"
        val response = embedRequest(candidate.url, "$origin/")
        if (!response.successful) throw MkissaUnsupportedSourceException("${candidate.name} did not respond")
        val direct = extractMediaUrl(response.body, setOf("m3u8", "mp4"))
            ?: packedBodies(response.body).firstNotNullOfOrNull { extractMediaUrl(it, setOf("m3u8", "mp4")) }
            ?: throw MkissaUnsupportedSourceException("${candidate.name} media was not found")
        val kind = when {
            URI(direct).path.orEmpty().contains(".m3u8", ignoreCase = true) -> MkissaMediaKind.HLS
            URI(direct).path.orEmpty().contains(".mp4", ignoreCase = true) -> MkissaMediaKind.MP4
            else -> expectedKind
        }
        return externalMedia(candidate, direct, kind, candidate.url, origin)
    }

    private suspend fun embedRequest(url: String, referer: String): MkissaHttpResponse = transport.execute(
        MkissaHttpRequest(
            method = "GET",
            url = MkissaUrlPolicy.requireMediaUrl(url),
            headers = MkissaKeyManager.browserHeaders() + mapOf("Accept" to "text/html,*/*", "Referer" to referer),
        ),
    )

    private fun externalMedia(
        candidate: MkissaSourceCandidate,
        url: String,
        kind: MkissaMediaKind,
        referer: String,
        origin: String? = null,
    ) = MkissaMediaSource(
        url = MkissaUrlPolicy.requireMediaUrl(url),
        serverName = candidate.name,
        kind = kind,
        headers = MkissaKeyManager.browserHeaders() + buildMap {
            put("Referer", referer)
            if (origin != null) put("Origin", origin)
        },
        downloadable = false,
    )

    private fun extractMediaUrl(text: String, extensions: Set<String>): String? {
        val candidates = MEDIA_URL.findAll(text).map { it.value } +
            MEDIA_FIELD.findAll(text).mapNotNull { it.groupValues.getOrNull(1) }
        return candidates.mapNotNull(::decodedMediaUrl).firstOrNull { url ->
            val path = runCatching { URI(url).path.orEmpty().lowercase() }.getOrDefault("")
            extensions.any { path.contains(".$it") }
        }
    }

    private fun decodedMediaUrl(value: String): String? = runCatching {
        val decoded = value
            .replace("\\u0026", "&", ignoreCase = true)
            .replace("&amp;", "&", ignoreCase = true)
            .replace("&quot;", "\"")
            .replace("\\/", "/")
        MkissaUrlPolicy.requireMediaUrl(decoded)
    }.getOrNull()

    private fun packedBodies(html: String): Sequence<String> =
        (PACKED_CALL.findAll(html) + PACKED_CALL_DOUBLE.findAll(html)).mapNotNull { match ->
        val encoded = match.groupValues[1]
        val radix = match.groupValues[2].toIntOrNull()?.takeIf { it in 2..62 } ?: return@mapNotNull null
        val count = match.groupValues[3].toIntOrNull()?.takeIf { it in 1..10_000 } ?: return@mapNotNull null
        val keys = match.groupValues[4].split('|').take(count)
        val lookup = keys.mapIndexedNotNull { index, word ->
            word.takeIf { it.isNotEmpty() }?.let { baseN(index, radix) to it }
        }.toMap()
        PACKED_WORD.replace(encoded) { token -> lookup[token.value] ?: token.value }
    }

    private fun baseN(value: Int, radix: Int): String {
        if (value == 0) return "0"
        var number = value
        val result = StringBuilder()
        while (number > 0) {
            result.append(PACKED_ALPHABET[number % radix])
            number /= radix
        }
        return result.reverse().toString()
    }

    suspend fun resolveFirst(candidates: List<MkissaSourceCandidate>): List<MkissaMediaSource> {
        val failures = mutableListOf<String>()
        for (candidate in candidates.sortedByDescending(MkissaSourceCandidate::priority)) {
            try {
                val media = resolve(candidate)
                if (media.isNotEmpty()) return media
            } catch (error: MkissaRateLimitedException) {
                throw error
            } catch (error: Exception) {
                failures += "${candidate.name}: ${error.message}"
            }
        }
        throw MkissaUnsupportedSourceException(
            failures.take(4).joinToString("; ").ifEmpty { "MKissa returned no supported server" },
        )
    }

    suspend fun resolveFirst(episode: MkissaEpisodeRef): List<MkissaMediaSource> = resolveFirst(sources(episode))

    private suspend fun graphQl(
        query: String,
        variables: JSONObject,
        allowErrors: Boolean = false,
    ): JSONObject {
        val body = JSONObject().put("query", query).put("variables", variables).toString()
        val response = transport.execute(
            MkissaHttpRequest(
                method = "POST",
                url = "$API_URL/api",
                headers = MkissaKeyManager.browserHeaders() + mapOf(
                    "Content-Type" to "application/json",
                    "Origin" to SITE_URL,
                    "Referer" to "$SITE_URL/",
                ),
                body = body,
            ),
        )
        MkissaChallengePolicy.classify(response.code, response.body)?.let { kind ->
            throw MkissaRateLimitedException(kind)
        }
        if (!response.successful) throw MkissaProtocolException("MKissa API returned HTTP ${response.code}")
        val root = runCatching { JSONObject(response.body) }
            .getOrElse { throw MkissaProtocolException("MKissa API returned invalid JSON", it) }
        val errors = root.graphQlErrors()
        errors.firstNotNullOfOrNull(MkissaGraphQlError::challengeKind)?.let { kind ->
            throw MkissaRateLimitedException(kind)
        }
        if (!allowErrors) {
            errors.firstOrNull()?.let { error ->
                throw MkissaProtocolException("MKissa: ${error.message ?: error.code}")
            }
        }
        return root
    }

    private suspend fun protectedSourceRequest(
        episode: MkissaEpisodeRef,
        material: MkissaKeyManager.Material,
    ): MkissaHttpResponse {
        val variables = JSONObject()
            .put("showId", episode.showId)
            .put("translationType", episode.translation.wireValue)
            .put("episodeString", episode.episodeString)
        val queryHash = MkissaCrypto.sha256Hex(STREAM_QUERY)
        val extensions = JSONObject()
            .put("persistedQuery", JSONObject().put("version", 1).put("sha256Hash", queryHash))
            .put("k", MkissaKeyManager.CONTENT_LANE)
            .put("aaReq", keyManager.buildRequestToken(material, queryHash))
        val url = "$API_URL/api".toHttpUrl().newBuilder()
            .addQueryParameter("query", STREAM_QUERY)
            .addQueryParameter("variables", variables.toString())
            .addQueryParameter("extensions", extensions.toString())
            .build().toString()
        return transport.execute(
            MkissaHttpRequest(
                method = "GET",
                url = url,
                headers = MkissaKeyManager.browserHeaders() + mapOf(
                    "Origin" to SITE_URL,
                    "Referer" to "$SITE_URL/",
                    "x-build-id" to material.buildId,
                ),
            ),
        )
    }

    private fun parseSummary(raw: JSONObject?): MkissaShowSummary? {
        raw ?: return null
        val id = raw.nullableString("_id")?.takeIf { it.matches(SHOW_ID) } ?: return null
        val episodes = raw.optJSONObject("availableEpisodesDetail")
        val subCount = episodes?.optJSONArray("sub")?.length() ?: 0
        val dubCount = episodes?.optJSONArray("dub")?.length() ?: 0
        return MkissaShowSummary(
            id = id,
            title = raw.nullableString("name") ?: return null,
            englishTitle = raw.nullableString("englishName"),
            nativeTitle = raw.nullableString("nativeName"),
            thumbnail = raw.nullableString("thumbnail")?.let(::validatedOptionalMediaUrl),
            aniListId = raw.nullableInt("aniListId"),
            year = raw.seasonYear(),
            episodeCount = max(subCount, dubCount).takeIf { it > 0 },
        )
    }

    private fun parseSources(array: JSONArray): List<MkissaSourceCandidate> = buildList {
        for (index in 0 until minOf(array.length(), MAX_SOURCE_CHOICES)) {
            val raw = array.optJSONObject(index) ?: continue
            val encoded = raw.nullableString("sourceUrl") ?: continue
            val normalized = runCatching { normalizeSourceUrl(decodeSourceUrl(encoded)) }.getOrNull() ?: continue
            add(
                MkissaSourceCandidate(
                    url = normalized,
                    name = raw.nullableString("sourceName")?.take(80) ?: "Server ${index + 1}",
                    type = raw.nullableString("type")?.take(40).orEmpty(),
                    priority = raw.optDouble("priority", 0.0).toFloat(),
                ),
            )
        }
    }

    private suspend fun resolveClock(candidate: MkissaSourceCandidate): List<MkissaMediaSource> {
        val parsed = URI(candidate.url)
        val sourcePath = parsed.rawPath
        if (!sourcePath.matches(CLOCK_PATH)) {
            throw MkissaUnsupportedSourceException("MKissa internal server path was invalid")
        }
        val path = if (sourcePath.endsWith(".json")) sourcePath else "$sourcePath.json"
        val endpoint = "${MkissaKeyManager.PLAYER_ORIGIN}$path${parsed.rawQuery?.let { "?$it" }.orEmpty()}"
        val response = transport.execute(
            MkissaHttpRequest(
                method = "GET",
                url = MkissaUrlPolicy.requireMediaUrl(endpoint),
                headers = MkissaKeyManager.browserHeaders() + mapOf(
                    "Accept" to "*/*",
                    "Origin" to MkissaKeyManager.PLAYER_ORIGIN,
                    "Referer" to "${MkissaKeyManager.PLAYER_ORIGIN}/player.html",
                ),
            ),
        )
        MkissaChallengePolicy.classify(response.code, response.body)?.let { kind ->
            throw MkissaRateLimitedException(kind)
        }
        if (!response.successful) throw MkissaProtocolException(
            "MKissa ${candidate.name} server returned HTTP ${response.code}",
        )
        val links = runCatching { JSONObject(response.body).optJSONArray("links") }.getOrNull()
            ?: throw MkissaProtocolException("MKissa clock response had no links")
        return buildList {
            for (index in 0 until links.length()) {
                val link = links.optJSONObject(index) ?: continue
                val subtitles = link.optJSONArray("subtitles").toSubtitles()
                val quality = link.nullableString("resolutionStr")
                val direct = link.nullableString("link")
                when {
                    link.optBoolean("mp4") && direct != null -> direct.toSafeMediaUrl()?.let { url ->
                        add(media(candidate, url, MkissaMediaKind.MP4, subtitles, quality))
                    }
                    link.optBoolean("hls") && direct != null -> direct.toSafeMediaUrl()?.let { url ->
                        add(media(candidate, url, MkissaMediaKind.HLS, subtitles, quality))
                    }
                    link.optBoolean("dash") && direct != null -> direct.toSafeMediaUrl()?.let { url ->
                        // Only expose a complete DASH manifest. MKissa also returns split raw audio/video
                        // tracks, which the current player model cannot merge safely.
                        add(media(candidate, url, MkissaMediaKind.DASH, subtitles, quality))
                    }
                    link.optBoolean("crIframe") -> {
                        val streams = link.optJSONObject("portData")?.optJSONArray("streams")
                        if (streams != null) for (streamIndex in 0 until streams.length()) {
                            val stream = streams.optJSONObject(streamIndex) ?: continue
                            val url = stream.nullableString("url")?.toSafeMediaUrl() ?: continue
                            val kind = when (stream.nullableString("format")) {
                                "adaptive_hls" -> MkissaMediaKind.HLS
                                "adaptive_dash" -> MkissaMediaKind.DASH
                                else -> continue
                            }
                            add(media(candidate, url, kind, subtitles, quality))
                        }
                    }
                }
            }
        }.sortedWith(
            compareBy<MkissaMediaSource> {
                when (it.kind) {
                    MkissaMediaKind.HLS -> 0
                    MkissaMediaKind.MP4 -> 1
                    MkissaMediaKind.DASH -> 2
                    MkissaMediaKind.DIRECT -> 3
                }
            }.thenByDescending { it.quality?.filter(Char::isDigit)?.toIntOrNull() ?: 0 },
        ).ifEmpty { throw MkissaProtocolException("MKissa clock response had no safe playable links") }
    }

    private fun media(
        candidate: MkissaSourceCandidate,
        url: String,
        kind: MkissaMediaKind,
        subtitles: List<MkissaSubtitle>,
        quality: String?,
        audio: List<MkissaAudioTrack> = emptyList(),
    ) = MkissaMediaSource(
        url = url,
        serverName = candidate.name,
        kind = kind,
        headers = playbackHeaders(legacyPlayerReferer = true),
        subtitles = subtitles,
        audioTracks = audio,
        quality = quality,
        downloadable = false,
    )

    private fun playbackHeaders(legacyPlayerReferer: Boolean): Map<String, String> {
        val origin = if (legacyPlayerReferer) MkissaKeyManager.PLAYER_ORIGIN else SITE_URL
        return MkissaKeyManager.browserHeaders() + mapOf(
            "Origin" to origin,
            "Referer" to "$origin/",
        )
    }

    private fun normalizeSourceUrl(raw: String): String {
        val value = raw.trim()
        if (value.startsWith("/")) {
            val relative = runCatching { URI(value) }.getOrNull()
            if (relative != null && relative.rawAuthority == null && relative.rawFragment == null &&
                relative.rawPath.matches(CLOCK_PATH)
            ) {
                return relative.toASCIIString()
            }
        }
        val absolute = if (value.startsWith("//")) "https:$value" else value
        return MkissaUrlPolicy.requireMediaUrl(absolute)
    }

    private fun String.isClockEndpoint(): Boolean = runCatching {
        val uri = URI(this)
        uri.rawPath.matches(CLOCK_PATH) && when {
            uri.isAbsolute -> uri.host.equals("allanime.day", ignoreCase = true)
            else -> uri.rawAuthority == null && uri.rawFragment == null
        }
    }.getOrDefault(false)

    private fun decodeSourceUrl(value: String): String {
        val (payload, maskIndex) = when {
            value.startsWith("--") -> value.drop(2) to 3
            value.startsWith("#-") -> value.drop(2) to 2
            value.startsWith("##") -> value.drop(2) to 1
            value.startsWith("-#") -> value.drop(2) to 4
            value.startsWith("#") -> value.drop(1) to 0
            else -> return value
        }
        if (payload.length % 2 != 0 || !payload.matches(HEX)) return value
        val bytes = payload.chunked(2).map { it.toInt(16) }
        val decoded = bytes.map { (it xor XOR_MASKS[maskIndex]).toChar() }.joinToString("")
        return decoded.takeIf { it.startsWith("http") || it.startsWith("//") || it.startsWith("/clock") || it.startsWith("/apivtwo") }
            ?: value
    }

    private data class CacheEntry(val expiresAtMillis: Long, val sources: List<MkissaSourceCandidate>)
    companion object {
        private const val SITE_URL = MkissaKeyManager.SITE_URL
        private const val API_URL = MkissaKeyManager.API_URL
        private const val LOG_TAG = "AniTrackMkissa"
        private const val SEARCH_PAGE_SIZE = 40
        private const val MAX_MATCH_SEARCH_PAGES = 3
        private const val MAX_CRYPTO_ATTEMPTS = 2
        private const val SOURCE_CACHE_TTL_MS = 5 * 60 * 1000L
        private const val MAX_SOURCE_CACHE_ENTRIES = 40
        private const val MAX_SOURCE_CHOICES = 30
        private val SHOW_ID = Regex("[A-Za-z0-9_-]{4,100}")
        private val HEX = Regex("[0-9a-fA-F]+")
        private val CLOCK_PATH = Regex("/apivtwo/clock(?:\\.json)?")
        private val UNS_IDENTIFIER = Regex("[A-Za-z0-9_-]{1,200}")
        private val MEDIA_URL = Regex(
            """https?:\\?/\\?/[^\s\"'<>]+?\.(?:m3u8|mp4)[^\s\"'<>]*""",
            RegexOption.IGNORE_CASE,
        )
        private val MEDIA_FIELD = Regex(
            """(?:source|file|src)[\"']?\s*[=:]\s*[\"']([^\"']+\.(?:m3u8|mp4)[^\"']*)""",
            RegexOption.IGNORE_CASE,
        )
        private val OK_HLS = Regex(
            """ondemandHls(?:\\&quot;|&quot;|\")\s*:\s*(?:\\&quot;|&quot;|\")([^\"<]+?)(?:\\&quot;|&quot;|\")""",
            RegexOption.IGNORE_CASE,
        )
        private val PACKED_CALL = Regex(
            """\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)""",
            setOf(RegexOption.DOT_MATCHES_ALL),
        )
        private val PACKED_CALL_DOUBLE = Regex(
            """\}\s*\(\s*\"((?:[^\"\\]|\\.)*)\"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\"((?:[^\"\\]|\\.)*)\"\.split\(\"\|\"\)""",
            setOf(RegexOption.DOT_MATCHES_ALL),
        )
        private val PACKED_WORD = Regex("""\b\w+\b""")
        private const val PACKED_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
        private val XOR_KEYS = listOf(
            "allanimenews",
            "1234567890123456789",
            "1234567890123456789012345",
            "s5feqxw21",
            "feqx1",
        )
        private val XOR_MASKS = XOR_KEYS.map { key -> key.fold(0) { mask, char -> mask xor char.code } }

        private val SEARCH_QUERY = graphQlQuery(
            """
            query(
              ${'$'}search: SearchInput
              ${'$'}limit: Int
              ${'$'}page: Int
              ${'$'}translationType: VaildTranslationTypeEnumType
              ${'$'}countryOrigin: VaildCountryOriginEnumType
            ) {
              shows(search: ${'$'}search, limit: ${'$'}limit, page: ${'$'}page,
                    translationType: ${'$'}translationType, countryOrigin: ${'$'}countryOrigin) {
                edges {
                  _id name englishName nativeName thumbnail aniListId season availableEpisodesDetail
                }
              }
            }
            """,
        )
        private val SEARCH_QUERY_FALLBACK = SEARCH_QUERY.replace(" aniListId", "")
        private val SHOW_QUERY = graphQlQuery(
            """
            query(${'$'}_id: String!) {
              show(_id: ${'$'}_id) {
                _id name englishName nativeName thumbnail aniListId description genres season
                availableEpisodesDetail
              }
            }
            """,
        )
        private val STREAM_QUERY = graphQlQuery(
            """
            query(
              ${'$'}showId: String!
              ${'$'}translationType: VaildTranslationTypeEnumType!
              ${'$'}episodeString: String!
            ) {
              episode(showId: ${'$'}showId, translationType: ${'$'}translationType,
                      episodeString: ${'$'}episodeString) {
                sourceUrls
                show { _id }
              }
            }
            """,
        )

        private fun graphQlQuery(value: String): String = value.trimIndent().trim()
    }
}

private fun JSONObject.nullableString(name: String): String? {
    if (!has(name) || isNull(name)) return null
    return optString(name).trim().takeIf { it.isNotEmpty() && it != "null" }
}

private fun JSONObject.nullableInt(name: String): Int? {
    if (!has(name) || isNull(name)) return null
    return when (val value = opt(name)) {
        is Number -> value.toInt()
        is String -> value.toIntOrNull()
        else -> null
    }
}

private fun JSONObject.stringList(name: String): List<String> {
    val array = optJSONArray(name) ?: return emptyList()
    return (0 until array.length()).mapNotNull { index ->
        array.optString(index).trim().takeIf { it.isNotEmpty() && it != "null" }
    }
}

private fun JSONObject.seasonYear(): Int? {
    val season = opt("season")
    return when (season) {
        is JSONObject -> season.nullableInt("year")
        is String -> runCatching { JSONObject(season).nullableInt("year") }.getOrNull()
        else -> null
    }
}

private fun JSONObject.graphQlErrors(): List<MkissaGraphQlError> {
    val array = optJSONArray("errors") ?: return emptyList()
    return (0 until array.length()).mapNotNull { index ->
        val error = array.optJSONObject(index) ?: return@mapNotNull null
        MkissaGraphQlError(
            code = error.optJSONObject("extensions")?.nullableString("code"),
            message = error.nullableString("message"),
        )
    }
}

private fun List<String>.sortedEpisodeStrings(): List<String> = distinct().sortedWith(
    compareBy<String> { it.toDoubleOrNull() ?: Double.MAX_VALUE }.thenBy { it },
)

private fun String.toSafeMediaUrl(): String? = runCatching { MkissaUrlPolicy.requireMediaUrl(this) }.getOrNull()

private fun String?.letUrl(transform: (String) -> String?): String? = this?.let(transform)

private fun validatedOptionalMediaUrl(value: String): String? = value.toSafeMediaUrl()

private fun JSONArray?.toSubtitles(): List<MkissaSubtitle> {
    this ?: return emptyList()
    return (0 until length()).mapNotNull { index ->
        val raw = optJSONObject(index) ?: return@mapNotNull null
        val url = raw.nullableString("src")?.toSafeMediaUrl() ?: return@mapNotNull null
        val language = raw.nullableString("lang")
        MkissaSubtitle(url, raw.nullableString("label") ?: language ?: "Subtitles", language)
    }
}

private fun JSONArray?.toAudioTracks(): List<MkissaAudioTrack> {
    this ?: return emptyList()
    return (0 until length()).mapNotNull { index ->
        val raw = optJSONObject(index) ?: return@mapNotNull null
        val url = raw.nullableString("url")?.toSafeMediaUrl() ?: return@mapNotNull null
        val bandwidth = raw.optLong("bandwidth", 0).takeIf { it > 0 }
        MkissaAudioTrack(url, bandwidth?.let { "${it / 1000} kb/s" } ?: "Audio")
    }
}
