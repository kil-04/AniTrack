package com.sanjay.anitrack.next.data

import com.sanjay.anitrack.next.data.DownloadResume.Failure
import com.sanjay.anitrack.next.data.DownloadResume.Kind
import com.sanjay.anitrack.next.data.DownloadResume.Piece
import com.sanjay.anitrack.next.data.DownloadResume.Step
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/** The same cases as tests/download-resume.test.mjs, against the Kotlin twin. */
class DownloadResumeTest {
    private val cases = JSONObject(
        generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
            .map { File(it, "tests/fixtures/download-resume.json") }.first { it.isFile }.readText(Charsets.UTF_8),
    )

    private fun head(spec: String): ByteArray {
        val kind = spec.substringBefore(':')
        val value = spec.substringAfter(':')
        return when (kind) {
            "hex" -> value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
            "text" -> value.toByteArray(Charsets.UTF_8)
            else -> ByteArray(value.toInt()).also { bytes ->
                if (kind == "ts") for (i in bytes.indices step 188) bytes[i] = 0x47
            }
        }
    }

    /** JSON with sorted keys and integral numbers, so two objects compare by value. */
    private fun canon(o: Any?): String = when (o) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> o.keys().asSequence().sorted().joinToString(",", "{", "}") { "$it:${canon(o.get(it))}" }
        is JSONArray -> (0 until o.length()).joinToString(",", "[", "]") { canon(o.get(it)) }
        is Number -> if (o.toDouble() % 1.0 == 0.0) o.toLong().toString() else o.toString()
        else -> "\"$o\""
    }

    private fun JSONObject.str(name: String): String? = if (isNull(name) || !has(name)) null else getString(name)
    private fun JSONArray.objects() = (0 until length()).map { getJSONObject(it) }
    private fun JSONArray.ints() = (0 until length()).map { getInt(it) }

    private fun piece(o: JSONObject) = Piece(
        Kind.of(o.getString("kind")), o.getString("url"), o.optString("file", ""),
        o.str("duration"), o.optBoolean("encrypted", false),
    )
    private fun pieces(a: JSONArray) = a.objects().map(::piece)
    private fun ledger(o: JSONObject, name: String) = o.str(name)?.let(DownloadResume::parseLedger)

    private fun plain(l: DownloadResume.Ledger?): JSONObject? = l?.let {
        val pieces = JSONObject()
        it.pieces.forEach { (i, e) -> pieces.put(i.toString(), JSONArray().put(e.file).put(e.size).put(e.tag)) }
        JSONObject().put("version", it.version).put("rendition", it.rendition).put("total", it.total).put("pieces", pieces)
    }

    @Test fun fnvMatchesTheTypeScriptTwin() {
        cases.getJSONArray("fnv64").objects().forEach { assertEquals(it.getString("text"), it.getString("hash"), DownloadResume.fnv64(it.getString("text"))) }
    }

    @Test fun stableUrlsDropHostFragmentAndSigningParameters() {
        cases.getJSONArray("stableUrl").objects().forEach { assertEquals(it.getString("url"), it.getString("stable"), DownloadResume.stableUrl(it.getString("url"))) }
        cases.getJSONArray("variantAttributes").objects().forEach {
            assertEquals(it.getString("line"), it.getString("attributes"), DownloadResume.variantAttributes(it.getString("line")))
        }
    }

    @Test fun aReSignedRenditionKeepsItsIdentityAndAnotherDoesNot() {
        val r = cases.getJSONObject("rendition")
        val id = r.getString("id")
        assertEquals(id, DownloadResume.renditionId(r.getString("variant"), pieces(r.getJSONArray("pieces"))))
        r.getJSONArray("same").objects().forEach {
            assertEquals(it.getString("why"), id, DownloadResume.renditionId(it.getString("variant"), pieces(it.getJSONArray("pieces"))))
        }
        r.getJSONArray("different").objects().forEach {
            assertNotEquals(it.getString("why"), id, DownloadResume.renditionId(it.getString("variant"), pieces(it.getJSONArray("pieces"))))
        }
    }

    @Test fun mediaImageAndErrorPageSignatures() {
        cases.getJSONArray("tags").objects().forEach {
            val bytes = head(it.getString("head"))
            assertEquals("media ${it.getString("head")}", it.str("media"), DownloadResume.mediaTag(bytes))
            assertEquals("image ${it.getString("head")}", it.str("image"), DownloadResume.imageTag(bytes))
            assertEquals("error ${it.getString("head")}", it.getBoolean("errorPage"), DownloadResume.looksLikeErrorPage(bytes))
        }
        cases.getJSONArray("pieceTag").objects().forEach {
            assertEquals(it.toString(), it.getString("tag"), DownloadResume.pieceTag(piece(it.getJSONObject("piece")), head(it.getString("head"))))
        }
    }

    @Test fun whichSavedPiecesAreKept() {
        cases.getJSONArray("stillValid").objects().forEach {
            assertEquals(
                it.getString("why"), it.getBoolean("valid"),
                DownloadResume.pieceStillValid(Kind.of(it.getString("kind")), it.getString("tag"), head(it.getString("head")), it.getLong("size"), it.getLong("recorded")),
            )
        }
    }

    @Test fun theLedgerSurvivesAKillMidWrite() {
        cases.getJSONArray("ledgers").objects().forEach {
            val expected = it.optJSONObject("ledger")
            val actual = plain(DownloadResume.parseLedger(it.getString("text")))
            if (expected == null) assertNull(it.getString("why"), actual)
            else assertEquals(it.getString("why"), canon(expected), canon(actual))
        }
        val h = cases.getJSONObject("headerAndLine")
        assertEquals(h.getString("header"), DownloadResume.ledgerHeader("a71a4acc3692a01e", 3))
        assertEquals(h.getString("line"), DownloadResume.ledgerLine(1, "seg00000.ts", 1503232, "enc"))
    }

    @Test fun thePlanContinuesFromTheFirstMissingPieceAndNeverMixesRenditions() {
        cases.getJSONArray("resumePlans").objects().forEach { c ->
            val disk = c.getJSONObject("disk")
            val plan = DownloadResume.resumePlan(pieces(c.getJSONArray("pieces")), c.getString("rendition"), ledger(c, "ledger")) { file ->
                disk.optJSONObject(file)?.let { DownloadResume.Disk(it.getLong("size"), head(it.getString("head"))) }
            }
            val expected = c.getJSONObject("plan")
            assertEquals(
                c.getString("why"),
                DownloadResume.Plan(expected.getBoolean("restart"), expected.getJSONArray("keep").ints(), expected.getJSONArray("fetch").ints(), expected.getInt("firstMissing")),
                plan,
            )
        }
        cases.getJSONArray("keyStillMatches").objects().forEach {
            assertEquals(it.getBoolean("matches"), DownloadResume.keyStillMatches(ledger(it, "ledger"), it.getInt("index"), it.getString("tag")))
        }
    }

    private fun step(o: JSONObject): Step = when (o.getString("action")) {
        "retry" -> Step.Retry(o.getLong("delayMs"))
        "re-resolve" -> Step.ReResolve
        "pause" -> Step.Pause(
            DownloadResume.PauseReason.entries.first { it.wire == o.getString("reason") },
            if (o.isNull("resumeAt")) null else o.getLong("resumeAt"),
        )
        else -> Step.Fail
    }

    private fun failure(f: JSONObject): Failure =
        if (f.optBoolean("network")) Failure.Network(f.getBoolean("online")) else Failure.Http(f.getInt("status"), f.str("retryAfter"))

    private fun stopReason(wire: String) = DownloadResume.StopReason.entries.first { it.wire == wire }

    @Test fun backoffRetryAfterAndTheStepAfterAFailure() {
        val backoff = cases.getJSONArray("backoff")
        for (i in 0 until backoff.length()) {
            val pair = backoff.getJSONArray(i)
            assertEquals(pair.getLong(1), DownloadResume.backoffMs(pair.getInt(0)))
        }
        cases.getJSONArray("retryAfter").objects().forEach {
            val expected = if (it.isNull("ms")) null else it.getLong("ms")
            assertEquals(it.str("why") ?: it.str("header").toString(), expected, DownloadResume.retryAfterMs(it.str("header"), it.getLong("now")))
        }
        cases.getJSONArray("steps").objects().forEach {
            val failure = failure(it.getJSONObject("failure"))
            assertEquals(it.getString("why"), step(it.getJSONObject("step")), DownloadResume.nextStep(failure, it.getInt("attempt"), it.getInt("reResolves"), it.getLong("now")))
        }
        cases.getJSONArray("conservativeSteps").objects().forEach {
            assertEquals(
                it.getString("why"), step(it.getJSONObject("result")),
                DownloadResume.conservativeStep(step(it.getJSONObject("step")), failure(it.getJSONObject("failure")), it.getInt("reResolves"), it.getLong("now")),
            )
        }
    }

    @Test fun everyStopHasAFinalState() {
        cases.getJSONArray("afterStop").objects().forEach {
            val v = it.getJSONObject("verdict")
            val expected = if (v.getString("action") == "fail") DownloadResume.Verdict.Fail(stopReason(v.getString("reason")))
                else DownloadResume.Verdict.Wait(v.getInt("reResolves"), if (v.isNull("stalledSince")) null else v.getLong("stalledSince"))
            val since = if (it.isNull("stalledSince")) null else it.getLong("stalledSince")
            assertEquals(
                it.getString("why"), expected,
                DownloadResume.afterStop(stopReason(it.getString("reason")), it.getInt("reResolves"), since, it.getBoolean("progressed"), it.getLong("now")),
            )
        }
        cases.getJSONArray("stalledMessages").objects().forEach {
            val item = DownloadResume.Subject.entries.first { s -> s.wire == it.getString("item") }
            assertEquals(it.getString("message"), DownloadResume.stalledMessage(stopReason(it.getString("reason")), item))
        }
    }

    @Test fun captionsAreBestEffort() {
        cases.getJSONArray("captionSteps").objects().forEach {
            assertEquals(
                it.getString("why"), step(it.getJSONObject("step")),
                DownloadResume.captionStep(failure(it.getJSONObject("failure")), it.getInt("attempt"), it.getBoolean("conservative"), it.getLong("now")),
            )
        }
    }

    @Test fun whenToResolveTheStreamAgain() {
        cases.getJSONArray("expiry").objects().forEach {
            val expected = if (it.isNull("at")) null else it.getLong("at")
            assertEquals(it.getString("url"), expected, DownloadResume.urlExpiresAt(it.getString("url")))
        }
        cases.getJSONArray("reResolveBeforeFetch").objects().forEach {
            assertEquals(it.getString("why"), it.getBoolean("reResolve"), DownloadResume.reResolveBeforeFetch(it.getString("url"), it.getLong("resolvedAt"), it.getLong("now")))
        }
    }
}
