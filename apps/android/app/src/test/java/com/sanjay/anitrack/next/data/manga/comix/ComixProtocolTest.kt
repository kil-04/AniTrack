package com.sanjay.anitrack.next.data.manga.comix

import com.sanjay.anitrack.next.data.Manga
import java.net.InetAddress
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ComixProtocolTest {
    private val manga = Manga(30002,2,"Berserk","Berserk",null,null,null,null,null,"MANGA",1989,null,null,emptyList())

    @Test fun localPolicyDenialIsJsonWithoutAccountDataOrWafReloadSignal() {
        assertEquals("application/json", ComixProtocol.BLOCKED_MIME)
        val body = JSONObject(ComixProtocol.BLOCKED_BODY)
        assertEquals(setOf("message"), body.keys().asSequence().toSet())
        assertFalse(ComixProtocol.validRequest("/user", JSONObject()))
    }

    @Test fun trackerIdsConfirmTitlesAndRejectSameNamedSequels() {
        assertTrue(ComixProtocol.matches(JSONObject("""{"title":"Different translation","links":{"al":"https://anilist.co/manga/30002"}}"""),manga))
        assertFalse(ComixProtocol.matches(JSONObject("""{"title":"Berserk","links":{"al":"https://anilist.co/manga/30003"}}"""),manga))
        assertTrue(ComixProtocol.matches(JSONObject("""{"title":"Ｂｅｒｓｅｒｋ","year":1989,"originalLanguage":"ja"}"""),manga))
        assertTrue(ComixProtocol.matches(JSONObject("""{"title":"Different","altTitles":["Berserk"],"year":1989,"originalLanguage":"ja"}"""),manga))
    }

    @Test fun unlinkedNamesNeedRealPublicationYearAndRejectKnownCountryConflicts() {
        val wanted = manga.copy(country = "JP")
        assertFalse(ComixProtocol.matches(JSONObject("""{"title":"Berserk"}"""),wanted))
        assertFalse(ComixProtocol.matches(JSONObject("""{"title":"Berserk","year":2026,"originalLanguage":"ja"}"""),wanted))
        assertFalse(ComixProtocol.matches(JSONObject("""{"title":"Berserk","year":1989,"originalLanguage":"ko"}"""),wanted))
        assertFalse(ComixProtocol.matches(JSONObject("""{"title":"Berserk","year":1989,"country":"KR"}"""),wanted))
        assertFalse(ComixProtocol.matches(JSONObject("""{"title":"Berserk","year":1989,"country":"KR","originalLanguage":"ja"}"""),wanted))
        assertTrue(ComixProtocol.matches(JSONObject("""{"title":"Berserk","year":1988,"originalLanguage":"ja"}"""),wanted))
        assertTrue(ComixProtocol.matches(JSONObject("""{"title":"Berserk","year":1990,"country":"jp"}"""),wanted))
        assertFalse(ComixProtocol.matches(JSONObject("""{"title":"Berserk","year":1989}"""),wanted.copy(year = null)))
        for (year in listOf<Any>("1989", 1989.5, -1, JSONObject.NULL)) {
            assertFalse(ComixProtocol.matches(JSONObject().put("title","Berserk").put("year",year),wanted))
        }
    }

    @Test fun fallbackIncludesAniListSynonymsButNotUnrelatedNames() {
        val wanted = manga.copy(country = "JP", synonyms = listOf("Alternate registered name"))
        assertTrue(ComixProtocol.matches(JSONObject("""{"title":"Alternate registered name","year":1989,"originalLanguage":"ja"}"""),wanted))
        assertFalse(ComixProtocol.matches(JSONObject("""{"title":"Unrelated title","year":1989,"originalLanguage":"ja"}"""),wanted))
    }

    @Test fun trackerPrecedenceNeverLetsConflictingPrimaryIdsFallbackToName() {
        assertTrue(ComixProtocol.matches(JSONObject("""{"title":"Different","year":2026,"links":{"al":"https://anilist.co/manga/30002","mal":"https://myanimelist.net/manga/999"}}"""),manga))
        assertFalse(ComixProtocol.matches(JSONObject("""{"title":"Berserk","year":1989,"links":{"al":"https://anilist.co/manga/30003","mal":"https://myanimelist.net/manga/2"}}"""),manga))
        assertTrue(ComixProtocol.matches(JSONObject("""{"title":"Different","links":{"mal":"https://myanimelist.net/manga/2"}}"""),manga))
        assertFalse(ComixProtocol.matches(JSONObject("""{"title":"Berserk","year":1989,"links":{"mal":"https://myanimelist.net/manga/3"}}"""),manga))
        for (url in listOf("http://anilist.co/manga/30002", "https://anilist.co.evil.example/manga/30002", "https://user@anilist.co/manga/30002",
            "https://anilist.co:8443/manga/30002", "https://anilist.co/manga/0")) {
            assertFalse(ComixProtocol.matches(JSONObject().put("title","Berserk").put("links",JSONObject().put("al",url)),manga))
        }
    }

    @Test fun confirmationRequiresTheExactObservedSearchHidEvenWithMatchingTrackers() {
        val detail = JSONObject("""{"hid":"selected","title":"Berserk","links":{"al":"https://anilist.co/manga/30002"}}""")
        assertTrue(ComixProtocol.matches(detail,manga,"selected"))
        assertFalse(ComixProtocol.matches(detail,manga,"other"))
        assertFalse(ComixProtocol.matches(detail,manga,"not_valid"))
        detail.remove("hid")
        assertFalse(ComixProtocol.matches(detail,manga,"selected"))
        detail.put("hid",JSONObject())
        assertFalse(ComixProtocol.matches(detail,manga,"selected"))
    }

    @Test fun catalogueBoundaryAcceptsOnlyReviewedReadOperations() {
        val search = JSONObject().put("keyword","Berserk").put("page",1).put("limit",20).put("order[relevance]","desc")
        assertTrue(ComixProtocol.validRequest("/manga",search))
        assertTrue(ComixProtocol.validRequest("/manga/zjem",JSONObject()))
        assertTrue(ComixProtocol.validRequest("/chapters/123456",JSONObject()))
        assertFalse(ComixProtocol.validRequest("/user",JSONObject()))
        assertFalse(ComixProtocol.validRequest("https://example.com/manga",search))
        assertFalse(ComixProtocol.validRequest("/manga/../user",JSONObject()))
        assertFalse(ComixProtocol.validRequest("/manga",JSONObject(search.toString()).put("headers",JSONObject())))
        assertFalse(ComixProtocol.validRequest("/chapters/123",JSONObject().put("url","https://example.com")))
    }

    @Test fun connectionAllowsNormalPublicNavigationAndTheReviewedManualWafPage() {
        val publicPages = listOf("https://comix.to/", "https://comix.to/browse?keyword=Berserk",
            "https://comix.to/title/zjem", "https://comix.to/title/zjem-berserk")
        for (url in publicPages) {
            assertTrue(url,ComixProtocol.isPublicConnectionPage(url))
            assertTrue(url,ComixProtocol.allowedWebsiteRequest(url,"GET",true,true))
        }
        val waf = "https://comix.to/@waf/challenge"
        assertTrue(ComixProtocol.allowedWebsiteRequest(waf,"GET",true,true))
        assertTrue(ComixProtocol.allowedWebsiteRequest(waf,"GET",false,true))
        assertFalse(ComixProtocol.isPublicConnectionPage(waf))
        assertFalse(ComixProtocol.allowedWebsiteRequest(waf,"GET",false,false))
        assertFalse(ComixProtocol.allowedWebsiteRequest(waf,"POST",false,true))
    }

    @Test fun observedManualWafResourcesAreExactMethodAndConnectingOnly() {
        val generate = "https://comix.to/@waf/generate"
        val verify = "https://comix.to/@waf/verify"
        assertTrue(ComixProtocol.allowedWebsiteRequest(generate,"GET",false,true))
        assertTrue(ComixProtocol.allowedWebsiteRequest(generate,"GET",false,true,true))
        assertTrue(ComixProtocol.allowedWebsiteRequest(verify,"POST",false,true))
        assertTrue(ComixProtocol.allowedWebsiteRequest(verify,"POST",false,true,true))
        assertFalse(ComixProtocol.allowedWebsiteRequest(generate,"GET",true,true))
        assertFalse(ComixProtocol.allowedWebsiteRequest(verify,"POST",true,true))
        assertFalse(ComixProtocol.allowedWebsiteRequest(generate,"POST",false,true))
        assertFalse(ComixProtocol.allowedWebsiteRequest(verify,"GET",false,true))
        assertFalse(ComixProtocol.allowedWebsiteRequest(generate,"GET",false,false))
        assertFalse(ComixProtocol.allowedWebsiteRequest(verify,"POST",false,false))
        for (url in listOf("https://comix.to/@waf/unknown", "https://comix.to/@waf/verify/extra",
            "https://comix.to/@waf/generate/extra")) {
            assertFalse(url,ComixProtocol.allowedWebsiteRequest(url,"GET",false,true))
            assertFalse(url,ComixProtocol.allowedWebsiteRequest(url,"POST",false,true))
        }
    }

    @Test fun manualVerificationMayReturnToTheHomepageAsADocumentPost() {
        for (url in listOf("https://comix.to/", "https://comix.to/?return=fixture", "https://comix.to:443/")) {
            assertTrue(url,ComixProtocol.allowedWebsiteRequest(url,"POST",true,true))
            // A manual reconnection may recover a previously rejected session.
            assertTrue(url,ComixProtocol.allowedWebsiteRequest(url,"POST",true,true,true))
            assertFalse(url,ComixProtocol.allowedWebsiteRequest(url,"POST",false,true))
            assertFalse(url,ComixProtocol.allowedWebsiteRequest(url,"POST",true,false))
            assertFalse(url,ComixProtocol.allowedWebsiteRequest(url,"POST",true,false,true))
        }
    }

    @Test fun verificationReturnDoesNotPermitOtherPostTargetsOrMethods() {
        for (url in listOf("https://comix.to/browse", "https://comix.to/title/zjem-berserk",
            "https://comix.to/login", "https://comix.to/api/v1/user", "https://comix.to/api/v1/manga",
            "https://comix.to/@waf/verify", "https://comix.to/cdn-cgi/challenge-platform/flow",
            "https://other.example/", "https://comix.to.evil.example/", "https://user@comix.to/",
            "http://comix.to/", "https://comix.to:8443/", "https://comix.to//", "https://comix.to/%2f",
            "https://comix.to/title/../", "https://comix.to/#fragment")) {
            assertFalse(url,ComixProtocol.allowedWebsiteRequest(url,"POST",true,true))
        }
        for (method in listOf("PUT","PATCH","DELETE","HEAD","OPTIONS")) {
            assertFalse(method,ComixProtocol.allowedWebsiteRequest("https://comix.to/",method,true,true))
        }
    }

    @Test fun titleGroupsAreOnlyExactVisibleConnectionGetResources() {
        val url = "https://comix.to/api/v1/manga/eqr1e/groups"
        assertTrue(ComixProtocol.allowedWebsiteRequest(url,"GET",false,true))
        assertTrue(ComixProtocol.allowedWebsiteRequest(url,"GET",false,true,true))
        assertFalse(ComixProtocol.allowedWebsiteRequest(url,"GET",false,false))
        assertFalse(ComixProtocol.allowedWebsiteRequest(url,"GET",true,true))
        for (method in listOf("POST","HEAD","PUT","DELETE"))
            assertFalse(ComixProtocol.allowedWebsiteRequest(url,method,false,true))
        for (suffix in listOf("?","?other=1","/account","/extra"))
            assertFalse(ComixProtocol.allowedWebsiteRequest(url + suffix,"GET",false,true))
        assertFalse(ComixProtocol.allowedWebsiteRequest("https://comix.to/api/v1/manga/eqr_1/groups","GET",false,true))
        assertFalse(ComixProtocol.validRequest("/manga/eqr1e/groups",JSONObject()))
        assertFalse(ComixProtocol.allowedWebsiteRequest("https://comix.to/title/eqr1e-overgeared/11480837-chapter-343","GET",false,true))
    }

    @Test fun hiddenCatalogueModeCannotNavigateTitlesOrOfferManualChecks() {
        assertTrue(ComixProtocol.allowedWebsiteRequest("https://comix.to/","GET",true,false))
        assertFalse(ComixProtocol.allowedWebsiteRequest("https://comix.to/","GET",true,false,true))
        for (url in listOf("https://comix.to/browse", "https://comix.to/title/zjem-berserk", "https://comix.to/@waf/challenge")) {
            assertFalse(url,ComixProtocol.allowedWebsiteRequest(url,"GET",true,false))
            assertFalse(url,ComixProtocol.allowedWebsiteRequest(url,"GET",false,false))
        }
    }

    @Test fun manualSpaNavigationMayFetchPublicHtmlAsAGetSubresource() {
        for (url in listOf("https://comix.to/", "https://comix.to/browse?keyword=Berserk", "https://comix.to/title/zjem-berserk")) {
            assertTrue(url,ComixProtocol.allowedWebsiteRequest(url,"GET",false,true))
            assertTrue(url,ComixProtocol.allowedWebsiteRequest(url,"GET",false,true,true))
            assertFalse(url,ComixProtocol.allowedWebsiteRequest(url,"GET",false,false))
            assertFalse(url,ComixProtocol.allowedWebsiteRequest(url,"POST",false,true))
            assertFalse(url,ComixProtocol.allowedWebsiteRequest(url,"HEAD",false,true))
        }
    }

    @Test fun websitePolicyPreservesBoundedPublicResourcesAndExistingManualCloudflareFlow() {
        for (path in listOf("/assets/t3/dist/main-fixture.js", "/favicon.ico", "/api/v1/manga?keyword=Berserk",
            "/api/v1/manga/zjem", "/api/v1/manga/zjem/chapters?page=1", "/api/v1/chapters/123")) {
            assertTrue(path,ComixProtocol.allowedWebsiteRequest("https://comix.to$path","GET",false,false))
            assertFalse(path,ComixProtocol.allowedWebsiteRequest("https://comix.to$path","POST",false,true))
        }
        assertFalse(ComixProtocol.allowedWebsiteRequest("https://comix.to/api/v1/manga","GET",false,false,true))
        assertTrue(ComixProtocol.allowedWebsiteRequest("https://comix.to/api/v1/manga","GET",false,true,true))
        assertTrue(ComixProtocol.allowedWebsiteRequest("https://comix.to/cdn-cgi/challenge-platform/h/g/orchestrate","GET",false,true))
        assertTrue(ComixProtocol.allowedWebsiteRequest("https://comix.to/cdn-cgi/challenge-platform/h/g/flow","POST",false,true))
        assertFalse(ComixProtocol.allowedWebsiteRequest("https://comix.to/cdn-cgi/challenge-platform/h/g/flow","POST",true,true))
        assertTrue(ComixProtocol.allowedWebsiteRequest("https://challenges.cloudflare.com/turnstile/v0/api.js","GET",false,true))
        assertTrue(ComixProtocol.allowedWebsiteRequest("https://challenges.cloudflare.com/challenge","POST",false,true))
        assertFalse(ComixProtocol.allowedWebsiteRequest("https://challenges.cloudflare.com/challenge","GET",true,true))
        assertFalse(ComixProtocol.allowedWebsiteRequest("https://challenges.cloudflare.com/challenge","POST",false,false))
    }

    @Test fun websitePolicyRejectsAccountsAdsUnsafeUrlsAndUnreviewedRoutes() {
        for (url in listOf("http://comix.to/", "https://user@comix.to/", "https://comix.to:8443/", "https://comix.to.evil.example/",
            "https://ads.example.org/", "https://comix.to/user", "https://comix.to/login", "https://comix.to/api/v1/user",
            "https://comix.to/title/../user", "https://comix.to/title/%2e%2e/user", "https://comix.to/title/zjem/123-chapter-1",
            "https://comix.to/assets/../api/v1/user", "https://comix.to/assets/%2e%2e/api/v1/user", "https://comix.to//@waf/challenge",
            "https://comix.to/@waf/challenge/extra", "https://comix.to/@waf/challenge#fragment", "https://comix.to/\n")) {
            assertFalse(url,ComixProtocol.allowedWebsiteRequest(url,"GET",true,true))
            assertFalse(url,ComixProtocol.allowedWebsiteRequest(url,"GET",false,true))
            assertFalse(url,ComixProtocol.isPublicConnectionPage(url))
        }
        assertFalse(ComixProtocol.allowedWebsiteRequest("https://comix.to/browse","HEAD",true,true))
    }

    @Test fun chaptersKeepFractionalNumbersGroupsAndStableIds() {
        val value = JSONObject("""{"items":[
          {"id":101,"number":1,"name":"Opening","group":{"name":"Group A"}},
          {"id":102,"number":1.5,"name":null},
          {"id":103,"number":-1}, {"id":"bad","number":2}
        ],"pagination":{"page":1,"lastPage":2}}""")
        val rows = ComixProtocol.chapters(value)
        assertEquals(listOf("101","102"),rows.map { it.id })
        assertEquals(1.5f,rows[1].number)
        assertNull(rows[1].title)
        assertEquals("Group A",rows[0].group)
        assertTrue(ComixProtocol.hasNext(value,1))
        assertFalse(ComixProtocol.hasNext(JSONObject("""{"meta":{"page":2,"last_page":2}}"""),2))
    }

    @Test fun missingOrRepeatedPaginationCannotSilentlyTruncate() {
        assertThrows(IllegalStateException::class.java) { ComixProtocol.hasNext(JSONObject("""{"items":[]}"""),1) }
        assertThrows(IllegalArgumentException::class.java) { ComixProtocol.hasNext(JSONObject("""{"pagination":{"page":1,"lastPage":2}}"""),2) }
    }

    @Test fun pagesSupportBothPublicWebsiteResponseShapes() {
        val nested = ComixProtocol.pages(JSONObject("""{"pages":{"baseUrl":"https://images.example.org/","items":[{"url":"1.webp","width":1700,"height":2400}]}}"""))
        assertEquals("https://images.example.org/1.webp",nested.single().url)
        assertEquals(1700,nested.single().width)
        assertTrue(nested.single().headers.isEmpty())
        val plain = ComixProtocol.pages(JSONObject("""{"pages":[{"url":"https://images.example.org/2.webp"}]}"""))
        assertEquals(1,plain.size)
    }

    @Test fun pageUrlsJoinRelativePathsWithoutChangingAbsoluteTargets() {
        val pages = ComixProtocol.pages(JSONObject("""{"pages":{"baseUrl":"https://images.example.org/chapter/","items":[
          {"url":"/1.webp"},
          {"url":"2.webp"},
          {"url":"https://other.example.org/3.webp?token=public-value"}
        ]}}"""))
        assertEquals(listOf("https://images.example.org/chapter/1.webp", "https://images.example.org/chapter/2.webp",
            "https://other.example.org/3.webp?token=public-value"),pages.map { it.url })
        assertTrue(pages.all { it.headers.isEmpty() })
    }

    @Test fun gridScrambledPagesPreserveTheV3RequestFlagAndExistingQuery() {
        val pages = ComixProtocol.pages(JSONObject("""{"pages":{"baseUrl":"https://images.example.org/chapter","items":[
          {"url":"1.webp","s":1},
          {"url":"2.webp?token=public-value","s":1},
          {"url":"3.webp?v3","s":1},
          {"url":"4.webp?v3=1&token=public-value","s":0},
          {"url":"5.webp","s":0}
        ]}}"""))
        assertEquals(listOf("https://images.example.org/chapter/1.webp?v3",
            "https://images.example.org/chapter/2.webp?token=public-value&v3",
            "https://images.example.org/chapter/3.webp?v3",
            "https://images.example.org/chapter/4.webp?v3=1&token=public-value",
            "https://images.example.org/chapter/5.webp"),pages.map { it.url })
    }

    @Test fun pageAssemblyCannotHideAnUnsafeAbsoluteImageBehindASafeBase() {
        for (url in listOf("http://images.example.org/1.webp", "https://user:pw@images.example.org/1.webp",
            "https://localhost/1.webp", "file:///1.webp")) {
            val value = JSONObject().put("pages",JSONObject().put("baseUrl","https://images.example.org/")
                .put("items",org.json.JSONArray().put(JSONObject().put("url",url).put("s",1))))
            assertThrows(IllegalArgumentException::class.java) { ComixProtocol.pages(value) }
        }
    }

    @Test fun imageRequestIsExactAndNeverSendsHotlinkOrAccountHeaders() {
        val request = ComixImages.imageRequest("https://images.example.org/1.webp?token=public-value&v3")
        assertEquals("https://images.example.org/1.webp?token=public-value&v3",request.url.toString())
        assertEquals("GET",request.method)
        assertEquals(0,request.headers.size)
        assertNull(request.body)
    }

    @Test fun imageTargetsRejectUnsafeSchemesCredentialsAndLiteralLocalHosts() {
        for (url in listOf("http://images.example.org/a", "file:///a", "https://user:pw@images.example.org/a",
            "https://127.0.0.1/a", "https://localhost/a", "https://host.local/a", "https://[::1]/a", "https://images.example.org:8443/a")) {
            assertThrows(IllegalArgumentException::class.java) { ComixProtocol.imageUrl(url) }
        }
        for (ip in listOf("127.0.0.1","192.168.1.1","10.0.0.1","169.254.1.1","100.64.0.1","::1","fc00::1")) {
            assertTrue(ip,ComixImages.privateAddress(InetAddress.getByName(ip)))
        }
        assertFalse(ComixImages.privateAddress(InetAddress.getByName("8.8.8.8")))
    }

    @Test fun rateLimitAnswersPauseForRetryAfterBounded() {
        assertEquals(60_000L, ComixProtocol.retryAfterMillis(502, "60"))
        assertEquals(5_000L, ComixProtocol.retryAfterMillis(429, " 5 "))
        assertEquals(1_000L, ComixProtocol.retryAfterMillis(503, "0"))
        assertEquals(300_000L, ComixProtocol.retryAfterMillis(502, "86400"))
        val now = java.time.Instant.parse("2026-10-14T10:00:00Z").toEpochMilli()
        assertEquals(30_000L, ComixProtocol.retryAfterMillis(502, "Wed, 14 Oct 2026 10:00:30 GMT", now))
        for ((status, header) in listOf(200 to "60", 403 to "60", 500 to "60", 502 to null, 502 to "", 502 to "soon")) {
            assertNull(ComixProtocol.retryAfterMillis(status, header))
        }
        assertTrue(ComixProtocol.isChapterList("/manga/zjem/chapters"))
        assertFalse(ComixProtocol.isChapterList("/manga/zjem") || ComixProtocol.isChapterList("/chapters/42"))
        assertTrue(200 * ComixProtocol.CHAPTER_PAGE_INTERVAL_MS < ComixProtocol.CHAPTER_LIST_DEADLINE_MS)
    }
}
