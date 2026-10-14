package com.sanjay.anitrack.next.data

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class ThemeSongsTest {
    private val frieren = Anime(
        id = 154587, malId = null, title = "Frieren", titleRomaji = null, cover = null, banner = null,
        episodes = 28, status = "FINISHED", format = "TV", year = 2023, score = 91, synopsis = null, genres = emptyList(),
    )

    // Trimmed from api.animethemes.moe (filter[external_id]=154587).
    private val themes = JSONArray(
        """[
          {"type":"ED","sequence":1,"slug":"ED1","song":{"title":"Anytime Anywhere","artists":[{"name":"milet"}]},
           "animethemeentries":[{"episodes":"1-14, 16","spoiler":false,"nsfw":false,"videos":[
             {"link":"https://v.animethemes.moe/SousouNoFrieren-ED1.webm","nc":false,"overlap":"None","resolution":720,
              "audio":{"link":"https://a.animethemes.moe/SousouNoFrieren-ED1.ogg"}}]}]},
          {"type":"OP","sequence":1,"slug":"OP1","song":{"title":"Yuusha","artists":[{"name":"YOASOBI"}]},
           "animethemeentries":[{"episodes":"1-16","spoiler":false,"nsfw":false,"videos":[
             {"link":"https://v.animethemes.moe/SousouNoFrieren-OP1.webm","nc":false,"overlap":"None","resolution":720,
              "audio":{"link":"https://a.animethemes.moe/SousouNoFrieren-OP1-NCBD1080.ogg"}},
             {"link":"https://v.animethemes.moe/SousouNoFrieren-OP1-NCBD1080.webm","nc":true,"overlap":"None","resolution":1080,
              "audio":{"link":"https://a.animethemes.moe/SousouNoFrieren-OP1-NCBD1080.ogg"}}]}]},
          {"type":"OP","sequence":2,"slug":"OP2","song":null,
           "animethemeentries":[{"episodes":"17-28","videos":[
             {"link":"https://evil.example/OP2.webm","audio":{"link":"https://evil.example/OP2.ogg"}}]}]},
          {"type":"IN","slug":"IN1","animethemeentries":[]}
        ]""",
    )

    @Test fun parsesOpeningsFirstWithCreditlessVideo() {
        val songs = AnimeThemes.parseThemes(frieren, themes)
        assertEquals(listOf("OP1", "ED1"), songs.map { it.slug })
        val op = songs.first()
        assertEquals("Yuusha", op.title)
        assertEquals(listOf("YOASOBI"), op.artists)
        assertEquals("1-16", op.episodes)
        assertEquals("https://v.animethemes.moe/SousouNoFrieren-OP1-NCBD1080.webm", op.videoUrl)
        assertEquals("https://a.animethemes.moe/SousouNoFrieren-OP1-NCBD1080.ogg", op.audioUrl)
        assertTrue(op.isOpening)
        assertFalse(songs[1].isOpening)
    }

    @Test fun ignoresMediaOutsideAnimeThemesHosts() {
        // OP2 only links another host, so it has nothing playable and is left out.
        assertNull(AnimeThemes.parseThemes(frieren, themes).firstOrNull { it.slug == "OP2" })
    }

    private fun song(anime: Int, slug: String) = ThemeSong(
        animeId = anime, animeTitle = "Show $anime", cover = null, slug = slug, type = slug.take(2),
        title = slug, artists = emptyList(), episodes = null, spoiler = false, nsfw = false,
        audioUrl = "https://a.animethemes.moe/$anime-$slug.ogg", videoUrl = null,
    )

    @Test fun radioCapsLongShowsAndAvoidsBackToBackRepeats() {
        val onePiece = (1..30).map { song(21, "OP$it") }
        val others = listOf(song(1, "OP1"), song(1, "ED1"), song(5114, "OP1"), song(5114, "OP2"), song(20, "OP1"))
        for (seed in 1..200) {
            val mix = ThemeRadio.mix(onePiece + others, Random(seed))
            assertEquals(4, mix.count { it.animeId == 21 })
            assertEquals(9, mix.size)
            // A repeat-free order exists, so the same show never plays twice in a row.
            assertTrue("seed $seed", mix.zipWithNext().none { (a, b) -> a.animeId == b.animeId })
        }
    }
}
