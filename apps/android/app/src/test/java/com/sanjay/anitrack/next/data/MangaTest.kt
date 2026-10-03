package com.sanjay.anitrack.next.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MangaTest {
    private fun media(extra: String) = JSONObject(
        """{"id": 30013, "idMal": null, "title": {"romaji": "One Piece", "english": null},
            "coverImage": {"large": "https://example.test/c.jpg"}, "bannerImage": null,
            "chapters": null, "volumes": 108, "status": "RELEASING", "startDate": {"year": 1997},
            "averageScore": 92, "popularity": 500000, "genres": ["Action", "Adventure"],
            "description": "Gol D. Roger<br>was known", $extra}""",
    )

    @Test fun parsesAniListMangaFieldsAndNulls() {
        val manga = Manga.fromMedia(media(""""format": "MANGA", "countryOfOrigin": "JP""""))
        assertEquals("One Piece", manga.title)
        assertNull(manga.malId)
        assertNull(manga.chapters)
        assertNull(manga.banner)
        assertEquals(108, manga.volumes)
        assertEquals(1997, manga.year)
        assertEquals("Gol D. Rogerwas known", manga.synopsis)
        assertEquals(listOf("Action", "Adventure"), manga.genres)
        assertEquals("Manga", manga.kind)
    }

    @Test fun decodesEntitiesInDescriptions() {
        assertEquals("<Twilight> & \"Yor\"", cleanDescription("&lt;Twilight&gt; &amp; &quot;Yor&quot;<br>"))
        assertNull(cleanDescription("<br>"))
    }

    @Test fun labelsComicsByCountryAndFormat() {
        assertEquals("Manhwa", Manga.fromMedia(media(""""format": "MANGA", "countryOfOrigin": "KR"""")).kind)
        assertEquals("Manhua", Manga.fromMedia(media(""""format": "MANGA", "countryOfOrigin": "CN"""")).kind)
        assertEquals("One-shot", Manga.fromMedia(media(""""format": "ONE_SHOT", "countryOfOrigin": "JP"""")).kind)
        assertEquals("Light novel", Manga.fromMedia(media(""""format": "NOVEL", "countryOfOrigin": "JP"""")).kind)
    }
}
