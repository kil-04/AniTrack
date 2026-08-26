package com.sanjay.anitrack.next.data.providers

import com.sanjay.anitrack.next.data.AndroidRuntimeConfig
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.RemoteConfig
import com.sanjay.anitrack.next.data.providers.connectors.AnikotoProvider
import com.sanjay.anitrack.next.data.providers.connectors.AnimePaheProvider

private val VALID_ID = Regex("^[a-z][a-z0-9-]{1,31}$")

class ProviderRegistry(providers: List<AnimeProvider>) {
    private val providersById = linkedMapOf<String, AnimeProvider>()

    init {
        providers.forEach(::register)
    }

    fun register(provider: AnimeProvider) {
        val id = provider.descriptor.id
        require(id.matches(VALID_ID)) { "Invalid provider id: $id" }
        require(provider.descriptor.name.isNotBlank()) { "Provider $id has no display name" }
        require(id !in providersById) { "Provider already registered: $id" }
        providersById[id] = provider
    }

    fun get(id: String): AnimeProvider =
        providersById[id] ?: error("Provider not found: $id")

    fun ordered(
        providerOrder: List<String>,
        enabled: (AnimeProvider) -> Boolean = { true },
    ): List<AnimeProvider> {
        val ids = providerOrder + providersById.keys.filterNot(providerOrder::contains)
        return ids.mapNotNull(providersById::get).filter(enabled)
    }

    fun enabled(config: AndroidRuntimeConfig): List<AnimeProvider> =
        ordered(config.providerOrder) { it.isEnabled(config) }

    fun enabled(id: String, config: AndroidRuntimeConfig): AnimeProvider? =
        providersById[id]?.takeIf { it.isEnabled(config) }

    fun descriptors(config: AndroidRuntimeConfig): List<ProviderDescriptor> =
        enabled(config).map(AnimeProvider::descriptor)

    suspend fun matchFirst(anime: Anime, config: AndroidRuntimeConfig): ProviderSeries? {
        for (provider in enabled(config)) {
            runCatching { provider.match(anime) }.getOrNull()?.let { return it }
        }
        return null
    }

    suspend fun resumeFirst(key: String, config: AndroidRuntimeConfig): ProviderSeries? {
        for (provider in enabled(config).filter { it.acceptsResumeKey(key) }) {
            runCatching { provider.resume(key) }.getOrNull()?.let { return it }
        }
        return null
    }

    suspend fun resume(providerId: String, key: String, config: AndroidRuntimeConfig): ProviderSeries? {
        val provider = enabled(providerId, config) ?: return null
        if (!provider.acceptsResumeKey(key)) return null
        return runCatching { provider.resume(key) }.getOrNull()
    }
}

/** Composition root: adding a connector requires one deliberate registry entry. */
object Providers {
    val registry = ProviderRegistry(listOf(AnikotoProvider, AnimePaheProvider))
    fun enabled(): List<AnimeProvider> = registry.enabled(RemoteConfig.current())
}
