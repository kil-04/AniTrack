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
        val index = session.index + delta
        if (index !in session.chapters.indices) return
        current.value = session.copy(index = index, startPage = 0)
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
