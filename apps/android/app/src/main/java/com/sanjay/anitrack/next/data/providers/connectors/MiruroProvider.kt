package com.sanjay.anitrack.next.data.providers.connectors

import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.providers.AnimeProvider
import com.sanjay.anitrack.next.data.providers.PlaybackPreferences
import com.sanjay.anitrack.next.data.providers.ProviderCapabilities
import com.sanjay.anitrack.next.data.providers.ProviderDescriptor
import com.sanjay.anitrack.next.data.providers.ProviderEpisode
import com.sanjay.anitrack.next.data.providers.ProviderSeries
import com.sanjay.anitrack.next.data.providers.ProviderStreamVariant
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroProtocolException
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroV1Catalogue
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroV1Choice
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroV1ReadRequest
import org.json.JSONObject

/** User-approved current catalogue transport. No source cache, embeds or server fan-out. */
internal class MiruroProvider(
    private val read: suspend (MiruroV1ReadRequest) -> JSONObject,
    private val userAgent: () -> String,
) : AnimeProvider {
    override val descriptor = ProviderDescriptor("miruro", "Miruro", ProviderCapabilities(externalIds = true, downloads = false))

    override fun acceptsResumeKey(key: String): Boolean = coordinates(key) != null
    override suspend fun match(anime: Anime): ProviderSeries? = if (anime.id > 0) load(anime.id, "sub") else null
    override suspend fun resume(key: String): ProviderSeries? {
        val (id, translation) = coordinates(key) ?: return null
        return load(id, translation)
    }

    private suspend fun load(id: Int, translation: String): ProviderSeries? {
        val showId = MiruroV1Catalogue.show(read(MiruroV1ReadRequest.Lookup(id)), id)
        return series(id, translation, showId, read(MiruroV1ReadRequest.Episodes(showId)))
    }

    internal fun series(id: Int, translation: String, showId: String, payload: JSONObject): ProviderSeries? {
        require(id > 0 && translation in setOf("sub", "dub"))
        val episodes = MiruroV1Catalogue.episodes(payload)
        if (episodes.isEmpty()) return null
        return ProviderSeries(
            providerId = descriptor.id, resumeKey = "miruro:$translation:$id", verified = true,
            badges = listOf(translation.uppercase()), episodes = episodes.map { episode ->
                suspend fun choices(): List<MiruroV1Choice> = MiruroV1Catalogue.choices(
                    read(MiruroV1ReadRequest.Play(showId, episode.coordinate)), episode.coordinate,
                ).filter { if (translation == "dub") it.track == "dub" else it.track in setOf("sub", "ssub") }

                fun MiruroV1Choice.resolved() =
                    media.resolved(userAgent(), headers, episode.intro, episode.outro).copy(variantId = variantId)

                fun preferred(options: List<MiruroV1Choice>, preferences: PlaybackPreferences): MiruroV1Choice {
                    if (options.isEmpty()) throw MiruroProtocolException("This Miruro episode has no supported direct video for $translation")
                    val preferredTrack = if (preferences.preferHardSub) "sub" else "ssub"
                    return options.firstOrNull { it.track == preferredTrack } ?: options.first()
                }

                ProviderEpisode(
                    number = episode.number, title = episode.title,
                    // /play resolves media upstream, so call only for the active episode; retain only stable labels.
                    variantsResolver = { choices().map { ProviderStreamVariant(it.variantId, it.label) } },
                    variantResolver = { selected, _ ->
                        val choice = choices().firstOrNull { it.variantId == selected }
                            ?: throw MiruroProtocolException("That Miruro server or track is no longer available; reload the episode's server list")
                        choice.resolved()
                    },
                    resolver = { preferences -> preferred(choices(), preferences).resolved() },
                )
            },
        )
    }

    private fun coordinates(key: String): Pair<Int, String>? {
        if (key.length > 32) return null
        val match = Regex("miruro:(sub|dub):([1-9][0-9]{0,9})").matchEntire(key) ?: return null
        val id = match.groupValues[2].toIntOrNull()?.takeIf { it > 0 } ?: return null
        return id to match.groupValues[1]
    }
}
