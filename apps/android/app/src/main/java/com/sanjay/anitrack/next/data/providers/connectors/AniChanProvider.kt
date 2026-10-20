package com.sanjay.anitrack.next.data.providers.connectors

import com.sanjay.anitrack.next.data.AndroidRuntimeConfig
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.providers.*
import com.sanjay.anitrack.next.data.providers.connectors.anichan.AniChan
import com.sanjay.anitrack.next.data.providers.connectors.anichan.AniChanException
import org.json.JSONObject

/** AniList-keyed catalogue; the selected server is always read freshly in the verified page. */
internal class AniChanProvider(
    private val metadata: suspend (Int) -> JSONObject,
    private val episodeCount: suspend (Int) -> JSONObject,
    private val servers: suspend (Int, Int, String, String) -> JSONObject,
    private val userAgent: () -> String,
) : AnimeProvider {
    override val descriptor = ProviderDescriptor("anichan", "AniChan", ProviderCapabilities(externalIds = true, downloads = true))
    // Published older rules omit this newly compiled connector; explicit remote disable still wins.
    override fun isEnabled(config: AndroidRuntimeConfig) = config.providers[descriptor.id]?.enabled ?: true
    override fun acceptsResumeKey(key: String) = coordinates(key) != null
    override suspend fun match(anime: Anime) = if (anime.id > 0) load(anime.id) else null
    override suspend fun resume(key: String): ProviderSeries? = coordinates(key)?.let { load(it) }

    private suspend fun load(id: Int): ProviderSeries? {
        val details = metadata(id)
        // Known cached/available arrays are authoritative, even when empty.
        val self = details.optJSONObject("selfhost")
        val available = details.optJSONObject("available_eps")
        val known = listOf(self?.opt("cached_eps"), self?.opt("cached_sub"), self?.opt("cached_dub"),
            available?.opt("sub"), available?.opt("hsub"), available?.opt("dub")).any { it is org.json.JSONArray }
        return series(AniChan.parseTitle(details, id, if (known) null else episodeCount(id)))
    }

    internal fun series(title: AniChan.Title): ProviderSeries? {
        if (title.episodes.isEmpty()) return null
        return ProviderSeries(
            providerId = descriptor.id, resumeKey = "anichan:${title.anilistId}", verified = true,
            badges = listOfNotNull("SUB".takeIf { title.episodes.any { it.sub } }, "DUB".takeIf { title.episodes.any { it.dub } }),
            episodes = title.episodes.map { episode ->
                suspend fun read(category: String, tier: String) = AniChan.parseServers(
                    servers(title.anilistId, episode.number, category, tier), category, tier,
                )
                // Without a Sub server nothing is offered: AniTrack never starts a dub the
                // viewer didn't pick (the player tries the other Sub servers in turn).
                suspend fun choices(): List<AniChan.Choice> {
                    val result = ArrayList<AniChan.Choice>()
                    for (category in listOfNotNull("sub".takeIf { episode.sub }, "dub".takeIf { episode.dub })) {
                        val fast = read(category, "fast")
                        result += fast.ifEmpty { read(category, "rest") }
                    }
                    if (result.none { it.category == "sub" }) throw AniChanException(NO_SUB)
                    return result
                }
                fun AniChan.Choice.media() = ResolvedMedia(
                    // The signed proxy URL already carries upstream hotlink data.
                    url = url, referer = "", userAgent = userAgent(),
                    // Child playlists stay in /api/watch/. The signed /assets/.../seg-*.css
                    // media was verified to work without Referer/Origin/cookies; do not
                    // broaden this authorization merely because segments live elsewhere.
                    authorizationScope = if (hls) StreamAuthorizationScope.DIRECTORY else StreamAuthorizationScope.EXACT,
                    subtitles = subtitles.map {
                        ProviderSubtitle(it.file, it.label, language = if (it.label.startsWith("English", true)) "en" else null, default = it.default)
                    },
                    intro = intro?.let { SkipRange(it.start.toLong(), it.end.toLong()) },
                    outro = outro?.let { SkipRange(it.start.toLong(), it.end.toLong()) },
                    backend = PlaybackBackend.NATIVE, seekMode = SeekMode.EXACT, downloadable = hls,
                    conservativeNetwork = true,
                    mimeType = if (hls) "application/x-mpegURL" else "video/mp4", variantId = id,
                )
                ProviderEpisode(
                    number = episode.number.toFloat(), title = episode.title, snapshot = episode.snapshot,
                    variantsResolver = { choices().map { ProviderStreamVariant(it.id, it.label, it.category) } },
                    variantResolver = { selected, _ ->
                        val identity = AniChan.variant(selected) ?: throw AniChanException("Invalid AniChan stream choice.")
                        val category = identity.first
                        if ((category == "sub" && !episode.sub) || (category == "dub" && !episode.dub))
                            throw AniChanException("AniChan has no episode in that language.")
                        val choice = read(category, identity.second).firstOrNull { it.id == selected }
                            ?: throw AniChanException("That AniChan server is no longer available. Reload the server list.")
                        choice.media()
                    },
                    resolver = { preferences ->
                        val options = choices()
                        val chosen = if (preferences.preferHardSub) options.firstOrNull { it.category == "sub" && it.label.endsWith(" · Hard sub") } else null
                        (chosen ?: options.first { it.category == "sub" }).media()
                    },
                )
            },
        )
    }

    private companion object {
        const val NO_SUB = "AniChan has no subtitled stream for this episode right now. Retry later or choose another source."
    }

    private fun coordinates(key: String): Int? {
        if (key.length > 24) return null
        val match = Regex("anichan:([1-9][0-9]{0,9})").matchEntire(key) ?: return null
        return match.groupValues[1].toIntOrNull()?.takeIf { it > 0 }
    }
}
