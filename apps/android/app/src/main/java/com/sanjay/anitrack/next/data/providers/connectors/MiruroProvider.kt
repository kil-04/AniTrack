package com.sanjay.anitrack.next.data.providers.connectors

import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.providers.AnimeProvider
import com.sanjay.anitrack.next.data.providers.PlaybackPreferences
import com.sanjay.anitrack.next.data.providers.ProviderCapabilities
import com.sanjay.anitrack.next.data.providers.ProviderDescriptor
import com.sanjay.anitrack.next.data.providers.ProviderEpisode
import com.sanjay.anitrack.next.data.providers.ProviderSeries
import com.sanjay.anitrack.next.data.providers.ProviderStreamVariant
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroCatalogue
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroEpisodeChoice
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroMediaParser
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroProtocolException
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroReadRequest
import org.json.JSONObject

/**
 * Staged native adapter. Its owner must supply an explicit live, user-approved session.
 * No global/default browser, automatic verification, source cache or server fan-out.
 * MiruroAndroidProvider supplies the activity-owned session and debug-only registration.
 */
internal class MiruroProvider(
    private val read: suspend (MiruroReadRequest) -> JSONObject,
    private val userAgent: () -> String,
) : AnimeProvider {
    override val descriptor = ProviderDescriptor("miruro", "Miruro",
        ProviderCapabilities(externalIds = true, downloads = false)) // Category is part of each server variant.

    override fun acceptsResumeKey(key: String): Boolean = coordinates(key) != null

    override suspend fun match(anime: Anime): ProviderSeries? {
        if (anime.id <= 0) return null
        return load(anime.id, "sub")
    }

    override suspend fun resume(key: String): ProviderSeries? {
        val (id, translation) = coordinates(key) ?: return null
        return load(id, translation)
    }

    private suspend fun load(id: Int, translation: String): ProviderSeries? {
        val info = read(MiruroReadRequest.Info(id))
        val actualId = info.optJSONObject("media")?.opt("id") as? Number
        if (actualId?.toDouble() != id.toDouble()) throw MiruroProtocolException("Miruro show identity could not be verified")
        val config = read(MiruroReadRequest.Config)
        val episodes = read(MiruroReadRequest.Episodes(id))
        return series(id, translation, config, episodes)
    }

    /** Also used by the on-device test with its already validated catalogue, without rereading it. */
    internal fun series(id: Int, translation: String, config: JSONObject, payload: JSONObject): ProviderSeries? {
        val choices = MiruroCatalogue.choices(id, translation, config, payload)
        if (choices.isEmpty()) return null
        return ProviderSeries(
            providerId = descriptor.id,
            resumeKey = "miruro:$translation:$id",
            verified = (payload.optJSONObject("mappings")?.opt("aniId") as? Number)?.toDouble() == id.toDouble(),
            badges = listOf(translation.uppercase()),
            episodes = choices.groupBy { it.number }.toSortedMap().map { (number, variants) ->
                suspend fun resolve(choice: MiruroEpisodeChoice) = MiruroMediaParser.directMedia(
                    read(MiruroReadRequest.Sources(id, choice.episodeId, choice.server, choice.category)),
                ).firstOrNull()?.resolved(userAgent())
                    ?: throw MiruroProtocolException("This Miruro server did not return supported direct video")

                fun preferred(preferences: PlaybackPreferences): MiruroEpisodeChoice =
                    if (preferences.preferHardSub) variants.firstOrNull { it.category == "sub" } ?: variants.first()
                    else variants.first()

                ProviderEpisode(
                    number = number,
                    title = variants.firstNotNullOfOrNull { it.title },
                    variantsResolver = { variants.map { ProviderStreamVariant(it.variantId, it.label) } },
                    variantResolver = { selected, _ ->
                        val choice = variants.firstOrNull { it.variantId == selected }
                            ?: throw MiruroProtocolException("That Miruro server is not available for this episode")
                        resolve(choice)
                    },
                    resolver = { preferences -> resolve(preferred(preferences)) },
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
