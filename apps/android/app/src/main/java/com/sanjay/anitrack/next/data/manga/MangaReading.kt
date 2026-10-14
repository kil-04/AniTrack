package com.sanjay.anitrack.next.data.manga

import androidx.compose.runtime.mutableStateOf
import com.sanjay.anitrack.next.data.Db
import com.sanjay.anitrack.next.data.Manga

/** The chapter open in the reader — the manga counterpart of PlaySession. */
object MangaReading {
    data class Session(
        val manga: Manga,
        val source: MangaSource,
        val title: SourceTitle,
        val chapters: List<MangaChapter>,
        val index: Int,
        val startPage: Int = 0,
    ) {
        val chapter: MangaChapter get() = chapters[index]
        val hasPrevious: Boolean get() = index > 0
        val hasNext: Boolean get() = index < chapters.lastIndex
    }

    val current = mutableStateOf<Session?>(null)

    fun open(
        manga: Manga,
        source: MangaSource,
        title: SourceTitle,
        chapters: List<MangaChapter>,
        chapter: MangaChapter,
        startPage: Int = 0,
    ): Boolean {
        val index = chapters.indexOfFirst { it.id == chapter.id }
        if (index < 0) return false
        current.value = Session(manga, source, title, chapters, index, startPage.coerceAtLeast(0))
        return true
    }

    /** Moves to the neighbouring chapter, starting at its first page. */
    fun step(delta: Int) {
        val session = current.value ?: return
        jump(session.index + delta)
    }

    /** Opens the chapter at [index] of the session's reading order, from its first page. */
    fun jump(index: Int, startPage: Int = 0) {
        val session = current.value ?: return
        if (index !in session.chapters.indices) return
        current.value = session.copy(index = index, startPage = startPage.coerceAtLeast(0))
    }

    // Page lists fetched recently (the next chapter is fetched ahead while reading).
    private val pageCache = object : LinkedHashMap<String, List<MangaPage>>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<MangaPage>>) = size > 6
    }

    /** A chapter's pages: the downloaded copy first, then a recent fetch, then the source. */
    suspend fun pages(session: Session, chapter: MangaChapter = session.chapter): List<MangaPage> {
        MangaDownloads.localPages(session.manga.id, chapter.id)?.let { return it }
        val key = "${session.source.id}:${chapter.id}"
        synchronized(pageCache) { pageCache[key] }?.let { return it }
        val pages = session.source.pages(session.title, chapter)
        if (pages.isNotEmpty()) synchronized(pageCache) { pageCache[key] = pages }
        return pages
    }

    suspend fun save(session: Session, page: Int, pageCount: Int) {
        if (pageCount <= 0) return
        runCatching {
            Db.saveReading(
                Db.ReadRow(
                    mangaId = session.manga.id,
                    chapter = session.chapter.number,
                    chapterId = session.chapter.id,
                    page = page.coerceIn(0, pageCount - 1),
                    pageCount = pageCount,
                    title = session.manga.title,
                    cover = session.manga.cover,
                    sourceId = session.source.id,
                    updatedAt = System.currentTimeMillis(),
                ),
            )
        }
    }
}
