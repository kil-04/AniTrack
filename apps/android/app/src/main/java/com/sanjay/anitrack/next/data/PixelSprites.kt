package com.sanjay.anitrack.next.data

import android.content.Context
import org.json.JSONObject

/**
 * Pixel mode's sprites: packages/catalogs/pixel-sprites.json (an asset here, imported on desktop
 * by packages/shared/pixel-sprites.ts). 16-wide pictures for empty states, row headers, the Home
 * footer and the animated background.
 */
object PixelSprites {
    const val FILE = "pixel-sprites.json"

    class Sheet(val palette: Map<Char, String>, val sprites: Map<String, List<String>>, val sections: Map<String, String>) {
        private val cache = HashMap<String, List<CityPopPixel>>()

        /** A sprite's pixels, cached; empty for an unknown id. */
        fun rects(id: String): List<CityPopPixel> = synchronized(cache) {
            cache.getOrPut(id) { PixelScenes.spriteRects(sprites[id].orEmpty(), palette) }
        }

        fun width(id: String): Int = sprites[id]?.firstOrNull()?.length ?: 0
        fun height(id: String): Int = sprites[id]?.size ?: 0

        /** The sprite beside a row's title ("Continue Watching": the TV; "New in 2015": the star), if it has one. */
        fun forSection(title: String): String? = PixelScenes.sectionSprite(sections, title)?.takeIf { it in sprites }
    }

    @Volatile private var loaded: Sheet? = null

    fun parse(json: String): Sheet {
        val root = JSONObject(json)
        val palette = HashMap<Char, String>()
        root.getJSONObject("palette").let { p -> p.keys().forEach { key -> if (key.length == 1) palette[key[0]] = p.getString(key) } }
        val sprites = LinkedHashMap<String, List<String>>()
        root.getJSONObject("sprites").let { s ->
            s.keys().forEach { id -> val rows = s.getJSONArray(id); sprites[id] = List(rows.length()) { rows.getString(it) } }
        }
        val sections = HashMap<String, String>()
        root.optJSONObject("sections")?.let { s -> s.keys().forEach { sections[it] = s.getString(it) } }
        return Sheet(palette, sprites, sections)
    }

    /** The sheet from the app's assets, read once. */
    fun load(context: Context): Sheet = loaded ?: synchronized(this) {
        loaded ?: parse(context.assets.open(FILE).bufferedReader().use { it.readText() }).also { loaded = it }
    }
}
