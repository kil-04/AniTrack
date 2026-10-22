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
import kotlinx.coroutines.async
import org.json.JSONException
import org.json.JSONObject

/**
 * shonen.to: AniList-keyed, plain HTTP (one paced request at a time on its own host,
 * honest user agent). Mirrors apps/desktop/main/services/providers/shonen.ts.
 * Each of an episode's streams, in Sub and Dub, is a server choice ("Sub · Primary").
 */
object ShonenProvider : AnimeProvider {
    private val USER_AGENT = "AniTrack/${BuildConfig.VERSION_NAME} (Android)"
    private const val TITLE_TTL_MS = 30 * 60_000L
    private const val PAGE_BYTES = 2 * 1024 * 1024
    private const val SOURCES_BYTES = 256 * 1024
    private val KEY = Regex("shonen:([1-9][0-9]{0,9})")
    /** A server list is reused this long, so listing servers and playing one is one API call. */
    private const val STREAMS_TTL_MS = 60_000L
    /** How long the default play waits for a stream's playlist before trying the next stream. */
    private const val PROBE_MS = 4_000L
    /** Checks a stream's playlist on whatever proxy host the API names, with shonen.to as Referer. */
    private val probeClient = okhttp3.OkHttpClient.Builder()
        .callTimeout(PROBE_MS, java.util.concurrent.TimeUnit.MILLISECONDS)
        .followRedirects(false)
        .build()
    private val VARIANT = Regex("(sub|dub):([0-7])")
    private const val NO_STREAM =
        "shonen.to has no subtitled stream for this episode right now. It sometimes finds one later: retry in a few minutes or choose another source."

    override val descriptor = ProviderDescriptor(
        id = "shonen",
        name = "shonen.to",
        capabilities = ProviderCapabilities(externalIds = true, downloads = true),
    )

    private val http = MangaHttp("shonen.to", Shonen.HOSTS, { USER_AGENT }, 500)
    private val lock = Mutex()
    private val titles = LinkedHashMap<Int, Pair<Long, Shonen.TitlePage>>()
    private val streamLists = LinkedHashMap<String, Pair<Long, List<Shonen.Stream>>>()

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
                variantsResolver = { variants(anilistId, n) },
                variantResolver = { id, _ -> resolveVariant(anilistId, n, id) },
                resolver = { resolveFirstWorking(anilistId, n) },
            )
        },
    )

    /** "sub:0", "sub:1", "dub:0"…: every stream in each language shonen.to has. */
    private suspend fun variants(anilistId: Int, episode: Int): List<ProviderStreamVariant> {
        val out = ArrayList<ProviderStreamVariant>()
        for (lang in listOf("sub", "dub")) {
            // Always ask afresh: a stream shonen.to found since the last list (a backup) shows on Retry.
            val list = try { streams(anilistId, episode, lang, fresh = true) } catch (e: Exception) {
                // A missing dub is normal. Without Sub nothing is offered: AniTrack never
                // starts a dub the viewer didn't pick (Sub's own servers are tried in turn).
                if (lang == "dub") continue
                if (e is ShonenException && e.notFound) throw ShonenException(NO_STREAM, true)
                throw e
            }
            list.forEachIndexed { i, stream ->
                out += ProviderStreamVariant("$lang:$i", "${if (lang == "dub") "Dub" else "Sub"} · ${stream.label}", lang)
            }
        }
        return out
    }

    private suspend fun resolveVariant(anilistId: Int, episode: Int, id: String): ResolvedMedia {
        // "sub"/"dub" are the ids saved before 9.1.5: that language's first stream.
        val match = VARIANT.matchEntire(id)
        val lang = match?.groupValues?.get(1) ?: if (id == "dub") "dub" else "sub"
        val index = match?.groupValues?.get(2)?.toInt() ?: 0
        val stream = streams(anilistId, episode, lang).getOrNull(index)
            ?: throw ShonenException("That shonen.to server is no longer listed. Reload the servers or choose another.")
        return media(stream, "$lang:$index")
    }

    /**
     * The default play: Sub's first stream whose playlist loads. One stream often fails
     * while another works (20 Oct 2026: Primary vs Anivexa; 22 Oct: stream.shonen.to never
     * connects, anigato.lol does). Never Dub: without Sub this is the no-stream error, as on desktop.
     */
    private suspend fun resolveFirstWorking(anilistId: Int, episode: Int): ResolvedMedia {
        val list = try { streams(anilistId, episode, "sub") } catch (e: ShonenException) {
            if (e.notFound) throw ShonenException(NO_STREAM, true)
            throw e
        }
        if (list.size > 1) {
            val works = kotlinx.coroutines.coroutineScope {
                list.map { stream -> async(kotlinx.coroutines.Dispatchers.IO) { playlistLoads(stream.url) } }.map { it.await() }
            }
            works.indexOf(true).takeIf { it >= 0 }?.let { return media(list[it], "sub:$it") }
        }
        return media(list.first(), "sub:0")
    }

    /** Whether a stream's master playlist answers within [PROBE_MS] (anigato.lol needs shonen.to's Referer). */
    private fun playlistLoads(url: String): Boolean = try {
        val request = okhttp3.Request.Builder().url(url)
            .header("Referer", "${Shonen.ORIGIN}/")
            .header("User-Agent", USER_AGENT)
            .header("Accept", "application/vnd.apple.mpegurl, */*")
            .build()
        probeClient.newCall(request).execute().use { response ->
            response.isSuccessful && response.body?.source()?.let { it.request(7); it.buffer.snapshot(minOf(7L, it.buffer.size).toInt()).utf8() } == "#EXTM3U"
        }
    } catch (_: Exception) {
        false // unreachable, refused, or too slow
    }

    /** An episode's streams in one language: a fresh answer, or (playing a listed server) one under a minute old. */
    private suspend fun streams(anilistId: Int, episode: Int, lang: String, fresh: Boolean = false): List<Shonen.Stream> {
        val key = "$anilistId:$episode:$lang"
        if (!fresh) lock.withLock {
            streamLists[key]?.takeIf { System.currentTimeMillis() - it.first < STREAMS_TTL_MS }?.let { return it.second }
        }
        val text = try {
            http.get(Shonen.sourcesUrl(anilistId, episode, lang), "application/json", SOURCES_BYTES)
        } catch (e: MangaSourceException) {
            if (e.status == 404) throw ShonenException("shonen.to has no stream for this episode in this language.", true)
            throw e
        }
        val list = try { Shonen.streams(JSONObject(text)) } catch (_: JSONException) {
            throw ShonenException("shonen.to sent a response AniTrack couldn't read.")
        }
        lock.withLock {
            if (streamLists.size >= 50) streamLists.remove(streamLists.keys.first())
            streamLists[key] = System.currentTimeMillis() to list
        }
        return list
    }

    private fun media(stream: Shonen.Stream, variantId: String): ResolvedMedia {
        return ResolvedMedia(
            url = stream.url,
            referer = "${Shonen.ORIGIN}/",
            userAgent = USER_AGENT,
            // Playlists, segments and captions all live under one proxy path (/api/v1/ on shonen.to).
            authorizationScope = StreamAuthorizationScope.DIRECTORY,
            subtitles = stream.subtitles.map {
                ProviderSubtitle(it.file, it.label, language = if (it.label.startsWith("English", ignoreCase = true)) "en" else null, default = it.default)
            },
            intro = stream.intro?.let { SkipRange(it.start.toLong(), it.end.toLong()) },
            outro = stream.outro?.let { SkipRange(it.start.toLong(), it.end.toLong()) },
            backend = PlaybackBackend.NATIVE,
            seekMode = SeekMode.EXACT,
            downloadable = true,
            // The proxy's playlist URL has no .m3u8 for the player to look for.
            mimeType = androidx.media3.common.MimeTypes.APPLICATION_M3U8,
            variantId = variantId,
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
