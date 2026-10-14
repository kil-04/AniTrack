package com.sanjay.anitrack.next.data

import android.content.Context

/** Recent searches that led somewhere (a result or "view all"), newest first, per mode. Kept on this device only. */
object SearchHistory {
    private const val PREFS = "anitrack_next"
    private const val MAX = 8

    private fun key(manga: Boolean) = if (manga) "search_history_manga" else "search_history_anime"

    fun recent(context: Context, manga: Boolean): List<String> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key(manga), null)
            ?.split('\n')?.filter { it.isNotBlank() }.orEmpty()

    fun remember(context: Context, manga: Boolean, query: String) {
        val q = query.trim().replace('\n', ' ').take(120)
        if (q.length < 2) return
        val list = (listOf(q) + recent(context, manga).filterNot { it.equals(q, ignoreCase = true) }).take(MAX)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(key(manga), list.joinToString("\n")).apply()
    }

    fun clear(context: Context, manga: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(key(manga)).apply()
    }
}
