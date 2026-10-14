package com.sanjay.anitrack.next.data

/**
 * Picks what to read after an anime from its AniList print relations: the manga it
 * adapts, or for novel-based shows the novel and its manga version.
 *
 * AniList labels these edges loosely (a show's source manga is usually an
 * "ADAPTATION" edge, rarely "SOURCE"), so the anime's own source type decides what
 * the books are, and popularity picks the main series over one-shots and anthologies.
 */
object StoryBridge {
    /** A manga or novel related to an anime, with AniList's relation type. */
    data class Link(val type: String, val manga: Manga)

    enum class Kind {
        /** The anime adapts this manga. */
        SourceManga,
        /** The anime adapts this novel; [Plan.readable] is its manga version, if any. */
        SourceNovel,
        /** An original (or game-based) anime retold as a manga. */
        MangaVersion,
    }

    data class Plan(
        /** The headline book; null when nothing in print tells this story. */
        val primary: Manga?,
        val kind: Kind?,
        /** The comic to open in the reader: [primary] itself, or a novel's manga version. */
        val readable: Manga?,
        /** Everything else in print, most popular first. */
        val more: List<Link>,
    )

    private val STORY_EDGES = setOf("SOURCE", "ADAPTATION")
    private val COMICS = setOf("MANGA", "ONE_SHOT")
    private val NOVEL_SOURCES = setOf("LIGHT_NOVEL", "NOVEL", "WEB_NOVEL")
    private val COMIC_SOURCES = setOf("MANGA", "COMIC", "DOUJINSHI")
    private const val MORE_LIMIT = 15

    private fun List<Link>.best(formats: Set<String>): Manga? =
        filter { it.manga.format in formats }.maxByOrNull { it.manga.popularity ?: 0 }?.manga

    /** The best match from the first pool that has one. */
    private fun best(formats: Set<String>, vararg pools: List<Link>): Manga? =
        pools.firstNotNullOfOrNull { it.best(formats) }

    /**
     * [links] carry AniList's version-2 relation types where available, which mark the
     * material an anime adapts as SOURCE; version-1 data labels it ADAPTATION.
     */
    fun plan(source: String?, links: List<Link>): Plan {
        val usable = links.distinctBy { it.manga.id }
        val sourced = usable.filter { it.type == "SOURCE" }
        val story = usable.filter { it.type in STORY_EDGES }
        val retold = usable.filter { it.type == "ALTERNATIVE" }
        var kind: Kind? = null
        var primary: Manga? = null
        var readable: Manga? = null
        when (source) {
            in COMIC_SOURCES -> {
                primary = best(COMICS, sourced, story, retold)
                if (primary != null) kind = Kind.SourceManga
                readable = primary
            }
            in NOVEL_SOURCES -> {
                val novel = best(setOf("NOVEL"), sourced, story, retold)
                val comic = (story + retold).best(setOf("MANGA"))
                when {
                    novel != null -> { primary = novel; kind = Kind.SourceNovel }
                    comic != null -> { primary = comic; kind = Kind.MangaVersion }
                }
                readable = comic
            }
            else -> {
                primary = (story + retold).best(setOf("MANGA"))
                if (primary != null) kind = Kind.MangaVersion
                readable = primary
            }
        }
        val shown = setOfNotNull(primary?.id, readable?.id)
        val more = usable.filter { it.manga.id !in shown }
            .sortedByDescending { it.manga.popularity ?: 0 }
            .take(MORE_LIMIT)
        return Plan(primary, kind, readable, more)
    }

    /**
     * The chapter to read next from [progress] (chapter number to read state), like
     * the manga page's resume target: the chapter read last, or the one after it once
     * finished. Null before any reading.
     */
    fun nextChapter(progress: Map<Float, com.sanjay.anitrack.next.data.manga.ReadState>): Float? {
        val latest = progress.maxByOrNull { it.value.updatedAt } ?: return null
        return if (latest.value.finished) kotlin.math.floor(latest.key) + 1f else latest.key
    }
}
