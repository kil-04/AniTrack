package com.sanjay.anitrack.next.data

import android.content.Context

/** Recent searches that led somewhere (a result or "view all"), newest first, per mode ("anime", "manga" or "novel"). Kept on this device only. */
object SearchHistory {
    private const val PREFS = "anitrack_next"
    private const val MAX = 8

    private fun key(mode: String) = "search_history_$mode"

    fun recent(context: Context, mode: String): List<String> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key(mode), null)
            ?.split('\n')?.filter { it.isNotBlank() }.orEmpty()

    fun remember(context: Context, mode: String, query: String) {
        val q = query.trim().replace('\n', ' ').take(120)
        if (q.length < 2) return
        val list = (listOf(q) + recent(context, mode).filterNot { it.equals(q, ignoreCase = true) }).take(MAX)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(key(mode), list.joinToString("\n")).apply()
    }

    fun clear(context: Context, mode: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(key(mode)).apply()
    }
}
