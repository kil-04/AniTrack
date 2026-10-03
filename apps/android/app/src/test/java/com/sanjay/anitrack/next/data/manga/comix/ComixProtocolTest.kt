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
        assertTrue(ComixProtocol.matches(JSONObject("""{"title":"Ｂｅｒｓｅｒｋ"}"""),manga))
        assertTrue(ComixProtocol.matches(JSONObject("""{"title":"Different","altTitles":["Berserk"]}"""),manga))
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
        assertEquals(ComixProtocol.ORIGIN,nested.single().headers["Origin"])
        val plain = ComixProtocol.pages(JSONObject("""{"pages":[{"url":"https://images.example.org/2.webp"}]}"""))
        assertEquals(1,plain.size)
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
}
