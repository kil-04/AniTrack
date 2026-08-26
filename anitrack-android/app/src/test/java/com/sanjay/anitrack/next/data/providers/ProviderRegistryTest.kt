package com.sanjay.anitrack.next.data.providers

import com.sanjay.anitrack.next.data.AndroidRuntimeConfig
import com.sanjay.anitrack.next.data.Anime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import kotlinx.coroutines.runBlocking

class ProviderRegistryTest {
    private fun connector(id: String, name: String = id.uppercase()) = object : AnimeProvider {
        override val descriptor = ProviderDescriptor(id, name)
        override fun isEnabled(config: AndroidRuntimeConfig) = true
        override suspend fun match(anime: Anime): ProviderSeries? = null
        override suspend fun resume(key: String): ProviderSeries? = null
    }

    @Test
    fun thirdConnectorUsesConfiguredOrderWithoutRegistryChanges() {
        val registry = ProviderRegistry(listOf(connector("first"), connector("mockstream")))

        assertEquals(
            listOf("mockstream", "first"),
            registry.ordered(listOf("mockstream", "first")).map { it.descriptor.id },
        )
        assertEquals("Mock Stream", connector("mockstream", "Mock Stream").descriptor.name)
    }

    @Test
    fun rejectsDuplicateInvalidAndUnknownConnectors() {
        val registry = ProviderRegistry(listOf(connector("working")))

        assertThrows(IllegalArgumentException::class.java) { registry.register(connector("working")) }
        assertThrows(IllegalArgumentException::class.java) { registry.register(connector("Bad ID")) }
        assertThrows(IllegalStateException::class.java) { registry.get("missing") }
    }

    @Test
    fun storedProviderIdRoutesResumeWithoutGuessingKeyShape() = runBlocking {
        val target = object : AnimeProvider {
            override val descriptor = ProviderDescriptor("mockstream", "Mock Stream")
            override fun isEnabled(config: AndroidRuntimeConfig) = true
            override fun acceptsResumeKey(key: String) = true
            override suspend fun match(anime: Anime): ProviderSeries? = null
            override suspend fun resume(key: String) = ProviderSeries("mockstream", key, emptyList())
        }
        val registry = ProviderRegistry(listOf(connector("first"), target))
        val runtime = AndroidRuntimeConfig(
            revision = 1,
            issuedAt = "test",
            providerOrder = listOf("first", "mockstream"),
            providers = emptyMap(),
            features = com.sanjay.anitrack.next.data.RuntimeFeatures(true, true, true, true, true),
            notice = null,
        )

        assertEquals("mockstream", registry.resume("mockstream", "opaque-key", runtime)?.providerId)
    }
}
