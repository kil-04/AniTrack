package com.sanjay.anitrack.next.data

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Pixel mode's banners: retrowave scenes in pixel art, drawn like City Pop's sunset
 * (CityPopScene, which "sunset" reuses) as rectangles on a grid of art pixels. Mirrors
 * packages/shared/pixel-scenes.ts line for line, in whole numbers only, so both apps draw the
 * very same pictures (the tests on both sides pin the same checksums).
 */
object PixelScenes {
    val IDS = listOf(
        "sunset", "neon-city", "fuji", "sakura", "shinkansen", "starlight", "library", "ramen-stand", "arcade",
        "bedroom", "cinema", "tower", "observatory", "station", "terminal", "stage",
        "jukebox", "radio", "hifi", "night-drive", "karaoke", "rooftop-band", "hologram",
        "manga-street", "moon-bench", "dusk-line", "green-shop",
    )

    private val STARS = listOf("#fff6d6", "#ff9be6", "#bff8ff")
    private val SIGNS = listOf("#ff2a9d", "#2ee6ff", "#ffd319", "#b44cff")
    private val SUNRISE = listOf("#fff2b0", "#ffe08a", "#ffc36b", "#ffa45c")
    private val CLOUD = listOf("#ffd0dc", "#ffa8c0", "#e77799")
    private val SUN_SEA = listOf("#fff27a", "#ffd319", "#ffab2e", "#ff7f3f")
    private val PLANET = listOf("#ffb3de", "#ff7ac6", "#e0529c", "#c74bd4", "#8a3bbf", "#5e2a99")
    private val BOOKS = listOf("#ff2a9d", "#2ee6ff", "#ffd319", "#c9a8ff", "#ff7f3f", "#5ce1a5", "#e0529c", "#4f7cff")
    /** A cherry tree's branches from its crown: direction, length (in cells) and lift (tenths of a cell). */
    private val BRANCHES = listOf(intArrayOf(-1, 9, 6), intArrayOf(1, 11, 5), intArrayOf(-1, 6, 12), intArrayOf(1, 7, 11), intArrayOf(1, 4, 16))
    private val DRINKS = listOf("#ff3d3d", "#2e6bff", "#ffd319", "#5ce1a5", "#ff7a59", "#ff2a9d")
    private val CABINETS = listOf("#ff2a9d", "#2ee6ff", "#ffd319", "#b44cff")
    private val SCREEN_DOTS = listOf("#2ee6ff", "#ff2a9d", "#ffd319")
    /** The arcade's neon sign in a tiny 5-row font. */
    private val GAME = listOf(
        listOf(".###", "#...", "#.##", "#..#", ".###"),
        listOf(".##.", "#..#", "####", "#..#", "#..#"),
        listOf("#...#", "##.##", "#.#.#", "#...#", "#...#"),
        listOf("####", "#...", "###.", "#...", "####"),
    )
    private val TAPES = listOf("#ff2a9d", "#2ee6ff", "#ffd319", "#5ce1a5", "#ff7f3f")
    private val SCREEN_SKY = listOf("#2e6bff", "#5b8bff", "#ff9fb8", "#ffc36b")
    private val EQUALIZER = listOf("#ff2a9d", "#b44cff", "#2ee6ff")
    private val LIGHT_STICKS = listOf("#2ee6ff", "#ff2a9d", "#ffd319", "#5ce1a5")
    /** The stage's spotlights: where each hangs (percent of the width), its lean (tenths of a pixel a row) and glow. */
    private val SPOT_X = intArrayOf(44, 60, 76, 90)
    private val SPOT_LEAN = intArrayOf(3, 1, -1, -3)
    private val SPOT_GLOW = listOf("#4a1a4a", "#1a3a5a", "#4a3a1f", "#331a5a")
    /** An eighth note, for music drifting up from the Songs scenes. */
    private val NOTE = listOf("..##.", "..#.#", "..#..", "..#..", "###..", "###..")
    private val NOTE_COLORS = listOf("#ff7ac6", "#2ee6ff", "#ffd319", "#c9a8ff")
    private val JUKE_ARCH = listOf("#ff2a9d", "#ff7f3f", "#ffd319", "#5ce1a5", "#2ee6ff", "#b44cff")
    private val BUTTONS = listOf("#ff3d3d", "#ffd319", "#2ee6ff", "#5ce1a5", "#ff7ad9")
    private val SLEEVES = listOf("#ff7f3f", "#ffd319", "#5ce1a5", "#ff2a9d", "#2e6bff", "#c9a8ff", "#ff3d3d")
    private val LYRIC_SKY = listOf("#2b1257", "#5a1f7a", "#a3307a", "#ff6a6a")
    private val EVENING = listOf("#3a1a66", "#7a2a7a", "#c8487a", "#ff7f6b", "#ffb36b")
    private val NIGHT_SKY = listOf("#0b0424", "#1a0838", "#3a0f55", "#7a1f6e", "#c8306e")
    private val DUSK = listOf("#2a1a66", "#5a2a8a", "#a3407a", "#ff7a6b", "#ffb36b")
    private val CITY_LIGHTS = listOf("#ffd36b", "#ffd36b", "#ffb36b", "#ff7ad9", "#2ee6ff")
    /** A virtual singer with twin tails, her microphone in her hands. */
    private val IDOL = listOf(
        ".....hhhh.....", "....hhhhhh....", "..rhhhhhhhhr..", "..hhffffffhh..", ".hhhfeffefhhh.", ".hh.ffffff.hh.",
        ".hh..rddr..hh.", ".hh.lddddl.hh.", ".hh.ldmmdl.hh.", ".hh..dddd..hh.", ".hh.dddddd.hh.", ".h.dddddddd.h.",
        ".h...l..l...h.", "h....l..l....h", ".....l..l.....", "....kk..kk....",
    )
    private val IDOL_COLORS = mapOf(
        'h' to "#2ee6ff", 'f' to "#e8fdff", 'e' to "#0a1036", 'r' to "#ff7ad9", 'l' to "#b8f6ff", 'd' to "#7fb8ff", 'm' to "#ffd319", 'k' to "#3aa0e0",
    )
    private val HEART = listOf(".##.##.", "#######", "#######", ".#####.", "..###..", "...#...")
    /** The hologram's floating screens: x, y, width and height (percent of the scene) and what each shows. */
    private val PANELS = listOf(
        intArrayOf(4, 10, 18, 24, 0), intArrayOf(10, 44, 12, 18, 1), intArrayOf(26, 20, 10, 14, 3),
        intArrayOf(40, 40, 10, 14, 1), intArrayOf(86, 10, 12, 22, 2), intArrayOf(88, 46, 10, 16, 3),
    )
    private val GLOW_STICKS = listOf("#2ee6ff", "#2ee6ff", "#7fe8ff", "#ff7ad9")
    private val SHOP_SIGNS = listOf("#ffd36b", "#ff5a5a", "#5ce1e6", "#ff9fd0", "#9be15c", "#ffb35a")
    private val TOWN_LIGHTS = listOf("#ffb35a", "#ffd27a", "#ff8a4a")
    /** A cat sitting under the lamp ('#' fur, 'o' eyes). */
    private val CAT = listOf("#...#....", "##.##....", "#####....", "#o#o#....", "#####...#", ".####...#", ".######.#", ".#######.", ".#######.")

    private fun hash(n: Int): Long = CityPopScene.hash(n)
    /** A seeded number below [m]. */
    private fun mod(n: Int, m: Int): Int = (hash(n) % m).toInt()

    /** The whole square root (floor), exact for any size used here. */
    fun isqrt(n: Int): Int {
        if (n <= 0) return 0
        var r = sqrt(n.toDouble()).toInt()
        while (r * r > n) r--
        while ((r + 1) * (r + 1) <= n) r++
        return r
    }

    /**
     * A part of a scene that moves or blinks over the still picture. Its pixels are where it starts;
     * each [period] (tenths of a second) it slides by ([dx], [dy]) and is shown for the first [on]
     * tenths. [delay] shifts its phase, and [rest] is the time shown when nothing moves.
     */
    data class Actor(val rects: List<CityPopPixel>, val dx: Int, val dy: Int, val period: Int, val delay: Int, val on: Int, val rest: Int)

    /** A scene's still picture and its moving parts. */
    data class Parts(val rects: List<CityPopPixel>, val actors: List<Actor>)

    /** Where [actor] is at [t] tenths of a second (whole art pixels from its start) and whether it shows. */
    fun actorAt(actor: Actor, t: Int): Triple<Int, Int, Boolean> {
        val phase = ((t + actor.delay) % actor.period + actor.period) % actor.period
        return Triple(actor.dx * phase / actor.period, actor.dy * phase / actor.period, phase < actor.on)
    }

    /** The art-pixel grid a scene draws on. */
    private class Grid(val w: Int, val h: Int, val clip: Boolean = true) {
        val out = ArrayList<CityPopPixel>(if (clip) 4096 else 16)
        /** The scene's moving parts ([actor]). */
        val actors = ArrayList<Actor>()

        /** A rectangle, clipped to the grid. */
        fun px(x: Int, y: Int, rw: Int, rh: Int, color: String) {
            if (!clip) {
                if (rw > 0 && rh > 0) out.add(CityPopPixel(x, y, rw, rh, color))
                return
            }
            val left = max(0, x); val top = max(0, y); val right = min(w, x + rw); val bottom = min(h, y + rh)
            if (right > left && bottom > top) out.add(CityPopPixel(left, top, right - left, bottom - top, color))
        }

        /** Bands of [colors] from row [top] down to [bottom], each band's first row dithered with the one above. */
        fun gradient(top: Int, bottom: Int, colors: List<String>) {
            val span = max(1, bottom - top)
            fun band(y: Int) = min(colors.size - 1, (y - top) * colors.size / span)
            var y = top
            while (y < bottom) {
                var end = y + 1
                while (end < bottom && band(end) == band(y)) end++
                px(0, y, w, end - y, colors[band(y)])
                y = end
            }
            for (row in top + 1 until bottom) {
                if (band(row) != band(row - 1)) { var x = row and 1; while (x < w) { px(x, row, 1, 1, colors[band(row) - 1]); x += 2 } }
            }
        }

        /** A filled circle. */
        fun disc(cx: Int, cy: Int, r: Int, color: String) {
            for (y in cy - r..cy + r) {
                val half = isqrt(r * r - (y - cy) * (y - cy))
                px(cx - half, y, half * 2 + 1, 1, color)
            }
        }

        /** A ring [t] pixels thick. */
        fun ring(cx: Int, cy: Int, r: Int, t: Int, color: String) {
            val inner = r - t
            for (y in cy - r..cy + r) {
                val dy = y - cy
                val half = isqrt(r * r - dy * dy)
                if (inner <= 0 || abs(dy) >= inner) {
                    px(cx - half, y, half * 2 + 1, 1, color)
                } else {
                    val hole = isqrt(inner * inner - dy * dy)
                    px(cx - half, y, half - hole, 1, color)
                    px(cx + hole + 1, y, half - hole, 1, color)
                }
            }
        }

        /** A straight line in single-pixel steps (Bresenham), [size] pixels thick. */
        fun line(x0: Int, y0: Int, x1: Int, y1: Int, color: String, size: Int = 1) {
            val dx = abs(x1 - x0); val dy = -abs(y1 - y0)
            val sx = if (x0 < x1) 1 else -1; val sy = if (y0 < y1) 1 else -1
            var err = dx + dy; var x = x0; var y = y0
            while (true) {
                px(x, y, size, size, color)
                if (x == x1 && y == y1) break
                val e2 = 2 * err
                if (e2 >= dy) { err += dy; x += sx }
                if (e2 <= dx) { err += dx; y += sy }
            }
        }

        /** A small picture from rows of letters ('.' clear), each letter's colour from [colors], in [cell]-pixel squares. */
        fun sprite(rows: List<String>, x: Int, y: Int, cell: Int, colors: Map<Char, String>) {
            for (r in rows.indices) {
                for (c in rows[r].indices) {
                    val color = colors[rows[r][c]] ?: continue
                    px(x + c * cell, y + r * cell, cell, cell, color)
                }
            }
        }

        /** A part that moves or blinks over the still picture ([Actor]), drawn by [draw] where it starts. */
        fun actor(dx: Int = 0, dy: Int = 0, period: Int, delay: Int = 0, on: Int = period, rest: Int = 0, draw: (Grid) -> Unit) {
            val a = Grid(w, h, false)
            draw(a)
            if (a.out.isNotEmpty()) actors.add(Actor(a.out, dx, dy, max(1, period), delay, on, rest))
        }

        /** Seeded stars between rows [top] and [bottom]; every eleventh one is a small cross. */
        fun stars(top: Int, bottom: Int, count: Int, seed: Int, colors: List<String> = STARS) {
            val span = max(1, bottom - top)
            for (i in 0 until count) {
                val x = mod(seed + i * 3 + 1, w); val y = top + mod(seed + i * 3 + 2, span)
                val color = colors[mod(seed + i * 3 + 3, colors.size)]
                px(x, y, 1, 1, color)
                if (i % 11 == 0 && x > 0 && y > top) { px(x - 1, y, 3, 1, color); px(x, y - 1, 1, 3, color) }
            }
        }
    }

    /** A scene at [width] × [height] art pixels. */
    fun scene(id: String, width: Int, height: Int): List<CityPopPixel> = sceneParts(id, width, height).rects

    /** A scene and its moving parts at [width] × [height] art pixels. */
    fun sceneParts(id: String, width: Int, height: Int): Parts {
        val g = Grid(max(16, width), max(12, height))
        when (id) {
            "sunset" -> return Parts(CityPopScene.scene(g.w, g.h, horizon = 680, sunX = 760, sun = 170), emptyList())
            "neon-city" -> neonCity(g)
            "fuji" -> fuji(g)
            "sakura" -> sakura(g)
            "shinkansen" -> shinkansen(g)
            "starlight" -> starlight(g)
            "library" -> library(g)
            "ramen-stand" -> ramenStand(g)
            "arcade" -> arcade(g)
            "bedroom" -> bedroom(g)
            "cinema" -> cinema(g)
            "tower" -> tower(g)
            "observatory" -> observatory(g)
            "station" -> station(g)
            "terminal" -> terminal(g)
            "stage" -> stage(g)
            "jukebox" -> jukebox(g)
            "radio" -> radio(g)
            "hifi" -> hifi(g)
            "night-drive" -> nightDrive(g)
            "karaoke" -> karaoke(g)
            "rooftop-band" -> rooftopBand(g)
            "hologram" -> hologram(g)
            "manga-street" -> mangaStreet(g)
            "moon-bench" -> moonBench(g)
            "dusk-line" -> duskLine(g)
            "green-shop" -> greenShop(g)
        }
        return Parts(g.out, g.actors)
    }

    /** A layer that drifts by ([dx], [dy]) every period without end: drawn twice, the copy one step behind, so it wraps unseen. */
    private fun drift(g: Grid, dx: Int, dy: Int, period: Int, draw: (Grid, Int, Int) -> Unit) {
        g.actor(dx = dx, dy = dy, period = period) { a -> draw(a, 0, 0); draw(a, -dx, -dy) }
    }

    /** Stars that come and go inside a box: two sets taking turns. */
    private fun twinkle(g: Grid, left: Int, top: Int, right: Int, bottom: Int, count: Int, seed: Int, color: String = "#ffffff") {
        val across = max(1, right - left); val span = max(1, bottom - top)
        for (k in 0 until 2) {
            g.actor(period = 30, delay = k * 15, on = 15) { a ->
                var i = k
                while (i < count) { a.px(left + mod(seed + i * 3 + 1, across), top + mod(seed + i * 3 + 2, span), 1, 1, color); i += 2 }
            }
        }
    }

    /** Two frames taking turns, [period] tenths for the pair (the first shows when nothing moves). */
    private fun frames(g: Grid, period: Int, first: (Grid) -> Unit, second: (Grid) -> Unit) {
        g.actor(period = period, on = period / 2, draw = first)
        g.actor(period = period, delay = period / 2, on = period / 2, draw = second)
    }

    /** A bird in flight, three pixels wide. */
    private fun bird(a: Grid, x: Int, y: Int, color: String) {
        a.px(x, y, 1, 1, color)
        a.px(x + 1, y + 1, 1, 1, color)
        a.px(x + 2, y, 1, 1, color)
    }

    /** A city at night in the rain: a full moon, lit towers, neon signs shining on the wet street. */
    private fun neonCity(g: Grid) {
        val w = g.w; val h = g.h
        val street = h - max(3, h * 16 / 100)
        g.gradient(0, street, listOf("#07021a", "#0d0430", "#170a45", "#24105a", "#3a1466", "#5a1a6e"))
        g.stars(0, street * 45 / 100, w * street / 160, 100)
        val mr = max(3, h * 10 / 100)
        val mx = w * 40 / 100; val my = h * 8 / 100 + mr
        g.disc(mx, my, mr, "#ffe9b0")
        g.disc(mx - mr / 3, my - mr / 4, max(1, mr / 4), "#f2cf86")
        g.disc(mx + mr / 3, my + mr / 3, max(1, mr / 5), "#f2cf86")
        g.px(0, street, w, h - street, "#0a0314")
        g.px(0, street, w, 1, "#3d1a6e")
        val lane = street + (h - street) / 2
        run { var x = 1; while (x < w) { g.px(x, lane, 4, 1, "#33224f"); x += 8 } }
        // Far towers: dim blocks with a few windows.
        run {
            var x = 0; var i = 0
            while (x < w) {
                val bw = 4 + mod(7000 + i, 7)
                val tall = street * (30 + mod(7100 + i, 32)) / 100
                g.px(x, street - tall, bw, tall, "#1c0b3a")
                var wy = street - tall + 2
                while (wy < street - 1) {
                    var wx = x + 1
                    while (wx < x + bw - 1) { if (mod(wx * 97 + wy * 31 + 7, 9) == 0) g.px(wx, wy, 1, 1, "#4b3a8a"); wx += 2 }
                    wy += 3
                }
                x += bw; i++
            }
        }
        // Near buildings: lit windows, rooftop beacons, and neon signs reflected in the street.
        run {
            var x = -2; var i = 0
            while (x < w) {
                val bw = 6 + mod(8000 + i, 9)
                if (mod(8100 + i, 6) == 0) { x += 2 + mod(8200 + i, 3); i++; continue }
                val tall = street * (35 + mod(8300 + i, 42)) / 100
                val top = street - tall
                g.px(x, top, bw, tall, "#0b0418")
                if (mod(8400 + i, 4) == 0) { g.px(x + bw / 2, top - 3, 1, 3, "#0b0418"); g.px(x + bw / 2, top - 4, 1, 1, "#ff3d6e") }
                var wy = top + 2
                while (wy < street - 2) {
                    var wx = x + 1
                    while (wx < x + bw - 1) {
                        val lit = hash(wx * 131 + wy * 17 + 3)
                        if (lit % 5 == 0L) g.px(wx, wy, 1, 1, if (lit % 4 == 0L) "#2ee6ff" else "#ffd36b")
                        wx += 2
                    }
                    wy += 3
                }
                if (mod(8500 + i, 3) == 0 && tall > 12) {
                    val color = SIGNS[mod(8700 + i, SIGNS.size)]
                    val sx = x + bw - 3; val sy = top + 3
                    val sh = min(tall - 6, 6 + mod(8600 + i, 8))
                    g.px(sx, sy, 3, sh, color)
                    var gy = sy + 1
                    while (gy < sy + sh - 1) { g.px(sx + 1, gy, 1, 1, "#12051f"); gy += 2 }
                    if (mod(8800 + i, 2) == 0) g.actor(period = 50 + mod(8900 + i, 40), delay = mod(9000 + i, 50), on = 2, rest = 40) { a -> a.px(sx, sy, 3, sh, "#12051f") }
                    var ry = street + 1
                    while (ry < h) { g.px(sx + mod(ry * 5 + sx * 3, 3), ry, 1, 1, color); ry += 2 }
                }
                x += bw; i++
            }
        }
        // The rain falls past, a little slanted; a sign blinks out now and then.
        val drops = w * h / 70; val slant = h / 4
        drift(g, -slant, h, 9) { a, ox, oy ->
            for (i in 0 until drops) a.px(mod(20000 + i * 2, w + slant) + ox, mod(20001 + i * 2, h) + oy, 1, 2 + mod(20000 + i * 5, 2), "#5866c4")
        }
        twinkle(g, 0, 0, w, street * 45 / 100, w * street / 700, 150)
    }

    /** Mount Fuji at dawn over a still lake, a torii gate standing in the water. */
    private fun fuji(g: Grid) {
        val w = g.w; val h = g.h
        val horizon = h * 72 / 100
        g.gradient(0, horizon, listOf("#1b1446", "#2c1a5e", "#4b2a7a", "#7a3584", "#b0487f", "#e2667a", "#ff8f6b", "#ffb86b"))
        g.stars(0, horizon * 30 / 100, w * horizon / 260, 300)
        val sr = max(3, h * 16 / 100)
        val sx = w * 42 / 100; val sy = horizon - sr / 3
        for (y in sy - sr until horizon) {
            val half = isqrt(sr * sr - (y - sy) * (y - sy))
            g.px(sx - half, y, half * 2 + 1, 1, SUNRISE[min(SUNRISE.size - 1, (y - sy + sr) * SUNRISE.size / (sr * 2))])
        }
        twinkle(g, 0, 0, w, horizon * 30 / 100, w * horizon / 900, 350)
        // The mountain: a broad cone with a flat crater, its right face in shade, a snow cap with a ragged hem.
        val peakX = w * 66 / 100; val peakY = h * 14 / 100
        val snow = peakY + (horizon - peakY) * 30 / 100
        for (y in peakY until horizon) {
            val half = (y - peakY) * 17 / 10 + 1
            g.px(peakX - half, y, half * 2 + 1, 1, "#3a2a6b")
            g.px(peakX + 1, y, half, 1, "#2e2159")
            if (y < snow) {
                g.px(peakX - half, y, half * 2 + 1, 1, "#f4eeff")
                g.px(peakX + 1, y, half, 1, "#c9b8f0")
            } else if (y < snow + 4) {
                for (x in peakX - half..peakX + half) {
                    if (mod(x * 29 + 5, 5) > y - snow) g.px(x, y, 1, 1, if (x > peakX) "#c9b8f0" else "#f4eeff")
                }
            }
        }
        // The lake: the mountain's reflection broken by ripples, the sun's path, shimmer.
        g.px(0, horizon, w, h - horizon, "#1a1240")
        g.px(0, horizon, w, 1, "#ffb86b")
        for (y in horizon + 1 until h) {
            val ry = horizon - (y - horizon) * 2
            if (ry < peakY) continue
            val half = (ry - peakY) * 17 / 10 + 1
            for (x in peakX - half..peakX + half) if (mod(x + y * 7, 3) != 0) g.px(x, y, 1, 1, if (ry < snow) "#6b5a9e" else "#2c1f57")
        }
        run {
            var y = horizon + 2
            while (y < h) {
                val half = max(0, sr - (y - horizon) * 2)
                g.px(sx - half, y, half * 2 + 1, 1, "#ff9f6b")
                y += 2
            }
        }
        for (i in 0 until w / 6) g.px(mod(9300 + i, w), horizon + 2 + mod(9400 + i, max(1, h - horizon - 2)), 2 + mod(9500 + i, 5), 1, "#2d2366")
        // A torii gate standing in the water, and its reflection.
        val s = max(1, h / 40)
        val tx = w * 34 / 100; val th = max(6, h * 24 / 100)
        val base = horizon + (h - horizon) / 2
        val tTop = base - th
        run { var y = base + 1; while (y < h) { g.px(tx, y, s, 1, "#7a2440"); g.px(tx + 7 * s, y, s, 1, "#7a2440"); y += 2 } }
        g.px(tx, tTop, s, th, "#ff3d3d")
        g.px(tx + 7 * s, tTop, s, th, "#ff3d3d")
        g.px(tx - 2 * s, tTop, 12 * s, s, "#ff3d3d")
        g.px(tx - 2 * s, tTop - s, s, s, "#ff3d3d")
        g.px(tx + 9 * s, tTop - s, s, s, "#ff3d3d")
        g.px(tx - s, tTop + 2 * s, 10 * s, s, "#d92f2f")
        g.px(tx + 3 * s, tTop + s, 2 * s, s, "#d92f2f")
        // Clouds drifting across the dawn, birds flying the other way.
        for (k in 0 until 3) {
            val cy = horizon * (34 + k * 16) / 100
            val cw = w * (16 + mod(9100 + k, 12)) / 100
            val cx = mod(9000 + k, w)
            drift(g, w, 0, 600 + k * 170) { a, ox, _ ->
                for (r in 0 until 3) {
                    val rw = cw * (2 + r) / 4
                    a.px(cx - rw / 2 + ox, cy + r, rw, 1, CLOUD[r])
                }
            }
        }
        drift(g, -w, 0, 260) { a, ox, _ ->
            for (i in 0 until 3) bird(a, w * (50 + i * 5) / 100 + ox, horizon * (18 + mod(9600 + i, 12)) / 100, "#2a1650")
        }
    }

    /** A cherry tree in bloom under a full moon, petals drifting over the hills. */
    private fun sakura(g: Grid) {
        val w = g.w; val h = g.h
        val ground = h * 82 / 100
        g.gradient(0, h, listOf("#0b0420", "#140733", "#1e0b45", "#2a0f52", "#3a1460"))
        g.stars(0, h * 60 / 100, w * h / 150, 400)
        val mr = max(4, h * 18 / 100)
        val mx = w * 82 / 100; val my = h * 32 / 100
        for (y in my - mr - 3..my + mr + 3) {
            for (x in mx - mr - 3..mx + mr + 3) {
                val d = (x - mx) * (x - mx) + (y - my) * (y - my)
                if (d > mr * mr && d <= (mr + 3) * (mr + 3) && ((x + y) and 1) == 0) g.px(x, y, 1, 1, "#3d2370")
            }
        }
        g.disc(mx, my, mr, "#fff2c7")
        g.disc(mx - mr / 3, my - mr / 4, max(1, mr / 5), "#f2d99b")
        g.disc(mx + mr / 3, my + mr / 3, max(1, mr / 6), "#f2d99b")
        g.disc(mx + mr / 5, my - mr / 2, max(1, mr / 8), "#f2d99b")
        fun peak(k: Int) = 1 + mod(9700 + k, 5)
        for (x in 0 until w) {
            val k = x / 24
            val hill = ground - (peak(k) + (peak(k + 1) - peak(k)) * (x - k * 24) / 24)
            g.px(x, hill, 1, h - hill, "#12072a")
            g.px(x, hill, 1, 1, "#2e1457")
        }
        // The tree: a leaning trunk, branches, then blossom in three layers (shade, bloom, highlights).
        val s = max(1, h / 45)
        val baseX = w * 46 / 100
        val crownY = h * 38 / 100
        val rise = max(1, ground - crownY)
        for (y in crownY..ground) {
            val up = ground - y
            g.px(baseX + 5 * s * up * up / (rise * rise), y, if (up < rise / 2) 3 * s else 2 * s, 1, "#2a0f2a")
        }
        val topX = baseX + 5 * s
        for ((dir, length, lift) in BRANCHES.map { Triple(it[0], it[1], it[2]) }) {
            for (t in 0..length * s) g.px(topX + dir * t, crownY - t * lift / 10, s, s, "#2a0f2a")
        }
        val radius = max(6, h * 38 / 100)
        val cy = crownY - radius / 4
        for (layer in 0 until 3) {
            for (k in 0 until 11) {
                val ox = mod(600 + k, radius * 2 + 1) - radius
                val oy = mod(700 + k, radius + 1) - radius / 2
                val cr = max(2, radius / 3 + mod(800 + k, max(1, radius / 4)))
                when (layer) {
                    0 -> g.disc(topX + ox, cy + oy, cr, "#b8256b")
                    1 -> g.disc(topX + ox - 1, cy + oy - 1, max(1, cr - 2), "#ff4fa3")
                    else -> g.disc(topX + ox - 2, cy + oy - 2, max(1, cr / 2), "#ff9fd0")
                }
            }
        }
        // Petals drifting down and across.
        val petals = w * h / 320; val across = h / 2
        drift(g, across, h, 70) { a, ox, oy ->
            for (i in 0 until petals) {
                a.px(mod(30000 + i * 2, w + across) - across + ox, mod(30001 + i * 2, h) + oy, if (i % 4 == 0) 2 else 1, 1, if (i % 3 == 0) "#ffb3de" else "#ff7ac6")
            }
        }
        twinkle(g, 0, 0, w, h * 60 / 100, w * h / 500, 450)
    }

    /** A bullet train crossing a sea bridge at sunset. */
    private fun shinkansen(g: Grid) {
        val w = g.w; val h = g.h
        val sea = h * 74 / 100
        g.gradient(0, sea, listOf("#1a0b3d", "#2d0f55", "#55166a", "#8c1f6e", "#c9336a", "#f25c5c", "#ff8a4c", "#ffb347"))
        g.stars(0, sea * 35 / 100, w * sea / 220, 500)
        val sr = max(3, h * 20 / 100)
        val sx = w * 74 / 100; val sy = sea - sr / 4
        for (y in sy - sr until sea) {
            val half = isqrt(sr * sr - (y - sy) * (y - sy))
            g.px(sx - half, y, half * 2 + 1, 1, SUN_SEA[min(SUN_SEA.size - 1, (y - sy + sr) * SUN_SEA.size / (sr * 2))])
        }
        for (k in 0 until 2) {
            val ix = w * (18 + k * 30) / 100; val iw = max(4, w * (6 + k * 3) / 100); val ih = max(2, h * (8 - k * 3) / 100)
            for (x in ix - iw..ix + iw) {
                val tall = ih - ih * (x - ix) * (x - ix) / (iw * iw)
                if (tall > 0) g.px(x, sea - tall, 1, tall, "#3a1046")
            }
        }
        g.px(0, sea, w, h - sea, "#1b0a3a")
        g.px(0, sea, w, 1, "#ff8a4c")
        run {
            var y = sea + 2
            while (y < h) {
                val half = max(1, sr - (y - sea))
                g.px(sx - half, y, half * 2 + 1, 1, if (y % 4 == 0) "#ffab2e" else "#ff7f3f")
                y += 2
            }
        }
        for (i in 0 until w / 5) g.px(mod(31000 + i, w), sea + 2 + mod(31100 + i, max(1, h - sea - 2)), 2 + mod(31200 + i, 5), 1, "#3b1c66")
        // The bridge: piers into the sea and a deck.
        val s = max(1, h / 40)
        val deck = h * 66 / 100
        val span = max(12, w / 9)
        run { var x = span / 2; while (x < w) { g.px(x, deck, 2 * s, h - deck, "#120526"); x += span } }
        g.px(0, deck, w, 2 * s, "#120526")
        g.px(0, deck - s, w, 1, "#2a0f45")
        // The train: white cars with a blue stripe, windows, a long sloping nose and a headlight. It
        // crosses the bridge, then the sea is empty a while; still, it stands where it was drawn.
        val th = max(4, h * 14 / 100)
        val ty = deck - th
        val length = w * 58 / 100
        val nose = th * 3
        val whole = length + nose; val travel = 2 * (w + whole); val period = 300
        g.actor(dx = travel, period = period, rest = period * (w * 6 / 100 + whole) / travel) { a ->
            val x0 = -whole
            a.px(x0, ty, length, th, "#f4f2ff")
            for (i in 0 until th) a.px(x0 + length, ty + i, nose * (i + 1) / th, 1, "#f4f2ff")
            a.px(x0, ty + th * 62 / 100, length + nose, max(1, th / 5), "#2e6bff")
            val wy = ty + max(1, th * 22 / 100); val wh = max(1, th / 5)
            run { var x = x0 + 2; while (x < x0 + length - 2) { a.px(x, wy, 2, wh, if (mod(x - x0 + 11, 5) == 0) "#ffd36b" else "#1b2a5a"); x += 3 } }
            val car = max(14, length / 4)
            run { var x = x0 + car; while (x < x0 + length) { a.px(x, ty, 1, th, "#b9b4d9"); x += car } }
            a.px(x0 + length + 1, wy, max(1, nose * (wy - ty + 1) / th - 2), wh, "#1b2a5a")
            a.px(x0 + length + nose - 3, ty + th - 2, 2, 1, "#fff27a")
            for (i in 0 until 6) a.px(x0 - 4 - mod(31300 + i, max(1, w / 12)), ty + mod(31400 + i, th), 3 + mod(31500 + i, 6), 1, "#ff8fb1")
        }
        twinkle(g, 0, 0, w, sea * 35 / 100, w * sea / 800, 550)
    }

    /** Deep space: nebulae, a ringed planet, a small moon and a shooting star. */
    private fun starlight(g: Grid) {
        val w = g.w; val h = g.h
        g.gradient(0, h, listOf("#04010d", "#0a0320", "#130632", "#1d0a45", "#2a0d55"))
        for (k in 0 until 4) {
            val nx = mod(40000 + k, w); val ny = mod(40100 + k, h); val nr = max(4, h * (20 + mod(40200 + k, 20)) / 100)
            for (y in ny - nr..ny + nr) {
                val half = isqrt(nr * nr - (y - ny) * (y - ny))
                for (x in nx - half..nx + half) {
                    if (((x + y) and 1) == 0 && mod(x * 7 + y * 13 + k, 3) != 0) g.px(x, y, 1, 1, if (k % 2 == 0) "#3a1060" else "#0f2a55")
                }
            }
        }
        g.stars(0, h, w * h / 45, 600, listOf("#fff6d6", "#ff9be6", "#bff8ff", "#ffd319"))
        // The planet: the ring's far half, the banded globe shaded on the right, the ring's near half.
        val pr = max(4, h * 26 / 100)
        val pcx = w * 70 / 100; val pcy = h * 55 / 100
        val rx = pr * 2; val ry = max(1, pr / 3)
        for (x in -rx..rx) g.px(pcx + x, pcy - ry * isqrt(rx * rx - x * x) / rx, 1, 1, "#1a8fa6")
        for (y in pcy - pr..pcy + pr) {
            val half = isqrt(pr * pr - (y - pcy) * (y - pcy))
            g.px(pcx - half, y, half * 2 + 1, 1, PLANET[min(PLANET.size - 1, (y - pcy + pr) * PLANET.size / (pr * 2 + 1))])
            val lit = half * 45 / 100
            g.px(pcx + lit, y, half - lit + 1, 1, "#4a1f7a")
        }
        for (x in -rx..rx) g.px(pcx + x, pcy + ry * isqrt(rx * rx - x * x) / rx, 1, 1, "#2ee6ff")
        val mr = max(2, h * 7 / 100)
        val mx = w * 40 / 100; val my = h * 30 / 100
        g.disc(mx, my, mr, "#c9a8ff")
        g.disc(mx + mr / 3, my - mr / 3, max(1, mr / 3), "#a98ae0")
        val tail = max(6, w * 12 / 100)
        val hx = w * 52 / 100; val hy = h * 30 / 100
        for (t in 0..tail) g.px(hx + t, hy - t / 3, 1, 1, if (t < 2) "#ffffff" else if (t < tail / 2) "#2ee6ff" else "#1a6f8f")
        shootingStar(g, 61000)
        twinkle(g, 0, 0, w, h, w * h / 160, 650)
    }

    /** Now and then a short streak crosses the upper sky. */
    private fun shootingStar(g: Grid, seed: Int) {
        val w = g.w; val h = g.h
        val length = max(4, w * 4 / 100)
        val x0 = w * (8 + mod(seed, 30)) / 100; val y0 = h * (6 + mod(seed + 1, 14)) / 100
        g.actor(dx = w * 26 / 100, dy = h * 13 / 100, period = 120 + mod(seed + 2, 60), on = 7, rest = 60) { a ->
            for (t in 0 until length) a.px(x0 + t, y0 + t / 2, 1, 1, if (t > length - 3) "#ffffff" else if (t > length / 2) "#bff8ff" else "#4f7cff")
        }
    }

    /** A bookshop at night: full shelves, a window on the city, a lamp's warm light and a cat. */
    private fun library(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val floor = h - max(2, h * 10 / 100)
        g.gradient(0, floor, listOf("#1a0d30", "#1f1038", "#241242"))
        run { var x = 3; while (x < w) { var y = x and 1; while (y < floor) { g.px(x, y, 1, 1, "#22123e"); y += 2 }; x += 8 } }
        // The window: night sky, a moon, the city's lights, the frame's cross.
        val wx = w * 74 / 100; val wy = h * 12 / 100; val ww = max(8, w * 18 / 100); val wh = max(8, h * 48 / 100)
        g.px(wx - s, wy - s, ww + 2 * s, wh + 2 * s, "#3b1d63")
        g.px(wx, wy, ww, wh, "#0b0420")
        g.px(wx, wy + wh - wh / 4, ww, wh / 4, "#1e0b45")
        for (i in 0 until ww * wh / 30) g.px(wx + mod(50000 + i, ww), wy + mod(50100 + i, max(1, wh - wh / 4)), 1, 1, "#fff6d6")
        g.disc(wx + ww * 70 / 100, wy + wh * 28 / 100, max(1, wh / 7), "#fff2c7")
        run {
            var x = wx
            while (x < wx + ww) {
                val t = 1 + mod(50200 + x, max(1, wh / 4))
                g.px(x, wy + wh - t, 2, t, "#0d0520")
                if (mod(50300 + x, 3) == 0) g.px(x, wy + wh - t + 1, 1, 1, "#ffd36b")
                x += 2
            }
        }
        g.px(wx + ww / 2, wy, s, wh, "#3b1d63")
        g.px(wx, wy + wh / 2, ww, s, "#3b1d63")
        // The bookcase.
        val left = w * 4 / 100; val right = wx - max(6, w * 10 / 100)
        val top = h * 8 / 100
        val rows = max(2, (floor - top) / 16)
        val gap = (floor - top) / rows
        g.px(left - 2 * s, top - s, 2 * s, floor - top + s, "#6b3a22")
        g.px(right, top - s, 2 * s, floor - top + s, "#6b3a22")
        g.px(left - 2 * s, top - 2 * s, right - left + 4 * s, 2 * s, "#7d4628")
        for (r in 0 until rows) {
            val board = top + (r + 1) * gap - s
            g.px(left, board - gap + s, right - left, gap - s, "#140a24")
            var x = left + 1; var i = r * 500
            while (x < right - 1) {
                val bw = (1 + mod(51000 + i, 3)) * s
                if (mod(51100 + i, 11) == 0) { x += bw + s; i++; continue }
                val bh = gap - s - 1 - mod(51200 + i, max(1, gap / 3))
                g.px(x, board - bh, min(bw, right - 1 - x), bh, BOOKS[mod(51300 + i, BOOKS.size)])
                if (mod(51400 + i, 4) == 0) g.px(x, board - bh + bh / 3, min(bw, right - 1 - x), 1, "#f4eeff")
                x += bw; i++
            }
            g.px(left, board, right - left, s, "#6b3a22")
        }
        // The floor, the lamp's light and the lamp, the cat under it.
        g.px(0, floor, w, h - floor, "#2b1626")
        g.px(0, floor, w, 1, "#4a2a3a")
        run { var x = 5; while (x < w) { g.px(x, floor + 1, 1, h - floor - 1, "#22111e"); x += 9 } }
        val lx = right + (wx - right) / 2
        val shade = h * 30 / 100
        val widest = max(s, (wx - right) / 2 - 2)
        for (y in shade until floor) {
            val half = min(widest, (y - shade) * 2 / 3 + s)
            for (x in lx - half..lx + half) if (((x + y) and 1) == 0) g.px(x, y, 1, 1, "#3a2346")
        }
        g.px(lx, shade, s, floor - shade, "#3b1d63")
        for (i in 0 until 3 * s) {
            val sw = 3 * s + i
            g.px(lx + s / 2 - sw / 2, shade - 3 * s + i, sw, 1, "#ffd319")
        }
        val catX = lx + 2 * s; val catY = floor - CAT.size * s
        for (y in CAT.indices) {
            for (x in CAT[y].indices) {
                val c = CAT[y][x]
                if (c != '.') g.px(catX + x * s, catY + y * s, s, s, if (c == 'o') "#ffd319" else "#07010f")
            }
        }
        g.actor(period = 45, delay = 30, on = 2) { a ->
            for (y in CAT.indices) for (x in CAT[y].indices) if (CAT[y][x] == 'o') a.px(catX + x * s, catY + y * s, s, s, "#07010f")
        }
        twinkle(g, wx, wy, wx + ww, wy + wh - wh / 4, ww * wh / 60, 52000)
    }

    /** A ramen stall at night: power lines, a glowing vending machine, red lanterns, steam and warm light on the street. */
    private fun ramenStand(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val ground = h - max(3, h * 20 / 100)
        g.gradient(0, ground, listOf("#0b0420", "#120632", "#1a0a40", "#24104d", "#2f1258"))
        g.stars(0, ground * 50 / 100, w * ground / 200, 700)
        twinkle(g, 0, 0, w, ground * 50 / 100, w * ground / 700, 750)
        val mr = max(3, h * 9 / 100)
        g.disc(w * 90 / 100, h * 10 / 100 + mr, mr, "#fff2c7")
        // Houses behind, a few windows still lit.
        run {
            var x = 0; var i = 0
            while (x < w) {
                val bw = 6 + mod(71000 + i, 10)
                val tall = ground * (25 + mod(71100 + i, 30)) / 100
                g.px(x, ground - tall, bw, tall, "#170b30")
                var wy = ground - tall + 2
                while (wy < ground - 1) {
                    var wx = x + 1
                    while (wx < x + bw - 1) { if (mod(wx * 53 + wy * 29 + 1, 11) == 0) g.px(wx, wy, 1, 1, "#ffcf7a"); wx += 3 }
                    wy += 3
                }
                x += bw; i++
            }
        }
        // The street, and the light the machine and the stall throw on it.
        g.px(0, ground, w, h - ground, "#120726")
        g.px(0, ground, w, 1, "#2a1650")
        val vmW = max(8, h * 26 / 100); val vmH = max(12, h * 46 / 100)
        val vmX = w * 36 / 100; val vmY = ground - vmH
        val stW = max(24, w * 28 / 100); val stX = w * 56 / 100
        for (y in ground + 1 until h) {
            val spread = (y - ground) * 3 / 2 + 2
            for (x in vmX - spread until vmX + vmW + spread) if (((x + y) and 1) == 0) g.px(x, y, 1, 1, "#173a58")
            for (x in stX - spread until stX + stW + spread) if (((x + y) and 1) == 0) g.px(x, y, 1, 1, "#4a2a1a")
        }
        // A pole on the left and two wires sagging across the sky.
        val poleX = w * 8 / 100; val wireY = h * 14 / 100
        g.px(poleX, wireY - 2 * s, 2 * s, ground - wireY + 2 * s, "#2a1a4d")
        g.px(poleX - 3 * s, wireY, 8 * s, s, "#2a1a4d")
        val span = max(1, w - poleX); val sag = max(2, h * 12 / 100)
        for (k in 0 until 2) {
            for (x in poleX until w) {
                val t = x - poleX
                g.px(x, wireY + k * 3 * s + 4 * sag * t * (span - t) / (span * span), 1, 1, "#3a2466")
            }
        }
        // The vending machine: blue casing, a lit window of drinks, the slot.
        g.px(vmX, vmY, vmW, vmH, "#2e6bff")
        g.px(vmX + vmW - s, vmY, s, vmH, "#1b2a8a")
        val winX = vmX + s; val winY = vmY + s; val winW = vmW - 3 * s; val winH = vmH * 60 / 100
        g.px(winX, winY, winW, winH, "#d6f6ff")
        run {
            var r = 0
            while (winY + 1 + r * 3 + 2 <= winY + winH - 1) {
                var x = winX + 1; var j = 0
                while (x + 1 < winX + winW) { g.px(x, winY + 1 + r * 3, 1, 2, DRINKS[mod(72000 + r * 31 + j, DRINKS.size)]); x += 2; j++ }
                r++
            }
        }
        g.px(vmX + s, vmY + vmH - 4 * s, vmW - 3 * s, 2 * s, "#140726")
        // The stall: posts, a red roof, the noren curtain, warm light inside, the counter.
        val roofY = h * 34 / 100
        val counterY = ground - h * 24 / 100
        g.px(stX + s, roofY, s, ground - roofY, "#5a2d1a")
        g.px(stX + stW - 2 * s, roofY, s, ground - roofY, "#5a2d1a")
        val norenH = max(3 * s, h * 16 / 100)
        g.px(stX + 2 * s, roofY + norenH, stW - 4 * s, max(1, counterY - roofY - norenH), "#ffcf7a")
        g.px(stX - s, roofY - 3 * s, stW + 2 * s, s, "#8a1f2e")
        g.px(stX - 3 * s, roofY - 2 * s, stW + 6 * s, 2 * s, "#8a1f2e")
        g.px(stX - 3 * s, roofY - 2 * s, stW + 6 * s, s, "#b8263b")
        val pw = max(2, stW / 4)
        for (k in 0 until 4) {
            g.px(stX + k * pw, roofY, pw - s, norenH, if (k % 2 == 0) "#ff3d6e" else "#e8325f")
            g.px(stX + k * pw + pw / 2 - s, roofY + norenH / 3, s, max(1, norenH / 3), "#fff6e8")
        }
        g.px(stX - s, counterY, stW + 2 * s, s, "#c27a45")
        g.px(stX, counterY + s, stW, ground - counterY - s, "#9a5a35")
        run { var x = stX + 2; while (x < stX + stW - 1) { g.px(x, counterY + s, 1, ground - counterY - s, "#7a4426"); x += 4 } }
        for (k in 0 until 3) g.px(stX + stW * (30 + k * 22) / 100, counterY - s, 2 * s, s, "#fff6e8")
        // A pot with its steam curling up past the curtain.
        val potX = stX + 2 * s
        g.px(potX, counterY - 2 * s, 3 * s, 2 * s, "#7d7896")
        frames(g, 12,
            { a -> for (t in 0 until 4) a.px(potX + (t % 2) * s, counterY - 3 * s - t * 2 * s, s, s, "#c9c3d9") },
            { a -> for (t in 0 until 4) a.px(potX + ((t + 1) % 2) * s, counterY - 4 * s - t * 2 * s, s, s, "#c9c3d9") })
        // Red lanterns at the corners of the roof.
        for (lx in intArrayOf(stX - 2 * s, stX + stW + s)) {
            val r = max(2, 2 * s)
            val top = roofY + s
            g.px(lx - s, top - s, 2 * s + 1, s, "#140726")
            g.disc(lx, top + r, r, "#ff3d3d")
            g.disc(lx, top + r, max(1, r - s), "#ff7a59")
            g.px(lx - s, top + 2 * r + 1, 2 * s + 1, s, "#140726")
            g.actor(period = 23 + mod(lx, 9), on = 3) { a -> a.disc(lx, top + r, max(1, r - s), "#ffb38a") }
        }
        // Stools before the counter.
        for (k in 0 until 3) {
            val sx = stX + stW * (18 + k * 28) / 100
            g.px(sx, ground - 3 * s, 3 * s, s, "#ff2a9d")
            g.px(sx + s, ground - 2 * s, s, 2 * s, "#3b1d63")
        }
    }

    /** Inside a game centre: a neon GAME sign, a row of glowing cabinets, a checkered floor. */
    private fun arcade(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val floor = h - max(3, h * 18 / 100)
        g.gradient(0, floor, listOf("#0b0420", "#120632", "#170838", "#1c0a3f"))
        run { var x = 3; while (x < w) { g.px(x, s, 3 * s, s, "#ffd36b"); x += 12 } }
        g.px(0, floor, w, h - floor, "#140a2e")
        run {
            var y = floor; var r = 0
            while (y < h) {
                var x = (r % 2) * 4
                while (x < w) { g.px(x, y, 4, 2, "#21124a"); x += 8 }
                y += 2; r++
            }
        }
        g.px(0, floor, w, 1, "#3b1d63")
        // The cabinets, from a third of the way across: trim, marquee, screen with a game on it, controls.
        val cabW = max(10, h * 34 / 100)
        val gap = max(3, cabW / 3)
        val cabH = h * 64 / 100
        val top = floor - cabH
        run {
            var x = w * 32 / 100; var i = 0
            while (x + cabW < w - 2) {
                val accent = CABINETS[mod(73000 + i, CABINETS.size)]
                for (y in floor + 1 until h) {
                    for (gx in x until x + cabW) if (((gx + y) and 1) == 0 && mod(gx * 7 + y, 3) == 0) g.px(gx, y, 1, 1, accent)
                }
                g.px(x, top, cabW, cabH, "#1a0f33")
                g.px(x, top, s, cabH, accent)
                g.px(x + cabW - s, top, s, cabH, accent)
                val mqH = max(2, cabH / 8)
                g.px(x + s, top + s, cabW - 2 * s, mqH, accent)
                val scY = top + s + mqH + s; val scH = max(4, cabH * 34 / 100)
                g.px(x + 2 * s, scY, cabW - 4 * s, scH, "#0a1840")
                val cabX = x; val cab = i
                val dots = { a: Grid, from: Int ->
                    for (k in from until from + 6) {
                        a.px(cabX + 3 * s + mod(74000 + cab * 7 + k, max(1, cabW - 6 * s)), scY + 1 + mod(75000 + cab * 7 + k, max(1, scH - 2)), 1, 1, SCREEN_DOTS[k % 3])
                    }
                }
                frames(g, 6 + mod(73100 + i, 5), { a -> dots(a, 0) }, { a -> dots(a, 50) })
                val cpY = scY + scH + s
                g.px(x - s, cpY, cabW + 2 * s, 2 * s, "#2a1650")
                g.px(x + 3 * s, cpY - s, s, s, "#ff3d3d")
                g.px(x + cabW / 2, cpY, s, s, "#ffd319")
                g.px(x + cabW / 2 + 2 * s, cpY, s, s, "#ff2a9d")
                g.px(x + cabW / 2 - s, cpY + 4 * s, 2 * s, 2 * s, "#ff7a59")
                x += cabW + gap; i++
            }
        }
        // The neon sign over them, with a dithered glow.
        val letter = 6 * s
        val signX = w * 62 / 100; val signY = max(2 * s, top - 7 * s)
        for (gy in signY - s until signY + 6 * s) {
            for (gx in signX - 2 * s until signX + letter * 4 + s) if (((gx + gy) and 1) == 0) g.px(gx, gy, 1, 1, "#3d0a3a")
        }
        for (c in GAME.indices) {
            val rows = GAME[c]
            for (y in rows.indices) {
                for (x in rows[y].indices) if (rows[y][x] == '#') g.px(signX + c * letter + x * s, signY + y * s, s, s, "#ff2a9d")
            }
        }
        g.actor(period = 70, delay = 20, on = 3) { a ->
            val rows = GAME[1]
            for (y in rows.indices) for (x in rows[y].indices) if (rows[y][x] == '#') a.px(signX + letter + x * s, signY + y * s, s, s, "#5a1040")
        }
    }

    /** A bedroom at night with everything saved for later: an episode on the CRT, a cabinet of tapes, floppies, the city outside. */
    private fun bedroom(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val floor = h - max(3, h * 16 / 100)
        g.gradient(0, floor, listOf("#1c0f33", "#221139", "#291545"))
        run { var x = 2; while (x < w) { var y = 1 + (x / 6) % 2; while (y < floor) { g.px(x, y, 1, 1, "#2e1a52"); y += 3 }; x += 6 } }
        // The window between drawn curtains: night sky, a moon, the city's lights.
        val wx = w * 40 / 100; val wy = h * 14 / 100
        val ww = max(10, w * 15 / 100); val wh = max(10, h * 46 / 100)
        g.px(wx - s, wy - s, ww + 2 * s, wh + 2 * s, "#4a2a6b")
        g.px(wx, wy, ww, wh, "#0e1440")
        val lower = wh * 62 / 100
        g.px(wx, wy + lower, ww, wh - lower, "#1d1650")
        for (i in 0 until ww * wh / 40) g.px(wx + mod(80000 + i, ww), wy + mod(80100 + i, max(1, lower)), 1, 1, "#fff6d6")
        g.disc(wx + ww * 72 / 100, wy + wh * 24 / 100, max(1, wh / 8), "#fff2c7")
        run {
            var x = wx
            while (x < wx + ww) {
                val t = 1 + mod(80200 + x, max(1, wh / 3))
                g.px(x, wy + wh - t, 2, t, "#0b0620")
                if (mod(80300 + x, 3) == 0) g.px(x, wy + wh - t + 1, 1, 1, "#ffd36b")
                x += 2
            }
        }
        g.px(wx + ww / 2, wy, s, wh, "#4a2a6b")
        g.px(wx, wy + wh / 2, ww, s, "#4a2a6b")
        g.px(wx - 4 * s, wy - 2 * s, 3 * s, wh + 5 * s, "#d92f5c")
        g.px(wx + ww + s, wy - 2 * s, 3 * s, wh + 5 * s, "#d92f5c")
        g.px(wx - 3 * s, wy - 2 * s, s, wh + 5 * s, "#a3203f")
        g.px(wx + ww + 2 * s, wy - 2 * s, s, wh + 5 * s, "#a3203f")
        // The floor.
        g.px(0, floor, w, h - floor, "#3a2030")
        g.px(0, floor, w, 1, "#5a3448")
        run { var x = 4; while (x < w) { g.px(x, floor + 1, 1, h - floor - 1, "#2c1825"); x += 10 } }
        // The cabinet of tapes and the TV on it, glowing on the wall behind.
        val standW = max(20, w * 24 / 100); val standX = w * 64 / 100
        val standH = max(5, h * 16 / 100); val standY = floor - standH
        val tvW = max(12, h * 48 / 100); val tvH = max(9, h * 36 / 100)
        val tvX = standX + (standW - tvW) / 2; val tvY = standY - tvH
        for (y in tvY - 3 * s until standY) {
            for (x in tvX - 4 * s until tvX + tvW + 4 * s) if (((x + y) and 1) == 0) g.px(x, y, 1, 1, "#253a66")
        }
        g.px(standX, standY, standW, standH, "#5a2d1a")
        g.px(standX, standY, standW, s, "#7d4628")
        run {
            var x = standX + 2 * s; var i = 0
            while (x + 2 * s <= standX + standW - 2 * s) {
                g.px(x, standY + 2 * s, 2 * s, standH - 3 * s, "#141019")
                g.px(x, standY + 3 * s, 2 * s, s, TAPES[mod(81000 + i, TAPES.size)])
                x += 3 * s; i++
            }
        }
        g.px(tvX, tvY, tvW, tvH, "#3a3247")
        g.px(tvX, tvY, tvW, s, "#544a66")
        val scW = tvW - 6 * s; val scH = tvH - 4 * s
        // On the screen, paused on a nice frame: a sunset over the sea.
        g.px(tvX + 2 * s, tvY + 2 * s, scW, scH / 2, "#ff9fb8")
        g.disc(tvX + 2 * s + scW / 2, tvY + 2 * s + scH / 2, max(1, scH / 4), "#ffd319")
        g.px(tvX + 2 * s, tvY + 2 * s + scH / 2, scW, scH - scH / 2, "#2e6bff")
        g.px(tvX + 2 * s, tvY + 2 * s + scH / 2, scW, s, "#bff8ff")
        g.actor(dy = max(1, scH - s), period = 40, on = 40) { a -> a.px(tvX + 2 * s, tvY + 2 * s, scW, max(1, s / 2), "#fff6e8") }
        twinkle(g, wx, wy, wx + ww, wy + lower, ww * wh / 70, 80500)
        g.px(tvX + tvW - 3 * s, tvY + 2 * s, 2 * s, s, "#ff2a9d")
        g.px(tvX + tvW - 3 * s, tvY + 4 * s, 2 * s, s, "#ffd319")
        for (t in 1..4 * s) {
            g.px(tvX + tvW / 2 - t, tvY - t, 1, 1, "#a9a3c2")
            g.px(tvX + tvW / 2 + t, tvY - t, 1, 1, "#a9a3c2")
        }
        // A stack of floppies on the floor, a plant in the corner.
        for (k in 0 until 3) {
            val fx = w * 54 / 100 + k * s; val fy = h - 2 * s - k * 2 * s
            g.px(fx, fy, 6 * s, 2 * s, TAPES[k])
            g.px(fx + 2 * s, fy, 2 * s, s, "#c9c3d9")
        }
        val potX = w * 93 / 100
        g.px(potX, floor - 4 * s, 4 * s, 4 * s, "#c27a45")
        for (k in 0 until 7) {
            g.px(potX - 2 * s + mod(82000 + k, 8 * s), floor - 6 * s - mod(82100 + k, 6 * s), 2 * s, s, if (k % 2 == 0) "#5ce1a5" else "#1f8a5a")
        }
    }

    /** A little cinema: the projector's beam over the seats, an episode on the screen between red curtains. */
    private fun cinema(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        g.gradient(0, h, listOf("#0b0420", "#10052a", "#150732"))
        val sx = w * 40 / 100; val sy = h * 8 / 100; val sw = w * 54 / 100; val sh = h * 48 / 100
        for (y in 0 until sh) g.px(sx, sy + y, sw, 1, SCREEN_SKY[min(SCREEN_SKY.size - 1, y * SCREEN_SKY.size / max(1, sh))])
        g.disc(sx + sw * 70 / 100, sy + sh * 62 / 100, max(2, sh / 6), "#fff27a")
        for (x in sx until sx + sw) {
            val hill = sh * (18 + mod(83000 + (x - sx) / 6, 10)) / 100
            g.px(x, sy + sh - hill, 1, hill, "#1f8a5a")
        }
        val fx = sx + sw * 30 / 100; val fy = sy + sh - sh * 22 / 100
        g.px(fx, fy - 4 * s, 2 * s, 4 * s, "#140726")
        g.px(fx + 4 * s, fy - 5 * s, 2 * s, 5 * s, "#140726")
        // Curtains and their valance.
        g.px(sx - 5 * s, sy - s, 5 * s, sh + 3 * s, "#a3182e")
        g.px(sx + sw, sy - s, 5 * s, sh + 3 * s, "#a3182e")
        run {
            var k = 1
            while (k < 5) {
                g.px(sx - 5 * s + k * s, sy - s, s, sh + 3 * s, "#7a1224")
                g.px(sx + sw + k * s, sy - s, s, sh + 3 * s, "#7a1224")
                k += 2
            }
        }
        g.px(sx - 5 * s, sy - 3 * s, sw + 10 * s, 2 * s, "#7a1224")
        // The projector's beam from the back of the hall.
        val bx = w * 8 / 100; val by = h * 6 / 100
        val reach = max(1, sx - bx)
        for (x in bx until sx) {
            val t = x - bx
            val top = by + (sy - by) * t / reach; val bottom = by + (sy + sh - by) * t / reach
            for (y in top..bottom) if (((x + y) and 1) == 0 && mod(x * 3 + y, 4) == 0) g.px(x, y, 1, 1, "#4a3f7a")
        }
        val beam = { a: Grid, pick: Int ->
            for (x in bx until sx) {
                val t = x - bx
                val top = by + (sy - by) * t / reach; val bottom = by + (sy + sh - by) * t / reach
                for (y in top..bottom) if (((x + y) and 1) == 0 && mod(x * 3 + y, 4) == pick) a.px(x, y, 1, 1, "#6a5fa0")
            }
        }
        frames(g, 4, { a -> beam(a, 1) }, { a -> beam(a, 2) })
        g.px(bx - 2 * s, by - s, 3 * s, 2 * s, "#d7d0e8")
        // Rows of seats, a few heads watching.
        val rowH = max(3, h * 10 / 100)
        for (r in 0 until 3) {
            val y = h - (3 - r) * rowH
            g.px(0, y + s, w, rowH - s, if (r % 2 == 0) "#4a0f1f" else "#3a0c19")
            var x = (r % 2) * 3 * s; var i = 0
            while (x < w) {
                g.px(x, y, 4 * s, 2 * s, "#5a1426")
                if (mod(84000 + r * 97 + i, 4) == 0) g.disc(x + 2 * s, y - 2 * s, max(1, s + s / 2), "#07010f")
                x += 6 * s; i++
            }
        }
        run { var x = 2; while (x < w) { g.px(x, h - s, s, s, "#ffd36b"); x += 16 } }
    }

    /** A broadcast tower over the town at night, the newest episodes going out on its waves. */
    private fun tower(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val ground = h - max(3, h * 18 / 100)
        g.gradient(0, ground, listOf("#08031c", "#0f0630", "#1a0b45", "#2a1158"))
        g.stars(0, ground * 60 / 100, w * ground / 180, 800)
        // The tower: flaring legs in red and white bands, lattice, a lit deck, the antenna and its waves.
        val cx = w * 66 / 100
        val top = h * 12 / 100; val base = ground + (h - ground) / 2
        val span = max(1, base - top)
        val baseHalf = max(4, h * 24 / 100)
        val band = max(2, span / 8)
        for (y in top until base) {
            val half = baseHalf * (y - top) * (y - top) / (span * span) + s
            val color = if ((y - top) / band % 2 == 0) "#ff5a36" else "#fff6e8"
            g.px(cx - half, y, s, 1, color)
            g.px(cx + half, y, s, 1, color)
            val step = (y - top) - (y - top) / band * band
            val off = 2 * half * step / band
            g.px(cx - half + off, y, 1, 1, color)
            g.px(cx + half - off, y, 1, 1, color)
            if (step == 0) g.px(cx - half, y, half * 2 + s, 1, color)
        }
        val deckY = top + span * 35 / 100
        val deckHalf = baseHalf * (deckY - top) * (deckY - top) / (span * span) + 3 * s
        g.px(cx - deckHalf, deckY, deckHalf * 2 + s, 3 * s, "#2a1650")
        run { var x = cx - deckHalf + s; while (x < cx + deckHalf) { g.px(x, deckY + s, 1, s, "#ffd36b"); x += 2 } }
        val antenna = max(3, h * 9 / 100)
        g.px(cx, top - antenna, s, antenna, "#d7d0e8")
        g.px(cx, top - antenna - s, s, s, "#ff3d3d")
        // The waves going out, one ring after another; the warning light blinks.
        for (k in 1..3) {
            val r = k * 4 * s
            val reach = r * 6 / 10
            g.actor(period = 24, delay = (24 - (k - 1) * 8) % 24, on = 14) { a ->
                for (dy in -reach..reach) {
                    val dx = isqrt(r * r - dy * dy)
                    if (((dy + k) and 1) == 0) {
                        a.px(cx + dx, top - antenna + dy, 1, 1, "#2ee6ff")
                        a.px(cx - dx, top - antenna + dy, 1, 1, "#2ee6ff")
                    }
                }
            }
        }
        g.actor(period = 16, on = 8, rest = 8) { a -> a.px(cx, top - antenna - s, s, s, "#5a1a2a") }
        twinkle(g, 0, 0, w, ground * 60 / 100, w * ground / 600, 850)
        // The town in front, its windows lit.
        run {
            var x = 0; var i = 0
            while (x < w) {
                val bw = 4 + mod(85000 + i, 7)
                val tall = max(2, h * (8 + mod(85100 + i, 18)) / 100)
                g.px(x, ground - tall, bw, h - ground + tall, "#120826")
                var wy = ground - tall + 1
                while (wy < h - 1) {
                    var wx = x + 1
                    while (wx < x + bw - 1) {
                        if (mod(wx * 41 + wy * 13 + 5, 6) == 0) g.px(wx, wy, 1, 1, if (mod(wx + wy, 3) == 0) "#ff7ad9" else "#ffd36b")
                        wx += 2
                    }
                    wy += 2
                }
                x += bw; i++
            }
        }
    }

    /** An observatory on a hill under the Milky Way, its telescope out, a comet passing. */
    private fun observatory(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        g.gradient(0, h, listOf("#030414", "#07082a", "#0d0d3d", "#16114d"))
        val half = max(2, h * 12 / 100)
        for (x in 0 until w) {
            val cy = h * 70 / 100 - x * h * 55 / (100 * w)
            for (y in cy - half..cy + half) {
                val d = kotlin.math.abs(y - cy)
                if (((x + y) and 1) == 0 && mod(x * 31 + y * 17, half + 1) >= d) g.px(x, y, 1, 1, if (d * 2 < half) "#2c2470" else "#1f1a58")
            }
        }
        g.stars(0, h, w * h / 50, 900, listOf("#fff6d6", "#bff8ff", "#ffd319", "#c9a8ff"))
        val kx = w * 50 / 100; val ky = h * 18 / 100; val tail = max(6, w * 10 / 100)
        for (t in 0..tail) g.px(kx + t, ky - t / 4, 1, 1, if (t < 2) "#ffffff" else if (t < tail / 2) "#bff8ff" else "#4f7cff")
        // The hill.
        val peakX = w * 74 / 100; val peakY = h * 64 / 100
        val flat = max(1, w * w / 6)
        for (x in 0 until w) {
            val d = x - peakX
            val top = min(h, peakY + (h - peakY) * d * d / flat)
            g.px(x, top, 1, h - top, "#0a0718")
        }
        // The observatory: a white drum and dome, the slit open, the telescope out, a lit door.
        val bw = max(8, h * 30 / 100); val bh = max(4, h * 14 / 100)
        val bx = peakX - bw / 2; val by = peakY - bh
        g.px(bx, by, bw, bh, "#cfc8e2")
        g.px(bx + bw * 60 / 100, by, bw - bw * 60 / 100, bh, "#9a93b8")
        g.px(bx + bw / 2 - s, by + bh / 2, 2 * s, bh - bh / 2, "#ffd36b")
        val r = bw / 2
        for (y in by - r until by) {
            val dome = isqrt(r * r - (y - by) * (y - by))
            g.px(peakX - dome, y, dome * 2 + 1, 1, "#e8e2f5")
            g.px(peakX + dome / 3, y, dome - dome / 3 + 1, 1, "#b7b0cf")
        }
        g.px(peakX - s, by - r, 2 * s, r, "#14102e")
        for (t in 0 until max(4, r * 3 / 2)) g.px(peakX - t, by - r / 2 - t, 2 * s, 2 * s, "#7d7896")
        shootingStar(g, 91000)
        twinkle(g, 0, 0, w, h * 60 / 100, w * h / 200, 950)
    }

    /** A station at night: the departure board's next trains, the clock, the yellow line, the town across the tracks. */
    private fun station(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val roofH = max(3, h * 14 / 100)
        val platform = h * 76 / 100
        val tracks = platform - 4 * s
        g.gradient(0, platform, listOf("#0b0420", "#140733", "#1f0b45", "#2c1157"))
        g.stars(roofH, platform * 60 / 100, w * platform / 260, 1000)
        // The town across the tracks.
        run {
            var x = 0; var i = 0
            while (x < w) {
                val bw = 5 + mod(86000 + i, 8)
                val tall = max(2, h * (6 + mod(86100 + i, 14)) / 100)
                g.px(x, tracks - tall, bw, tall, "#170b30")
                var wy = tracks - tall + 1
                while (wy < tracks - 1) {
                    var wx = x + 1
                    while (wx < x + bw - 1) { if (mod(wx * 29 + wy * 7 + 3, 7) == 0) g.px(wx, wy, 1, 1, "#ffd36b"); wx += 3 }
                    wy += 2
                }
                x += bw; i++
            }
        }
        // The tracks.
        g.px(0, tracks, w, platform - tracks, "#1a1228")
        g.px(0, tracks + s, w, 1, "#7d7896")
        g.px(0, platform - s, w, 1, "#7d7896")
        run { var x = 1; while (x < w) { g.px(x, tracks + s + 1, 2, platform - tracks - 2 * s - 1, "#2a1f3d"); x += 5 } }
        // The roof, its lamps and pillars.
        g.px(0, 0, w, roofH, "#120a26")
        g.px(0, roofH, w, s, "#2a1650")
        run { var x = 6; while (x < w) { g.px(x, roofH + s, 3 * s, s, "#ffd36b"); x += 14 } }
        val pillarStep = max(24, w * 22 / 100)
        run { var x = w * 10 / 100; while (x < w) { g.px(x, roofH, 2 * s, platform - roofH, "#1c1238"); x += pillarStep } }
        // The departure board: the next train in cyan, the rest in amber.
        val bx = w * 44 / 100; val bwid = max(16, w * 32 / 100)
        val by = roofH + 2 * s; val bhgt = max(8, h * 28 / 100)
        g.px(bx + bwid / 4, roofH, s, 2 * s, "#2a1650")
        g.px(bx + bwid * 3 / 4, roofH, s, 2 * s, "#2a1650")
        g.px(bx, by, bwid, bhgt, "#07040f")
        g.px(bx, by, bwid, s, "#3b2a52")
        run {
            var r = 0
            while (by + 2 * s + r * 3 * s + s <= by + bhgt - s) {
                val y = by + 2 * s + r * 3 * s
                val color = if (r == 0) "#2ee6ff" else "#ffb02e"
                g.px(bx + 2 * s, y, 5 * s, s, color)
                val end = min(bx + bwid - 2 * s, bx + 9 * s + bwid * (30 + mod(87000 + r, 35)) / 100)
                var x = bx + 9 * s
                while (x < end) { g.px(x, y, s, s, color); x += 2 * s }
                r++
            }
        }
        // The clock.
        val cr = max(3, h * 9 / 100); val ccx = w * 88 / 100; val ccy = roofH + cr + 2 * s
        g.px(ccx, roofH, s, 2 * s, "#2a1650")
        g.disc(ccx, ccy, cr, "#fff6e8")
        g.px(ccx, ccy - cr + s, s, cr - s, "#140726")
        g.px(ccx, ccy, cr * 2 / 3, s, "#140726")
        // The platform, its yellow line, a bench.
        g.px(0, platform, w, h - platform, "#2a1f3d")
        g.px(0, platform, w, s, "#ffd319")
        run { var x = 2; while (x < w) { g.px(x, platform + 2 * s, 4, s, "#352a4d"); x += 8 } }
        val benchX = w * 62 / 100
        g.px(benchX, platform - 3 * s, 8 * s, s, "#9a5a35")
        g.px(benchX + s, platform - 2 * s, s, 2 * s, "#5a2d1a")
        g.px(benchX + 6 * s, platform - 2 * s, s, 2 * s, "#5a2d1a")
        // A train through the station now and then, right to left, its windows lit.
        val trainH = max(4, h * 18 / 100); val trainY = platform - s - trainH; val trainL = w * 70 / 100
        g.actor(dx = -2 * (w + trainL), period = 260, delay = 130) { a ->
            a.px(w, trainY, trainL, trainH, "#c9d3e8")
            a.px(w, trainY + trainH - 2 * s, trainL, s, "#2e6bff")
            run { var x = w + 2 * s; while (x < w + trainL - 2 * s) { a.px(x, trainY + s, 2 * s, max(1, trainH / 3), "#ffd36b"); x += 4 * s } }
            run { var x = w + trainL / 4; while (x < w + trainL) { a.px(x, trainY, 1, trainH, "#8f9ab8"); x += trainL / 4 } }
            a.px(w, trainY + trainH / 2, s, s, "#fff27a")
        }
        g.actor(period = 12, on = 4, rest = 6) { a -> a.px(bx + 2 * s, by + 2 * s, 5 * s, s, "#07040f") }
    }

    /** A desk at night: a beige computer's green prompt, the keyboard, a lamp, a mug, books and floppies on the shelf. */
    private fun terminal(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val desk = h * 72 / 100
        g.gradient(0, desk, listOf("#0e0820", "#130a2a", "#180c33"))
        // The shelf over the desk.
        val shelfY = h * 24 / 100; val shelfX = w * 38 / 100; val shelfW = max(12, w * 20 / 100)
        g.px(shelfX, shelfY, shelfW, s, "#7d4628")
        run {
            var x = shelfX + s; var i = 0
            while (x < shelfX + shelfW - 2 * s) {
                val bw = (2 + mod(88000 + i, 2)) * s
                val bh = max(3, h * (8 + mod(88100 + i, 6)) / 100)
                g.px(x, shelfY - bh, bw, bh, BOOKS[mod(88200 + i, BOOKS.size)])
                x += bw + (if (mod(88300 + i, 4) == 0) s else 0)
                i++
            }
        }
        // The desk.
        val deskX = w * 34 / 100
        g.px(0, desk, w, h - desk, "#24121e")
        g.px(deskX, desk, w - deskX, h - desk, "#5a2d1a")
        g.px(deskX, desk, w - deskX, s, "#9a5a35")
        // The monitor's green glow on the wall, then the monitor: beige, a green prompt, the cursor.
        val mw = max(14, h * 54 / 100); val mh = max(10, h * 42 / 100)
        val mx = w * 58 / 100; val my = desk - mh - 2 * s
        for (y in my - 3 * s until desk) {
            for (x in mx - 4 * s until mx + mw + 4 * s) if (((x + y) and 1) == 0) g.px(x, y, 1, 1, "#17392a")
        }
        g.px(mx, my, mw, mh, "#d8cdb8")
        g.px(mx + mw - 2 * s, my, 2 * s, mh, "#b0a690")
        val scX = mx + 2 * s; val scY = my + 2 * s; val scW = mw - 5 * s; val scH = mh - 5 * s
        g.px(scX, scY, scW, scH, "#08140e")
        var lastY = scY + s; var lastEnd = scX + s
        run {
            var r = 0
            while (scY + s + r * 2 * s + s <= scY + scH - s) {
                val y = scY + s + r * 2 * s
                val len = max(2, mod(89000 + r, max(1, scW - 3 * s)))
                g.px(scX + s, y, len, s, "#5ce1a5")
                lastY = y; lastEnd = scX + s + len
                r++
            }
        }
        g.actor(period = 10, on = 5) { a -> a.px(min(lastEnd + s, scX + scW - 2 * s), lastY, s, s, "#bff8ff") }
        g.px(mx + mw / 2 - 2 * s, my + mh, 4 * s, 2 * s, "#b0a690")
        // The keyboard.
        g.px(mx - 2 * s, desk + s, mw + 4 * s, 2 * s, "#d8cdb8")
        run { var x = mx - s; while (x < mx + mw + 2 * s) { g.px(x, desk + s, 1, 1, "#8f8a7a"); x += 2 } }
        // The computer: a beige tower with its lights and a floppy slot.
        val tx = mx + mw + 3 * s; val tw = max(4, 5 * s); val th = mh + 2 * s
        g.px(tx, desk - th, tw, th, "#d8cdb8")
        g.px(tx + s, desk - th + 2 * s, tw - 2 * s, s, "#5a5348")
        g.px(tx + s, desk - th + 4 * s, s, s, "#5ce1a5")
        g.px(tx + 3 * s, desk - th + 4 * s, s, s, "#ff3d3d")
        // A desk lamp's warm light, a mug with steam.
        val lx = deskX + 4 * s; val ly = desk - h * 30 / 100
        for (y in ly + 2 * s until desk) {
            val spread = (y - ly) * 2 / 3
            for (x in lx - spread..lx + spread) if (((x + y) and 1) == 0) g.px(x, y, 1, 1, "#4a2a1f")
        }
        g.px(lx, ly, s, desk - ly, "#3b1d63")
        g.px(lx - 2 * s, ly, 5 * s, 2 * s, "#ffd319")
        val cupX = mx - 6 * s
        g.px(cupX, desk - 3 * s, 3 * s, 3 * s, "#ff2a9d")
        g.px(cupX + 3 * s, desk - 2 * s, s, s, "#ff2a9d")
        frames(g, 12,
            { a -> for (t in 0 until 3) a.px(cupX + s + (t % 2) * s, desk - 4 * s - t * 2 * s, s, s, "#8f88ad") },
            { a -> for (t in 0 until 3) a.px(cupX + s + ((t + 1) % 2) * s, desk - 5 * s - t * 2 * s, s, s, "#8f88ad") })
    }

    /** A concert stage: spotlights, an equalizer glowing behind the band, light sticks up in the crowd. */
    private fun stage(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val deckY = h * 70 / 100
        val deckH = max(3, h * 7 / 100)
        val stageX = w * 34 / 100
        g.gradient(0, deckY, listOf("#07021a", "#0d0428", "#140633", "#1d0940"))
        // The rig and the soft cones of its spotlights.
        val rigY = h * 4 / 100
        g.px(stageX, rigY, w - stageX, s, "#2a1650")
        for (k in SPOT_X.indices) {
            val lx = w * SPOT_X[k] / 100; val ly = rigY + s
            for (y in ly + s until deckY) {
                val spread = (y - ly) * 2 / 5
                val mid = lx + (y - ly) * SPOT_LEAN[k] / 10
                for (x in mid - spread..mid + spread) if (((x + y) and 1) == 0) g.px(x, y, 1, 1, SPOT_GLOW[k])
            }
            g.px(lx - s, ly - s, 2 * s, 2 * s, "#fff6e8")
        }
        // The equalizer down to the deck: columns of segments, pink at the bottom to cyan at the top.
        val ex = w * 38 / 100; val eTop = h * 12 / 100; val eBottom = deckY - s
        val eSpan = max(1, eBottom - eTop)
        val peaks = listOf(ArrayList<IntArray>(), ArrayList<IntArray>())
        run {
            var x = ex; var i = 0
            while (x + 2 * s <= w - 2 * s) {
                val tall = max(2 * s, eSpan * (30 + mod(76000 + i, 71)) / 100)
                var y = eBottom - tall
                while (y < eBottom) {
                    g.px(x, y, 2 * s, s, EQUALIZER[min(EQUALIZER.size - 1, (eBottom - y) * EQUALIZER.size / eSpan)])
                    y += 2 * s
                }
                peaks[i % 2].add(intArrayOf(x, eBottom - tall))
                x += 3 * s; i++
            }
        }
        // The bars bounce: every other one jumps two segments, then the rest.
        val bounce = { a: Grid, set: List<IntArray> ->
            for ((x, top) in set) for (k in 1..2) if (top - 2 * s * k >= eTop - 2 * s) a.px(x, top - 2 * s * k, 2 * s, s, EQUALIZER[EQUALIZER.size - 1])
        }
        frames(g, 6, { a -> bounce(a, peaks[0]) }, { a -> bounce(a, peaks[1]) })
        // The deck, its footlights, an amp at each side.
        g.px(stageX, deckY, w - stageX, deckH, "#2a1650")
        g.px(stageX, deckY, w - stageX, s, "#4a2a7a")
        run { var x = stageX + 2; while (x < w) { g.px(x, deckY + deckH - s, 2, s, "#ffd36b"); x += 6 } }
        val ampW = 6 * s; val ampH = 8 * s
        for (ax in intArrayOf(stageX + 2 * s, w - 3 * s - ampW)) {
            g.px(ax, deckY - ampH, ampW, ampH, "#07010f")
            g.px(ax + s, deckY - ampH + s, ampW - 2 * s, ampH - 2 * s, "#1a0f2a")
        }
        // The band against the glow: a guitarist with a pink guitar, the singer at the microphone, the drummer.
        val tall = max(10, h * 36 / 100)
        for (fx in intArrayOf(w * 52 / 100, w * 66 / 100)) {
            g.disc(fx + s, deckY - tall + 2 * s, max(1, 2 * s), "#07010f")
            g.px(fx - s, deckY - tall + 4 * s, 5 * s, tall - 7 * s, "#07010f")
            g.px(fx - s, deckY - 3 * s, 2 * s, 3 * s, "#07010f")
            g.px(fx + 2 * s, deckY - 3 * s, 2 * s, 3 * s, "#07010f")
        }
        val guitarX = w * 52 / 100
        for (t in 0 until 8 * s) g.px(guitarX - 3 * s + t, deckY - tall / 2 + t / 2, s, s, "#ff2a9d")
        g.px(guitarX - 4 * s, deckY - tall / 2 - s, 2 * s, 2 * s, "#ff2a9d")
        val micX = w * 66 / 100 - 3 * s
        g.px(micX, deckY - tall * 3 / 4, s, tall * 3 / 4, "#c9c3d9")
        g.px(micX - s, deckY - tall * 3 / 4 - s, 2 * s, 2 * s, "#fff6e8")
        val drumX = w * 82 / 100; val drum = max(3, 4 * s)
        g.disc(drumX, deckY - 2 * drum - 2 * s, max(1, 2 * s), "#07010f")
        g.px(drumX - 2 * s, deckY - 2 * drum, 5 * s, drum, "#07010f")
        g.disc(drumX, deckY - drum, drum, "#07010f")
        g.disc(drumX, deckY - drum, max(1, drum - s), "#ff2a9d")
        g.px(drumX + drum + s, deckY - 2 * drum - 3 * s, 5 * s, s, "#ffd319")
        g.px(drumX + drum + 3 * s, deckY - 2 * drum - 2 * s, s, 2 * drum + 2 * s, "#c9c3d9")
        // The crowd in the light off the stage, light sticks up.
        val crowdTop = deckY + deckH
        g.px(0, crowdTop, w, h - crowdTop, "#24104d")
        for (y in crowdTop until h) { var x = y and 1; while (x < w) { g.px(x, y, 1, 1, "#33166a"); x += 2 } }
        run {
            var x = -s; var i = 0
            while (x < w) {
                val hy = crowdTop + 2 * s + mod(77000 + i, 3) * s
                g.disc(x + 2 * s, hy, max(1, s + s / 2), "#07010f")
                g.px(x, hy + s, 4 * s, h - hy - s, "#07010f")
                if (mod(77100 + i, 3) == 0) {
                    g.px(x + 3 * s, hy - 4 * s, s, 4 * s, "#07010f")
                    g.px(x + 3 * s, hy - 8 * s, s, 4 * s, LIGHT_STICKS[mod(77200 + i, LIGHT_STICKS.size)])
                }
                x += 4 * s; i++
            }
        }
    }

    /** Music notes drifting up and to the left of ([x], [y]), seeded by [seed]. */
    private fun notes(g: Grid, x: Int, y: Int, count: Int, s: Int, seed: Int) {
        for (k in 0 until count) {
            val color = NOTE_COLORS[mod(seed + k, NOTE_COLORS.size)]
            val nx = x - k * 7 * s - mod(seed + 10 + k, 4) * s; val ny = y - k * 5 * s - mod(seed + 20 + k, 3) * s
            // Each rises a little and goes, one after another.
            g.actor(dy = -3 * s, period = 30, delay = k * 10, on = 24) { a -> a.sprite(NOTE, nx, ny, s, mapOf('#' to color)) }
        }
    }

    /** All time: a jukebox glowing in a diner at night, its arch of colours, records and buttons, notes rising. */
    private fun jukebox(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val floor = h - max(4, h * 20 / 100)
        g.gradient(0, floor, listOf("#0c0420", "#140733", "#1b0a40", "#24104d"))
        run { var x = 6; while (x < w) { g.px(x, 0, 1, floor, "#1d0b3a"); x += 12 } }
        // The checkered floor and a neon strip along the wall.
        g.px(0, floor, w, h - floor, "#1a0f2e")
        val tile = max(2, 3 * s)
        run {
            var y = floor; var r = 0
            while (y < h) {
                var x = (r % 2) * tile
                while (x < w) { g.px(x, y, tile, tile, "#3b2a5a"); x += tile * 2 }
                y += tile; r++
            }
        }
        g.px(0, floor - s, w, s, "#ff2a9d")
        // The diner's counter and stools on the left.
        val counterW = w * 42 / 100; val counterY = floor - h * 22 / 100
        g.px(0, counterY, counterW, 2 * s, "#ff3d6e")
        g.px(0, counterY + 2 * s, counterW, floor - counterY - 3 * s, "#2a1650")
        run {
            var x = w * 5 / 100
            while (x < counterW - 2 * s) {
                g.px(x - 2 * s, floor - 9 * s, 6 * s, 2 * s, "#ff3d6e")
                g.px(x, floor - 7 * s, 2 * s, 7 * s, "#c9c3d9")
                x += max(8 * s, w * 9 / 100)
            }
        }
        // The jukebox, glowing on the wall behind it.
        val jw = max(16, h * 50 / 100); val jh = max(22, h * 66 / 100)
        val r = jw / 2; val acx = w * 74 / 100; val jx = acx - r
        val acy = floor - jh + r
        for (y in acy - r - 4 * s until floor) {
            for (x in jx - 6 * s until jx + jw + 6 * s) if (((x + y) and 1) == 0 && mod(x * 7 + y * 3, 3) == 0) g.px(x, y, 1, 1, "#4a1a5a")
        }
        for (band in JUKE_ARCH.indices) {
            val rr = r - band * s
            if (rr <= 0) break
            for (y in acy - rr..acy) {
                val half = isqrt(rr * rr - (y - acy) * (y - acy))
                g.px(acx - half, y, half * 2 + 1, 1, JUKE_ARCH[band])
            }
        }
        val inner = r - JUKE_ARCH.size * s
        if (inner > 2) {
            for (y in acy - inner..acy) {
                val half = isqrt(inner * inner - (y - acy) * (y - acy))
                g.px(acx - half, y, half * 2 + 1, 1, "#140726")
            }
            g.disc(acx, acy - inner / 3, max(2, inner / 2), "#07010f")
            g.disc(acx, acy - inner / 3, max(1, inner / 6), "#ff2a9d")
            g.line(acx + inner * 2 / 3, acy - inner * 2 / 3, acx + inner / 6, acy - inner / 3, "#c9c3d9", s)
        }
        g.px(jx, acy, jw, floor - acy, "#8a1f3a")
        g.px(jx, acy, 2 * s, floor - acy, "#d7d0e8")
        g.px(jx + jw - 2 * s, acy, 2 * s, floor - acy, "#9a93b8")
        val panelY = acy + 2 * s; val panelH = max(4 * s, (floor - acy) / 3)
        g.px(jx + 3 * s, panelY, jw - 6 * s, panelH, "#d7d0e8")
        run {
            var y = panelY + s; var row = 0
            while (y + s < panelY + panelH) {
                var x = jx + 4 * s; var col = 0
                while (x + s < jx + jw - 4 * s) { g.px(x, y, s, s, BUTTONS[mod(90000 + row * 13 + col, BUTTONS.size)]); x += 2 * s; col++ }
                y += 2 * s; row++
            }
        }
        val grilleY = panelY + panelH + 2 * s
        g.px(jx + 3 * s, grilleY, jw - 6 * s, max(s, floor - grilleY - 3 * s), "#2a0f1f")
        run { var y = grilleY + s; while (y < floor - 3 * s) { g.px(jx + 4 * s, y, jw - 8 * s, s, "#ff7f3f"); y += 2 * s } }
        g.px(jx + s, floor - 2 * s, 3 * s, 2 * s, "#c9c3d9")
        g.px(jx + jw - 4 * s, floor - 2 * s, 3 * s, 2 * s, "#c9c3d9")
        for (x in jx - 4 * s until jx + jw + 4 * s) if ((x and 1) == 0) g.px(x, floor, 1, s, "#ff7ad9")
        notes(g, jx - 3 * s, floor - jh / 2, 4, s, 90100)
    }

    /** The 1960s: a valve radio on the chest of drawers, its dial aglow, the evening sun through the window, the clock on the wall. */
    private fun radio(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val floor = h - max(4, h * 14 / 100)
        g.gradient(0, floor, listOf("#1e0b2a", "#271033", "#30153a"))
        run { var x = 5; while (x < w) { g.px(x, 0, s, floor, "#2a1236"); x += 10 } }
        g.px(0, floor, w, h - floor, "#2a1420")
        run { var x = 7; while (x < w) { g.px(x, floor + s, 1, h - floor - s, "#1e0e18"); x += 14 } }
        g.px(0, floor, w, s, "#4a2430")
        // The window on the evening: the sun going down behind the roofs, a TV aerial, the power lines.
        val wx = w * 8 / 100; val wy = h * 12 / 100; val ww = max(16, w * 26 / 100); val wh = h * 50 / 100
        g.px(wx - s, wy - s, ww + 2 * s, wh + 2 * s, "#5a2d1a")
        for (y in 0 until wh) g.px(wx, wy + y, ww, 1, EVENING[min(EVENING.size - 1, y * EVENING.size / max(1, wh))])
        val sr = max(2, min(ww, wh) / 4); val scx = wx + ww * 64 / 100; val scy = wy + wh * 56 / 100
        for (y in scy - sr..scy + sr) {
            if (y >= scy && (y - scy) % (2 * s + 1) < s) continue
            val half = isqrt(sr * sr - (y - scy) * (y - scy))
            g.px(scx - half, y, half * 2 + 1, 1, "#ffd36b")
        }
        g.line(wx, wy + wh * 30 / 100, wx + ww - 1, wy + wh * 40 / 100, "#2a1236")
        g.line(wx, wy + wh * 36 / 100, wx + ww - 1, wy + wh * 46 / 100, "#2a1236")
        val roofs = wy + wh
        run {
            var x = wx; var k = 0
            while (x < wx + ww) {
                val bw = min((4 + mod(92000 + k, 4)) * s, wx + ww - x)
                val top = roofs - wh * (16 + mod(92100 + k, 14)) / 100
                g.px(x, top, bw, roofs - top, "#2a1236")
                g.px(x, top, bw, s, "#1a0a26")
                if (mod(92200 + k, 3) == 0 && bw > 2 * s && top + 3 * s < roofs) g.px(x + s, top + 2 * s, s, s, "#ffd36b")
                if (k == 1) {
                    val ax = x + bw / 2; val pole = max(1, s / 2)
                    g.px(ax, top - 5 * s, pole, 5 * s, "#1a0a26")
                    g.px(ax - 2 * s, top - 5 * s, 4 * s + pole, pole, "#1a0a26")
                    g.px(ax - s, top - 3 * s, 2 * s + pole, pole, "#1a0a26")
                }
                x += bw; k++
            }
        }
        g.px(wx + ww / 2, wy, s, wh, "#5a2d1a")
        g.px(wx - 2 * s, wy + wh + s, ww + 4 * s, s, "#7a4426")
        g.px(wx - 4 * s, wy - 3 * s, ww + 8 * s, s, "#c9a070")
        for (cx in intArrayOf(wx - 3 * s, wx + ww)) {
            g.px(cx, wy - 2 * s, 3 * s, wh + 4 * s, "#a3307a")
            g.px(cx + s, wy - 2 * s, 1, wh + 4 * s, "#7a2060")
        }
        // The chest of drawers, and a standing lamp beside it when there's room.
        val chestX = w * 50 / 100; val chestW = w * 40 / 100; val chestH = max(8, h * 26 / 100)
        val chestY = floor - chestH
        val gap = chestX - (wx + ww + 3 * s)
        if (gap > 12 * s) {
            val lx = wx + ww + 3 * s + gap / 2; val lt = h * 26 / 100
            for (y in lt + 4 * s until floor) {
                val spread = 3 * s + (y - lt) * 2 / 5
                for (x in lx - spread..lx + spread) if (((x + y) and 1) == 0 && mod(x * 5 + y * 3, 3) == 0) g.px(x, y, 1, 1, "#4a2440")
            }
            g.px(lx, lt + 4 * s, max(1, s / 2), floor - lt - 4 * s, "#c9a070")
            for (y in 0 until 4 * s) {
                val half = 2 * s + y / 2
                g.px(lx - half, lt + y, half * 2 + 1, 1, "#ff9e6b")
            }
            g.px(lx - 2 * s, floor - s, 4 * s + 1, s, "#c9a070")
        }
        g.px(chestX, chestY, chestW, chestH, "#5a2d1a")
        g.px(chestX, chestY, chestW, s, "#7a4426")
        for (k in 1 until 3) g.px(chestX + s, chestY + chestH * k / 3, chestW - 2 * s, s, "#3a1d10")
        for (k in 0 until 3) {
            val ky = chestY + chestH * k / 3 + chestH / 6
            g.px(chestX + chestW / 4, ky, s, s, "#c9a070")
            g.px(chestX + chestW * 3 / 4, ky, s, s, "#c9a070")
        }
        // The radio: a wooden case, the woven grille, the lit dial with its red needle, two knobs.
        val rh = max(12, h * 30 / 100); val rw = rh * 17 / 10
        val rx = chestX + (chestW - rw) / 2; val ry = chestY - rh
        for (y in ry - 5 * s until chestY) {
            for (x in rx - 5 * s until rx + rw + 5 * s) if (((x + y) and 1) == 0 && mod(x * 7 + y * 3, 3) == 0) g.px(x, y, 1, 1, "#4a2a3a")
        }
        g.px(rx + 2 * s, ry, rw - 4 * s, s, "#b86a3a")
        g.px(rx + s, ry + s, rw - 2 * s, s, "#9a5a35")
        g.px(rx, ry + 2 * s, rw, rh - 2 * s, "#8a4a28")
        g.px(rx, chestY - s, rw, s, "#5a2d1a")
        val gx = rx + 2 * s; val gy = ry + 3 * s; val gw = rw * 50 / 100; val gh = rh - 5 * s
        g.px(gx, gy, gw, gh, "#d9b07a")
        for (y in gy until gy + gh) { var x = gx + (y and 1); while (x < gx + gw) { g.px(x, y, 1, 1, "#b88a58"); x += 2 } }
        run { var x = gx + 2 * s; while (x < gx + gw - s) { g.px(x, gy, s, gh, "#8a4a28"); x += 3 * s } }
        val dx = gx + gw + 2 * s; val dw = rx + rw - 2 * s - dx; val dh = max(3 * s, gh / 2)
        g.px(dx, gy, dw, dh, "#ffe9a8")
        run { var x = dx + s; while (x < dx + dw - s) { g.px(x, gy + dh - 2 * s, 1, s, "#8a5a2a"); x += 2 * s } }
        g.px(dx + dw * 62 / 100, gy + s, max(1, s / 2), dh - 2 * s, "#ff3d3d")
        val ky = gy + dh + (gh - dh) / 2; val kr = max(1, dw / 5)
        g.disc(dx + dw / 4, ky, kr, "#f0e0c0")
        g.disc(dx + dw * 3 / 4, ky, kr, "#f0e0c0")
        // The clock on the wall and its pendulum.
        val cw = max(6, 5 * s); val ch = max(12, 11 * s); val clx = w * 88 / 100 - cw / 2; val cly = h * 8 / 100
        g.px(clx, cly, cw, ch, "#5a2d1a")
        g.px(clx, cly, cw, s, "#7a4426")
        val fr = max(2, cw / 2 - s); val fcx = clx + cw / 2; val fcy = cly + 2 * s + fr
        g.disc(fcx, fcy, fr, "#f0e0c0")
        g.px(fcx, fcy - fr + s, 1, fr - s, "#2a1420")
        g.px(fcx, fcy, fr / 2 + 1, 1, "#2a1420")
        val pendTop = fcy + fr + s
        g.px(clx + s, pendTop, cw - 2 * s, cly + ch - s - pendTop, "#2a1420")
        val bobY = cly + ch - 3 * s; val swing = max(1, s)
        frames(g, 20,
            { a -> a.line(fcx, pendTop, fcx - swing, bobY, "#c9a070"); a.disc(fcx - swing, bobY, max(1, s), "#ffd36b") },
            { a -> a.line(fcx, pendTop, fcx + swing, bobY, "#c9a070"); a.disc(fcx + swing, bobY, max(1, s), "#ffd36b") })
        notes(g, rx - 2 * s, ry - 2 * s, 3, s, 92300)
    }

    /** The 1970s: a turntable spinning on the sideboard between wooden speakers, a crate of records, a lava lamp. */
    private fun hifi(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val floor = h - max(4, h * 16 / 100)
        g.gradient(0, floor, listOf("#1e0d14", "#2a1218", "#36181c"))
        // Seventies wallpaper: rows of brown and orange rings.
        val ring = max(3, 4 * s)
        run {
            var y = ring; var row = 0
            while (y < floor - ring) {
                var x = ring + (row % 2) * ring * 2; var k = 0
                while (x < w) {
                    g.disc(x, y, ring, if (k % 2 == 0) "#4a2418" else "#5a2a14")
                    g.disc(x, y, max(1, ring - s), "#2a1218")
                    x += ring * 4; k++
                }
                y += ring * 3; row++
            }
        }
        g.px(0, floor, w, h - floor, "#3a1f12")
        run { var x = 3; while (x < w) { g.px(x, floor + s, 1, h - floor - s, "#2c170d"); x += 9 } }
        g.px(0, floor, w, s, "#5a2d1a")
        // The sideboard and the speakers on either side.
        val boardX = w * 50 / 100; val boardW = w * 38 / 100; val boardH = max(6, h * 24 / 100)
        val boardY = floor - boardH
        g.px(boardX, boardY, boardW, boardH, "#7a4426")
        g.px(boardX, boardY, boardW, s, "#9a5a35")
        run { var x = boardX + boardW / 4; while (x < boardX + boardW - s) { g.px(x, boardY + 2 * s, s, boardH - 3 * s, "#5a2d1a"); x += boardW / 4 } }
        val spW = max(6, min(h * 22 / 100, w * 9 / 100)); val spH = max(14, h * 46 / 100)
        for (sx in intArrayOf(boardX - spW - s, boardX + boardW + s)) {
            g.px(sx, floor - spH, spW, spH, "#5a2d1a")
            g.px(sx + s, floor - spH + s, spW - 2 * s, spH - 2 * s, "#3a1d10")
            val cx = sx + spW / 2
            g.disc(cx, floor - spH + spH / 3, max(2, spW / 3), "#1a0c08")
            g.disc(cx, floor - spH + spH / 3, max(1, spW / 6), "#9a5a35")
            g.disc(cx, floor - spH / 4, max(1, spW / 5), "#1a0c08")
        }
        // The turntable: wooden plinth, a black record with an orange label, the silver tonearm.
        val ttW = max(16, boardW * 46 / 100); val ttX = boardX + boardW / 8; val ttH = max(4, 4 * s)
        g.px(ttX, boardY - ttH, ttW, ttH, "#c27a45")
        g.px(ttX, boardY - ttH, ttW, s, "#d89a65")
        val rr = max(3, ttW * 34 / 100); val rcx = ttX + ttW * 40 / 100; val rcy = boardY - ttH - s
        for (y in rcy - rr / 3..rcy) {
            val half = isqrt(rr * rr - (y - rcy) * (y - rcy) * 9)
            g.px(rcx - half, y, half * 2 + 1, 1, if ((y and 1) == 0) "#07010f" else "#1a1420")
        }
        g.px(rcx - 2 * s, rcy - s, 4 * s, s, "#ff7f3f")
        g.line(ttX + ttW - 2 * s, boardY - ttH - 4 * s, rcx + rr / 2, rcy - s, "#d7d0e8", s)
        // A lava lamp on the sideboard.
        val lx = boardX + boardW * 78 / 100; val lh = max(8, h * 26 / 100)
        g.px(lx, boardY - 2 * s, 4 * s, 2 * s, "#c9c3d9")
        for (y in boardY - lh until boardY - 2 * s) {
            val half = s + (y - (boardY - lh)) * s / max(1, lh)
            g.px(lx + 2 * s - half, y, half * 2, 1, "#ff7f3f")
        }
        frames(g, 40,
            { a -> a.disc(lx + 2 * s, boardY - lh * 2 / 3, s, "#ffd319"); a.disc(lx + 2 * s, boardY - lh / 3, max(1, s + s / 2), "#ff2a9d") },
            { a -> a.disc(lx + 2 * s, boardY - lh * 2 / 5, s, "#ffd319"); a.disc(lx + 2 * s, boardY - lh * 3 / 5, max(1, s), "#ff2a9d") })
        g.px(lx + s, boardY - lh - s, 2 * s, 2 * s, "#c9c3d9")
        // A crate of records on the floor, their sleeves in every colour.
        val crateX = w * 40 / 100; val crateW = max(12, w * 10 / 100); val crateH = max(5, h * 14 / 100)
        run {
            var x = crateX + s; var k = 0
            while (x < crateX + crateW - s) { g.px(x, h - crateH - 2 * s, s * 2 - 1, crateH, SLEEVES[mod(90200 + k, SLEEVES.size)]); x += 2 * s; k++ }
        }
        g.px(crateX, h - crateH * 2 / 3, crateW, crateH * 2 / 3, "#9a5a35")
        notes(g, rcx - 2 * s, rcy - 6 * s, 3, s, 90300)
    }

    /** The 1980s: a night drive, a cassette in the deck, the highway's lights running in to the city. */
    private fun nightDrive(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val dash = h - max(6, h * 30 / 100)
        val horizon = h * 44 / 100
        g.gradient(0, horizon, NIGHT_SKY)
        g.stars(0, horizon * 2 / 3, max(4, w * horizon / 260), 93000)
        twinkle(g, 0, 0, w, horizon * 2 / 3, w * horizon / 800, 93050)
        g.disc(w * 66 / 100, h * 16 / 100, max(2, h * 7 / 100), "#ffe9c8")
        // The city ahead, its windows lit.
        val tallest = max(2 * s, horizon - h * 16 / 100)
        run {
            var x = 0; var k = 0
            while (x < w) {
                val bw = (4 + mod(93100 + k, 6)) * s; val bh = max(2 * s, tallest * (25 + mod(93200 + k, 76)) / 100)
                g.px(x, horizon - bh, bw, bh, "#140630")
                var yy = horizon - bh + s
                while (yy < horizon - s) {
                    var xx = x + s
                    while (xx < x + bw - s) {
                        if (mod(xx * 3 + yy * 7 + 93300, 5) == 0) g.px(xx, yy, s, s, CITY_LIGHTS[mod(xx + yy, CITY_LIGHTS.size)])
                        xx += 2 * s
                    }
                    yy += 2 * s
                }
                x += bw; k++
            }
        }
        // The highway: lane marks dashed by distance, lamps along both sides, a car's tail lights ahead.
        val vx = w / 2; val depth = max(1, dash - horizon)
        val marks = listOf(ArrayList<IntArray>(), ArrayList<IntArray>())
        g.px(0, horizon, w, dash - horizon, "#0d0420")
        for (y in horizon until dash) {
            val dy = y - horizon + 1
            val half = dy * w * 7 / (depth * 10)
            g.px(vx - half, y, half * 2, 1, "#1c0e33")
            val edge = max(1, half / 30)
            g.px(vx - half, y, edge, 1, "#ff7ad9")
            g.px(vx + half - edge, y, edge, 1, "#ff7ad9")
            marks[(depth * 24 / dy / 6) % 2].add(intArrayOf(y, half))
        }
        // The lane marks rush past: their two sets take turns.
        val lane = { a: Grid, set: List<IntArray> ->
            for ((y, half) in set) {
                val mark = max(1, half / 24)
                a.px(vx - half / 3 - mark / 2, y, mark, 1, "#fff6e8")
                a.px(vx + half / 3 - mark / 2, y, mark, 1, "#fff6e8")
            }
        }
        frames(g, 4, { a -> lane(a, marks[0]) }, { a -> lane(a, marks[1]) })
        for (z in intArrayOf(26, 34, 46, 62, 86, 120, 170)) {
            val dy = max(1, depth * 24 / z); val y = horizon + dy - 1
            val half = dy * w * 7 / (depth * 10); val pole = dy * 3 / 2; val size = max(1, dy / 6)
            for (side in intArrayOf(-1, 1)) {
                val px = vx + side * (half * 12 / 10)
                g.px(px, y - pole, max(1, dy / 14), pole, "#2a1650")
                g.px(if (side < 0) px else px - dy / 4, y - pole, dy / 4 + 1, max(1, dy / 16), "#2a1650")
                g.px(px - side * (dy / 4) - size / 2, y - pole, size, size, "#ffb36b")
            }
        }
        val cdy = max(2, depth * 24 / 60); val cy = horizon + cdy
        val cw = max(4 * s, cdy * w * 7 / (depth * 10) * 2 / 5); val ch = max(2 * s, cw / 4)
        val cl = vx - cw / 2; val roofIn = cw / 6; val cabH = max(s, ch * 2 / 3); val lamp = max(1, cw / 6)
        g.px(cl, cy - ch, cw, ch, "#07010f")
        g.px(cl + roofIn, cy - ch - cabH, cw - 2 * roofIn, cabH, "#07010f")
        g.px(cl + roofIn + s, cy - ch - cabH + s, cw - 2 * roofIn - 2 * s, max(1, cabH - s), "#2a1650")
        g.px(cl, cy - ch + s, lamp, s, "#ff3d3d")
        g.px(cl + cw - lamp, cy - ch + s, lamp, s, "#ff3d3d")
        g.px(vx - lamp / 2, cy - ch / 2, lamp, s, "#c9c3d9")
        g.actor(period = 47, delay = 20, on = 6) { a -> a.px(cl, cy - ch + s, lamp, s, "#ffb0b0"); a.px(cl + cw - lamp, cy - ch + s, lamp, s, "#ffb0b0") }
        // The windshield's frame, the mirror and the dice hanging from it.
        g.px(0, 0, w, 2 * s, "#07010f")
        for (y in 0 until dash) {
            val pw = w * 3 / 100 + (dash - y) * w * 5 / (max(1, dash) * 100)
            g.px(0, y, pw, 1, "#07010f")
            g.px(w - pw, y, pw, 1, "#07010f")
        }
        val mw = max(8 * s, w * 12 / 100); val mx = vx - mw / 2
        g.px(vx - s, 2 * s, 2 * s, 2 * s, "#07010f")
        g.px(mx, 4 * s, mw, 3 * s, "#07010f")
        g.px(mx + s, 5 * s, mw - 2 * s, s, "#3a1f6e")
        val dice = mx + mw / 3
        g.px(dice, 7 * s, max(1, s / 2), 3 * s, "#c9c3d9")
        g.px(dice - 2 * s, 10 * s, 2 * s, 2 * s, "#ff7ad9")
        g.px(dice, 11 * s, 2 * s, 2 * s, "#fff6e8")
        // The dashboard: the deck with its cassette in the middle, the gauges behind the wheel on the right.
        g.px(0, dash, w, h - dash, "#0d0618")
        g.px(0, dash, w, s, "#2a1650")
        val deckW = max(14 * s, min(w * 24 / 100, 30 * s)); val deckH = max(6 * s, (h - dash) * 64 / 100)
        val deckX = vx - deckW / 2; val deckY = dash + 2 * s
        for (y in deckY - 2 * s until h) {
            for (x in deckX - 4 * s until deckX + deckW + 4 * s) if (((x + y) and 1) == 0 && mod(x * 7 + y * 5, 3) == 0) g.px(x, y, 1, 1, "#24164a")
        }
        val ventW = 6 * s; val ventH = 4 * s
        for (ventX in intArrayOf(deckX - 3 * s - ventW, deckX + deckW + 3 * s)) {
            g.px(ventX, deckY, ventW, ventH, "#07010f")
            run { var y = deckY + s; while (y < deckY + ventH) { g.px(ventX + s, y, ventW - 2 * s, max(1, s / 2), "#2a1650"); y += 2 * s } }
        }
        g.px(deckX - s, deckY - s, deckW + 2 * s, deckH + 2 * s, "#2a1650")
        g.px(deckX, deckY, deckW, deckH, "#07010f")
        val ledH = max(1, s); val winH = max(2 * s, deckH - 3 * s - ledH)
        val cassH = winH; val cassW = min(deckW - 6 * s, cassH * 16 / 10); val cassX = vx - cassW / 2; val cassY = deckY + s
        g.px(cassX, cassY, cassW, cassH, "#d7d0e8")
        g.px(cassX + s, cassY + s, cassW - 2 * s, max(1, cassH / 2 - s), "#ff7ac6")
        g.px(cassX + s, cassY + s, cassW - 2 * s, max(1, s / 2), "#ffd319")
        val tapeY = cassY + cassH / 2; val tapeH = max(1, cassH / 4)
        g.px(cassX + cassW / 4, tapeY, cassW / 2, tapeH, "#2a1420")
        g.px(cassX + cassW / 4, tapeY, max(1, s), tapeH, "#fff6e8")
        g.px(cassX + cassW * 3 / 4 - max(1, s), tapeY, max(1, s), tapeH, "#fff6e8")
        for (kx in intArrayOf(deckX + 2 * s, deckX + deckW - 2 * s)) g.disc(kx, cassY + cassH / 2, max(1, s * 3 / 4), "#9a93b8")
        run {
            var x = deckX + 2 * s; var i = 0
            while (x < deckX + deckW - 2 * s) {
                val bar = 1 + mod(93500 + i, ledH + 1)
                g.px(x, deckY + deckH - s - bar, s, bar, if (i % 3 == 0) "#ff2a9d" else "#2ee6ff")
                x += 2 * s; i++
            }
        }
        val wheelX = w * 80 / 100; val wheelR = max(8 * s, h * 40 / 100); val wheelY = h + h * 8 / 100
        val gaugeR = max(2 * s, h * 7 / 100)
        g.px(wheelX - 3 * gaugeR, dash - 2 * s, 6 * gaugeR, 3 * s, "#0d0618")
        g.px(wheelX - 3 * gaugeR, dash - 2 * s, 6 * gaugeR, s, "#2a1650")
        for (side in intArrayOf(-1, 1)) {
            val gxc = wheelX + side * (gaugeR + s); val gyc = dash + gaugeR
            g.disc(gxc, gyc, gaugeR, "#0a1a2a")
            g.ring(gxc, gyc, gaugeR, max(1, s / 2), "#2ee6ff")
            g.line(gxc, gyc, gxc - side * (gaugeR * 2 / 3), gyc - gaugeR * 2 / 3, "#ff2a9d")
        }
        g.ring(wheelX, wheelY, wheelR, 2 * s, "#07010f")
        g.ring(wheelX, wheelY, wheelR - 2 * s, max(1, s / 2), "#1f1238")
        g.line(wheelX, wheelY, wheelX - wheelR, wheelY - wheelR / 3, "#07010f", 2 * s)
        g.line(wheelX, wheelY, wheelX + wheelR, wheelY - wheelR / 3, "#07010f", 2 * s)
        notes(g, vx - w * 14 / 100, dash - 6 * s, 2, s, 93400)
    }

    /** The 1990s: a karaoke box, lyrics lighting up on the screen, the disco ball's sparkles, two microphones. */
    private fun karaoke(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val floor = h - max(4, h * 14 / 100)
        g.gradient(0, floor, listOf("#12052e", "#1a0838", "#230b45"))
        run { var x = -h; var k = 0; while (x < w) { g.line(x, floor, x + floor, 0, if (k % 2 == 0) "#2a0f52" else "#1f0a42"); x += 10 * s; k++ } }
        g.px(0, floor, w, h - floor, "#2a1145")
        g.px(0, floor, w, s, "#ff2a9d")
        // The screen: a video sky and the lyrics, the sung part lit cyan.
        val tx = w * 50 / 100; val ty = h * 24 / 100; val tw = w * 34 / 100; val th = h * 44 / 100
        g.px(tx - 2 * s, ty - 2 * s, tw + 4 * s, th + 4 * s, "#07010f")
        for (y in 0 until th) g.px(tx, ty + y, tw, 1, LYRIC_SKY[min(LYRIC_SKY.size - 1, y * LYRIC_SKY.size / max(1, th))])
        g.disc(tx + tw * 72 / 100, ty + th * 46 / 100, max(2, th / 6), "#ffd319")
        for (line in 0 until 2) {
            val ly = ty + th - (2 - line) * 4 * s
            val lx = tx + 3 * s
            val len = tw - 6 * s - line * 4 * s
            val sung = if (line == 0) len * 60 / 100 else 0
            run { var x = lx; while (x < lx + len) { g.px(x, ly, 2 * s, 2 * s, if (x < lx + sung) "#2ee6ff" else "#fff6e8"); x += 3 * s } }
        }
        // The karaoke machine and its song number, the microphones in their stand.
        val mY = ty + th + 4 * s; val mH = max(4, floor - mY - 2 * s)
        g.px(tx + tw / 4, mY, tw / 2, mH, "#1a0f2a")
        g.px(tx + tw / 4 + s, mY + s, 7 * s, 2 * s, "#ff3d3d")
        run { var x = tx + tw / 4 + 10 * s; while (x < tx + tw * 3 / 4 - s) { g.px(x, mY + s, s, s, BUTTONS[mod(x, BUTTONS.size)]); x += 2 * s } }
        for (k in 0 until 2) {
            val mx = tx + tw + 4 * s + k * 4 * s
            g.px(mx, floor - 12 * s, s, 12 * s, "#7d7896")
            g.disc(mx, floor - 13 * s, max(1, s + s / 2), if (k == 0) "#c9c3d9" else "#ff2a9d")
        }
        // The disco ball and its sparkles over everything.
        val bx = tx + tw / 2; val by = h * 10 / 100; val br = max(3, h * 8 / 100)
        g.px(bx, 0, s, by - br, "#7d7896")
        for (y in by - br..by + br) {
            val half = isqrt(br * br - (y - by) * (y - by))
            for (x in bx - half..bx + half) g.px(x, y, 1, 1, if (((x / s + y / s) and 1) == 0) "#d7d0e8" else "#7fe8ff")
        }
        for (i in 0 until w * h / (160 * s * s)) {
            val color = NOTE_COLORS[mod(91000 + i, NOTE_COLORS.size)]
            g.px(mod(91100 + i, w), mod(91200 + i, floor), s, s, color)
        }
        frames(g, 6,
            { a -> for (y in by - br..by + br) { val half = isqrt(br * br - (y - by) * (y - by)); for (x in bx - half..bx + half) if (((x / s + y / s) and 1) == 1) a.px(x, y, 1, 1, "#d7d0e8") } },
            { a -> for (y in by - br..by + br) { val half = isqrt(br * br - (y - by) * (y - by)); for (x in bx - half..bx + half) if (((x / s + y / s) and 1) == 0) a.px(x, y, 1, 1, "#7fe8ff") } })
        twinkle(g, 0, 0, w, floor, w * h / 300, 91500, "#fff6e8")
        // A sofa on the left and the table of drinks.
        val sofaY = floor - h * 18 / 100
        g.px(0, sofaY, w * 34 / 100, floor - sofaY, "#8a1f3a")
        g.px(0, sofaY, w * 34 / 100, 2 * s, "#b8263b")
        val tableX = w * 38 / 100
        g.px(tableX, floor - 5 * s, 10 * s, s, "#c9c3d9")
        g.px(tableX + 4 * s, floor - 4 * s, 2 * s, 4 * s, "#7d7896")
        g.px(tableX + s, floor - 8 * s, 2 * s, 3 * s, "#ffd319")
        g.px(tableX + 6 * s, floor - 9 * s, 2 * s, 4 * s, "#2ee6ff")
    }

    /** The 2000s: the after-school band on the school roof at sunset, the town past the fence, the water tank up on the stairwell. */
    private fun rooftopBand(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val roof = h - max(5, h * 20 / 100)
        g.gradient(0, roof, DUSK)
        g.disc(w * 20 / 100, h * 48 / 100, max(3, h * 16 / 100), "#ffe08a")
        for (k in 0 until 3) {
            val cx = w * (12 + k * 30 + mod(94300 + k, 10)) / 100; val cy = h * (10 + mod(94400 + k, 18)) / 100; val cw = w * (10 + mod(94500 + k, 8)) / 100
            drift(g, w, 0, 700 + k * 200) { a, ox, _ ->
                a.px(cx + ox, cy, cw, s, "#ff9fb8")
                a.px(cx + 2 * s + ox, cy - s, cw - 6 * s, s, "#ffc3d0")
            }
        }
        drift(g, -w, 0, 240) { a, ox, _ ->
            bird(a, w * 60 / 100 + ox, h * 20 / 100, "#3a1a5a")
            bird(a, w * 64 / 100 + ox, h * 24 / 100, "#3a1a5a")
        }
        // The town beyond the fence, its lights coming on.
        val townTop = roof - h * 24 / 100
        run {
            var x = 0; var k = 0
            while (x < w) {
                val bw = (3 + mod(94000 + k, 6)) * s; val top = townTop + mod(94100 + k, max(1, h * 14 / 100))
                g.px(x, top, bw, roof - top, if (k % 2 == 0) "#3a1a5a" else "#33174f")
                var yy = top + s
                while (yy < roof - s) {
                    var xx = x + s
                    while (xx < x + bw - s) {
                        if (mod(xx * 5 + yy * 3 + 94200, 7) == 0) g.px(xx, yy, s, s, "#ffd36b")
                        xx += 2 * s
                    }
                    yy += 2 * s
                }
                x += bw; k++
            }
        }
        // The fence: chain-link between posts, rails along the top and the bottom.
        val fenceTop = roof - h * 34 / 100; val link = 4 * s
        for (y in fenceTop until roof) {
            for (x in 0 until w) if ((x + y) % link == 0 || ((x - y) % link + link) % link == 0) g.px(x, y, 1, 1, "#9a7aa8")
        }
        run { var x = 2 * s; while (x < w) { g.px(x, fenceTop - s, s, roof - fenceTop + s, "#c9b3d0"); x += 22 * s } }
        g.px(0, fenceTop - s, w, s, "#c9b3d0")
        g.px(0, roof - 2 * s, w, s, "#8a6a98")
        // The stairwell with the water tank on its stand.
        val sx = w * 84 / 100; val sTop = roof - h * 40 / 100
        g.px(sx, sTop, w - sx, roof - sTop, "#b8869a")
        g.px(sx, sTop, 2 * s, roof - sTop, "#d8a0a8")
        g.px(sx, sTop, w - sx, s, "#8a5a78")
        val doorW = max(3 * s, (w - sx) / 3)
        g.px(sx + 3 * s, roof - h * 22 / 100, doorW, h * 22 / 100, "#5a3a5a")
        g.px(sx + 4 * s, roof - h * 20 / 100, doorW - 2 * s, 3 * s, "#ffb36b")
        val tankW = max(6 * s, (w - sx) * 60 / 100); val tankH = max(5 * s, h * 14 / 100); val tankX = sx + 3 * s
        val tankY = sTop - 3 * s - tankH
        for (lx in intArrayOf(tankX + s, tankX + tankW - 2 * s)) g.px(lx, tankY + tankH, s, 3 * s, "#5a3a5a")
        g.px(tankX, tankY + s, tankW, tankH - s, "#e8c8c0")
        g.px(tankX + s, tankY, tankW - 2 * s, s, "#e8c8c0")
        g.px(tankX + tankW - 2 * s, tankY + s, 2 * s, tankH - s, "#b8909a")
        g.px(tankX, tankY + tankH / 2, tankW, s, "#b8909a")
        // The rooftop's concrete.
        g.px(0, roof, w, h - roof, "#5a4068")
        run { var x = 4; while (x < w) { g.px(x, roof + s, 1, h - roof - s, "#4a3058"); x += 12 } }
        g.px(0, roof, w, s, "#7a5a88")
        // The band in the low sun, long shadows behind them: a guitarist, the singer at the microphone, the drummer, an amp.
        val tall = max(10, h * 36 / 100)
        fun person(fx: Int) {
            g.px(fx + 2 * s, roof + s, tall * 2 / 3, s, "#3a2848")
            g.disc(fx + s, roof - tall + 2 * s, max(1, 2 * s), "#1f0d33")
            g.px(fx - s, roof - tall + 4 * s, 5 * s, tall - 7 * s, "#1f0d33")
            g.px(fx - s, roof - tall + 4 * s, s, tall - 7 * s, "#ff9e6b")
            g.px(fx - s, roof - 3 * s, 2 * s, 3 * s, "#1f0d33")
            g.px(fx + 2 * s, roof - 3 * s, 2 * s, 3 * s, "#1f0d33")
        }
        val guitarist = w * 42 / 100; val singer = w * 54 / 100
        person(guitarist)
        person(singer)
        g.disc(guitarist + 3 * s, roof - tall * 2 / 5, max(2, 2 * s), "#ff3d3d")
        g.line(guitarist + 3 * s, roof - tall * 2 / 5, guitarist - 3 * s, roof - tall * 3 / 4, "#c9a070", max(1, s / 2))
        g.px(singer - 3 * s, roof - tall * 3 / 4, max(1, s / 2), tall * 3 / 4, "#c9c3d9")
        g.px(singer - 4 * s, roof - tall * 3 / 4 - s, 2 * s, 2 * s, "#fff6e8")
        val drumX = w * 68 / 100; val drum = max(3, 4 * s)
        g.disc(drumX, roof - 2 * drum - 2 * s, max(1, 2 * s), "#1f0d33")
        g.px(drumX - 2 * s, roof - 2 * drum, 5 * s, drum, "#1f0d33")
        g.disc(drumX, roof - drum, drum, "#1f0d33")
        g.disc(drumX, roof - drum, max(1, drum - s), "#fff6e8")
        g.px(drumX - drum / 2, roof - drum, drum, s, "#ff3d3d")
        g.px(drumX + drum + s, roof - 2 * drum - 3 * s, 5 * s, s, "#ffd319")
        g.px(drumX + drum + 3 * s, roof - 2 * drum - 2 * s, s, 2 * drum + 2 * s, "#c9c3d9")
        val ampX = w * 77 / 100; val ampW = max(5 * s, h * 12 / 100); val ampH = max(6 * s, h * 16 / 100)
        g.px(ampX, roof - ampH, ampW, ampH, "#1f0d33")
        g.px(ampX + s, roof - ampH + 2 * s, ampW - 2 * s, ampH - 3 * s, "#3a2a4a")
        g.px(ampX + s, roof - ampH + s, ampW - 2 * s, max(1, s / 2), "#ffd36b")
    }

    /** From 2020: a virtual singer live as a hologram, the projector's light under her, floating screens and a sea of light sticks. */
    private fun hologram(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val deckY = h * 74 / 100
        g.gradient(0, deckY, listOf("#02030f", "#050a24", "#0a1036", "#0e1648"))
        run { var x = 4 * s; while (x < w) { g.px(x, 0, 1, deckY, "#0c1a44"); x += 8 * s } }
        run { var y = 6 * s; while (y < deckY) { g.px(0, y, w, 1, "#0c1a44"); y += 8 * s } }
        // Lasers fanning up from both ends of the stage.
        for (k in 0 until 4) {
            g.line(w * 6 / 100, deckY - 1, w * (18 + k * 14) / 100, 0, if (k % 2 == 0) "#3a1a6a" else "#123a6a")
            g.line(w * 94 / 100, deckY - 1, w * (82 - k * 14) / 100, 0, if (k % 2 == 0) "#123a6a" else "#3a1a6a")
        }
        val cx = w * 68 / 100; val cell = max(1, h * 56 / 1600)
        val fw = IDOL[0].length * cell; val fh = IDOL.size * cell
        val fx = cx - fw / 2; val fy = deckY - 2 * s - fh
        g.ring(cx, fy + fh / 2, fh * 7 / 10, max(1, s / 2), "#1a3a7a")
        g.ring(cx, fy + fh / 2, fh * 9 / 10, 1, "#132a62")
        // The floating screens: a waveform, hearts, a song playing, a level meter.
        for (k in PANELS.indices) {
            val (ppx, ppy, ppw, pph, kind) = PANELS[k]
            val x0 = w * ppx / 100; val y0 = h * ppy / 100; val pw = max(6 * s, w * ppw / 100); val ph = max(5 * s, h * pph / 100)
            if (x0 + pw > fx - 2 * s && x0 < fx + fw + 2 * s) continue
            g.px(x0, y0, pw, ph, "#0a2050")
            g.px(x0, y0, pw, 1, "#2ee6ff")
            g.px(x0, y0 + ph - 1, pw, 1, "#2ee6ff")
            g.px(x0, y0, 1, ph, "#2ee6ff")
            g.px(x0 + pw - 1, y0, 1, ph, "#2ee6ff")
            val mid = y0 + ph / 2
            when (kind) {
                0 -> {
                    val amp = max(1, ph / 4); val period = max(4, 8 * s); val halfP = period / 2
                    for (x in x0 + s until x0 + pw - s) {
                        val t = (x - x0) % period; val v = if (t < halfP) t else period - t
                        g.px(x, mid - amp + v * 2 * amp / halfP, 1, max(1, s / 2), "#7fe8ff")
                    }
                }
                1 -> {
                    val hc = max(1, min(pw, ph) / 9)
                    g.sprite(HEART, x0 + (pw - 7 * hc) / 2, mid - 3 * hc, hc, mapOf('#' to "#ff7ad9"))
                }
                2 -> {
                    for (l in 0 until 2) g.px(x0 + 2 * s, y0 + 2 * s + l * 2 * s, (pw - 4 * s) * (80 - l * 30) / 100, s, if (l == 0) "#d8fbff" else "#7fe8ff")
                    val by = y0 + ph - 3 * s
                    g.px(x0 + 2 * s, by, pw - 4 * s, max(1, s / 2), "#1a4a8a")
                    g.px(x0 + 2 * s, by, (pw - 4 * s) * 60 / 100, max(1, s / 2), "#ff7ad9")
                    g.disc(x0 + 2 * s + (pw - 4 * s) * 60 / 100, by, max(1, s / 2), "#fff6e8")
                }
                else -> {
                    var x = x0 + s; var i = 0
                    while (x < x0 + pw - s) {
                        val bar = max(1, (ph - 2 * s) * (20 + mod(95400 + k * 31 + i, 81)) / 100)
                        g.px(x, y0 + ph - s - bar, s, bar, if (i % 4 == 3) "#ff7ad9" else "#2ee6ff")
                        x += 2 * s; i++
                    }
                }
            }
        }
        // The projector's light, then the singer in scanlines (every third row dark), one row slipping sideways.
        for (y in fy - 2 * s until deckY - s) {
            val spread = fw / 2 + 2 * s + (deckY - y) / 5
            for (x in cx - spread..cx + spread) if (((x + y) and 1) == 0 && mod(x * 3 + y * 5, 4) == 0) g.px(x, y, 1, 1, "#1a4a8a")
        }
        for (y in 0 until fh) {
            if (y % 3 == 2) continue
            val r = y / cell; val slip = if (r == 9) cell else 0
            for (c in IDOL[r].indices) {
                val color = IDOL_COLORS[IDOL[r][c]] ?: continue
                g.px(fx + c * cell + slip, fy + y, cell, 1, color)
            }
        }
        // Now and then her head and shoulders slip sideways too.
        g.actor(period = 43, delay = 15, on = 2) { a ->
            for (y in 2 * cell until 7 * cell) {
                if (y % 3 == 2) continue
                val r = y / cell
                for (c in IDOL[r].indices) {
                    val color = IDOL_COLORS[IDOL[r][c]] ?: continue
                    a.px(fx + c * cell - 2 * cell, fy + y, cell, 1, color)
                }
            }
        }
        val padW = fw + 6 * s; val padX = cx - padW / 2
        val crowdTop = deckY + max(2, h * 6 / 100)
        g.px(0, deckY, w, h - deckY, "#0c1650")
        g.px(0, deckY, w, crowdTop - deckY, "#101c5c")
        g.px(0, deckY, w, s, "#2a5aa8")
        run { var x = 2 * s; while (x < w) { g.px(x, deckY + s, s, s, "#2ee6ff"); x += 6 * s } }
        g.px(padX + 2 * s, deckY - 2 * s, padW - 4 * s, s, "#7fe8ff")
        g.px(padX, deckY - s, padW, s, "#2ee6ff")
        g.px(padX + 2 * s, deckY, padW - 4 * s, s, "#1a6a9a")
        // The crowd, light sticks up and waving.
        val tips = listOf(ArrayList<IntArray>(), ArrayList<IntArray>())
        run {
            var x = -s; var i = 0
            while (x < w) {
                val hy = crowdTop + 2 * s + mod(95000 + i, 3) * s
                g.disc(x + 2 * s, hy, max(1, s + s / 2), "#01020a")
                g.px(x, hy + s, 4 * s, h - hy - s, "#01020a")
                if (mod(95100 + i, 2) == 0) {
                    g.px(x + 3 * s, hy - 4 * s, s, 4 * s, "#01020a")
                    g.px(x + 3 * s, hy - 8 * s, s, 4 * s, GLOW_STICKS[mod(95300 + i, GLOW_STICKS.size)])
                    tips[if (i % 4 < 2) 0 else 1].add(intArrayOf(x + 3 * s, hy - 9 * s))
                }
                x += 4 * s; i++
            }
        }
        val wave = { a: Grid, set: List<IntArray> -> for ((x, y) in set) a.px(x, y, s, s, "#e8fdff") }
        frames(g, 8, { a -> wave(a, tips[0]) }, { a -> wave(a, tips[1]) })
    }

    /** A shopping street at night in the rain: lit signs, glowing shopfronts, wires overhead, the signs' colours on the wet road. */
    private fun mangaStreet(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val road = h - max(4, h * 16 / 100)
        g.gradient(0, road, listOf("#070b16", "#0c1322", "#111b2e", "#16233a", "#1b2b44"))
        // Towers far off in the rain, a few windows lit.
        run {
            var x = 0; var i = 0
            while (x < w) {
                val bw = 4 + mod(96000 + i, 9)
                val tall = road * (50 + mod(96100 + i, 40)) / 100
                g.px(x, road - tall, bw, tall, "#151f33")
                var wy = road - tall + 2
                while (wy < road - 2) {
                    var wx = x + 1
                    while (wx < x + bw - 1) { if (mod(wx * 37 + wy * 11 + 3, 7) == 0) g.px(wx, wy, 1, 1, if (mod(wx + wy, 4) == 0) "#ffcf7a" else "#3b5478"); wx += 2 }
                    wy += 3
                }
                x += bw; i++
            }
        }
        // Poles, and the wires sagging between them.
        val wireY = h * 10 / 100; val span = max(30, w * 30 / 100); val first = w * 6 / 100; val sag = max(2, h * 6 / 100)
        for (k in 0 until 2) {
            for (x in 0 until w) {
                val t = ((x - first) % span + span) % span
                g.px(x, wireY + k * 2 * s + 4 * sag * t * (span - t) / (span * span), 1, 1, "#0a101c")
            }
        }
        run {
            var px = first
            while (px < w) {
                g.px(px, wireY - 2 * s, s, road - wireY + 2 * s, "#0a101c")
                g.px(px - 2 * s, wireY, 5 * s, s, "#0a101c")
                px += span
            }
        }
        // The shops: an upper floor, a lit sign, an awning, the glowing shopfront.
        val shopTop = h * 34 / 100
        val fronts = ArrayList<IntArray>()
        run {
            var x = -2 * s; var i = 0
            while (x < w) {
                val sw = max(16 * s, w * (11 + mod(96200 + i, 7)) / 100)
                val top = shopTop + mod(96300 + i, max(1, h * 12 / 100))
                g.px(x, top, sw, road - top, if (i % 2 == 0) "#1d2436" else "#241f33")
                g.px(x, top, sw, s, "#2c3550")
                val winY = top + 2 * s; val winH = max(2 * s, (road - top) / 6)
                for (k in 0 until 2) {
                    g.px(x + sw * (14 + k * 46) / 100, winY, max(2 * s, sw / 4), winH, if (mod(96400 + i * 2 + k, 3) == 0) "#ffcf7a" else "#2c3a55")
                }
                val ci = mod(96500 + i, SHOP_SIGNS.size)
                val signY = winY + winH + 2 * s; val signH = max(3 * s, h * 8 / 100)
                g.px(x + s, signY, sw - 2 * s, signH, SHOP_SIGNS[ci])
                run { var gx = x + 3 * s; while (gx + 2 * s < x + sw - 2 * s) { g.px(gx, signY + s, 2 * s, max(1, signH - 2 * s), "#1a1020"); gx += 4 * s } }
                if (mod(96700 + i, 3) == 0) {
                    val vc = SHOP_SIGNS[(ci + 2) % SHOP_SIGNS.size]
                    g.px(x + sw - 4 * s, top - 3 * s, 3 * s, signY - top + 3 * s, vc)
                    run { var gy = top - 2 * s; while (gy + s < signY) { g.px(x + sw - 3 * s, gy, s, 2 * s, "#1a1020"); gy += 3 * s } }
                }
                val awnY = signY + signH + s
                g.px(x, awnY, sw, 2 * s, if (mod(96600 + i, 2) == 0) "#7a2a3a" else "#2a5a5a")
                run { var ax = x + s; while (ax < x + sw) { g.px(ax, awnY + s, s, s, "#e8d8c0"); ax += 3 * s } }
                val frontY = awnY + 2 * s
                g.px(x + s, frontY, sw - 2 * s, road - frontY, "#16121c")
                val pane = (sw - 6 * s) / 2
                for (px in intArrayOf(x + 2 * s, x + sw - 2 * s - pane)) {
                    g.px(px, frontY + s, pane, road - frontY - 2 * s, "#d9a066")
                    run { var fy = frontY + 3 * s; while (fy < road - 2 * s) { g.px(px + s, fy, pane - 2 * s, s, "#8a5a3a"); fy += 3 * s } }
                }
                fronts.add(intArrayOf(x, sw, signY, signH, ci))
                x += sw; i++
            }
        }
        // The wet road, the signs' colours streaked in it.
        g.px(0, road, w, h - road, "#0a0f1a")
        g.px(0, road, w, s, "#2a3550")
        for (f in fronts) {
            val x = f[0]; val sw = f[1]; val ci = f[4]
            run { var ry = road + 2 * s; while (ry < h) { g.px(x + s + mod(ry * 7 + x + 99000, max(1, sw - 2 * s)), ry, max(1, sw / 5), 1, SHOP_SIGNS[ci]); ry += 2 } }
        }
        // Moving: two signs blink out now and then, someone walks by under an umbrella, the rain.
        for (k in 0 until min(2, fronts.size)) {
            val f = fronts[(k * 3 + 1) % fronts.size]
            val x = f[0]; val sw = f[1]; val signY = f[2]; val signH = f[3]
            g.actor(period = 60 + k * 23, delay = k * 31, on = 3, rest = 30) { a -> a.px(x + s, signY, sw - 2 * s, signH, "#2a1f2a") }
        }
        val r = max(2, 4 * s); val body = max(4, 6 * s)
        val walk = w + 4 * r; val walkPeriod = 420
        g.actor(dx = walk, period = walkPeriod, rest = walkPeriod * (w * 30 / 100 + 2 * r) / walk) { a ->
            val cx = -2 * r; val top = road - body - r - 2 * s
            for (y in 0..r) {
                val half = isqrt(r * r - (r - y) * (r - y))
                a.px(cx - half, top + y, half * 2 + 1, 1, if (y == 0) "#ff8a9a" else "#d94a5a")
            }
            a.px(cx, top + r, max(1, s / 2), 2 * s, "#c9c3d9")
            a.px(cx - s, top + r + s, 2 * s + 1, body, "#06080f")
        }
        val drops = w * h / 60; val slant = h / 5
        drift(g, -slant, h, 8) { a, ox, oy ->
            for (i in 0 until drops) a.px(mod(98000 + i * 2, w + slant) + ox, mod(98001 + i * 2, h) + oy, 1, 2 + mod(98000 + i * 5, 2), "#4a6a9a")
        }
    }

    /** A bench on a hill at night: someone sitting looking over the town's lights, the full moon in the clouds, wires overhead. */
    private fun moonBench(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val ground = h * 84 / 100
        g.gradient(0, h, listOf("#04060d", "#070c17", "#0b1322", "#10192c", "#141f35"))
        g.stars(0, h * 50 / 100, w * h / 260, 97000, listOf("#dfe8ff", "#9fb4d9", "#ffffff"))
        // The moon, a soft halo, its seas.
        val mr = max(4, h * 17 / 100); val mx = w * 22 / 100; val my = h * 28 / 100
        for (y in my - mr - 4..my + mr + 4) {
            for (x in mx - mr - 4..mx + mr + 4) {
                val d = (x - mx) * (x - mx) + (y - my) * (y - my)
                if (d > mr * mr && d <= (mr + 4) * (mr + 4) && ((x + y) and 1) == 0) g.px(x, y, 1, 1, "#1d2a44")
            }
        }
        g.disc(mx, my, mr, "#dfe8f5")
        g.disc(mx - mr / 3, my - mr / 5, max(1, mr / 4), "#b9c6dc")
        g.disc(mx + mr / 4, my + mr / 3, max(1, mr / 5), "#b9c6dc")
        g.disc(mx + mr / 3, my - mr / 3, max(1, mr / 7), "#c9d4e6")
        // The ridge across the valley, a mast on its peak; then the town's lights below it.
        fun ridgeAt(x: Int): Int {
            val k = x / 30
            val a = 2 + mod(97100 + k, 9); val b = 2 + mod(97100 + k + 1, 9)
            return h * 44 / 100 + a * s + (b - a) * s * (x - k * 30) / 30
        }
        var peakX = 0
        for (x in 0 until w) {
            val top = ridgeAt(x)
            if (top < ridgeAt(peakX)) peakX = x
            g.px(x, top, 1, ground - top, "#0a111e")
        }
        val mast = max(3, 4 * s); val peakY = ridgeAt(peakX)
        g.px(peakX, peakY - mast, 1, mast, "#0a111e")
        val lights = w * (ground - peakY) / 34
        for (i in 0 until lights) {
            val x = mod(97200 + i, w); val y = ridgeAt(x) + 2 + mod(97300 + i, max(1, ground - ridgeAt(x) - 2))
            if (y < ground) g.px(x, y, 1, 1, TOWN_LIGHTS[mod(97400 + i, TOWN_LIGHTS.size)])
        }
        // The wires, then the ledge of grass and the bench with someone on it.
        val sag = max(2, h * 8 / 100)
        for (k in 0 until 2) for (x in 0 until w) g.px(x, h * 18 / 100 + k * 3 * s + 4 * sag * x * (w - x) / (w * w), 1, 1, "#1a2438")
        g.px(0, ground, w, h - ground, "#05080e")
        run { var x = 0; while (x < w) { g.px(x, ground - mod(97500 + x, 3), 1, 3, "#0a101a"); x += 2 } }
        val bx = w * 52 / 100; val bw = max(16 * s, w * 16 / 100); val seat = ground - 5 * s
        g.px(bx, seat, bw, s, "#2a2a3a")
        g.px(bx, seat - 4 * s, bw, s, "#2a2a3a")
        g.px(bx, seat - 2 * s, bw, s, "#1f1f2c")
        for (lx in intArrayOf(bx + s, bx + bw - 2 * s)) g.px(lx, seat, s, ground - seat, "#1a1a26")
        val pcx = bx + bw / 2 - s
        g.px(pcx - 2 * s, seat - 8 * s, 6 * s, 8 * s, "#03050a")
        g.disc(pcx + s, seat - 10 * s, max(1, 2 * s), "#03050a")
        g.px(pcx - 2 * s, seat - 8 * s, s, 7 * s, "#24324c")
        g.px(bx + bw - 4 * s, seat - 3 * s, s, 3 * s, "#3a6a5a")
        // Moving: clouds pass the moon, the town's lights flicker, the mast's light blinks.
        for (k in 0 until 2) {
            val cy = h * (18 + k * 16) / 100; val cw = w * (20 + k * 8) / 100; val cx = mod(97600 + k, w)
            drift(g, w, 0, 900 + k * 300) { a, ox, _ ->
                for (r in 0 until 3 * s) {
                    val rw = cw - cw * (3 * s - 1 - r) / (6 * s)
                    for (x in 0 until rw) if (((x + r) and 1) == 0 || r > s) a.px(cx - rw / 2 + x + ox, cy + r, 1, 1, if (r == 0) "#2a3550" else "#1a2338")
                }
            }
        }
        twinkle(g, 0, peakY, w, ground, lights / 3, 97700, "#ffd27a")
        g.actor(period = 20, on = 8) { a -> a.px(peakX, peakY - mast - 1, 1, 1, "#ff3d3d") }
    }

    /** Dusk over the city: towers against the evening sky, wires, the elevated line and a train heading home. */
    private fun duskLine(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val deck = h * 74 / 100
        g.gradient(0, deck, listOf("#2a4a72", "#3a628c", "#5f86a8", "#a6ae98", "#e8cf8e", "#ffc27a"))
        g.disc(w * 46 / 100, h * 60 / 100, max(3, h * 7 / 100), "#fff1c4")
        // Far towers in the haze.
        run {
            var x = 0; var i = 0
            while (x < w) {
                val bw = 5 + mod(98100 + i, 8)
                val tall = deck * (25 + mod(98200 + i, 30)) / 100
                g.px(x, deck - tall, bw, tall, "#7d93b0")
                x += bw + mod(98300 + i, 4); i++
            }
        }
        // Near towers: rows of lit windows, an antenna or two.
        run {
            var x = -s; var i = 0
            while (x < w) {
                val bw = max(8 * s, w * (6 + mod(98400 + i, 6)) / 100)
                if (mod(98500 + i, 4) == 0) { x += bw; i++; continue }
                val tall = deck * (35 + mod(98600 + i, 45)) / 100
                val top = deck - tall
                g.px(x, top, bw, tall, if (i % 2 == 0) "#34496c" else "#2c3f5e")
                var wy = top + 2 * s
                while (wy < deck - 2 * s) {
                    var wx = x + s
                    while (wx < x + bw - s) { if (mod(wx * 13 + wy * 7 + 98700, 5) < 2) g.px(wx, wy, s, s, if (mod(wx + wy, 3) == 0) "#ffe2a0" else "#9fc0e0"); wx += 2 * s }
                    wy += 2 * s
                }
                if (mod(98800 + i, 3) == 0) g.px(x + bw / 2, top - 4 * s, max(1, s / 2), 4 * s, "#2c3f5e")
                x += bw; i++
            }
        }
        // Poles and wires over the line.
        val wireY = h * 40 / 100
        run { var px = w * 12 / 100; while (px < w) { g.px(px, wireY - 2 * s, s, deck - wireY + 2 * s, "#1c2a44"); px += max(30, w * 34 / 100) } }
        for (k in 0 until 2) for (x in 0 until w) g.px(x, wireY + k * 2 * s + mod(x / 9 + 98900, 3) / 2, 1, 1, "#1c2a44")
        // The elevated line: the deck, its railing, a signal.
        g.px(0, deck, w, h - deck, "#18223a")
        g.px(0, deck, w, s, "#3a4c70")
        run { var y = deck + 3 * s; while (y < h) { g.px(0, y, w, 1, "#121a2e"); y += 3 * s } }
        run { var x = 0; while (x < w) { g.px(x, deck + s, s, h - deck - s, "#121a2e"); x += 6 * s } }
        val sigX = w * 86 / 100
        g.px(sigX, deck - 8 * s, s, 8 * s, "#1c2a44")
        g.px(sigX - s, deck - 9 * s, 3 * s, 2 * s, "#0c1220")
        // Moving: the train goes home, clouds drift, the signal changes.
        val th = max(4, h * 12 / 100); val length = w * 60 / 100; val travel = 2 * (w + length); val period = 320
        g.actor(dx = travel, period = period, rest = period * (w * 20 / 100 + length) / travel) { a ->
            val x0 = -length; val ty = deck - th
            a.px(x0, ty, length, th, "#2f3e5c")
            a.px(x0, ty, length, max(1, s / 2), "#5a6f96")
            run { var x = x0 + s; while (x < x0 + length - 2 * s) { a.px(x, ty + th / 3, 2 * s, max(1, th / 3), "#ffd27a"); x += 3 * s } }
            run { var x = x0 + length / 4; while (x < x0 + length) { a.px(x, ty, 1, th, "#1c2a44"); x += length / 4 } }
            a.px(x0 + length - s, ty + th * 2 / 3, s, s, "#fff1c4")
        }
        for (k in 0 until 3) {
            val cy = h * (8 + k * 13) / 100; val cw = w * (14 + mod(99100 + k, 10)) / 100; val cx = mod(99000 + k, w)
            drift(g, w, 0, 800 + k * 250) { a, ox, _ ->
                for (r in 0 until 3) {
                    val rw = cw * (2 + r) / 4
                    for (x in 0 until rw) if (r > 0 || (x and 1) == 0) a.px(cx - rw / 2 + x + ox, cy + r, 1, 1, if (r == 2) "#e8b8a8" else "#8a7fa8")
                }
            }
        }
        frames(g, 50, { a -> a.px(sigX, deck - 9 * s, s, s, "#ff4a4a") }, { a -> a.px(sigX + s, deck - 9 * s, s, s, "#5ce17a") })
    }

    /** A little green workshop on a quiet street: panels on the roof, a chimney tower, signs and a banner, a lamp in the shop window. */
    private fun greenShop(g: Grid) {
        val w = g.w; val h = g.h
        val s = max(1, h / 40)
        val ground = h - max(3, h * 10 / 100)
        val ink = "#1e2b22"
        g.gradient(0, ground, listOf("#7fb487", "#8cbe93", "#9ac99d", "#a6d2a6"))
        g.px(0, ground, w, h - ground, "#86b48a")
        g.px(0, ground, w, s, ink)
        val bx = w * 38 / 100; val bw = max(30 * s, w * 34 / 100)
        val top = h * 30 / 100; val roofH = max(4 * s, h * 12 / 100)
        val mid = top + (ground - top) * 42 / 100
        // The roof: a slanted band of panels, dark and light.
        for (y in top - roofH until top) {
            val inset = (top - y) * 2 / 3
            g.px(bx + inset, y, bw - 2 * inset, 1, "#2f6a4f")
            run {
                var x = bx + inset
                while (x < bx + bw - inset) {
                    if ((((x - bx) / (4 * s) + (y - top + roofH) / (2 * s)) and 1) == 0) g.px(x, y, min(4 * s, bx + bw - inset - x), 1, "#4a8f6a")
                    x += 4 * s
                }
            }
        }
        g.px(bx + roofH * 2 / 3, top - roofH - s, bw - roofH * 4 / 3, s, "#7a8a2a")
        // The upper floor: three window boxes with fans, vents under them.
        g.px(bx, top, bw, mid - top, "#55a578")
        g.px(bx, top, s, ground - top, ink)
        val winW = bw / 5; val winH = max(3 * s, (mid - top) * 50 / 100)
        for (k in 0 until 3) {
            val wx = bx + bw * (8 + k * 30) / 100; val wy = top + 2 * s
            g.px(wx - s, wy - s, winW + 2 * s, winH + 2 * s, ink)
            g.px(wx, wy, winW, winH, "#2d4a3a")
            g.disc(wx + winW / 2, wy + winH / 2, max(1, min(winW, winH) / 3), "#a8c8a0")
            g.px(wx + s, wy + winH + 2 * s, winW - 2 * s, s, "#7a8a2a")
        }
        g.px(bx - s, mid, bw + 2 * s, 2 * s, "#6b7a1a")
        // The ground floor: the shop's opening with a lamp, screens and a counter; notices beside it.
        g.px(bx, mid + 2 * s, bw, ground - mid - 2 * s, "#4f9a6e")
        val ox = bx + bw * 10 / 100; val ow = bw * 48 / 100; val oy = mid + 4 * s
        g.px(ox - s, oy - s, ow + 2 * s, ground - oy + s, ink)
        g.px(ox, oy, ow, ground - oy, "#20261f")
        run { var y = oy + 4 * s; while (y < ground - 3 * s) { g.px(ox + s, y, ow / 3, s, "#3a5a44"); y += 3 * s } }
        g.px(ox + ow / 2, oy + 4 * s, 3 * s, 2 * s, "#7fc8a0")
        g.px(ox + ow / 2 + 4 * s, oy + 4 * s, 3 * s, 2 * s, "#7fc8a0")
        val lampX = ox + ow * 40 / 100; val lr = max(2, 3 * s)
        g.px(lampX, oy, max(1, s / 2), 2 * s, "#9ab08a")
        for (y in 0..lr) {
            val half = isqrt(lr * lr - (lr - y) * (lr - y))
            g.px(lampX - half, oy + 2 * s + y, half * 2 + 1, 1, "#c9dca0")
        }
        g.px(ox, ground - 3 * s, ow, 3 * s, "#3f7a5a")
        for (k in 0 until 2) {
            val nx = ox + ow + 3 * s + k * 5 * s; val ny = oy + 2 * s
            g.px(nx, ny, 4 * s, 6 * s, "#c9d8a8")
            run { var y = ny + s; while (y < ny + 5 * s) { g.px(nx + s, y, 2 * s, max(1, s / 2), ink); y += 2 * s } }
        }
        // The chimney tower on the right, under its little roof.
        val tx = bx + bw - s; val tw = max(6 * s, w * 6 / 100); val ty = h * 12 / 100
        g.px(tx, ty, tw, ground - ty, "#3f7a5a")
        g.px(tx + tw - 2 * s, ty, 2 * s, ground - ty, "#2d5a44")
        run { var y = ty + 4 * s; while (y < ground) { g.px(tx, y, tw, s, "#2d5a44"); y += 6 * s } }
        for (y in 0 until 3 * s) g.px(tx - s - y, ty - 3 * s + y, tw + 2 * s + 2 * y, 1, "#7a5a1a")
        g.px(tx, ty - 5 * s, tw, 2 * s, "#5a4a1a")
        // A street lamp and a sign by the road, a little fence, boxes by the tower.
        val lx = w * 18 / 100
        g.px(lx, h * 34 / 100, s, ground - h * 34 / 100, ink)
        g.px(lx - 2 * s, h * 34 / 100 - 2 * s, 5 * s, 2 * s, ink)
        g.disc(lx - 4 * s, h * 50 / 100, max(2, 3 * s), ink)
        g.disc(lx - 4 * s, h * 50 / 100, max(1, 2 * s), "#4f9a6e")
        g.line(lx - 6 * s, h * 50 / 100 + 2 * s, lx - 2 * s, h * 50 / 100 - 2 * s, ink)
        run { var x = w * 4 / 100; while (x < w * 30 / 100) { g.px(x, ground - 5 * s, s, 5 * s, "#3f7a5a"); x += 6 * s } }
        g.px(w * 4 / 100, ground - 4 * s, w * 26 / 100, s, "#3f7a5a")
        for (k in 0 until 2) g.px(tx + tw + s + k * s, ground - (4 + k * 3) * s, 5 * s - k * s, 3 * s, if (k == 0) "#5a7a64" else "#6a8a74")
        // Moving: smoke from the chimney, the banner swaying, the shop's screens and lamp.
        val smoke = { a: Grid, lift: Int ->
            for (k in 0 until 3) a.disc(tx + tw / 2 + (k % 2) * 2 * s - s, ty - 7 * s - k * 3 * s - lift, max(1, s + k * s / 2), "#dfe8d8")
        }
        frames(g, 14, { a -> smoke(a, 0) }, { a -> smoke(a, s) })
        val banner = { a: Grid, sway: Int ->
            val bx2 = tx + tw + 3 * s + sway; val by2 = ty + 6 * s; val bh = max(6 * s, h * 28 / 100)
            a.px(tx + tw, ty + 5 * s, 4 * s, s, ink)
            a.px(bx2, by2, 4 * s, bh, "#c9d8a8")
            run { var y = by2 + s; while (y < by2 + bh - s) { a.px(bx2 + s, y, 2 * s, s, ink); y += 3 * s } }
            a.px(bx2, by2 + bh, s, s, ink)
            a.px(bx2 + 3 * s, by2 + bh, s, s, ink)
        }
        frames(g, 30, { a -> banner(a, 0) }, { a -> banner(a, max(1, s / 2)) })
        g.actor(period = 26, delay = 9, on = 9, rest = 13) { a -> a.px(ox + ow / 2, oy + 4 * s, 3 * s, 2 * s, "#2d4a3a") }
        g.actor(period = 37, on = 2, rest = 10) { a ->
            for (y in 0..lr) {
                val half = isqrt(lr * lr - (lr - y) * (lr - y))
                a.px(lampX - half, oy + 2 * s + y, half * 2 + 1, 1, "#f0f8c8")
            }
        }
    }

    /**
     * The scene for a year (the Time Machine's backdrop): the bullet train for the 1960s, Fuji for the
     * '70s, City Pop's sunset for the '80s, the arcade for the '90s, the neon city for the 2000s, the
     * ramen stand for the 2010s and starlight from 2020.
     */
    fun forYear(year: Int): String = when {
        year < 1970 -> "shinkansen"
        year < 1980 -> "fuji"
        year < 1990 -> "sunset"
        year < 2000 -> "arcade"
        year < 2010 -> "neon-city"
        year < 2020 -> "ramen-stand"
        else -> "starlight"
    }

    /**
     * The Songs page's scene for a chart (null for all time): the jukebox for all time, the valve radio
     * for the 1960s, the hi-fi for the '70s, the night drive for the '80s, karaoke for the '90s, the
     * rooftop band for the 2000s, the stage for the 2010s and the hologram singer from 2020.
     */
    fun forSongs(year: Int?): String = when {
        year == null -> "jukebox"
        year < 1970 -> "radio"
        year < 1980 -> "hifi"
        year < 1990 -> "night-drive"
        year < 2000 -> "karaoke"
        year < 2010 -> "rooftop-band"
        year < 2020 -> "stage"
        else -> "hologram"
    }

    /**
     * The sprite id for a row's title from the sheet's sections map: lower-case titles, or prefixes
     * ending in " *" ("new in *" matches "New in 2015").
     */
    fun sectionSprite(sections: Map<String, String>, title: String): String? {
        val key = title.trim().lowercase()
        sections[key]?.let { return it }
        for ((pattern, id) in sections) {
            if (pattern.endsWith(" *") && key.startsWith(pattern.dropLast(1))) return id
        }
        return null
    }

    /** A sprite (rows of palette letters, '.' clear) as runs of one colour along each row. */
    fun spriteRects(rows: List<String>, palette: Map<Char, String>): List<CityPopPixel> {
        val out = ArrayList<CityPopPixel>()
        for (y in rows.indices) {
            val row = rows[y]
            var x = 0
            while (x < row.length) {
                val ch = row[x]
                var end = x + 1
                while (end < row.length && row[end] == ch) end++
                val color = palette[ch]
                if (ch != '.' && color != null) out.add(CityPopPixel(x, y, end - x, 1, color))
                x = end
            }
        }
        return out
    }

    private val SKYLINE_WINDOWS = listOf("#ffd36b", "#ff7ad9", "#2ee6ff")

    /**
     * The animated background's skyline: building silhouettes with lit windows and rooftop beacons
     * on a clear sky, so the page shows through above them. [frame] 0 or 1 switches some windows and
     * the beacons; showing the two frames in turn makes the city twinkle.
     */
    fun skyline(width: Int, height: Int, frame: Int): List<CityPopPixel> {
        val g = Grid(max(16, width), max(8, height))
        val w = g.w; val h = g.h
        var x = 0; var i = 0
        while (x < w) {
            val bw = 5 + mod(60000 + i, 8)
            if (mod(60100 + i, 7) == 0) { x += 2 + mod(60200 + i, 4); i++; continue }
            val tall = max(3, h * (30 + mod(60300 + i, 66)) / 100)
            val top = h - tall
            g.px(x, top, bw, tall, if (i % 2 == 0) "#0e0720" else "#130a2a")
            if (mod(60400 + i, 3) == 0 && top > 4) {
                g.px(x + bw / 2, top - 3, 1, 3, "#0e0720")
                if ((i + frame) % 2 == 0) g.px(x + bw / 2, top - 4, 1, 1, "#ff3d6e")
            }
            var wy = top + 2
            while (wy < h - 1) {
                var wx = x + 1
                while (wx < x + bw - 1) {
                    val lit = hash(wx * 131 + wy * 17 + 9)
                    val on = lit % 9 == 0L || (lit % 9 == 1L && (lit / 16) % 2 == frame.toLong())
                    if (on) g.px(wx, wy, 1, 1, SKYLINE_WINDOWS[((lit / 64) % SKYLINE_WINDOWS.size).toInt()])
                    wx += 2
                }
                wy += 3
            }
            x += bw; i++
        }
        return g.out
    }
}
