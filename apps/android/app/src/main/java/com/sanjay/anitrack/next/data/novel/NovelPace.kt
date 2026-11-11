package com.sanjay.anitrack.next.data.novel

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * A request budget shared by everything that talks to one source: a few requests
 * may go at once ([burst]), after which one more is let through every [refillMs].
 * When several are waiting, the lowest priority number goes first (what's on
 * screen before background work), oldest first among equals.
 *
 * Novel Phoenix refuses bursts (HTTP 429 at roughly a dozen requests in as many
 * seconds), while one request every two seconds ran for a minute without a refusal;
 * its reader, chapter-list fill and downloads all draw on one budget so that
 * together they stay under that. Mirrors RequestPace in the desktop's services/novel/pace.ts.
 */
internal class NovelPace(private val burst: Int, private val refillMs: Long, private val now: () -> Long = System::currentTimeMillis) {
    private val lock = Any()
    private var tokens = burst
    /** When the budget last gained a token (or was last full). */
    private var since = now()
    private val waiting = ArrayList<Pair<Int, CompletableDeferred<Unit>>>()
    private var timer: Job? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** Returns when a request may be sent. */
    suspend fun take(priority: Int = 0) {
        val gate = CompletableDeferred<Unit>()
        synchronized(lock) {
            waiting += priority to gate
            pump()
        }
        try {
            gate.await()
        } catch (e: CancellationException) {
            synchronized(lock) { waiting.removeAll { it.second === gate } }
            throw e
        }
    }

    /** Called with [lock] held. */
    private fun pump() {
        val t = now()
        if (tokens >= burst) {
            since = t
        } else {
            val gained = ((t - since) / refillMs).toInt()
            if (gained > 0) {
                tokens = minOf(burst, tokens + gained)
                since = if (tokens >= burst) t else since + gained * refillMs
            }
        }
        while (tokens > 0 && waiting.isNotEmpty()) {
            // minBy keeps the first of equals: the oldest waiter of the most urgent kind.
            val next = waiting.indices.minByOrNull { waiting[it].first } ?: break
            tokens--
            waiting.removeAt(next).second.complete(Unit)
        }
        if (waiting.isNotEmpty() && timer == null) {
            timer = scope.launch {
                delay(maxOf(1L, refillMs - (now() - since)))
                synchronized(lock) {
                    timer = null
                    pump()
                }
            }
        }
    }
}
