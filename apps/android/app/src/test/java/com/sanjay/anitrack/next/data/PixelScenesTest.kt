package com.sanjay.anitrack.next.data

import org.junit.Assert.*
import org.junit.Test

/** The same numbers as tests/pixel-scenes.test.mjs: both apps draw the very same banners. */
class PixelScenesTest {
    private val checksums = mapOf(
        "sunset" to (3983455783L to 689284172L),
        "neon-city" to (890333625L to 2150705285L),
        "fuji" to (2693223344L to 596089318L),
        "sakura" to (2132904203L to 2822175471L),
        "shinkansen" to (3785893167L to 249138501L),
        "starlight" to (364579144L to 3853267797L),
        "library" to (3923208247L to 3367147208L),
        "ramen-stand" to (2833917191L to 368533171L),
        "arcade" to (1756015128L to 688910680L),
        "bedroom" to (3719754049L to 1829028358L),
        "cinema" to (4254042179L to 3318332427L),
        "tower" to (828731159L to 2124205917L),
        "observatory" to (2797300941L to 1714709199L),
        "station" to (1299516121L to 2673488787L),
        "terminal" to (3664655267L to 2610576800L),
        "stage" to (3567191245L to 2104692273L),
        "jukebox" to (3580116438L to 4191282131L),
        "radio" to (2512797039L to 1801240239L),
        "hifi" to (2637510729L to 3016147115L),
        "night-drive" to (1694478858L to 3756449637L),
        "karaoke" to (638356739L to 301354734L),
        "rooftop-band" to (2881704570L to 3775540109L),
        "hologram" to (3336172354L to 1952171754L),
    )

    @Test fun samePicturesAsDesktop() {
        assertEquals(checksums.keys, PixelScenes.IDS.toSet())
        for (id in PixelScenes.IDS) {
            assertEquals("$id at 420 x 64", checksums.getValue(id).first, CityPopScene.checksum(PixelScenes.scene(id, 420, 64)))
            assertEquals("$id at 120 x 44", checksums.getValue(id).second, CityPopScene.checksum(PixelScenes.scene(id, 120, 44)))
        }
    }

    @Test fun everySceneStaysInsideItsGrid() {
        for (id in PixelScenes.IDS) {
            for ((w, h) in listOf(16 to 12, 60 to 30, 120 to 44, 420 to 64, 640 to 120, 90 to 200)) {
                val pixels = PixelScenes.scene(id, w, h)
                assertTrue("$id $w x $h draws a scene", pixels.size > 40)
                for (p in pixels) {
                    assertTrue(p.w > 0 && p.h > 0)
                    assertTrue(Regex("^#[0-9a-f]{6}$").matches(p.color))
                    assertTrue("$id $w x $h: $p stays on the grid", p.x >= 0 && p.y >= 0 && p.x + p.w <= w && p.y + p.h <= h)
                }
            }
        }
    }

    @Test fun wholeSquareRoots() {
        assertEquals(listOf(0, 1, 1, 2, 2, 3, 3, 4, 9999), listOf(0, 1, 3, 4, 8, 9, 15, 16, 99999999).map(PixelScenes::isqrt))
        assertEquals(0, PixelScenes.isqrt(-5))
    }

    @Test fun skylineMatchesDesktop() {
        assertEquals(1058255262L, CityPopScene.checksum(PixelScenes.skyline(420, 30, 0)))
        assertEquals(4145227621L, CityPopScene.checksum(PixelScenes.skyline(420, 30, 1)))
        assertEquals(505561681L, CityPopScene.checksum(PixelScenes.skyline(140, 28, 0)))
        assertEquals(2454633099L, CityPopScene.checksum(PixelScenes.skyline(140, 28, 1)))
        for ((w, h) in listOf(16 to 8, 90 to 20, 700 to 40)) {
            for (frame in 0..1) {
                for (p in PixelScenes.skyline(w, h, frame)) {
                    assertTrue("$w x $h: $p", p.w > 0 && p.h > 0 && p.x >= 0 && p.y >= 0 && p.x + p.w <= w && p.y + p.h <= h)
                }
            }
        }
    }

    /** The same sheet desktop imports, drawn the same way (tests/pixel-scenes.test.mjs pins the same number). */
    @Test fun spriteSheetMatchesDesktop() {
        val file = listOf(java.io.File("../../../packages/catalogs/pixel-sprites.json"), java.io.File("packages/catalogs/pixel-sprites.json")).first { it.exists() }
        val sheet = PixelSprites.parse(file.readText())
        for ((id, rows) in sheet.sprites) {
            assertTrue("$id is 8 to 16 rows", rows.size in 8..16)
            rows.forEach { row -> assertEquals("$id: $row", 16, row.length); row.forEach { assertTrue("$id: $it", it == '.' || it in sheet.palette) } }
        }
        sheet.sections.values.forEach { assertTrue(it, it in sheet.sprites) }
        assertEquals("tv", sheet.forSection("  Continue Watching "))
        assertEquals(null, sheet.forSection("Not a row"))
        assertEquals("gem", sheet.forSection("Hidden gems"))
        assertEquals("star", sheet.forSection("New in the 1980s"))
        val all = sheet.sprites.keys.sorted().flatMap { sheet.rects(it) }
        assertEquals(1831068148L, CityPopScene.checksum(all))
        assertEquals(
            listOf(CityPopPixel(1, 0, 1, 1, "#000001"), CityPopPixel(2, 0, 1, 1, "#000002"), CityPopPixel(0, 1, 2, 1, "#000002")),
            PixelScenes.spriteRects(listOf(".ab", "bb."), mapOf('a' to "#000001", 'b' to "#000002")),
        )
    }

    @Test fun sceneForYearAndSectionPrefixMatchDesktop() {
        assertEquals(
            listOf("shinkansen", "shinkansen", "fuji", "sunset", "arcade", "neon-city", "ramen-stand", "starlight", "starlight"),
            listOf(1960, 1969, 1970, 1985, 1999, 2000, 2015, 2020, 2026).map(PixelScenes::forYear),
        )
        assertEquals(
            listOf("jukebox", "radio", "radio", "hifi", "night-drive", "karaoke", "rooftop-band", "stage", "hologram", "hologram"),
            listOf(null, 1960, 1969, 1970, 1985, 1999, 2000, 2015, 2020, 2026).map(PixelScenes::forSongs),
        )
        val sections = mapOf("top 10" to "trophy", "new in *" to "star")
        assertEquals("trophy", PixelScenes.sectionSprite(sections, " Top 10 "))
        assertEquals("star", PixelScenes.sectionSprite(sections, "New in 2015"))
        assertNull(PixelScenes.sectionSprite(sections, "New"))
        assertNull(PixelScenes.sectionSprite(sections, "Brand new in town"))
    }
}
