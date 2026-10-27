package com.sanjay.anitrack.next.data

import org.junit.Assert.*
import org.junit.Test

/** The same numbers as tests/city-pop-scene.test.mjs: both apps draw the very same banner. */
class CityPopSceneTest {
    @Test fun samePictureAsDesktop() {
        assertEquals(2462723854L, CityPopScene.hash(0))
        assertEquals(4067997445L, CityPopScene.hash(12345))
        assertEquals(1860387395L, CityPopScene.checksum(CityPopScene.scene(160, 60, horizon = 680, sunX = 720, sun = 170)))
        assertEquals(1129678847L, CityPopScene.checksum(CityPopScene.scene(116, 173, horizon = 870, sunX = 640, sun = 330)))
    }

    @Test fun staysInsideItsGrid() {
        for ((w, h) in listOf(16 to 12, 40 to 20, 387 to 37, 387 to 102, 116 to 173, 700 to 60)) {
            val pixels = CityPopScene.scene(w, h, horizon = 700, sunX = 720, sun = 170)
            assertTrue("$w x $h draws a scene", pixels.size > 50)
            for (p in pixels) {
                assertTrue(p.w > 0 && p.h > 0)
                assertTrue(Regex("^#[0-9a-f]{6}$").matches(p.color))
                assertTrue("$w x $h: $p stays on the grid", p.x >= 0 && p.y >= 0 && p.x + p.w <= w && p.y + p.h <= h)
            }
            assertEquals(CityPopScene.SKY[0], pixels[0].color)
            assertTrue(pixels.any { it.color in CityPopScene.SUN })
        }
    }

    @Test fun stationIconsAreNineByNine() {
        assertEquals(setOf("night-drive", "sunset", "after-hours"), CityPopScene.ICONS.keys)
        for (sprite in CityPopScene.ICONS.values) {
            assertEquals(9, sprite.size)
            sprite.forEach { assertTrue(Regex("^[.#]{9}$").matches(it)) }
        }
    }
}
