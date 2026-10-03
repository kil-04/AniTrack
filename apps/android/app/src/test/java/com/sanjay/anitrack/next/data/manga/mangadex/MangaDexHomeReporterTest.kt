package com.sanjay.anitrack.next.data.manga.mangadex

import okhttp3.Call
import okhttp3.Connection
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException
import java.util.concurrent.TimeUnit

class MangaDexHomeReporterTest {
    private val sent = mutableListOf<JSONObject>()
    private lateinit var original: (Request) -> Unit

    @Before fun capture() {
        original = MangaDexHomeReporter.sender
        MangaDexHomeReporter.sender = { request ->
            assertEquals("https://api.mangadex.network/report", request.url.toString())
            assertTrue(request.header("User-Agent")!!.startsWith("AniTrack/"))
            val buffer = Buffer()
            request.body!!.writeTo(buffer)
            sent += JSONObject(buffer.readUtf8())
        }
    }

    @After fun restore() {
        MangaDexHomeReporter.sender = original
    }

    private class FakeChain(private val request: Request, private val respond: (Request) -> Response) : Interceptor.Chain {
        override fun request() = request
        override fun proceed(request: Request) = respond(request)
        override fun connection(): Connection? = null
        override fun call(): Call = throw UnsupportedOperationException()
        override fun connectTimeoutMillis() = 0
        override fun withConnectTimeout(timeout: Int, unit: TimeUnit) = this
        override fun readTimeoutMillis() = 0
        override fun withReadTimeout(timeout: Int, unit: TimeUnit) = this
        override fun writeTimeoutMillis() = 0
        override fun withWriteTimeout(timeout: Int, unit: TimeUnit) = this
    }

    private fun response(request: Request, code: Int, bytes: ByteArray, cache: String? = null) =
        Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("x")
            .apply { if (cache != null) header("X-Cache", cache) }
            .body(bytes.toResponseBody("image/png".toMediaType()))
            .build()

    private fun request(host: String) = Request.Builder().url("https://$host/data/0123456789abcdef0123456789abcdef/1-a.png").build()

    @Test fun leavesOtherHostsAlone() {
        val req = request("uploads.mangadex.org")
        MangaDexHomeReporter.intercept(FakeChain(req) { response(it, 200, ByteArray(10)) }).body!!.bytes()
        assertTrue(sent.isEmpty())
    }

    @Test fun reportsACompleteLoadWithBytesAndCacheHit() {
        val req = request("ok1.example.mangadex.network")
        val body = MangaDexHomeReporter.intercept(FakeChain(req) { response(it, 200, ByteArray(1234), cache = "HIT") }).body!!
        assertEquals(1234, body.bytes().size)
        val report = sent.single()
        assertEquals(req.url.toString(), report.getString("url"))
        assertTrue(report.getBoolean("success"))
        assertEquals(1234, report.getLong("bytes"))
        assertTrue(report.getBoolean("cached"))
    }

    @Test fun reportsHttpErrorsAndMarksTheNodeFailed() {
        val before = System.currentTimeMillis() - 1
        val req = request("bad2.example.mangadex.network")
        MangaDexHomeReporter.intercept(FakeChain(req) { response(it, 503, ByteArray(0)) }).close()
        assertFalse(sent.single().getBoolean("success"))
        assertTrue(MangaDexHomeReporter.failedSince("https://bad2.example.mangadex.network", before))
        assertFalse(MangaDexHomeReporter.failedSince("https://other.example.mangadex.network", before))
    }

    @Test fun reportsConnectionFailuresAndRethrows() {
        val req = request("down3.example.mangadex.network")
        val thrown = runCatching {
            MangaDexHomeReporter.intercept(FakeChain(req) { throw IOException("reset") })
        }.exceptionOrNull()
        assertTrue(thrown is IOException)
        val report = sent.single()
        assertFalse(report.getBoolean("success"))
        assertEquals(0, report.getLong("bytes"))
    }

    @Test fun cancelledLoadsAreNotBlamedOnTheNode() {
        val req = request("slow4.example.mangadex.network")
        MangaDexHomeReporter.intercept(FakeChain(req) { response(it, 200, ByteArray(5000)) }).body!!.close()
        assertTrue(sent.isEmpty())
    }

    @Test fun aDecoderStoppingAtTheLastByteStillCountsAsComplete() {
        val req = request("ok5.example.mangadex.network")
        val body = MangaDexHomeReporter.intercept(FakeChain(req) { response(it, 200, ByteArray(300)) }).body!!
        body.source().require(300) // every byte read, EOF never requested
        body.close()
        assertTrue(sent.single().getBoolean("success"))
    }
}
