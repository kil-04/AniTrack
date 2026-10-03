package com.sanjay.anitrack.next.data.manga.comix

import android.app.Service
import android.content.Intent
import android.os.*
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

/** Internal process boundary accepts catalogue requests, not JavaScript or URLs. */
class ComixSessionService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val lock = Mutex()
    private val active = mutableMapOf<Int, Job>()
    private val messenger = Messenger(object : Handler(Looper.getMainLooper()) {
        override fun handleMessage(message: Message) {
            if (message.what == CANCEL) { active.remove(message.arg1)?.cancel(); return }
            if (message.what != READ || message.replyTo == null || active.size >= 2) return
            val id = message.arg1
            val reply = message.replyTo
            val path = message.data.getString("path").orEmpty()
            val raw = message.data.getString("params").orEmpty()
            if (path.length > 100 || raw.length > 2000) return
            val job = scope.launch(start = CoroutineStart.LAZY) {
                val body = try {
                    require(Build.VERSION.SDK_INT >= 28) { "Comix needs Android 9 or newer for its separate website profile." }
                    val value = lock.withLock { ComixSessionEngine.get(this@ComixSessionService).read(path, JSONObject(raw)) }
                    JSONObject().put("ok", true).put("value", value).toString()
                } catch (_: TimeoutCancellationException) {
                    JSONObject().put("ok", false).put("error", "Comix catalogue timed out. Retry manually.").toString()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    JSONObject().put("ok", false).put("error", e.message?.take(160) ?: "Comix request failed.").toString()
                }
                try {
                    reply.send(Message.obtain(null, READ, id, 0).apply { data = Bundle().apply { putString("body", body) } })
                } catch (_: RemoteException) { /* Caller has left; no retries. */ }
            }
            active[id] = job
            job.invokeOnCompletion { active.remove(id) }
            job.start()
        }
    })

    override fun onBind(intent: Intent): IBinder = messenger.binder
    override fun onDestroy() {
        scope.cancel()
        ComixSessionEngine.close()
        super.onDestroy()
    }

    companion object { internal const val READ = 1; internal const val CANCEL = 2 }
}
