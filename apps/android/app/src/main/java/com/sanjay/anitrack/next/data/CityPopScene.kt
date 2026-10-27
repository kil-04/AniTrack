package com.sanjay.anitrack.next.data

import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** One rectangle of art pixels and its colour ("#rrggbb"). */
data class CityPopPixel(val x: Int, val y: Int, val w: Int, val h: Int, val color: String)

/**
 * City Pop's banner: a retrowave sunset in pixel art, as rectangles on a grid of art pixels.
 * Mirrors packages/shared/city-pop-scene.ts line for line, in whole numbers only, so both apps
 * draw the very same picture (the tests on both sides pin the same checksums).
 */
object CityPopScene {
    /** Night at the top to the sunset glow at the horizon. */
    val SKY = listOf("#0b0420", "#150836", "#22094c", "#3a0c5e", "#5e1068", "#8c1a6c", "#c22b6b", "#f04f62", "#ff7f4d")
    /** The sun, top to bottom. */
    val SUN = listOf("#fff27a", "#ffd319", "#ffab2e", "#ff7f3f", "#ff4f5e", "#ff2a7f", "#e81fa0")
    private val SUN_GAPS = listOf(330 to 350, 410 to 440, 490 to 530, 570 to 620, 650 to 710, 730 to 800, 810 to 890)
    private val FRONDS = listOf(intArrayOf(-1, 11, 12, 16), intArrayOf(1, 11, 12, 16), intArrayOf(-1, 8, 16, 10), intArrayOf(1, 8, 16, 12), intArrayOf(-1, 5, 18, 4), intArrayOf(1, 5, 18, 6))
    private const val GROUND = "#0d0221"
    private const val MOUNTAIN = "#250c45"
    private const val RIDGE = "#ff3d9a"
    private const val BUILDING = "#140726"
    private const val WINDOW = "#ffd36b"
    private const val WINDOW_PINK = "#ff7ad9"
    private const val HORIZON = "#ff6ad5"
    private const val GRID_FAR = "#5c1659"
    private const val GRID_MID = "#a12384"
    private const val GRID_NEAR = "#ff2a9d"
    private const val PALM = "#07010f"
    private const val STAR = "#fff6d6"
    private const val STAR_PINK = "#ff9be6"

    /** The stations' icons as 9 × 9 pixel sprites ('#' lit): a crescent moon, a sun, waves. */
    val ICONS = mapOf(
        "night-drive" to listOf(".......#.", "...###...", "..##.....", ".##......", ".##......", ".##......", ".##......", "..##.....", "...###..."),
        "sunset" to listOf("....#....", ".#.....#.", "...###...", "..#####..", "#.#####.#", "..#####..", "...###...", ".#.....#.", "....#...."),
        "after-hours" to listOf(".........", ".##...##.", "#..###..#", ".........", ".##...##.", "#..###..#", ".........", ".##...##.", "#..###..#"),
    )

    /** A 32-bit integer hash: the same numbers as cityPopHash in TypeScript (unsigned). */
    fun hash(n: Int): Long {
        var x = n xor 0x9e3779b9.toInt()
        x = (x xor (x ushr 16)) * 0x85ebca6b.toInt()
        x = (x xor (x ushr 13)) * 0xc2b2ae35.toInt()
        x = x xor (x ushr 16)
        return x.toLong() and 0xffffffffL
    }

    private fun h(n: Int, mod: Int): Int = (hash(n) % mod).toInt()

    /** [horizon], [sunX] and [sun] (the radius) in thousandths, as in CityPopSceneOptions. */
    fun scene(width: Int, height: Int, horizon: Int, sunX: Int, sun: Int): List<CityPopPixel> {
        val w = max(16, width)
        val h = max(12, height)
        val line = min(h - 3, max(4, h * horizon / 1000))
        val out = ArrayList<CityPopPixel>(4096)
        // A rectangle, clipped to the grid (a palm's frond can reach past the edge).
        fun px(x: Int, y: Int, rw: Int, rh: Int, color: String) {
            val left = max(0, x); val top = max(0, y); val right = min(w, x + rw); val bottom = min(h, y + rh)
            if (right > left && bottom > top) out.add(CityPopPixel(left, top, right - left, bottom - top, color))
        }

        // Sky: bands from night to glow, then each band's first row dithered with the one above.
        fun bandOf(y: Int) = min(SKY.size - 1, y * SKY.size / line)
        var y0 = 0
        while (y0 < line) {
            var end = y0 + 1
            while (end < line && bandOf(end) == bandOf(y0)) end++
            px(0, y0, w, end - y0, SKY[bandOf(y0)])
            y0 = end
        }
        for (y in 1 until line) {
            if (bandOf(y) != bandOf(y - 1)) { var x = y and 1; while (x < w) { px(x, y, 1, 1, SKY[bandOf(y) - 1]); x += 2 } }
        }

        // The sun: centre a little above the horizon, so about two thirds of it shows.
        val radius = max(4, min(line * 4 / 5, w * sun / 1000))
        val cx = w * sunX / 1000
        val cy = line - radius * 35 / 100
        val top = cy - radius

        // Stars in the upper sky, clear of the sun.
        val stars = w * line / 70
        val starBand = max(1, line * 62 / 100)
        for (i in 0 until stars) {
            val x = h(i * 3 + 1, w)
            val y = h(i * 3 + 2, starBand)
            val dx = x - cx; val dy = y - cy
            if (dx * dx + dy * dy <= (radius + 2) * (radius + 2)) continue
            val color = if (h(i * 3 + 3, 4) == 0) STAR_PINK else STAR
            px(x, y, 1, 1, color)
            if (i % 9 == 0 && x > 0 && y > 0) { px(x - 1, y, 3, 1, color); px(x, y - 1, 1, 3, color) }
        }

        for (y in max(0, top) until line) {
            val dy = y - cy
            if (dy * dy > radius * radius) continue
            val half = sqrt((radius * radius - dy * dy).toDouble()).toInt()
            val along = (y - top) * 1000 / (radius * 2)
            if (SUN_GAPS.any { (from, to) -> along >= from && along < to }) continue
            px(cx - half, y, half * 2 + 1, 1, SUN[min(SUN.size - 1, (y - top) * SUN.size / (radius * 2))])
        }

        // Mountains: hashed peaks every 12 pixels, joined by straight slopes, with a neon ridge.
        val tallest = max(2, line * 16 / 100)
        fun peak(k: Int) = tallest * (35 + h(5000 + k, 66)) / 100
        for (x in 0 until w) {
            val k = x / 12
            val rise = peak(k) + (peak(k + 1) - peak(k)) * (x - k * 12) / 12
            if (rise <= 0) continue
            px(x, line - rise, 1, rise, MOUNTAIN)
            px(x, line - rise, 1, 1, RIDGE)
        }

        // The skyline: buildings of hashed widths and heights, with lit windows.
        var x0 = 0
        var i = 0
        while (x0 < w) {
            val width = 3 + h(1000 + i, 6)
            if (h(3000 + i, 5) == 0) { x0 += 1 + h(4000 + i, 2); i++; continue }
            val tall = max(2, line * (6 + h(2000 + i, 14)) / 100)
            px(x0, line - tall, width, tall, BUILDING)
            var wy = line - tall + 1
            while (wy < line - 1) {
                var wx = x0 + 1
                while (wx < x0 + width - 1) {
                    val lit = hash(wx * 131 + wy * 17)
                    if (lit % 7 == 0L) px(wx, wy, 1, 1, if (lit % 3 == 0L) WINDOW_PINK else WINDOW)
                    wx += 2
                }
                wy += 2
            }
            x0 += width
            i++
        }

        // The horizon glows; under it, dark ground with a neon grid running to the sun.
        px(0, line, w, 1, HORIZON)
        val ground = h - line - 1
        px(0, line + 1, w, ground, GROUND)
        var k = 1
        while (true) {
            val y = line + k + k * k / 3
            if (y >= h) break
            px(0, y, w, 1, if (k <= 2) GRID_FAR else if (k <= 4) GRID_MID else GRID_NEAR)
            k++
        }
        val spacing = max(8, w / 12)
        val reach = w / spacing + 2
        for (j in -reach..reach) {
            // Right at the horizon the lines would only blur together.
            for (y in line + 2 until h) {
                val x = cx + j * spacing * 2 * (y - line) / max(1, ground)
                if (x < 0 || x >= w) continue
                px(x, y, 1, 1, if (y - line <= 6) GRID_MID else GRID_NEAR)
            }
        }

        // A palm on the right, rooted at the bottom edge, drawn in cells of `scale` pixels.
        val scale = min(3, max(1, h / 40))
        fun cell(x: Int, y: Int, cw: Int = 1, ch: Int = 1) = px(x, y, cw * scale, ch * scale, PALM)
        val trunk = min(22, max(6, h * 6 / (10 * scale)))
        val baseX = w - 5 * scale
        for (t in 0 until trunk) cell(baseX - 4 * t * t / (trunk * trunk) * scale, h - (t + 1) * scale, if (t < trunk / 3) 2 else 1)
        val crownX = baseX - 4 * scale
        val crownY = h - trunk * scale
        for ((dir, length, rise, droop) in FRONDS.map { it.toList() }) {
            for (t in 0..length) {
                val dy = -rise * t / 10 + droop * t * t / (10 * length)
                val x = crownX + dir * t * scale
                cell(x, crownY + dy * scale)
                if (t >= 2 && t % 2 == 0) cell(x, crownY + (dy + 1) * scale, 1, 1 + (length - t) / 4)
            }
        }
        cell(crownX - scale, crownY - scale, 2, 2)
        return out
    }

    /** FNV-1a over every rectangle: the same number as cityPopSceneChecksum in TypeScript. */
    fun checksum(pixels: List<CityPopPixel>): Long {
        var hash = 0x811c9dc5.toInt()
        for (p in pixels) {
            for (c in "${p.x},${p.y},${p.w},${p.h},${p.color};") {
                hash = hash xor c.code
                hash *= 0x01000193
            }
        }
        return hash.toLong() and 0xffffffffL
    }
}
