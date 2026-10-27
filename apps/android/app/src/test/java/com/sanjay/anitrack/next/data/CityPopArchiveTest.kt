package com.sanjay.anitrack.next.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CityPopArchiveTest {
    private val escapedScope = """
        title:("Miki" AND "\"" AND "OR" AND "mediatype:texts" AND "\\" AND "Stay") OR creator:("Miki" AND "\"" AND "OR" AND "mediatype:texts" AND "\\" AND "Stay") OR subject:"Miki \" OR mediatype:texts \\ Stay"
    """.trimIndent()
    private fun file(name: String, vararg fields: Pair<String, Any>) = JSONObject().put("name", name).put("source", "original").put("size", "1000").apply { fields.forEach { put(it.first, it.second) } }
    private fun album(files: List<JSONObject>, vararg fields: Pair<String, Any>): String = JSONObject().put("metadata", JSONObject().put("identifier", "test-album").put("mediatype", "audio").put("title", "Album").put("creator", "Artist").apply { fields.forEach { put(it.first, it.second) } }).put("files", JSONArray(files)).toString()
    @Test fun searchQuotesLiteralAndLimitsMediaTypes() {
        assertTrue(CityPopArchive.query("").contains("title:\"city pop\""))
        assertEquals("mediatype:(audio OR movies) AND ($escapedScope)", CityPopArchive.query("Miki \" OR mediatype:texts \\ Stay"))
    }
    @Test fun searchMediaFiltersRetainDefaultGenreAndLiteralArtistScope() {
        val genre = "(title:\"city pop\" OR subject:\"city pop\" OR title:citypop OR subject:citypop)"
        assertEquals("mediatype:(audio OR movies) AND ($genre)", CityPopArchive.query("", CityPopArchiveMediaFilter.ALL))
        assertEquals("mediatype:audio AND ($genre)", CityPopArchive.query("", CityPopArchiveMediaFilter.AUDIO))
        assertEquals("mediatype:movies AND ($genre)", CityPopArchive.query("", CityPopArchiveMediaFilter.VIDEO))
        assertEquals("""mediatype:movies AND (title:("Miki" AND "Matsubara") OR creator:("Miki" AND "Matsubara") OR subject:"Miki Matsubara")""", CityPopArchive.query(" Miki Matsubara ", CityPopArchiveMediaFilter.VIDEO))
        assertEquals("mediatype:audio AND ($escapedScope)", CityPopArchive.query("Miki \" OR mediatype:texts \\ Stay", CityPopArchiveMediaFilter.AUDIO))
        assertEquals("mediatype:movies AND ($escapedScope)", CityPopArchive.query("Miki \" OR mediatype:texts \\ Stay", CityPopArchiveMediaFilter.VIDEO))
    }
    @Test fun searchCombinesSongAndArtistWordsWithoutRequiringAnExactPhrase() {
        assertEquals("""mediatype:movies AND (title:("Mariya" AND "Takeuchi" AND "Plastic" AND "Love") OR creator:("Mariya" AND "Takeuchi" AND "Plastic" AND "Love") OR subject:"Mariya Takeuchi   Plastic Love")""", CityPopArchive.query("  Mariya\nTakeuchi   Plastic\tLove ", CityPopArchiveMediaFilter.VIDEO))
        assertEquals("""mediatype:movies AND (title:("竹内まりや" AND "プラスティック・ラブ") OR creator:("竹内まりや" AND "プラスティック・ラブ") OR subject:"竹内まりや プラスティック・ラブ")""", CityPopArchive.query("竹内まりや プラスティック・ラブ", CityPopArchiveMediaFilter.VIDEO))
    }
    @Test fun searchNormalizesArraysYearsAndDuplicateItems() {
        val docs = JSONArray().put(JSONObject().put("identifier", "audio-item").put("title", JSONArray(listOf("First", "Second"))).put("creator", JSONArray(listOf("Singer", "Band"))).put("mediatype", "audio").put("year", 1983))
            .put(JSONObject().put("identifier", "video-item").put("title", "Live").put("mediatype", "movies").put("date", "1980-05-01"))
            .put(JSONObject().put("identifier", "audio-item").put("mediatype", "audio"))
            .put(JSONObject().put("identifier", "restricted").put("mediatype", "audio").put("access-restricted-item", "true"))
            .put(JSONObject().put("identifier", "../bad").put("mediatype", "audio"))
        val found = CityPopArchive.parseSearch(JSONObject().put("response", JSONObject().put("numFound", 100).put("docs", docs)).toString(), 2)
        assertEquals(100, found.total); assertEquals(2, found.page)
        assertEquals(listOf("audio-item", "video-item"), found.items.map { it.id })
        assertEquals("First; Second", found.items[0].title); assertEquals("Singer; Band", found.items[0].creator)
        assertEquals(1983, found.items[0].year); assertEquals(1980, found.items[1].year)
        assertEquals("Unknown artist", found.items[1].creator)
    }
    private fun unavailable(message: String, block: () -> Unit) {
        try { block(); fail("An error answer must not become an empty result") }
        catch (e: IllegalStateException) { assertEquals(message, e.message) }
    }
    @Test fun anErrorAnswerIsArchiveBeingUnavailableNeverAnEmptySearch() {
        listOf("null", "<html>Maintenance</html>", "[]", "{}", """{"error":"Search engine down"}""",
            """{"responseHeader":{"status":500},"response":{"numFound":0,"docs":[]}}""", """{"responseHeader":{"status":"0"},"response":{"docs":[]}}""",
            """{"response":{"docs":[]},"error":null}""").forEach { answer -> unavailable(CityPopArchive.SEARCH_UNAVAILABLE) { CityPopArchive.parseSearch(answer) } }
        // A real answer with no documents is an honest "nothing found".
        assertEquals(CityPopArchiveSearch(emptyList(), 0, 3), CityPopArchive.parseSearch("""{"responseHeader":{"status":0},"response":{"numFound":0,"docs":[]}}""", 3))
    }
    @Test fun anErrorAnswerOrAnItemWithoutItsFileListIsUnavailableNotEmpty() {
        val metadata = JSONObject(album(emptyList())).getJSONObject("metadata")
        listOf("null", "<html>Maintenance</html>", "[]", """{"error":"Item storage offline"}""", JSONObject(album(listOf(file("song.mp3")))).put("error", "Temporary").toString(),
            JSONObject().put("metadata", metadata).toString()).forEach { answer -> unavailable(CityPopArchive.ITEM_UNAVAILABLE) { CityPopArchive.parseMetadata(answer, "test-album") } }
        // An item that no longer exists has nothing to play; a dark one without files is simply not playable.
        assertTrue(CityPopArchive.parseMetadata("{}", "test-album").isEmpty())
        assertTrue(CityPopArchive.parseMetadata(JSONObject().put("is_dark", true).put("metadata", metadata).toString(), "test-album").isEmpty())
    }
    @Test fun searchMediaFiltersIgnoreMismatchedItems() {
        val mixed = """{"response":{"numFound":2,"docs":[{"identifier":"audio-item","title":"Album","mediatype":"audio"},{"identifier":"video-item","title":"Live","mediatype":"movies"}]}}"""
        assertEquals(listOf("audio-item", "video-item"), CityPopArchive.parseSearch(mixed).items.map { it.id })
        assertEquals(listOf("audio-item"), CityPopArchive.parseSearch(mixed, 1, CityPopArchiveMediaFilter.AUDIO).items.map { it.id })
        assertEquals(listOf("video-item"), CityPopArchive.parseSearch(mixed, 1, CityPopArchiveMediaFilter.VIDEO).items.map { it.id })
    }
    @Test fun fileUrlsRejectTraversalAndPreserveEncodedNames() {
        assertEquals("https://archive.org/download/safe-item/disc%201/01%20-%20%E6%9B%B2.mp3", CityPopArchive.trackUrl("safe-item", "disc 1/01 - 曲.mp3"))
        listOf("", ".", "..", "a/b", "https://evil.test", "item\n", "a".repeat(101)).forEach { assertFalse(CityPopArchive.validId(it)) }
        listOf("", "/song.mp3", "song.mp3/", "../song.mp3", "disc/../../song.mp3", "disc/./song.mp3", "disc//song.mp3", "disc\\song.mp3", "song\n.mp3").forEach { assertFalse(CityPopArchive.validFile(it)) }
        assertEquals("https://archive.org/download/safe-item/%252e%252e/song.mp3", CityPopArchive.trackUrl("safe-item", "%2e%2e/song.mp3"))
    }
    @Test fun prefersMp3DerivativesAndRetainsNumberedAlbumOrder() {
        val tracks = CityPopArchive.parseMetadata(album(listOf(
            file("02 - MUSIC BOOK.flac", "title" to "MUSIC BOOK", "track" to "2"),
            file("02 - MUSIC BOOK.mp3", "original" to "02 - MUSIC BOOK.flac", "track" to "2", "size" to "7558556"),
            file("01 - SPARKLE.flac", "title" to "SPARKLE", "artist" to "山下達郎", "track" to "1/16"),
            file("01 - SPARKLE.mp3", "original" to "01 - SPARKLE.flac", "track" to "1", "size" to "6152644"),
            file("02 - MUSIC BOOK.ogg", "original" to "02 - MUSIC BOOK.mp3", "track" to "2"), file("cover.jpg"), file("subtitles.srt")
        )), "test-album")
        assertEquals(listOf("01 - SPARKLE.mp3", "02 - MUSIC BOOK.mp3"), tracks.map { it.fileName })
        assertEquals(6152644L, tracks[0].size); assertEquals("山下達郎", tracks[0].artist)
        assertEquals("https://archive.org/download/test-album/01%20-%20SPARKLE.mp3", tracks[0].url)
    }
    @Test fun prefersBrowserMp4AndKeepsUnnumberedSourceOrder() {
        val tracks = CityPopArchive.parseMetadata(album(listOf(
            file("concert.mp4", "title" to "Concert"), file("concert.ia.mp4", "original" to "concert.mp4"), file("concert.webm", "original" to "concert.mp4"),
            file("side-b.wav", "track" to "1", "size" to "not-known"), file("side-a.m4a", "track" to "2")
        ), "mediatype" to "movies", "creator" to JSONArray(listOf("Singer", "Band"))), "test-album")
        assertEquals(listOf("concert.ia.mp4", "side-b.wav", "side-a.m4a"), tracks.map { it.fileName })
        assertEquals("video", tracks[0].mediaType); assertEquals("Singer; Band", tracks[0].artist); assertNull(tracks[1].size)
        val discs = CityPopArchive.parseMetadata(album(listOf(file("disc2.mp3", "track" to "1", "disc" to "2/2"), file("disc1.mp3", "track" to "1", "disc" to "1/2"))), "test-album")
        assertEquals("disc1.mp3", discs[0].fileName)
    }
    @Test fun restrictedItemsAndDerivativesNeverBecomeTracks() {
        listOf("is_dark", "access-restricted-item", "access_restricted", "private", "restricted").forEach { key ->
            assertTrue(CityPopArchive.parseMetadata(album(listOf(file("song.mp3")), key to "true"), "test-album").isEmpty())
            assertTrue(CityPopArchive.parseMetadata(album(listOf(file("song.mp3", key to 1))), "test-album").isEmpty())
            assertTrue(CityPopArchive.parseMetadata(JSONObject(album(listOf(file("song.mp3")))).put(key, true).toString(), "test-album").isEmpty())
        }
        assertTrue(CityPopArchive.parseMetadata(album(listOf(file("private.flac", "private" to "true"), file("private.mp3", "original" to "private.flac"), file("../song.mp3"), file("zero.mp3", "size" to "0"), file("script.mp3.exe"))), "test-album").isEmpty())
        assertTrue(CityPopArchive.parseMetadata(album(listOf(file("song.mp3"))), "wrong-id").isEmpty())
        assertTrue(CityPopArchive.parseMetadata(album(listOf(file("song.mp3")), "mediatype" to "texts"), "test-album").isEmpty())
    }
    @Test fun parserBoundsFilesAndResults() {
        assertEquals(500, CityPopArchive.parseMetadata(album((0 until 5500).map { file("song-$it.mp3") }), "test-album").size)
    }
}
