package com.sanjay.anitrack.next.ui

/** The successfully displayed page to save for a settled pager unit.
 * Call inside snapshotFlow so late image completion, not just page turns,
 * changes progress. A failed pair member or unloaded final page never counts.
 */
internal fun pagedReaderSavePage(
    settledUnit: Int,
    units: List<List<Int>>,
    pageCount: Int,
    displayed: (Int) -> Boolean,
): Int? {
    if (pageCount <= 0 || settledUnit !in 0..units.size) return null
    if (settledUnit == units.size) {
        val last = pageCount - 1
        return last.takeIf(displayed)
    }
    return units[settledUnit].lastOrNull { it in 0 until pageCount && displayed(it) }
}
