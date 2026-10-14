package com.sanjay.anitrack.next.data.providers.connectors.mkissa

import com.sanjay.anitrack.next.data.providers.connectors.MkissaProvider
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.providers.PlaybackBackend
import com.sanjay.anitrack.next.data.providers.SeekMode
import com.sanjay.anitrack.next.data.providers.StreamAuthorizationScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody
import okio.Buffer
import okio.Source
import okio.Timeout
import okio.buffer
import java.util.Base64
import java.io.IOException
import javax.net.ssl.SSLHandshakeException
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

class MkissaConnectorTest {
    @Test
    fun descriptorDoesNotAdvertiseIgnoredHardSoftSubtitlePreference() {
        assertFalse(
            "MKissa's single-translation adapter cannot select hard/soft sources",
            MkissaProvider.descriptor.capabilities.subtitleModes,
        )
    }

    @Test
    fun urlPolicyAllowsOnlyPublicCredentialFreeHttpsUrls() {
        assertEquals(
            "https://api.mkissa.net/api",
            MkissaUrlPolicy.requireProviderUrl("https://api.mkissa.net/api"),
        )
        assertEquals(
            "https://media.example/video.m3u8?token=test",
            MkissaUrlPolicy.requireMediaUrl("https://media.example/video.m3u8?token=test"),
        )

        listOf(
            "http://media.example/video.m3u8",
            "https://user:secret@media.example/video.m3u8",
            "https://media.example:8443/video.m3u8",
            "https://localhost/video.m3u8",
            "https://127.0.0.1/video.m3u8",
            "https://10.1.2.3/video.m3u8",
            "https://192.168.1.5/video.m3u8",
            "https://[::1]/video.m3u8",
            "javascript:alert(1)",
            "data:text/plain,video",
            "https://media.example/\nvideo.m3u8",
        ).forEach { unsafe ->
            assertThrows(unsafe, IllegalArgumentException::class.java) {
                MkissaUrlPolicy.requireMediaUrl(unsafe)
            }
        }
        assertThrows(IllegalArgumentException::class.java) {
            MkissaUrlPolicy.requireProviderUrl("https://mkissa.to.attacker.example/api")
        }

        val client = MkissaOkHttpTransport.defaultClient()
        assertFalse(client.followRedirects)
        assertFalse(client.followSslRedirects)
    }

    @Test
    fun bundleParserReadsWhitelistedDataWithoutExecutingJavascript() {
        val fixture = """
            globalThis.sideEffect = 'must never run';
            const config = {
              buildId: '149',
              maskParts: ['YWJjZGVmZ2g=', 'aWprbG1ub3A=', 'cXJzdHV2d3g=', 'eXoxMjM0NTY=']
            };
        """.trimIndent()

        val parsed = MkissaBundleParser.parse(fixture)
        assertEquals("149", parsed?.buildId)
        assertEquals(4, parsed?.seeds?.size)
        assertNull(MkissaBundleParser.parse("globalThis.buildId = fetch('https://evil.example')"))
    }

    @Test
    fun bundleParserAcceptsFourFragmentsAndInlineConstantAlias() {
        val fixture = """
            function table(){const values=['YWJ','jZG','VmZ','2g=','aWp','rbG','1ub','3A=','cXJ','zdH','V2d','3g=','eXo','xMj','M0N','TY=','154','dummy:'];return values}
            function base(value){return value=value-100,table()[value]}
            function mix(first,second){return base(second-{offset:1}.offset)}
            const build=mix(0,117),next=1;
            function request({buildId:value=build}){return 'aaReq'}
            const masks=[mix(0,101)+mix(0,102)+mix(0,103)+mix(0,104),mix(0,105)+mix(0,106)+mix(0,107)+mix(0,108),mix(0,109)+mix(0,110)+mix(0,111)+mix(0,112),mix(0,113)+mix(0,114)+mix(0,115)+mix(0,116)];
            const config={saltMul:6,saltAdd:244,fragMul:190,fragAdd:88,bootPrefix:mix(0,118e0),join:'.',parts:['group','host','lane','buildId','epoch'],omitEmptyLane:!1};
        """.trimIndent()

        val parsed = MkissaBundleParser.parse(fixture)
        assertEquals("154", parsed?.buildId)
        assertEquals(
            listOf("YWJjZGVmZ2g=", "aWprbG1ub3A=", "cXJzdHV2d3g=", "eXoxMjM0NTY="),
            parsed?.seeds,
        )
        assertEquals("dummy:", parsed?.cryptoScheme?.bootPrefix)
        assertNull(MkissaBundleParser.parse(fixture.replace("118e0", "118e99999999"))?.cryptoScheme)
    }

    @Test
    fun discoveredCryptoSchemeSurvivesBuildCacheRoundTrip() {
        val scheme = MkissaCrypto.CryptoScheme(
            6,
            244,
            190,
            88,
            "dynamic:",
            ".",
            listOf("group", "host", "lane", "buildId", "epoch"),
            false,
        )
        val build = MkissaBundleParser.BuildInfo(
            "153",
            listOf("YWJjZGVmZ2g=", "aWprbG1ub3A=", "cXJzdHV2d3g=", "eXoxMjM0NTY="),
            scheme,
        )

        assertEquals(build, MkissaBundleParser.BuildInfo.deserialize(build.serialize()))
    }

    @Test
    fun serverAliasesResolveSequentiallyAndStopAfterFirstPlayableSource() = runBlocking {
        val requests = mutableListOf<MkissaHttpRequest>()
        val transport = MkissaHttpTransport { request ->
            requests += request
            MkissaHttpResponse(502, "unavailable")
        }
        val service = MkissaService(transport = transport)

        val result = service.resolveFirst(
            listOf(
                MkissaSourceCandidate(
                    url = "/apivtwo/clock?id=broken",
                    name = "Default",
                    type = "clock",
                    priority = 10f,
                ),
                MkissaSourceCandidate(
                    url = "https://embed.example/watch/episode",
                    name = "Embed",
                    type = "player",
                    priority = 9f,
                ),
                MkissaSourceCandidate(
                    url = "https://media.example/episode.m3u8",
                    name = "Direct fallback",
                    type = "hls",
                    priority = 1f,
                ),
            ),
        ).single()

        assertEquals("Direct fallback", result.serverName)
        assertEquals("https://media.example/episode.m3u8", result.url)
        assertEquals(1, requests.size)
        assertTrue(result.headers.containsKey("Referer"))
        assertTrue(result.headers.containsKey("Origin"))

        requests.clear()
        service.resolveFirst(
            listOf(
                MkissaSourceCandidate(
                    url = "https://media.example/first.mp4",
                    name = "First",
                    type = "mp4",
                    priority = 20f,
                ),
                MkissaSourceCandidate(
                    url = "/apivtwo/clock?id=unused",
                    name = "Never requested",
                    type = "clock",
                    priority = 1f,
                ),
            ),
        )
        assertTrue("Lower-priority servers must remain lazy", requests.isEmpty())
    }

    @Test
    fun serverVariantsPreserveAllAliasesAndDuplicateIdentity() {
        val sources = listOf(
            MkissaSourceCandidate("https://media.example/default.m3u8", "Default", "player", 10f),
            MkissaSourceCandidate("https://media.example/yuki.m3u8", "Yt", "player", 9f),
            MkissaSourceCandidate("https://media.example/mp4-1.mp4", "Mp4", "embed", 8f),
            MkissaSourceCandidate("https://media.example/mp4-2.mp4", "Mp4", "embed", 7f),
            MkissaSourceCandidate("https://media.example/ok.m3u8", "Ok", "embed", 6f),
        )

        val variants = MkissaProvider.streamVariants(sources)

        assertEquals(listOf("Default", "Yt", "Mp4 1", "Mp4 2", "Ok"), variants.map { it.label })
        assertEquals(5, variants.map { it.id }.distinct().size)
        variants.forEachIndexed { index, variant ->
            assertEquals(sources[index], MkissaProvider.sourceForVariant(sources, variant.id))
        }
        assertNull(MkissaProvider.sourceForVariant(sources, "missing"))
    }

    @Test
    fun genericPlayerPagesAreNeverReturnedAsNativeMedia() {
        val service = MkissaService(transport = MkissaHttpTransport { error("not expected") })
        assertThrows(MkissaUnsupportedSourceException::class.java) {
            runBlocking {
                service.resolve(
                    MkissaSourceCandidate(
                        url = "https://embed.example/watch/episode",
                        name = "Ad embed",
                        type = "player",
                        priority = 1f,
                    ),
                )
            }
        }
    }

    @Test
    fun knownLiveServerShapesResolveToBoundedDirectMedia() = runBlocking {
        val unsPayload = """{"source":"https://media.example/uni.mp4"}"""
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding").apply {
            init(
                Cipher.ENCRYPT_MODE,
                SecretKeySpec("kiemtienmua911ca".toByteArray(), "AES"),
                IvParameterSpec("1234567890oiuytr".toByteArray()),
            )
        }
        val encryptedUns = cipher.doFinal(unsPayload.toByteArray()).joinToString("") { "%02x".format(it) }
        val transport = MkissaHttpTransport { request ->
            when {
                request.url.contains("mp4upload.com") -> MkissaHttpResponse(
                    200,
                    """player.src({src: "https:\/\/media.example\/mp4upload.mp4"});""",
                )
                request.url.contains("ok.ru") -> MkissaHttpResponse(
                    200,
                    """{&quot;ondemandHls&quot;:&quot;https:\/\/media.example\/ok.m3u8?x=1&amp;y=2&quot;}""",
                )
                request.url.contains("/api/v1/video") -> MkissaHttpResponse(200, encryptedUns)
                request.url.contains("bysekoze.com") -> MkissaHttpResponse(
                    200,
                    """<script>eval(function(p,a,c,k,e,d){return p}("0 1='2';",10,3,"const|file|https://media.example/filemoon.m3u8".split("|"),0,{}))</script>""",
                )
                else -> error("Unexpected request: ${request.url}")
            }
        }
        val service = MkissaService(transport = transport)
        val candidates = listOf(
            MkissaSourceCandidate("https://tools.fast4speed.rsvp/video-token", "Yt-mp4", "player", 5f),
            MkissaSourceCandidate("https://bysekoze.com/e/token", "Fm-Hls", "iframe", 4f),
            MkissaSourceCandidate("https://watchanime.uns.bio/#safe_id", "Uni", "iframe", 3f),
            MkissaSourceCandidate("https://mp4upload.com/embed-token.html", "Mp4", "iframe", 2f),
            MkissaSourceCandidate("https://ok.ru/videoembed/token", "Ok", "iframe", 1f),
        )

        val resolved = candidates.associate { it.name to service.resolve(it).single() }

        assertEquals(MkissaMediaKind.MP4, resolved.getValue("Yt-mp4").kind)
        assertEquals("https://media.example/filemoon.m3u8", resolved.getValue("Fm-Hls").url)
        assertEquals("https://media.example/uni.mp4", resolved.getValue("Uni").url)
        assertEquals("https://media.example/mp4upload.mp4", resolved.getValue("Mp4").url)
        assertEquals("https://media.example/ok.m3u8?x=1&y=2", resolved.getValue("Ok").url)
        assertTrue(resolved.values.all { it.headers.containsKey("Referer") })
    }

    @Test
    fun captchaStopsAttemptButAllowsImmediateManualRetry() {
        val now = 1_000L
        var requests = 0
        val service = MkissaService(
            transport = MkissaHttpTransport {
                requests++
                MkissaHttpResponse(
                    200,
                    """{"errors":[{"message":"CAPTCHA required","extensions":{"code":"NEED_CAPTCHA"}}]}""",
                )
            },
            nowMillis = { now },
        )

        val challenge = assertThrows(MkissaRateLimitedException::class.java) {
            runBlocking { service.search("Gundam") }
        }
        assertEquals(MkissaChallengeKind.CAPTCHA, challenge.kind)
        assertTrue(challenge.message.orEmpty().contains("will not bypass"))
        assertEquals(1, requests)

        val retry = assertThrows(MkissaRateLimitedException::class.java) {
            runBlocking { service.search("Gundam") }
        }
        assertEquals(MkissaChallengeKind.CAPTCHA, retry.kind)
        assertEquals(2, requests)
        assertFalse(retry.message.orEmpty().isBlank())
    }

    @Test
    fun adapterPropagatesEveryPlaybackHeader() {
        val media = MkissaMediaSource(
            url = "https://media.example/episode.m3u8",
            serverName = "Default",
            kind = MkissaMediaKind.HLS,
            headers = mapOf(
                "referer" to "https://player.example/",
                "user-agent" to "mkissa-test-agent",
                "Origin" to "https://player.example",
                "X-Stream-Token" to "opaque",
            ),
        )

        val resolved = MkissaProvider.toResolvedMedia(media)
        assertEquals(media.headers, resolved.requestHeaders)
        assertEquals("https://player.example/", resolved.referer)
        assertEquals("mkissa-test-agent", resolved.userAgent)
        assertFalse(resolved.downloadable)
        assertTrue("MKissa native playback must not rotate/retry after denial", resolved.conservativeNetwork)
    }

    @Test
    fun nativeMediaMimeSeekAndScopedHeadersFollowActualFormat() {
        val cases = listOf(
            Triple(MkissaMediaKind.HLS, "application/x-mpegURL", StreamAuthorizationScope.DIRECTORY),
            Triple(MkissaMediaKind.MP4, "video/mp4", StreamAuthorizationScope.EXACT),
            Triple(MkissaMediaKind.DASH, "application/dash+xml", StreamAuthorizationScope.DIRECTORY),
        )
        for ((kind, mime, scope) in cases) {
            val media = MkissaMediaSource(
                url = "https://media.example/episode/manifest",
                serverName = "Fixture",
                kind = kind,
                headers = mapOf("Referer" to "https://player.example/", "Origin" to "https://player.example"),
            )
            val native = MkissaProvider.toResolvedMedia(media)
            assertEquals(kind.name, mime, native.mimeType)
            assertEquals(kind.name, scope, native.authorizationScope)
            assertEquals(media.headers, native.requestHeaders)
            assertEquals(PlaybackBackend.NATIVE, native.backend)
            assertEquals(if (kind == MkissaMediaKind.MP4) SeekMode.EXACT else SeekMode.CLOSEST_SYNC, native.seekMode)
            assertTrue(native.conservativeNetwork)
            assertFalse(native.downloadable)
        }
    }

    @Test
    fun accessPolicyDistinguishesCryptoErrorsAndDoesNotInspectOrdinaryTitles() {
        assertEquals(MkissaChallengeKind.CAPTCHA, MkissaChallengePolicy.classify(403, "Forbidden"))
        assertEquals(MkissaChallengeKind.RATE_LIMIT, MkissaChallengePolicy.classify(429, ""))
        assertNull(MkissaChallengePolicy.classify(
            403,
            """{"errors":[{"extensions":{"code":"AA_CRYPTO_MISMATCH"}}]}""",
        ))
        assertNull(MkissaChallengePolicy.classify(
            200,
            """{"data":{"show":{"name":"CAPTCHA_REQUIRED: Security Challenge"}}}""",
        ))
        assertEquals(MkissaChallengeKind.CAPTCHA, MkissaChallengePolicy.classify(
            503,
            """ <html><title>Just a moment...</title><script src="/cf-chl-verify.js"></script></html>""",
        ))
    }

    @Test
    fun sourceDiscoveryCacheDoesNotReuseExpiringUrlsAtPlayback() = runBlocking {
        var protectedReads = 0
        val service = fixtureService {
            protectedReads++
            sourceResponse(url = "https://media.example/episode.mp4?generation=$protectedReads")
        }
        val episode = MkissaEpisodeRef("fixture_show", "1.5", MkissaTranslation.SUB)
        assertEquals(service.sources(episode), service.sources(episode))
        assertEquals(1, protectedReads)
        assertEquals(
            "https://media.example/episode.mp4?generation=2",
            service.sources(episode, fresh = true).single().url,
        )
        assertEquals(2, protectedReads)
        service.resolveFirst(episode)
        assertEquals("Default playback also requests current sources", 3, protectedReads)
    }

    @Test
    fun explicitServerSelectionTracksAliasAfterReorderAndRejectsDisappearedAlias() = runBlocking {
        var protectedReads = 0
        val service = fixtureService {
            protectedReads++
            val choices = when (protectedReads) {
                1 -> """[{"sourceName":"Mp4","type":"player","priority":3,"sourceUrl":"https://media.example/old.mp4"},{"sourceName":"Ok","type":"player","priority":2,"sourceUrl":"https://media.example/ok.mp4"}]"""
                2 -> """[{"sourceName":"Ok","type":"player","priority":4,"sourceUrl":"https://media.example/ok-new.mp4"},{"sourceName":"Mp4","type":"player","priority":1,"sourceUrl":"https://media.example/fresh.mp4"}]"""
                else -> """[{"sourceName":"Ok","type":"player","priority":4,"sourceUrl":"https://media.example/never-selected.mp4"}]"""
            }
            sourceResponse(choices = choices)
        }
        val show = MkissaShow("fixture_show", "Fixture", subEpisodes = listOf("1"))
        val episode = MkissaProvider.series(show, MkissaTranslation.SUB, service).episodes.single()
        val selected = episode.variants().first { it.label == "Mp4" }
        assertEquals("https://media.example/fresh.mp4", episode.resolve(variantId = selected.id).url)
        val failure = runCatching { episode.resolve(variantId = selected.id) }.exceptionOrNull()
        assertTrue(failure is MkissaProtocolException)
        assertTrue(failure?.message.orEmpty().contains("no longer available"))
        assertEquals(3, protectedReads)
    }

    @Test
    fun invalidSourcePayloadsNeverCauseAnotherKeyHandshake() = runBlocking {
        val payloads = listOf(
            "not-json",
            """{"data":{"episode":{"sourceUrls":[]}}}""",
            """{"data":{"episode":{"show":{"_id":"other_show"},"sourceUrls":[{"sourceName":"Mp4","sourceUrl":"https://media.example/wrong.mp4"}]}}}""",
            """{"data":{"tobeparsed":"not-base64"}}""",
            """{"data":{"episode":{"sourceUrls":"unexpected"}}}""",
        )
        for (payload in payloads) {
            var protectedReads = 0
            var bootstrapReads = 0
            val service = fixtureService(onBootstrap = { bootstrapReads++ }) {
                protectedReads++
                MkissaHttpResponse(200, payload)
            }
            val failure = runCatching {
                service.sources(MkissaEpisodeRef("fixture_show", "1", MkissaTranslation.SUB))
            }.exceptionOrNull()
            assertTrue(payload, failure is MkissaProtocolException)
            assertEquals(payload, 1, protectedReads)
            assertEquals(payload, 1, bootstrapReads)
        }
    }

    @Test
    fun decryptedMalformedJsonIsNotMistakenForStaleKeys() = runBlocking {
        var bootstrapReads = 0
        var protectedReads = 0
        val key = MkissaCrypto.deriveKey(
            MkissaCrypto.maskCandidates(FIXTURE_BUILD.buildId, FIXTURE_BUILD.seeds).first(),
            FIXTURE_PART_B,
        )
        val envelope = MkissaCrypto.encryptPayload("not-json", key, ByteArray(12) { it.toByte() })
        val service = fixtureService(onBootstrap = { bootstrapReads++ }) {
            protectedReads++
            MkissaHttpResponse(200, JSONObject().put("data", JSONObject().put("tobeparsed", envelope)).toString())
        }
        val failure = runCatching { service.sources(MkissaEpisodeRef("fixture_show", "1", MkissaTranslation.SUB)) }.exceptionOrNull()
        assertTrue(failure is MkissaProtocolException)
        assertEquals(1, bootstrapReads)
        assertEquals(1, protectedReads)
    }

    @Test
    fun explicitlyStaleKeysPermitOnlyOneRefresh() = runBlocking {
        var bootstrapReads = 0
        var protectedReads = 0
        val service = fixtureService(onBootstrap = { bootstrapReads++ }) {
            protectedReads++
            MkissaHttpResponse(403, """{"errors":[{"extensions":{"code":"AA_CRYPTO_MISMATCH"}}]}""")
        }
        val failure = runCatching { service.sources(MkissaEpisodeRef("fixture_show", "1", MkissaTranslation.SUB)) }.exceptionOrNull()
        assertTrue(failure is MkissaProtocolException)
        assertEquals(2, bootstrapReads)
        assertEquals(2, protectedReads)
    }

    @Test
    fun queuedSourcesStopAfterChallengeButLaterManualRequestWorksImmediately() = runBlocking {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var protectedReads = 0
        val service = fixtureService {
            protectedReads++
            if (protectedReads == 1) {
                started.complete(Unit)
                release.await()
                MkissaHttpResponse(403, "Forbidden")
            } else sourceResponse()
        }
        val first = async(start = CoroutineStart.UNDISPATCHED) {
            runCatching { service.sources(MkissaEpisodeRef("fixture_show", "1", MkissaTranslation.SUB)) }
        }
        started.await()
        val queued = async(start = CoroutineStart.UNDISPATCHED) {
            runCatching { service.sources(MkissaEpisodeRef("fixture_show", "2", MkissaTranslation.SUB)) }
        }
        release.complete(Unit)
        assertTrue(first.await().exceptionOrNull() is MkissaRateLimitedException)
        assertTrue(queued.await().exceptionOrNull() is MkissaRateLimitedException)
        assertEquals("Queued reads must not reach the rejected API", 1, protectedReads)
        assertEquals(1, service.sources(MkissaEpisodeRef("fixture_show", "2", MkissaTranslation.SUB)).size)
        assertEquals(2, protectedReads)
    }

    @Test
    fun bootstrapUnknownDenialsAndMalformedBodiesStopAtFirstToken() = runBlocking {
        for (response in listOf(MkissaHttpResponse(403, "Forbidden"), MkissaHttpResponse(503, "down"), MkissaHttpResponse(200, "not-json"))) {
            var calls = 0
            val keys = MkissaKeyManager(
                transport = MkissaHttpTransport { calls++; response },
                externalBuildResolver = { FIXTURE_BUILD },
                nowMillis = { 1_000L },
            )
            assertTrue(runCatching { keys.material() }.isFailure)
            assertEquals("Bootstrap must not rotate token candidates for arbitrary failures", 1, calls)
        }
    }

    @Test
    fun mediaAccessDenialNeverRotatesToAnotherServer() = runBlocking {
        var calls = 0
        val service = MkissaService(transport = MkissaHttpTransport {
            calls++
            MkissaHttpResponse(403, "Forbidden")
        })
        val failure = runCatching {
            service.resolveFirst(listOf(
                MkissaSourceCandidate("https://mp4upload.com/embed-one.html", "Mp4", "iframe", 2f),
                MkissaSourceCandidate("https://media.example/never-reached.mp4", "Fallback", "player", 1f),
            ))
        }.exceptionOrNull()
        assertTrue(failure is MkissaRateLimitedException)
        assertEquals(1, calls)
    }

    @Test
    fun cancelledSearchDoesNotTryAnotherTitleOrBecomeAnAvailabilityError() = runBlocking {
        val cancellation = CancellationException("Fixture search cancelled")
        var calls = 0
        val service = MkissaService(transport = MkissaHttpTransport {
            calls++
            throw cancellation
        })
        val anime = Anime(
            id = 1, malId = null, title = "English fixture", titleRomaji = "Romaji fixture",
            cover = null, banner = null, episodes = 26, status = "FINISHED", format = "TV",
            year = 1998, score = null, synopsis = null, genres = emptyList(),
        )
        val failure = runCatching { service.match(anime) }.exceptionOrNull()
        assertTrue("Cancellation must reach the caller unchanged", failure === cancellation)
        assertEquals("Cancelled matching must not search alternate titles", 1, calls)
    }

    @Test
    fun cancelledResolutionDoesNotReturnAFallbackServer() = runBlocking {
        val cancellation = CancellationException("Fixture resolution cancelled")
        var calls = 0
        val service = MkissaService(transport = MkissaHttpTransport {
            calls++
            throw cancellation
        })
        val failure = runCatching {
            service.resolveFirst(listOf(
                MkissaSourceCandidate("https://mp4upload.com/embed-one.html", "Mp4", "iframe", 2f),
                MkissaSourceCandidate("https://media.example/never-selected.mp4", "Fallback", "player", 1f),
            ))
        }.exceptionOrNull()
        assertTrue("A cancelled resolver must not silently choose another server", failure === cancellation)
        assertEquals(1, calls)
    }

    @Test
    fun canonicalMp4UploadRedirectIsValidatedAndDeletedFileIsActionable() = runBlocking {
        val requests = mutableListOf<MkissaHttpRequest>()
        val service = MkissaService(transport = MkissaHttpTransport { request ->
            requests += request
            if (requests.size == 1) MkissaHttpResponse(302, "", mapOf("location" to "https://www.mp4upload.com/embed-fixture.html"))
            else MkissaHttpResponse(200, "File was deleted")
        })
        val failure = runCatching {
            service.resolve(MkissaSourceCandidate("https://mp4upload.com/embed-fixture.html", "Mp4", "iframe", 1f))
        }.exceptionOrNull()
        assertEquals(2, requests.size)
        assertEquals("https://www.mp4upload.com/embed-fixture.html", requests.last().url)
        assertTrue(requests.last().headers.keys.none { it.equals("Cookie", true) || it.equals("Authorization", true) })
        assertTrue(failure is MkissaUnsupportedSourceException)
        assertTrue(failure?.message.orEmpty().contains("file was deleted"))
    }

    @Test
    fun embedRedirectCannotFollowAdvertisingOrPrivateHosts() = runBlocking {
        for (location in listOf("https://ads.example/player", "https://127.0.0.1/video", "http://www.mp4upload.com/embed-fixture.html")) {
            var calls = 0
            val service = MkissaService(transport = MkissaHttpTransport {
                calls++
                MkissaHttpResponse(302, "", mapOf("Location" to location))
            })
            assertTrue(runCatching {
                service.resolve(MkissaSourceCandidate("https://mp4upload.com/embed-fixture.html", "Mp4", "iframe", 1f))
            }.isFailure)
            assertEquals(location, 1, calls)
        }
    }

    @Test
    fun wrongShowCatalogueIsRejected() = runBlocking {
        val service = MkissaService(transport = MkissaHttpTransport {
            MkissaHttpResponse(200, """{"data":{"show":{"_id":"other_show","name":"Wrong title"}}}""")
        })
        assertTrue(runCatching { service.show("fixture_show") }.exceptionOrNull() is MkissaProtocolException)
    }

    @Test
    fun browserTlsFallbackNeverRetriesApiDenialsNetworkResetsOrUnsafeDns() {
        val embed = "https://mp4upload.com/embed-fixture.html"
        assertTrue(MkissaNetwork.allowsBrowserTlsFallback(embed, SSLHandshakeException("TLS handshake")))
        assertFalse(MkissaNetwork.allowsBrowserTlsFallback("https://api.mkissa.net/api", SSLHandshakeException("TLS handshake")))
        assertFalse(MkissaNetwork.allowsBrowserTlsFallback("https://arbitrary.example/player", SSLHandshakeException("TLS handshake")))
        assertFalse(MkissaNetwork.allowsBrowserTlsFallback(embed, IOException("Connection reset")))
        assertFalse(MkissaNetwork.allowsBrowserTlsFallback(embed, IOException("Unsafe DNS answer")))
        assertFalse(MkissaNetwork.allowsBrowserTlsFallback("https://127.0.0.1/player", SSLHandshakeException("TLS handshake")))
    }

    @Test
    fun unreadableDeniedResponseRemainsTypedAccessStopRatherThanNetworkRetry() = runBlocking {
        var calls = 0
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            calls++
            val brokenBody = object : ResponseBody() {
                override fun contentType() = "text/plain".toMediaType()
                override fun contentLength() = -1L
                override fun source() = object : Source {
                    override fun read(sink: Buffer, byteCount: Long): Long = throw IOException("Unreadable denial")
                    override fun timeout() = Timeout.NONE
                    override fun close() = Unit
                }.buffer()
            }
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(403).message("Forbidden").body(brokenBody).build()
        }.build()
        val failure = runCatching {
            MkissaOkHttpTransport(client).execute(MkissaHttpRequest("GET", "https://mp4upload.com/embed-fixture.html"))
        }.exceptionOrNull()
        assertTrue(failure is MkissaRateLimitedException)
        assertEquals(1, calls)
    }

    private fun fixtureService(
        onBootstrap: () -> Unit = {},
        sources: suspend (MkissaHttpRequest) -> MkissaHttpResponse,
    ): MkissaService {
        val transport = MkissaHttpTransport { request ->
            if (request.url.contains("/client-crypto/v1/bootstrap")) {
                onBootstrap()
                MkissaHttpResponse(200, JSONObject()
                    .put("epoch", 1234)
                    .put("k", "k7")
                    .put("partB", Base64.getEncoder().encodeToString(FIXTURE_PART_B))
                    .toString())
            } else sources(request)
        }
        return MkissaService(
            transport = transport,
            keyManager = MkissaKeyManager(transport, externalBuildResolver = { FIXTURE_BUILD }, nowMillis = { 1_000L }),
            nowMillis = { 1_000L },
            diagnostic = {},
        )
    }

    private fun sourceResponse(
        url: String = "https://media.example/episode.mp4",
        choices: String = """[{"sourceName":"Mp4","type":"player","priority":1,"sourceUrl":"$url"}]""",
    ) = MkissaHttpResponse(200, """{"data":{"episode":{"show":{"_id":"fixture_show"},"sourceUrls":$choices}}}""")

    companion object {
        private val FIXTURE_PART_B = ByteArray(32) { (it + 1).toByte() }
        private val FIXTURE_BUILD = MkissaBundleParser.BuildInfo(
            "149",
            listOf("YWJjZGVmZ2g=", "aWprbG1ub3A=", "cXJzdHV2d3g=", "eXoxMjM0NTY="),
        )
    }
}
