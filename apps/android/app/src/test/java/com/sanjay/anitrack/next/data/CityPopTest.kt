package com.sanjay.anitrack.next.data

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CityPopTest {
    private fun catalog(): List<CityPopTrack> {
        val file = listOf(File("../../../packages/catalogs/city-pop.json"), File("packages/catalogs/city-pop.json"))
            .first { it.isFile }
        return CityPop.parseCatalog(file.readText())
    }
    private fun row() = JSONObject().put("id", "anri-night").put("title", "Café Summer Night").put("artist", "ＡＮＲＩ")
        .put("year", 1983).put("videoId", "abcdefghijk").put("channel", "Universal").put("moods", JSONArray(listOf("sunset")))
        .put("note", "A warm summer song").put("sourceUrl", "https://www.youtube.com/watch?v=abcdefghijk")
    private fun fails(block: () -> Unit) { try { block(); fail("Expected invalid input to fail") } catch (_: IllegalArgumentException) {} catch (_: IllegalStateException) {} catch (_: org.json.JSONException) {} }
    @Test fun sharedCatalogHasMusicForEveryStation() {
        val tracks = catalog()
        assertTrue(tracks.size >= 8)
        assertEquals(tracks.size, tracks.map { it.id }.distinct().size)
        assertEquals(tracks.size, tracks.map { it.videoId }.distinct().size)
        CityPop.stations.forEach { assertTrue(CityPop.filter(tracks, mood = it.id).isNotEmpty()) }
    }
    @Test fun rejectsMalformedCatalogAndDuplicateIdentities() {
        fails { CityPop.parseCatalog("[]") }
        listOf("id" to "../bad", "videoId" to "bad", "title" to " ", "artist" to 42, "year" to "1983", "year" to 1983.5,
            "year" to 1899, "year" to 2101, "moods" to JSONArray(), "moods" to JSONArray(listOf("unknown")),
            "sourceUrl" to "https://youtube.com.evil.test/watch?v=abcdefghijk").forEach { (key, value) ->
            fails { CityPop.parseCatalog(JSONArray().put(row().put(key, value)).toString()) }
        }
        fails { CityPop.parseCatalog(JSONArray().put(row()).put(row()).toString()) }
        fails { CityPop.parseCatalog(JSONArray().put(row()).put(row().put("id", "other-id")).toString()) }
    }
    @Test fun searchCombinesWordsMoodsAndFavoritesInCatalogOrder() {
        val tracks = CityPop.parseCatalog(JSONArray().put(row()).put(row().put("id", "second").put("videoId", "bcdefghijkl").put("sourceUrl", "https://www.youtube.com/watch?v=bcdefghijkl")).toString())
        assertEquals(2, CityPop.filter(tracks, " cafe   anri ").size)
        assertEquals(emptyList<CityPopTrack>(), CityPop.filter(tracks, favorites = emptySet()))
        assertEquals(tracks, CityPop.filter(tracks, favorites = setOf("second", "anri-night")))
        assertEquals(emptyList<CityPopTrack>(), CityPop.filter(tracks, mood = "night-drive"))
        assertEquals(tracks.take(1), CityPop.filter(tracks, "Universal", "sunset", setOf("anri-night")))
    }
    @Test fun favoritesSurviveRoundTripAndUnknownIdsAreDropped() {
        val tracks = catalog()
        val ids = setOf(tracks[0].id, tracks[2].id, "unknown")
        assertEquals(setOf(tracks[0].id, tracks[2].id), CityPop.parseFavorites(CityPop.serializeFavorites(ids, tracks), tracks))
        assertEquals(emptySet<String>(), CityPop.parseFavorites("broken", tracks))
        assertNull(CityPop.sourceUrl("https://evil.test", tracks))
    }
    private fun video(id: String = "abcdefghijk", extra: JSONObject = JSONObject()): JSONObject {
        val renderer = JSONObject().put("videoId", id).put("title", JSONObject().put("runs", JSONArray().put(JSONObject().put("text", "A title with } braces and \"quotes\""))))
            .put("ownerText", JSONObject().put("runs", JSONArray().put(JSONObject().put("text", "Artist Official"))))
        extra.keys().forEach { renderer.put(it, extra.get(it)) }
        return JSONObject().put("videoRenderer", renderer)
    }
    /** The shape of YouTube's desktop results page (trimmed), as in tests/city-pop.test.mjs. */
    private fun results(rows: JSONArray) = JSONObject().put("estimatedResults", rows.length().toString()).put("contents", JSONObject().put("twoColumnSearchResultsRenderer",
        JSONObject().put("primaryContents", JSONObject().put("sectionListRenderer", JSONObject().put("contents",
            JSONArray().put(JSONObject().put("itemSectionRenderer", JSONObject().put("contents", rows))))))))
    private fun page(rows: JSONArray) = "<script>var ytInitialData = ${results(rows)};</script>"
    private fun unavailable(block: () -> Unit) {
        try { block(); fail("An unreadable page must not become an empty search") }
        catch (e: IllegalStateException) { assertEquals(CityPop.SEARCH_UNAVAILABLE, e.message) }
    }
    @Test fun onlineSearchParsesOrdinaryVideosInOrderAndSkipsShortsLiveAndDuplicates() {
        val rows = JSONArray().put(video()).put(video()).put(video("bcdefghijkl", JSONObject().put("title", JSONObject().put("simpleText", "Second song"))))
            .put(video("cdefghijklm", JSONObject().put("badges", JSONArray().put(JSONObject().put("metadataBadgeRenderer", JSONObject().put("style", "BADGE_STYLE_TYPE_LIVE_NOW"))))))
            .put(video("defghijklmn", JSONObject().put("thumbnailOverlays", JSONArray().put(JSONObject().put("thumbnailOverlayTimeStatusRenderer", JSONObject().put("style", "UPCOMING"))))))
            .put(video("efghijklmno", JSONObject().put("upcomingEventData", JSONObject().put("startTime", "1000"))))
            .put(video("fghijklmnop", JSONObject().put("navigationEndpoint", JSONObject().put("commandMetadata", JSONObject().put("webCommandMetadata", JSONObject().put("url", "/shorts/fghijklmnop"))))))
            .put(JSONObject().put("reelShelfRenderer", JSONObject().put("items", JSONArray().put(video("ghijklmnopq"))))).put(video("bad"))
        val result = CityPop.parseSearch(page(rows))
        assertEquals(listOf("youtube-abcdefghijk", "youtube-bcdefghijkl"), result.map { it.id })
        assertEquals("A title with } braces and \"quotes\"", result[0].title)
        assertEquals("Artist Official", result[0].artist)
        assertNull(result[0].year)
        assertTrue(result[0].moods.isEmpty())
        assertEquals(result, CityPop.parseSearch(page(rows).replace("var ytInitialData", "window[\"ytInitialData\"]")))
    }
    @Test fun onlineParserBoundsInputsAndRefusesBrokenOrUnknownPages() {
        listOf("not a page", "var ytInitialData = {bad};", "var ytInitialData = JSON.parse('anything');", "var ytInitialData = {\"broken\":\"unterminated", "x".repeat(4 * 1024 * 1024 + 1),
            "var ytInitialData = {\"contents\":{}};", "var ytInitialData = {\"responseContext\":{}};",
            "var ytInitialData = ${results(JSONArray().put(JSONObject().put("lockupViewModel", JSONObject().put("contentId", "abcdefghijk"))))};")
            .forEach { html -> unavailable { CityPop.parseSearch(html) } }
        val rows = JSONArray((0 until 25).map { video(it.toString().padStart(11, 'a')) })
        assertEquals(20, CityPop.parseSearch(page(rows)).size)
        // A real results page with nothing playable is an honest empty search.
        assertTrue(CityPop.parseSearch(page(JSONArray().put(video(extra = JSONObject().put("title", JSONObject().put("simpleText", "x".repeat(201))))))).isEmpty())
        assertTrue(CityPop.parseSearch(page(JSONArray())).isEmpty())
        assertTrue(CityPop.parseSearch("var ytInitialData = {\"contents\":{\"sectionListRenderer\":{\"contents\":[]}}};").isEmpty())
    }
    @Test fun searchResponseDistinguishesEmptyResultsFromCheckAndConsentPages() {
        assertTrue(CityPop.parseSearchResponse(page(JSONArray())).isEmpty())
        assertEquals(listOf("youtube-abcdefghijk"), CityPop.parseSearchResponse(page(JSONArray().put(video()))).map { it.id })
        listOf("<html>Before you continue to YouTube</html>", "<html>Sign in to confirm you're not a bot</html>", "<html>Temporarily unavailable</html>").forEach { html ->
            unavailable { CityPop.parseSearchResponse(html) }
        }
    }
    @Test fun aSearchResultForACuratedSongIsThatSongFavoritedOnce() {
        val tracks = catalog()
        val plastic = tracks.first { it.id == "mariya-takeuchi-plastic-love" }
        val result = CityPopTrack("youtube-${plastic.videoId}", "Plastic Love (Official Music Video)", "Mariya Takeuchi", null, plastic.videoId, "Mariya Takeuchi", emptyList(), "YouTube search result", plastic.sourceUrl)
        assertSame(plastic, CityPop.canonical(result, tracks))
        val other = result.copy(id = "youtube-abcdefghijk", videoId = "abcdefghijk", sourceUrl = "https://www.youtube.com/watch?v=abcdefghijk")
        assertSame(other, CityPop.canonical(other, tracks))
        // An old search-result favorite of a curated video becomes its catalog id; saved results stay; unknown ids go.
        val stored = JSONArray(listOf(plastic.id, result.id, other.id, "youtube-zzzzzzzzzzz", "gone", tracks[0].id)).toString()
        assertEquals(setOf(tracks[0].id, plastic.id, other.id), CityPop.parseFavorites(stored, tracks + other))
    }
    @Test fun queuesPlayOnceFromTheChosenTrackEachVideoOnceAndAtMost100() {
        val (a, b, c) = catalog()
        assertEquals(listOf(b, c, a), CityPop.playOrder(listOf(a, b, c), 1))
        assertEquals(listOf(a, b, c), CityPop.playOrder(listOf(a, b, c), 0))
        val result = b.copy(id = "youtube-${b.videoId}", year = null, moods = emptyList(), note = "YouTube search result")
        assertEquals(listOf(c, a, result), CityPop.playOrder(listOf(a, result, b, c), 3))
        val many = (0 until 120).map { i -> a.copy(id = "youtube-${i.toString().padStart(11, 'v')}", videoId = i.toString().padStart(11, 'v')) }
        assertEquals(100, CityPop.playOrder(many, 50).size)
        assertEquals(many[50], CityPop.playOrder(many, 50).first())
        assertTrue(CityPop.playOrder(emptyList(), 0).isEmpty())
    }
    @Test fun youtubeSearchPreservesExactSongAndArtistQueryWithoutAddedTerms() {
        val query = "  竹内まりや Plastic Love & live  "
        val url = CityPop.searchUrl(query)
        assertEquals("https", url.scheme)
        assertEquals("www.youtube.com", url.host)
        assertEquals("/results", url.encodedPath)
        assertEquals("竹内まりや Plastic Love & live", url.queryParameter("search_query"))
        assertEquals("en", url.queryParameter("hl"))
        assertEquals(setOf("search_query", "hl"), url.queryParameterNames)
        assertEquals("x".repeat(200), CityPop.searchUrl("x".repeat(200)).queryParameter("search_query"))
        listOf("", " a ", "x".repeat(201)).forEach { fails { CityPop.searchUrl(it) } }
    }
    @Test fun desktopSavedSearchWireFormatParsesAndRoundTrips() {
        val desktop = """[{"id":"youtube-abcdefghijk","title":"Song","artist":"Artist Official","year":null,"videoId":"abcdefghijk","channel":"Artist Official","moods":[],"note":"YouTube search result","sourceUrl":"https://www.youtube.com/watch?v=abcdefghijk"}]"""
        val saved = CityPop.parseSavedTracks(desktop)
        assertEquals(1, saved.size)
        assertEquals(saved, CityPop.parseSavedTracks(CityPop.serializeSavedTracks(saved)))
        assertEquals(saved, CityPop.parseSavedTracks(JSONArray(desktop).put(JSONArray(desktop).get(0)).toString()))
        assertTrue(CityPop.parseSavedTracks(desktop.replace("https://www.youtube.com/watch?v=abcdefghijk", "https://evil.test")).isEmpty())
        assertTrue(CityPop.parseSavedTracks(desktop.replace("\"year\":null", "\"year\":1983")).isEmpty())
    }
}
