package com.sanjay.anitrack.next.data.providers.connectors.anikoto

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

internal object AnikotoServerPolicy {
    data class Group(val label: String, val ids: List<String>)

    fun isHard(label: String): Boolean = Regex("H[- ]?SUB|HARD[- ]?SUB", RegexOption.IGNORE_CASE).containsMatchIn(label)

    fun select(groups: List<Group>, preferHardSub: Boolean): Group =
        groups.firstOrNull { group ->
            group.ids.isNotEmpty() && if (preferHardSub) isHard(group.label)
            else group.label.contains("SUB", ignoreCase = true) && !isHard(group.label)
        } ?: error(if (preferHardSub) "Anikoto has no hard-sub server for this episode. Select soft subtitles."
            else "Anikoto has no soft-sub server for this episode. Select another subtitle type or provider.")

    suspend fun <T> resolve(ids: List<String>, preferred: (T) -> Boolean, attempt: (String) -> T): T {
        var first: T? = null
        var lastError: Exception? = null
        for (id in ids.take(5)) {
            currentCoroutineContext().ensureActive()
            try {
                val value = attempt(id)
                if (first == null) first = value
                if (preferred(value)) return value
            } catch (error: Exception) {
                AnikotoRequestPolicy.rethrowTerminal(error)
                lastError = error
            }
        }
        return first ?: throw (lastError ?: IllegalStateException("Every Anikoto server failed."))
    }
}
