package com.sanjay.anitrack.next.data.manga.toonkotsu

import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

/** Same catalogue fixtures and edge cases as tests/toonkotsu.test.mjs. */
class ToonkotsuParserTest {
    private fun fixture() = JSONObject(javaClass.classLoader!!.getResource("toonkotsu/catalogue.json")!!.readText())
    @Test fun metadataConfirmsTheTrackerIdAndExpectedSeries() {
        val value = fixture()
        val d = ToonkotsuParser.detail(value, "ktm04-one-piece")!!
        assertEquals(30013,d.anilistId); assertEquals(13,d.malId); assertEquals("One Piece",d.title)
        assertNull(ToonkotsuParser.detail(value,"abcde-other"))
        value.getJSONObject("series").put("trackers",JSONObject()).put("externalIds",JSONObject())
        assertNull(ToonkotsuParser.detail(value,"ktm04-one-piece")!!.anilistId)
    }
    @Test fun searchPreservesValidRefsAndRemovesDuplicates() {
        assertEquals(listOf("ktm04-one-piece","pwaij-one-piece-aces-story"),ToonkotsuParser.search(JSONObject("""{"items":[{"hid":"ktm04","slug":"one-piece"},{"hid":"ktm04","slug":"one-piece"},{"hid":"../bad","slug":"escape"},{"hid":"pwaij","slug":"one-piece-aces-story"}]}""")))
    }
    @Test fun alternateUploadsInheritNumbersButKeepTheirOwnMetadata() {
        val chapters = ToonkotsuParser.chapters(fixture())
        assertEquals(8,chapters.size)
        val official = chapters.first { it.id == "4706277" }
        assertEquals(1196f,official.number);assertEquals("Official",official.group);assertEquals(16,official.pageCount);assertEquals(1792169980000L,official.uploadedAt)
        assertEquals(17,chapters.first().pageCount)
    }
    @Test fun fractionsVolumesAndInvalidCounts() {
        val c=ToonkotsuParser.chapters(JSONObject("""{"chapters":[{"id":1,"n":3.5,"label":"Chapter 3.5 [Group]","pages":12,"at":123},{"id":2,"n":null,"label":"Volume 1"},{"id":3,"n":4,"pages":501},{"id":"../bad","n":5}]}"""))
        assertEquals(2,c.size);assertEquals(3.5f,c[0].number);assertEquals("Group",c[0].group);assertNull(c[1].pageCount)
        val oversized=JSONArray();repeat(ToonkotsuParser.MAX_CHAPTERS+1){oversized.put(JSONObject().put("id",it+1).put("n",it))}
        assertThrows(IllegalStateException::class.java) { ToonkotsuParser.chapters(JSONObject().put("chapters",oversized)) }
        assertThrows(IllegalStateException::class.java) { ToonkotsuParser.chapters(JSONObject("""{"chapters":[{"id":1,"n":1,"alts":{}}]}""")) }
    }
    @Test fun pageHandlesStayOnTheSelectedReaderAndHost() {
        val url=ToonkotsuParser.pageUrl("ktm04-one-piece",ToonkotsuParser.chapters(fixture()).first(),17)
        assertEquals(ToonkotsuParser.PageRef("ktm04-one-piece","4675553",17),ToonkotsuParser.pageRef(url))
        for(bad in listOf(url.replace("https:","http:"),url.replace("toonkotsu.com","toonkotsu.com.evil.test"),"$url?token=1","$url#x",url.replace("/17","/501"),url.replace("https://","https://user@"))) assertNull(ToonkotsuParser.pageRef(bad))
    }
}
