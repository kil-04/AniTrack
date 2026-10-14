package com.sanjay.anitrack.next.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Test

class ProviderProbeRequestKindTest {
    @Test fun engineContextClassifiesExtensionlessLoadsWithoutGuessingSegmentsOrOverridingExactIdentity() {
        assertEquals("manifest", ProviderProbeRequestKind.withEngineContext("unknown", ProviderProbeRequestKind.EngineLoadKind.MANIFEST, false))
        assertEquals("caption", ProviderProbeRequestKind.withEngineContext("unknown", ProviderProbeRequestKind.EngineLoadKind.MEDIA, true))
        assertEquals("media-load", ProviderProbeRequestKind.withEngineContext("unknown", ProviderProbeRequestKind.EngineLoadKind.MEDIA, false))
        assertEquals("media-initialization", ProviderProbeRequestKind.withEngineContext("unknown", ProviderProbeRequestKind.EngineLoadKind.INITIALIZATION, false))
        assertEquals("unknown", ProviderProbeRequestKind.withEngineContext("unknown", ProviderProbeRequestKind.EngineLoadKind.OTHER, false))
        assertEquals("main-media", ProviderProbeRequestKind.withEngineContext("main-media", ProviderProbeRequestKind.EngineLoadKind.MANIFEST, false))
        assertEquals("caption", ProviderProbeRequestKind.withEngineContext("caption", ProviderProbeRequestKind.EngineLoadKind.MEDIA, false))
    }

    @Test fun selectedMediaAndExactOfferedCaptionsTakePrecedenceOverExtensions() {
        val media = "https://media.example/manifest?fixture=private"
        val caption = "https://subs.example/download?fixture=private"
        assertEquals("main-media", ProviderProbeRequestKind.classify(media, media, listOf(caption)))
        assertEquals("caption", ProviderProbeRequestKind.classify(caption, media, listOf(caption)))
        assertEquals("unknown", ProviderProbeRequestKind.classify("$caption-new", media, listOf(caption)))
    }

    @Test fun errorCategoriesContainNoUrlQueryOrHeaderValues() {
        for ((path, expected) in listOf("index.m3u8" to "manifest", "index.mpd" to "manifest",
            "English.VTT" to "caption", "part.m4s" to "media-segment", "part.ts" to "media-segment",
            "encryption.key" to "media-key", "opaque" to "unknown")) {
            assertEquals(expected, ProviderProbeRequestKind.classify("https://media.example/$path?fixture=private", null, emptyList()))
        }
        assertEquals("unknown", ProviderProbeRequestKind.classify("invalid uri", null, emptyList()))
        assertEquals("unknown", ProviderProbeRequestKind.classify(null, null, emptyList()))
    }
}
