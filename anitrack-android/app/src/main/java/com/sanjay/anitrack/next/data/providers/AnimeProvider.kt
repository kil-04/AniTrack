package com.sanjay.anitrack.next.data.providers

import com.sanjay.anitrack.next.data.AndroidRuntimeConfig
import com.sanjay.anitrack.next.data.Anime

interface AnimeProvider {
    val descriptor: ProviderDescriptor
    fun isEnabled(config: AndroidRuntimeConfig): Boolean =
        config.providers[descriptor.id]?.enabled == true
    /**
     * Whether this connector recognizes a raw, persisted resume key. AniTrack
     * deliberately keeps legacy Anikoto slugs and AnimePahe UUIDs unchanged in
     * the database/gist, so connectors identify their own keys at this edge.
     */
    fun acceptsResumeKey(key: String): Boolean = false
    suspend fun match(anime: Anime): ProviderSeries?
    suspend fun resume(key: String): ProviderSeries?
}
