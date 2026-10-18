package com.sanjay.anitrack.next.data.providers.connectors

import com.sanjay.anitrack.next.BuildConfig
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.manga.MangaHttp
import com.sanjay.anitrack.next.data.manga.MangaSourceException
import com.sanjay.anitrack.next.data.providers.AnimeProvider
import com.sanjay.anitrack.next.data.providers.PlaybackBackend
import com.sanjay.anitrack.next.data.providers.ProviderCapabilities
import com.sanjay.anitrack.next.data.providers.ProviderDescriptor
import com.sanjay.anitrack.next.data.providers.ProviderEpisode
import com.sanjay.anitrack.next.data.providers.ProviderSeries
import com.sanjay.anitrack.next.data.providers.ProviderStreamVariant
import com.sanjay.anitrack.next.data.providers.ProviderSubtitle
import com.sanjay.anitrack.next.data.providers.ResolvedMedia
import com.sanjay.anitrack.next.data.providers.SeekMode
import com.sanjay.anitrack.next.data.providers.SkipRange
import com.sanjay.anitrack.next.data.providers.StreamAuthorizationScope
import com.sanjay.anitrack.next.data.providers.connectors.shonen.Shonen
import com.sanjay.anitrack.next.data.providers.connectors.shonen.ShonenException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONException
import org.json.JSONObject

/**
 * shonen.to: AniList-keyed, plain HTTP (one paced request at a time on its own host,
 * honest user agent). Mirrors apps/desktop/main/services/providers/shonen.ts.
 * Sub and Dub are the two variants of every episode.
 */
object ShonenProvider : AnimeProvider {
    private val USER_AGENT = "AniTrack/${BuildConfig.VERSION_NAME} (Android)"
    private const val TITLE_TTL_MS = 30 * 60_000L
    private const val PAGE_BYTES = 2 * 1024 * 1024
    private const val SOURCES_BYTES = 256 * 1024
    private val KEY = Regex("shonen:([1-9][0-9]{0,9})")
    private val VARIANTS = listOf(ProviderStreamVariant("sub", "Sub"), ProviderStreamVariant("dub", "Dub"))

    override val descriptor = ProviderDescriptor(
        id = "shonen",
        name = "shonen.to",
        capabilities = ProviderCapabilities(externalIds = true, downloads = false),
    )

    private val http = MangaHttp("shonen.to", Shonen.HOSTS, { USER_AGENT }, 500)
    private val lock = Mutex()
    private val titles = LinkedHashMap<Int, Pair<Long, Shonen.TitlePage>>()

    override fun acceptsResumeKey(key: String): Boolean = key.length <= 20 && KEY.matches(key)

    override suspend fun match(anime: Anime): ProviderSeries? = if (anime.id > 0) load(anime.id) else null

    override suspend fun resume(key: String): ProviderSeries? {
        val id = KEY.matchEntire(key)?.groupValues?.get(1)?.toLongOrNull()?.takeIf(Shonen::isAnimeId) ?: return null
        return load(id.toInt())
    }

    private suspend fun load(anilistId: Int): ProviderSeries? {
        val count = titlePage(anilistId).episodes ?: return null
        return series(anilistId, count)
    }

    internal fun series(anilistId: Int, count: Int): ProviderSeries = ProviderSeries(
        providerId = descriptor.id,
        resumeKey = "shonen:$anilistId",
        // Its catalogue is AniList's own ids, so the match is exact.
        verified = true,
        badges = listOf("SUB", "DUB"),
        episodes = (1..count.coerceIn(1, Shonen.MAX_EPISODES)).map { n ->
            ProviderEpisode(
                number = n.toFloat(),
                title = "Episode $n",
                variantsResolver = { VARIANTS },
                variantResolver = { language, _ -> resolve(anilistId, n, language) },
                resolver = { resolve(anilistId, n, "sub") },
            )
        },
    )

    private suspend fun resolve(anilistId: Int, episode: Int, language: String): ResolvedMedia {
        val lang = if (language == "dub") "dub" else "sub"
        val text = try {
            http.get(Shonen.sourcesUrl(anilistId, episode, lang), "application/json", SOURCES_BYTES)
        } catch (e: MangaSourceException) {
            if (e.status == 404) throw ShonenException("shonen.to has no stream for this episode in this language.", true)
            throw e
        }
        val stream = try { Shonen.sources(JSONObject(text)) } catch (_: JSONException) {
            throw ShonenException("shonen.to sent a response AniTrack couldn't read.")
        }
        return ResolvedMedia(
            url = stream.url,
            referer = "${Shonen.ORIGIN}/",
            userAgent = USER_AGENT,
            // Playlists, segments and captions all live under the proxy's /api/proxy/ path.
            authorizationScope = StreamAuthorizationScope.DIRECTORY,
            subtitles = stream.subtitles.map {
                ProviderSubtitle(it.file, it.label, language = if (it.label.startsWith("English", ignoreCase = true)) "en" else null, default = it.default)
            },
            intro = stream.intro?.let { SkipRange(it.start.toLong(), it.end.toLong()) },
            outro = stream.outro?.let { SkipRange(it.start.toLong(), it.end.toLong()) },
            backend = PlaybackBackend.NATIVE,
            seekMode = SeekMode.EXACT,
            downloadable = false,
            // The proxy's playlist URL is /api/proxy/m3u8?t=…, without the .m3u8 the player looks for.
            mimeType = androidx.media3.common.MimeTypes.APPLICATION_M3U8,
            variantId = lang,
        )
    }

    private suspend fun titlePage(anilistId: Int): Shonen.TitlePage {
        lock.withLock {
            titles[anilistId]?.takeIf { System.currentTimeMillis() - it.first < TITLE_TTL_MS }?.let { return it.second }
        }
        val page = Shonen.titlePage(http.get(Shonen.animeUrl(anilistId), "text/html", PAGE_BYTES))
        lock.withLock {
            if (titles.size >= 100) titles.remove(titles.keys.first())
            titles[anilistId] = System.currentTimeMillis() to page
        }
        return page
    }
}
