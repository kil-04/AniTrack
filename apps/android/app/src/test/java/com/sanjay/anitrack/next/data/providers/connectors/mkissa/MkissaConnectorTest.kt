package com.sanjay.anitrack.next.data.providers.connectors.mkissa

import com.sanjay.anitrack.next.data.providers.connectors.MkissaProvider
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

class MkissaConnectorTest {
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
    }
}
