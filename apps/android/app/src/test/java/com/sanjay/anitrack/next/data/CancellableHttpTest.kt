package com.sanjay.anitrack.next.data

import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.ForwardingSource
import okio.Timeout
import okio.buffer
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

class CancellableHttpTest {
    private class ControlledCall : Call {
        lateinit var callback: Callback
        private val cancelled = AtomicBoolean(false)
        val cancellation = CountDownLatch(1)
        override fun request(): Request = Request.Builder().url("https://fixture.invalid/graphql").build()
        override fun execute(): Response = error("This path must be asynchronous")
        override fun enqueue(responseCallback: Callback) { callback = responseCallback }
        override fun cancel() { cancelled.set(true); cancellation.countDown() }
        override fun isExecuted() = ::callback.isInitialized
        override fun isCanceled() = cancelled.get()
        override fun timeout() = Timeout()
        override fun clone(): Call = ControlledCall()
        fun respond(body: ResponseBody) = callback.onResponse(this, Response.Builder()
            .request(request()).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(body).build())
    }

    private fun body(closed: AtomicBoolean, beforeRead: () -> Unit = {}): ResponseBody {
        val source = object : ForwardingSource(Buffer().writeUtf8("{\"data\":{\"id\":1}}")) {
            override fun read(sink: Buffer, byteCount: Long): Long {
                beforeRead()
                return super.read(sink, byteCount)
            }
            override fun close() { closed.set(true); super.close() }
        }.buffer()
        return object : ResponseBody() {
            override fun contentType(): MediaType? = null
            override fun contentLength() = -1L
            override fun source(): BufferedSource = source
        }
    }

    @Test fun successReadsAndClosesBeforeReturning() = runBlocking {
        val call = ControlledCall()
        val closed = AtomicBoolean(false)
        val result = async(start = CoroutineStart.UNDISPATCHED) {
            call.readCancellable { it.body!!.string() }
        }
        call.respond(body(closed))
        assertEquals("{\"data\":{\"id\":1}}", result.await())
        assertTrue(closed.get())
        assertFalse(call.isCanceled())
    }

    @Test fun cancellingBeforeHeadersClosesALateResponseWithoutReadingIt() = runBlocking {
        val call = ControlledCall()
        val closed = AtomicBoolean(false)
        var read = false
        val result = async(start = CoroutineStart.UNDISPATCHED) {
            call.readCancellable { read = true; it.body!!.string() }
        }
        result.cancelAndJoin()
        call.respond(body(closed))
        assertTrue(call.isCanceled())
        assertTrue(closed.get())
        assertFalse(read)
    }

    @Test fun cancellingDuringTheBodyReleasesTheSerialQueueForTheNextSearch() = runBlocking {
        val call = ControlledCall()
        val closed = AtomicBoolean(false)
        val entered = CountDownLatch(1)
        val queue = Mutex()
        val abandoned = async(start = CoroutineStart.UNDISPATCHED) {
            queue.withLock { call.readCancellable { it.body!!.string() } }
        }
        val worker = thread(isDaemon = true) {
            call.respond(body(closed) {
                entered.countDown()
                check(call.cancellation.await(2, TimeUnit.SECONDS))
                throw IOException("Cancelled socket read")
            })
        }
        assertTrue(entered.await(1, TimeUnit.SECONDS))
        abandoned.cancelAndJoin()
        val next = withTimeout(1000) { queue.withLock { "new search" } }
        worker.join(1000)
        assertEquals("new search", next)
        assertTrue(call.isCanceled())
        assertTrue(closed.get())
        assertFalse(worker.isAlive)
    }

    @Test fun bodyAndTransportFailuresAreDeliveredWithoutLeakingResponses() = runBlocking {
        val call = ControlledCall()
        val closed = AtomicBoolean(false)
        val result = async(start = CoroutineStart.UNDISPATCHED) {
            runCatching { call.readCancellable { it.body!!.string() } }
        }
        call.respond(body(closed) { throw IOException("Stalled body deadline") })
        assertEquals("Stalled body deadline", result.await().exceptionOrNull()?.message)
        assertTrue(closed.get())

        val failedCall = ControlledCall()
        val failure = async(start = CoroutineStart.UNDISPATCHED) {
            runCatching { failedCall.readCancellable { "unused" } }
        }
        failedCall.callback.onFailure(failedCall, IOException("Unavailable"))
        assertEquals("Unavailable", failure.await().exceptionOrNull()?.message)
    }
}
