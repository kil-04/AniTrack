package com.sanjay.anitrack.next.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same cases as tests/anisongs.test.mjs (shapes from anisongdb.com/api, 20 Oct 2026). */
class AniSongsTest {
    private fun row(vararg over: Pair<String, Any?>): JSONObject = JSONObject(
        """{"annId":13,"annSongId":25,"animeENName":"Cowboy Bebop","animeJPName":"Cowboy Bebop","animeVintage":"Spring 1998","animeType":"TV",
        "linked_ids":{"myanimelist":1,"anidb":23,"anilist":1,"kitsu":1},"songType":"Opening 1","songName":"Tank!",
        "songArtist":"Seatbelts","songDifficulty":85.0,"songCategory":"Standard","isDub":false,"isRebroadcast":false,
        "HQ":"byvisp.webm","MQ":null,"audio":"je3987.mp3"}""",
    ).apply { over.forEach { (k, v) -> put(k, v ?: JSONObject.NULL) } }

    @Test fun rowsBecomeSongs() {
        val songs = AniSongs.parseSongs(JSONArray(listOf(
            row(),
            row("annSongId" to 26, "songType" to "Ending 1", "songName" to "THE REAL FOLK BLUES", "songArtist" to "Mai Yamane",
                "songDifficulty" to 44, "HQ" to null, "MQ" to "ffr7rh.webm"),
            row("annSongId" to 27, "songType" to "Insert Song", "songName" to "Rush"),
            row("annSongId" to 28, "isDub" to true),
            row("annSongId" to 29, "HQ" to "../evil.webm", "MQ" to null, "audio" to null),
            row(),
        )))
        assertEquals(2, songs.size)
        assertEquals(
            AniSong(25, 1, 1, "Cowboy Bebop", "Cowboy Bebop", "Spring 1998", 1998, "TV", "OP", 1, "Tank!", "Seatbelts", 85.0,
                "byvisp.webm", "720p", "je3987.mp3"),
            songs[0],
        )
        assertEquals("ED", songs[1].kind)
        assertEquals("480p", songs[1].quality)
        assertEquals("https://naedist.animemusicquiz.com/byvisp.webm", AniSongs.videoUrl(songs[0]))
    }

    @Test fun chartsRankOncePerSongUnderTheOriginalShow() {
        val songs = AniSongs.parseSongs(JSONArray(listOf(
            row("annSongId" to 1, "songName" to "crossing field", "songArtist" to "LiSA", "animeENName" to "Sword Art Online", "animeVintage" to "Summer 2012", "songDifficulty" to 80),
            row("annSongId" to 2, "songName" to "crossing field", "songArtist" to "LiSA", "animeENName" to "Sword Art Online: Extra Edition", "animeVintage" to "Winter 2014", "songDifficulty" to 88, "songType" to "Opening"),
            row("annSongId" to 3, "songName" to "Tank!", "songDifficulty" to 85),
            row("annSongId" to 4, "songName" to "Quiet", "songDifficulty" to 10, "songType" to "Ending 2"),
            row("annSongId" to 5, "songName" to "Unknown", "songDifficulty" to null),
            row("annSongId" to 6, "songName" to "Audio only", "songDifficulty" to 99, "HQ" to null, "MQ" to null),
        )))
        assertEquals(
            listOf(Triple("crossing field", "Sword Art Online", 88.0), Triple("Tank!", "Cowboy Bebop", 85.0)),
            AniSongs.rank(songs, "OP").map { Triple(it.title, it.anime, it.recognition) },
        )
        assertEquals(listOf("Quiet"), AniSongs.rank(songs, "ED").map { it.title })
        assertEquals(1, AniSongs.rank(songs, null, 1).size)
        // Same year: the TV series, not its film, is the song's original show.
        val tie = AniSongs.parseSongs(JSONArray(listOf(
            row("annSongId" to 10, "songName" to "CHA-LA HEAD-CHA-LA", "songArtist" to "Hironobu Kageyama", "animeENName" to "Dragon Ball Z: Dead Zone", "animeType" to "Movie", "animeVintage" to "Summer 1989", "songDifficulty" to 86),
            row("annSongId" to 11, "songName" to "CHA-LA HEAD-CHA-LA", "songArtist" to "Hironobu Kageyama", "animeENName" to "Dragon Ball Z", "animeType" to "TV", "animeVintage" to "Spring 1989", "songDifficulty" to 84),
        )))
        assertEquals(listOf("Dragon Ball Z" to 86.0), AniSongs.rank(tie).map { it.anime to it.recognition })
        // A show's versions of one song count once.
        val versions = AniSongs.parseSongs(JSONArray(listOf(
            row("annSongId" to 20, "songType" to "Ending 1", "songName" to "FLY ME TO THE MOON <YOKO TAKAHASHI Version>", "songArtist" to "Yoko Takahashi", "animeENName" to "Neon Genesis Evangelion", "animeVintage" to "Fall 1995", "songDifficulty" to 87, "linked_ids" to JSONObject().put("anilist", 30)),
            row("annSongId" to 21, "songType" to "Ending 1", "songName" to "FLY ME TO THE MOON <Rei (#5) Remix Version>", "songArtist" to "Megumi Hayashibara", "animeENName" to "Neon Genesis Evangelion", "animeVintage" to "Fall 1995", "songDifficulty" to 87, "linked_ids" to JSONObject().put("anilist", 30)),
        )))
        assertEquals(1, AniSongs.rank(versions, "ED").size)
        assertEquals("crossing field", AniSongs.baseTitle("crossing field ~TV ver.~"))
        assertEquals("ora wa ninkimono", AniSongs.baseTitle("Ora wa Ninkimono 25thMIX"))
        assertEquals("remix", AniSongs.baseTitle("Remix"))
    }

    @Test fun bestRanksListeningAndDropsKidsSongs() {
        val (sara, doraemon, unknown) = AniSongs.parseSongs(JSONArray(listOf(
            row("annSongId" to 30, "songName" to "SARA", "songArtist" to "Fence of Defense", "animeENName" to "City Hunter 2", "animeVintage" to "Spring 1988", "songDifficulty" to 27),
            row("annSongId" to 31, "songName" to "Doraemon no Uta", "songArtist" to "Kumiko Osugi", "animeENName" to "Doraemon", "animeVintage" to "Spring 1979", "songDifficulty" to 85),
            row("annSongId" to 32, "songName" to "Obscure", "songArtist" to "Nobody", "animeENName" to "Rare Show", "animeVintage" to "Fall 1987", "songDifficulty" to 40),
        )))
        val songs = listOf(sara.copy(listeners = 2858), doraemon.copy(listeners = 27, kids = true), unknown)
        assertEquals(65.6, AniSongs.bestScore(songs[0])!!, 0.2)
        assertTrue(AniSongs.bestScore(songs[1])!! < 20)
        assertEquals(20.0, AniSongs.bestScore(unknown)!!, 0.001)
        assertEquals(listOf("SARA", "Obscure", "Doraemon no Uta"), AniSongs.rank(songs, "OP", 10, Int.MAX_VALUE, "best").map { it.title })
        assertEquals(listOf("Doraemon no Uta", "Obscure", "SARA"), AniSongs.rank(songs, "OP", 10, Int.MAX_VALUE, "known").map { it.title })
        // A licensed import's worldwide listeners don't count: it scores on its quiz recognition.
        val alone = unknown.copy(id = 33, title = "Alone Again", listeners = 539769, licensed = true, recognition = 29.0)
        assertEquals(14.5, AniSongs.bestScore(alone)!!, 0.001)
        assertEquals("SARA", AniSongs.rank(listOf(songs[0], alone), "OP", 10, Int.MAX_VALUE, "best")[0].title)
        // YouTube views share the scale (about 3,000 views a listener); whichever says more counts.
        assertEquals(64.9, AniSongs.bestScore(sara.copy(views = 7_800_000))!!, 0.2)
        assertEquals(99.8, AniSongs.bestScore(sara.copy(views = 7_800_000, listeners = 180_000))!!, 0.3)
        assertEquals(15.0, AniSongs.bestScore(sara.copy(views = 900_000_000, licensed = true, recognition = 30.0))!!, 0.001)
    }

    @Test fun playerShapeKeepsOnlyAnisongdbHosts() {
        val theme = AniSongs.toThemeSong(AniSongs.parseSongs(JSONArray(listOf(row())))[0])
        assertEquals("OP1", theme.slug)
        assertEquals("https://naedist.animemusicquiz.com/je3987.mp3", theme.audioUrl)
        assertTrue(AniSongs.isSongMedia(theme.videoUrl))
        assertTrue(AniSongs.isSongMedia("https://files.catbox.moe/byvisp.webm"))
        assertFalse(AniSongs.isSongMedia("http://naedist.animemusicquiz.com/byvisp.webm"))
        assertFalse(AniSongs.isSongMedia("https://evil.example/byvisp.webm"))
        assertFalse(AniSongs.isSongMedia("https://naedist.animemusicquiz.com/a/b.webm"))
    }

    @Test fun seasonsSearchBodiesAndChartFiles() {
        assertEquals("Fall" to 2026, AniSongs.seasonOf(1792454400000L)) // 20 Oct 2026
        assertEquals("Fall" to 2025, AniSongs.previousSeason("Winter", 2026))
        val body = AniSongs.searchBody("  LiSA ", "artist")
        assertEquals("LiSA", body.getJSONObject("artist_search_filter").getString("search"))
        assertFalse(body.has("anime_search_filter"))
        assertFalse(body.getBoolean("insert_filter"))
        val song = row().apply { put("id", 25); put("kind", "OP"); put("title", "Tank!"); put("anime", "Cowboy Bebop"); put("video", "byvisp.webm"); put("cover", "https://s4.anilist.co/x.jpg"); put("listeners", 34135) }
        val bad = JSONObject(song.toString()).put("id", 2).put("video", "../x")
        fun ids(vararg v: Int) = JSONArray(v.toList())
        val charts = AniSongs.parseCharts(JSONObject().put("generatedAt", "2026-10-20T00:00:00Z")
            .put("songs", JSONArray(listOf(song, bad)))
            .put("decades", JSONObject().put("1990", JSONObject()
                .put("best", JSONObject().put("OP", ids(25, 2, 999)).put("ED", JSONArray()))
                .put("known", JSONObject().put("OP", ids(25)))))
            .put("years", JSONObject().put("1998", JSONObject().put("best", JSONObject().put("OP", ids(25))))
                .put("1850", JSONObject().put("best", JSONObject().put("OP", ids(25)))).put("x", JSONObject()))
            .put("allTime", JSONObject().put("known", JSONObject().put("OP", ids(25)))))
        assertEquals(setOf(1998), charts.years.keys)
        assertEquals("Tank!", charts.years[1998]!!["best"]!!["OP"]!![0].title)
        assertEquals(1, charts.decades[1990]!!["best"]!!["OP"]!!.size)
        assertEquals("https://s4.anilist.co/x.jpg", charts.decades[1990]!!["best"]!!["OP"]!![0].cover)
        assertEquals(34135L, charts.decades[1990]!!["best"]!!["OP"]!![0].listeners)
        assertTrue(charts.decades[1970]!!["known"]!!["OP"]!!.isEmpty())
        assertTrue(charts.allTime["known"]!!["ED"]!!.isEmpty())
        assertNull(AniSongs.parseSong(null))
    }

    @Test fun titlePagesFillAnimeThemesGapsWithClips() {
        val clips = AniSongs.parseSongs(JSONArray(listOf(
            row("annSongId" to 50, "songType" to "Opening 1", "songName" to "Tank!", "HQ" to "aaaaaa.webm"),
            row("annSongId" to 51, "songType" to "Ending 2", "songName" to "Blue", "HQ" to "bbbbbb.webm", "audio" to "cccccc.mp3"),
        )))
        fun theme(slug: String, video: String?) = ThemeSong(1, "Cowboy Bebop", null, slug, slug.take(2), slug, emptyList(), null, false, false, "https://a.animethemes.moe/x.ogg", video)
        val merged = AniSongs.withClips(listOf(theme("OP1", "https://v.animethemes.moe/x.webm"), theme("ED2-TV", null), theme("ED3", null)), clips)
        assertEquals("https://v.animethemes.moe/x.webm", merged[0].videoUrl)
        assertEquals("https://naedist.animemusicquiz.com/bbbbbb.webm", merged[1].videoUrl)
        assertNull(merged[2].videoUrl)
        assertEquals(listOf("OP1", "ED2"), AniSongs.withClips(emptyList(), clips).map { it.slug })
        // Songs AnimeThemes doesn't list come after its own.
        assertEquals(listOf("OP1", "ED2"), AniSongs.withClips(listOf(theme("OP1", "https://v.animethemes.moe/x.webm")), clips).map { it.slug })
    }
}
