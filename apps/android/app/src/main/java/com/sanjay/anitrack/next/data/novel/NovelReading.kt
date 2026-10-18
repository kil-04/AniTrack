package com.sanjay.anitrack.next.data.novel

import androidx.compose.runtime.mutableStateOf

/** The chapter open in the novel reader — the novels counterpart of MangaReading. */
object NovelReading {
    data class Session(
        val detail: NovelDetail,
        val chapters: List<NovelChapter>,
        val index: Int,
        val startParagraph: Int = 0,
        /** How far through to start, when the place came from another source's copy (its paragraphs differ). */
        val startFraction: Float? = null,
    ) {
        val source: NovelSourceId get() = detail.card.source
        val titleId: String get() = detail.card.id
        val chapter: NovelChapter get() = chapters[index]
        val previous: NovelChapter? get() = chapters.getOrNull(index - 1)
        val next: NovelChapter? get() = chapters.getOrNull(index + 1)
    }

    val current = mutableStateOf<Session?>(null)

    fun open(detail: NovelDetail, chapters: List<NovelChapter>, chapter: NovelChapter, paragraph: Int = 0, fraction: Float? = null): Boolean {
        val index = chapters.indexOfFirst { it.id == chapter.id }
        if (index < 0) return false
        current.value = Session(detail, chapters, index, paragraph.coerceAtLeast(0), fraction?.coerceIn(0f, 1f))
        return true
    }

    fun jump(index: Int) {
        val s = current.value ?: return
        if (index in s.chapters.indices) current.value = s.copy(index = index, startParagraph = 0, startFraction = null)
    }

    suspend fun save(session: Session, paragraph: Int, paragraphCount: Int) {
        if (paragraphCount <= 0) return
        runCatching {
            NovelStore.save(
                NovelStore.ReadingRow(
                    source = session.source,
                    titleId = session.titleId,
                    chapterId = session.chapter.id,
                    chapterOrder = session.chapter.order,
                    chapterLabel = session.chapter.label,
                    paragraph = paragraph.coerceIn(0, paragraphCount - 1),
                    paragraphCount = paragraphCount,
                    title = session.detail.card.title,
                    cover = session.detail.card.cover,
                    updatedAt = System.currentTimeMillis(),
                ),
            )
            com.sanjay.anitrack.next.data.GistSync.novelReadingChanged()
        }
    }
}
