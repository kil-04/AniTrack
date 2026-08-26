package com.sanjay.anitrack.next.data

import com.sanjay.anitrack.next.data.providers.PlaybackBackend
import com.sanjay.anitrack.next.data.providers.PlaybackPreferences
import com.sanjay.anitrack.next.data.providers.ProviderRegistry
import com.sanjay.anitrack.next.data.providers.ProviderSeries
import com.sanjay.anitrack.next.data.providers.Providers
import com.sanjay.anitrack.next.data.providers.ResolvedMedia
import com.sanjay.anitrack.next.data.providers.SeekMode
import com.sanjay.anitrack.next.data.providers.connectors.AnikotoProvider
import com.sanjay.anitrack.next.data.providers.connectors.AnimePaheProvider

/**
 * What the player screen should play — set right before navigating to it.
 * Provider-agnostic: holds enough to resolve either Anikoto or AnimePahe, and
 * exposes a unified [resolve] + [episodeNumbers] so the player stays simple.
 * (Server tokens are large base64 blobs; a singleton beats route-encoding.)
 */
object PlaySession {
    var provider: String = "anikoto"      // "anikoto" | "animepahe"
    var animeId: Int = 0
    var animeTitle: String = ""
    var animeCover: String? = null
    var index: Int = 0
    // Full metadata, set on detail-page launches — enables in-player server
    // switching (matchFor needs title/year/episodes/malId). Null on a bare
    // Continue-Watching resume, where switching is simply disabled.
    var anime: Anime? = null

    // Anikoto
    var slug: String = ""
    var anikotoEps: List<Anikoto.Episode> = emptyList()
    var subType: String = "soft"   // "soft" | "hard" (anikoto only)

    // AnimePahe
    var paheSession: String = ""
    var paheEps: List<Pahe.Episode> = emptyList()

    // Normalized connector state. The legacy fields above remain temporarily
    // writable so older launch call sites can migrate independently.
    private var activeSeries: ProviderSeries? = null
    private var activeLegacySignature: String? = null
    private val seriesByProvider = linkedMapOf<String, ProviderSeries>()

    /** True while the player screen is mounted — drives auto-PiP on Home press. */
    var playerActive: Boolean = false

    data class Resolved(
        val url: String,
        val referer: String,
        // The CDN binds sessions to the browser fingerprint that resolved the
        // stream — the player must present the SAME user agent.
        val userAgent: String,
        val subtitles: List<Anikoto.Subtitle>,
        val introStart: Long?, val introEnd: Long?,
        val outroStart: Long?, val outroEnd: Long?,
        val backend: PlaybackBackend = PlaybackBackend.NATIVE,
        val seekMode: SeekMode = SeekMode.CLOSEST_SYNC,
        val downloadable: Boolean = true,
    )

    private fun legacyKey(): String = if (provider == "animepahe") paheSession else slug

    private fun legacySignature(): String = buildString {
        append(provider).append('|').append(legacyKey()).append('|')
        if (provider == "animepahe") append(paheEps.hashCode()) else append(anikotoEps.hashCode())
    }

    /** Convert still-unmigrated launch fields into the connector contract. */
    private fun series(): ProviderSeries? {
        val signature = legacySignature()
        activeSeries?.takeIf { activeLegacySignature == signature }?.let { return it }
        val rebuilt = when (provider) {
            "animepahe" -> paheEps.takeIf { it.isNotEmpty() }
                ?.let { AnimePaheProvider.series(paheSession, it) }
            "anikoto" -> anikotoEps.takeIf { it.isNotEmpty() }
                ?.let { AnikotoProvider.series(slug, it, verified = false) }
            else -> null
        }
        seriesByProvider.clear()
        rebuilt?.let { seriesByProvider[it.providerId] = it }
        activeSeries = rebuilt
        activeLegacySignature = signature
        return rebuilt
    }

    /** Preferred launch API for migrated screens and future connectors. */
    fun startSeries(
        series: ProviderSeries,
        selectedIndex: Int,
        animeId: Int,
        animeTitle: String,
        animeCover: String?,
        anime: Anime?,
    ) {
        require(series.episodes.isNotEmpty()) { "Cannot start an empty provider series" }
        provider = series.providerId
        if (provider == "animepahe") {
            paheSession = series.resumeKey; paheEps = emptyList(); anikotoEps = emptyList()
        } else {
            slug = series.resumeKey; anikotoEps = emptyList(); paheEps = emptyList()
        }
        this.animeId = animeId
        this.animeTitle = animeTitle
        this.animeCover = animeCover
        this.anime = anime
        localFile = null
        index = selectedIndex.coerceIn(series.episodes.indices)
        seriesByProvider.clear()
        seriesByProvider[series.providerId] = series
        activeSeries = series
        activeLegacySignature = legacySignature()
    }

    val count: Int get() = series()?.episodes?.size ?: 0

    fun episodeNumber(i: Int): Float = series()?.episodes?.getOrNull(i)?.number ?: 0f

    /** The slug/session persisted with progress so Continue Watching can resume
     *  without re-matching. RAW value, same as the desktop app writes to the
     *  sync gist: pahe sessions are UUIDs, anikoto slugs never are — consumers
     *  detect the provider with PAHE_UUID (a "pahe:" prefix broke desktop). */
    fun resumeKey(): String = series()?.resumeKey ?: legacyKey()

    /** AnimePahe sessions are full UUIDs; anikoto slugs are never UUID-shaped. */
    val PAHE_UUID = Regex("^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", RegexOption.IGNORE_CASE)

    /** Episode title for side-panel labels (anikoto has real titles; pahe doesn't). */
    fun episodeTitle(i: Int): String? = series()?.episodes?.getOrNull(i)?.title

    val canSwitchServer: Boolean get() = anime != null

    /**
     * Switch the active server without leaving the player (the desktop app's
     * "SERVERS" buttons). Matches the target provider lazily, then lands on the
     * same EPISODE NUMBER — the two providers index episodes differently.
     * Returns false if the target has no source for this show.
     */
    suspend fun switchProvider(
        target: String,
        registry: ProviderRegistry = Providers.registry,
        runtime: AndroidRuntimeConfig = RemoteConfig.current(),
    ): Boolean {
        if (target == provider) return true
        val connector = registry.enabled(target, runtime) ?: return false
        val a = anime ?: return false
        val currentNum = episodeNumber(index)
        val prevIndex = index
        series()?.let { seriesByProvider[it.providerId] = it }
        val targetSeries = seriesByProvider[target]
            ?: connector.match(a)?.also { seriesByProvider[target] = it }
            ?: return false
        if (targetSeries.episodes.isEmpty()) return false
        provider = targetSeries.providerId
        if (provider == "animepahe") paheSession = targetSeries.resumeKey else slug = targetSeries.resumeKey
        activeSeries = targetSeries
        activeLegacySignature = legacySignature()
        // Match by episode NUMBER; if providers number differently, retain the
        // same list position instead of snapping back to episode one.
        index = targetSeries.episodeIndex(currentNum, prevIndex)
        return true
    }

    // Offline single-episode playback (set when launched from Downloads).
    var localFile: String? = null

    suspend fun resolve(
        i: Int,
        registry: ProviderRegistry = Providers.registry,
        runtime: AndroidRuntimeConfig = RemoteConfig.current(),
    ): Resolved {
        localFile?.let { path ->
            // Downloaded HLS — play the local index.m3u8 directly.
            return Resolved(
                java.io.File(path).toURI().toString(), "", "", emptyList(),
                null, null, null, null,
                backend = PlaybackBackend.NATIVE,
                seekMode = SeekMode.EXACT,
                downloadable = false,
            )
        }
        val connector = registry.enabled(provider, runtime)
        check(connector != null) {
            val name = runCatching { registry.get(provider).descriptor.name }.getOrDefault(provider)
            "$name is temporarily disabled. Refresh automatic fixes in Settings."
        }
        val media = series()?.episodes?.getOrNull(i)
            ?.resolve(PlaybackPreferences(preferHardSub = subType == "hard"))
            ?: error("Episode is no longer available")
        return media.toLegacyResolved()
    }

    private fun ResolvedMedia.toLegacyResolved() = Resolved(
        url = url,
        referer = referer,
        userAgent = userAgent,
        subtitles = subtitles.map { Anikoto.Subtitle(it.url, it.label) },
        introStart = intro?.startSeconds,
        introEnd = intro?.endSeconds,
        outroStart = outro?.startSeconds,
        outroEnd = outro?.endSeconds,
        backend = backend,
        seekMode = seekMode,
        downloadable = downloadable,
    )
}
