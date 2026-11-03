package com.sanjay.anitrack.next.data.providers.connectors

import com.sanjay.anitrack.next.BuildConfig
import com.sanjay.anitrack.next.data.AndroidRuntimeConfig
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
import com.sanjay.anitrack.next.data.providers.connectors.xanime.Xanime
import com.sanjay.anitrack.next.data.providers.connectors.xanime.XanimeException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Xanime: plain HTTP on its own host (one paced request at a time, honest user agent).
 * Its pages carry each show's AniList id, so a match is exact. Streams are signed HLS on
 * its xanivsrc*.org hosts with no Referer or cookie. Mirrors
 * apps/desktop/main/services/providers/xanime.ts.
 */
object XanimeProvider : AnimeProvider {
    private val USER_AGENT = "AniTrack/${BuildConfig.VERSION_NAME} (Android)"
    private const val PAGE_BYTES = 3 * 1024 * 1024
    private const val SHOW_TTL_MS = 30 * 60_000L
    /** An episode page is reused this long, so listing its servers and playing one is one request. */
    private const val STREAMS_TTL_MS = 60_000L
    private val KEY = Regex("xanime:([1-9][0-9]{0,9})")
    private const val NO_SUB = "Xanime has no subtitled stream for this episode. Choose another source."

    override val descriptor = ProviderDescriptor(
        id = "xanime",
        name = "Xanime",
        capabilities = ProviderCapabilities(externalIds = true, downloads = true),
    )

    /** Older signed configurations predate Xanime: on unless the configuration switches it off. */
    override fun isEnabled(config: AndroidRuntimeConfig) = config.providers[descriptor.id]?.enabled ?: true

    private val http = MangaHttp("Xanime", Xanime.HOSTS, { USER_AGENT }, 600)
    private val lock = Mutex()
    private val shows = LinkedHashMap<String, Pair<Long, Xanime.Show>>()
    private val pages = LinkedHashMap<String, Pair<Long, String>>()

    override fun acceptsResumeKey(key: String): Boolean = key.length <= 20 && KEY.matches(key)

    override suspend fun match(anime: Anime): ProviderSeries? {
        if (anime.id <= 0) return null
        for (query in listOfNotNull(anime.title, anime.titleRomaji).map { it.trim() }.filter { it.length >= 2 }.distinct()) {
            val hit = Xanime.shows(get(Xanime.searchUrl(query))).filterNot { it.adult }
                .onEach { remember(it) }
                .firstOrNull { it.anilistId == anime.id }
            if (hit != null) return load(hit.id)
        }
        return null
    }

    override suspend fun resume(key: String): ProviderSeries? {
        val id = KEY.matchEntire(key)?.groupValues?.get(1)?.takeIf(Xanime::isId) ?: return null
        return load(id)
    }

    private suspend fun load(showId: String): ProviderSeries? {
        val show = show(showId)
        val latest = show.latestEpisodeId ?: return null
        val list = Xanime.episodes(page(showId, latest, fresh = true), showId)
        // Long shows list only their latest 50-episode page (see Xanime.kt).
        return series(show, list.episodes)
    }

    internal fun series(show: Xanime.Show, episodes: List<Xanime.Episode>): ProviderSeries? {
        if (episodes.isEmpty()) return null
        return ProviderSeries(
            providerId = descriptor.id,
            resumeKey = "xanime:${show.id}",
            // Its pages name the show's AniList id, and match() only accepts that exact id.
            verified = true,
            badges = listOfNotNull("SUB".takeIf { (show.subCount ?: 1) > 0 }, "DUB".takeIf { (show.dubCount ?: 0) > 0 }),
            episodes = episodes.map { episode ->
                ProviderEpisode(
                    number = episode.number,
                    title = episode.title,
                    variantsResolver = { variants(show.id, episode.id) },
                    variantResolver = { id, _ -> resolve(show.id, episode.id, id) },
                    resolver = { resolve(show.id, episode.id, null) },
                )
            },
        )
    }

    /** Each stream Xanime has for the episode, Sub first. Without Sub nothing is offered. */
    private suspend fun variants(showId: String, episodeId: String): List<ProviderStreamVariant> {
        // Always ask afresh, so Retry sees a stream Xanime added since.
        val list = streams(showId, episodeId, fresh = true)
        if (list.none { it.language == "sub" }) throw XanimeException(NO_SUB, true)
        return list.map { ProviderStreamVariant(it.id, Xanime.label(it, list), it.language) }
    }

    /** [variantId] null: the default play, Sub's first stream (never a Dub the viewer didn't pick). */
    private suspend fun resolve(showId: String, episodeId: String, variantId: String?): ResolvedMedia {
        val list = streams(showId, episodeId)
        val stream = if (variantId == null) {
            list.firstOrNull { it.language == "sub" } ?: throw XanimeException(NO_SUB, true)
        } else {
            list.firstOrNull { it.id == variantId }
                ?: throw XanimeException("That Xanime server is no longer listed. Reload the servers or choose another.")
        }
        return media(stream)
    }

    private fun media(stream: Xanime.Stream) = ResolvedMedia(
        url = stream.url,
        // Xanime's streams need no Referer, cookie or other header.
        referer = "",
        userAgent = USER_AGENT,
        // Renditions and segments sit beside the master playlist, under its signed media path.
        authorizationScope = StreamAuthorizationScope.DIRECTORY,
        subtitles = stream.subtitles.map {
            ProviderSubtitle(it.file, it.label, language = if (it.label.startsWith("English", ignoreCase = true)) "en" else null, default = it.default)
        },
        intro = stream.intro?.let { SkipRange(it.start.toLong(), it.end.toLong()) },
        outro = stream.outro?.let { SkipRange(it.start.toLong(), it.end.toLong()) },
        backend = PlaybackBackend.NATIVE,
        seekMode = SeekMode.EXACT,
        downloadable = true,
        // Renditions end in .ico and segments in image names; the content is HLS and MPEG-TS.
        mimeType = androidx.media3.common.MimeTypes.APPLICATION_M3U8,
        variantId = stream.id,
    )

    private suspend fun streams(showId: String, episodeId: String, fresh: Boolean = false): List<Xanime.Stream> =
        Xanime.streams(page(showId, episodeId, fresh), episodeId)

    private suspend fun page(showId: String, episodeId: String, fresh: Boolean = false): String {
        val key = "$showId/$episodeId"
        if (!fresh) lock.withLock {
            pages[key]?.takeIf { System.currentTimeMillis() - it.first < STREAMS_TTL_MS }?.let { return it.second }
        }
        val html = get(Xanime.episodeUrl(showId, episodeId))
        lock.withLock {
            if (pages.size >= 8) pages.remove(pages.keys.first())
            pages[key] = System.currentTimeMillis() to html
        }
        return html
    }

    private suspend fun show(showId: String): Xanime.Show {
        lock.withLock {
            shows[showId]?.takeIf { System.currentTimeMillis() - it.first < SHOW_TTL_MS }?.let { return it.second }
        }
        val show = Xanime.show(get(Xanime.titleUrl(showId)), showId)
            ?: throw XanimeException("Xanime sent a page AniTrack couldn't read.")
        remember(show)
        return show
    }

    private suspend fun remember(show: Xanime.Show) = lock.withLock {
        if (shows.size >= 200) shows.remove(shows.keys.first())
        shows[show.id] = System.currentTimeMillis() to show
    }

    private suspend fun get(url: String): String = try {
        http.get(url, "text/html", PAGE_BYTES)
    } catch (e: MangaSourceException) {
        if (e.status == 404) throw XanimeException("Xanime doesn't have this show or episode.", true)
        throw e
    }
}
