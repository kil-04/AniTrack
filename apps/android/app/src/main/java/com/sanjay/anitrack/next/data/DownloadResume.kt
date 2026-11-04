package com.sanjay.anitrack.next.data

import java.io.ByteArrayOutputStream
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset

/**
 * Resuming interrupted downloads: which saved pieces (HLS segments, keys, init
 * segments, manga pages) can be kept, where to continue, how to wait after a
 * failure and when to resolve the stream again.
 *
 * Twin of packages/shared/download-resume.ts. Both run against the same cases
 * in tests/fixtures/download-resume.json, so keep them in step.
 */
object DownloadResume {
    const val LEDGER_FILE = "download.ledger"
    const val LEDGER_VERSION = 1
    /** Bytes read from the start of a saved piece to check it (eight TS packets). */
    const val HEAD_BYTES = 1504

    enum class Kind(val wire: String) { SEGMENT("segment"), INIT("init"), KEY("key"), PAGE("page");
        companion object { fun of(wire: String) = entries.first { it.wire == wire } }
    }

    /** One file of a download, in playlist (or reading) order. [file] is empty when only known after the fetch. */
    data class Piece(
        val kind: Kind,
        val url: String,
        val file: String = "",
        /** The segment's #EXTINF duration exactly as the playlist wrote it. */
        val duration: String? = null,
        val encrypted: Boolean = false,
    )

    // ── Identity ────────────────────────────────────────────────────────────

    fun fnv64(bytes: ByteArray): String {
        var hash = -0x340d631b7bdddcdbL // 0xcbf29ce484222325
        for (b in bytes) {
            hash = hash xor (b.toLong() and 0xff)
            hash *= 0x100000001b3L
        }
        return java.lang.Long.toUnsignedString(hash, 16).padStart(16, '0')
    }

    fun fnv64(text: String): String = fnv64(text.toByteArray(Charsets.UTF_8))

    private val SIGNING = setOf(
        "token", "tok", "sig", "signature", "sign", "expires", "expiry", "expire", "exp", "e", "st",
        "hash", "h", "auth", "authkey", "auth_key", "md5", "hmac", "policy", "key-pair-id", "hdnts",
        "hdnea", "validfrom", "validto", "wmsauthsign", "nva", "acl", "ts", "t", "ttl", "s", "verify",
        "session", "sid", "ip", "nonce",
    )

    /** decodeURIComponent: %XX as UTF-8, the raw text when malformed. */
    private fun decode(raw: String): String {
        if ('%' !in raw) return raw
        val out = ByteArrayOutputStream()
        var i = 0
        while (i < raw.length) {
            val c = raw[i]
            if (c == '%') {
                if (i + 2 >= raw.length) return raw
                val byte = raw.substring(i + 1, i + 3).toIntOrNull(16) ?: return raw
                out.write(byte)
                i += 3
            } else {
                out.write(c.toString().toByteArray(Charsets.UTF_8))
                i++
            }
        }
        val bytes = out.toByteArray()
        val decoder = Charsets.UTF_8.newDecoder()
        return runCatching { decoder.decode(java.nio.ByteBuffer.wrap(bytes)).toString() }.getOrDefault(raw)
    }

    private fun signingParam(rawName: String): Boolean {
        val name = decode(rawName).lowercase()
        return name in SIGNING || name.startsWith("x-amz-") || name.startsWith("x-goog-")
    }

    private val ORIGIN = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://[^/?#]*")

    /** [url] without scheme, host, fragment or signing parameters. */
    fun stableUrl(url: String): String {
        val rest = ORIGIN.replaceFirst(url, "").substringBefore('#')
        val at = rest.indexOf('?')
        if (at < 0) return rest
        val path = rest.substring(0, at)
        val kept = rest.substring(at + 1).split('&')
            .filter { it.isNotEmpty() && !signingParam(it.substringBefore('=')) }
            .sorted()
        return if (kept.isEmpty()) path else "$path?${kept.joinToString("&")}"
    }

    /** The rendition [pieces] download (see download-resume.ts). */
    fun renditionId(variant: String, pieces: List<Piece>): String {
        val text = StringBuilder("v$LEDGER_VERSION\n$variant\n")
        for (p in pieces) {
            text.append(p.kind.wire).append('|').append(stableUrl(p.url)).append('|')
                .append(p.duration ?: "").append('|').append(if (p.encrypted) 1 else 0).append('\n')
        }
        return fnv64(text.toString())
    }

    /** The rendition-picking attributes of an #EXT-X-STREAM-INF line, in a fixed order. */
    fun variantAttributes(streamInf: String): String =
        listOf("BANDWIDTH", "RESOLUTION", "CODECS").joinToString(",") { name ->
            val value = Regex("(?:^|[:,])$name=(\"[^\"]*\"|[^,]*)").find(streamInf)?.groupValues?.get(1) ?: ""
            "$name=$value"
        }

    // ── Checking saved bytes ────────────────────────────────────────────────

    private val FMP4_BOXES = setOf("ftyp", "styp", "moof", "moov", "sidx", "emsg", "prft")
    private fun latin1(b: ByteArray, from: Int, to: Int) = String(CharArray(to - from) { (b[from + it].toInt() and 0xff).toChar() })
    private fun u(b: ByteArray, i: Int) = b[i].toInt() and 0xff

    fun mediaTag(bytes: ByteArray): String? {
        if (bytes.size >= 376) {
            val packets = minOf(8, bytes.size / 188)
            if ((0 until packets).all { u(bytes, it * 188) == 0x47 }) return "ts"
        }
        if (bytes.size >= 8) {
            val size = (u(bytes, 0).toLong() shl 24) + (u(bytes, 1) shl 16) + (u(bytes, 2) shl 8) + u(bytes, 3)
            if (size >= 8 && latin1(bytes, 4, 8) in FMP4_BOXES) return "fmp4"
        }
        if (bytes.size >= 10 && latin1(bytes, 0, 3) == "ID3" && u(bytes, 3) in 2..4) return "id3"
        return null
    }

    fun imageTag(bytes: ByteArray): String? = when {
        bytes.size >= 3 && u(bytes, 0) == 0xff && u(bytes, 1) == 0xd8 && u(bytes, 2) == 0xff -> "jpeg"
        bytes.size >= 8 && latin1(bytes, 0, 8) == "\u0089PNG\r\n\u001a\n" -> "png"
        bytes.size >= 6 && Regex("^GIF8[79]a$").matches(latin1(bytes, 0, 6)) -> "gif"
        bytes.size >= 12 && latin1(bytes, 0, 4) == "RIFF" && latin1(bytes, 8, 12) == "WEBP" -> "webp"
        bytes.size >= 12 && latin1(bytes, 4, 8) == "ftyp" && Regex("^avi[fs]$").matches(latin1(bytes, 8, 12)) -> "avif"
        bytes.size >= 2 && u(bytes, 0) == 0x42 && u(bytes, 1) == 0x4d -> "bmp"
        else -> null
    }

    private val PAGE_BODY = Regex(
        "^(?:<!doctype\\s+html\\b|<!--|<\\?xml\\b|<(?:html|head|body|title|meta|script|div|h[1-6]|p)\\b|\\{\\s*\"|\\[\\s*[{\"])",
        RegexOption.IGNORE_CASE,
    )
    private val ERROR_BODY = Regex(
        "^(?:access\\s+denied|forbidden\\b|unauthorized\\b|not\\s+found\\b|rate\\s+limit(?:ed)?\\b|internal\\s+server\\s+error|service\\s+unavailable|error\\b)",
        RegexOption.IGNORE_CASE,
    )

    /** An HTML/JSON/XML page or a plain-text error where media or an image was expected. */
    fun looksLikeErrorPage(bytes: ByteArray): Boolean {
        val prefix = String(bytes, 0, minOf(128, bytes.size), Charsets.UTF_8).removePrefix("﻿").trimStart()
        return PAGE_BODY.containsMatchIn(prefix) || ERROR_BODY.containsMatchIn(prefix)
    }

    /** What the ledger records about a finished piece (see download-resume.ts). */
    fun pieceTag(piece: Piece, bytes: ByteArray): String = when {
        piece.kind == Kind.KEY -> fnv64(bytes)
        piece.kind == Kind.PAGE -> imageTag(bytes) ?: "raw"
        piece.kind == Kind.SEGMENT && piece.encrypted -> "enc"
        else -> mediaTag(bytes) ?: "raw"
    }

    /** Bytes that are all zero: a file whose rename reached the disk before its data, after a power cut. */
    fun zeroFilled(bytes: ByteArray): Boolean = bytes.all { it.toInt() == 0 }

    fun pieceStillValid(kind: Kind, tag: String, head: ByteArray, size: Long, recordedSize: Long): Boolean {
        if (kind == Kind.KEY || size <= 0 || size != recordedSize) return false
        return when (tag) {
            "ts", "fmp4", "id3" -> mediaTag(head) == tag
            "jpeg", "png", "gif", "webp", "avif", "bmp" -> imageTag(head) == tag
            // No signature to check: a zero-filled head is a file lost to a power cut, not media.
            "enc" -> size % 16 == 0L && !zeroFilled(head) && !looksLikeErrorPage(head)
            "raw" -> !zeroFilled(head) && !looksLikeErrorPage(head)
            else -> false
        }
    }

    // ── Ledger ──────────────────────────────────────────────────────────────

    data class Entry(val file: String, val size: Long, val tag: String)
    data class Ledger(val version: Int, val rendition: String, val total: Int, val pieces: Map<Int, Entry>)

    fun ledgerHeader(rendition: String, total: Int) = "anitrack-ledger v$LEDGER_VERSION $rendition $total\n"
    fun ledgerLine(index: Int, file: String, size: Long, tag: String) = "$index $file $size $tag\n"

    private val HEADER = Regex("^anitrack-ledger v(\\d+) ([0-9a-f]{16}) (\\d+)$")
    private val LINE = Regex("^(\\d+) ([A-Za-z0-9_-][A-Za-z0-9._-]{0,127}) (\\d+) ([A-Za-z0-9]{1,32})$")

    /** Reads a ledger; a line cut off when the app was killed is ignored, a later line wins. */
    fun parseLedger(text: String): Ledger? {
        val lines = text.split('\n').dropLast(1)
        val header = HEADER.matchEntire(lines.firstOrNull() ?: return null) ?: return null
        val version = header.groupValues[1].toIntOrNull() ?: return null
        val total = header.groupValues[3].toIntOrNull() ?: return null
        val pieces = LinkedHashMap<Int, Entry>()
        for (line in lines.drop(1)) {
            val m = LINE.matchEntire(line) ?: continue
            val index = m.groupValues[1].toIntOrNull() ?: continue
            val size = m.groupValues[3].toLongOrNull() ?: continue
            if (index >= total) continue
            pieces[index] = Entry(m.groupValues[2], size, m.groupValues[4])
        }
        return Ledger(version, header.groupValues[2], total, pieces)
    }

    // ── Resume plan ─────────────────────────────────────────────────────────

    class Disk(val size: Long, val head: ByteArray)

    data class Plan(val restart: Boolean, val keep: List<Int>, val fetch: List<Int>, val firstMissing: Int)

    fun resumePlan(pieces: List<Piece>, rendition: String, ledger: Ledger?, disk: (String) -> Disk?): Plan {
        val all = pieces.indices.toList()
        fun firstNonKey(indices: List<Int>) = indices.firstOrNull { pieces[it].kind != Kind.KEY } ?: pieces.size
        if (ledger == null || ledger.version != LEDGER_VERSION || ledger.rendition != rendition || ledger.total != pieces.size) {
            return Plan(true, emptyList(), all, firstNonKey(all))
        }
        val keep = mutableListOf<Int>()
        val fetch = mutableListOf<Int>()
        pieces.forEachIndexed { i, piece ->
            val entry = ledger.pieces[i]
            val named = entry != null && (piece.file.isEmpty() || piece.file == entry.file)
            val saved = if (named) disk(entry!!.file) else null
            if (entry != null && saved != null && pieceStillValid(piece.kind, entry.tag, saved.head, saved.size, entry.size)) keep += i
            else fetch += i
        }
        return Plan(false, keep, fetch, firstNonKey(fetch))
    }

    fun keyStillMatches(ledger: Ledger?, index: Int, tag: String): Boolean {
        val entry = ledger?.pieces?.get(index) ?: return true
        return entry.tag == tag
    }

    // ── Failures, waiting and re-resolving ──────────────────────────────────

    const val NETWORK_RETRIES = 4
    const val RATE_LIMIT_RETRIES = 8
    const val SERVER_RETRIES = 6
    /** Runs in a row that may stop without saving a media piece (stalls) before the next one gives up (see download-resume.ts). */
    const val MAX_RE_RESOLVES = 2
    const val MAX_RETRY_AFTER_MS = 10 * 60_000L
    const val PAUSE_MS = 5 * 60_000L
    const val MAX_PAUSE_MS = 6 * 60 * 60_000L
    const val EXPIRY_MARGIN_MS = 60_000L
    const val MAX_RESOLVED_AGE_MS = 6 * 60 * 60_000L
    /** A request that got no answer while the device is online waits this long before the next run. */
    const val UNREACHABLE_PAUSE_MS = 60_000L
    /** Rate-limit stops keep waiting for at most about this long after the first one without progress… */
    const val MAX_RATE_LIMITED_MS = 60 * 60_000L
    /** …and for at most this many of them in a row, whatever the clock says. */
    const val MAX_RATE_LIMIT_STALLS = 12
    /** The least a rate-sensitive (conservative) stream waits before trying again; it doubles with each stall. */
    const val CONSERVATIVE_PAUSE_MS = 30_000L
    /** Captions are best-effort: this many quick retries, each at most [MAX_CAPTION_WAIT_MS] away. */
    const val CAPTION_RETRIES = 2
    const val MAX_CAPTION_WAIT_MS = 30_000L

    sealed class Failure {
        /** No answer at all (offline, reset, refused, timed out); [online]: the device had a network when it gave up. */
        data class Network(val online: Boolean) : Failure()
        data class Http(val status: Int, val retryAfter: String? = null) : Failure()
    }

    enum class PauseReason(val wire: String) { NETWORK("network"), RATE_LIMIT("rate-limit"), SERVER("server") }

    sealed class Step {
        data class Retry(val delayMs: Long) : Step()
        object ReResolve : Step()
        data class Pause(val reason: PauseReason, val resumeAt: Long?) : Step()
        object Fail : Step()
    }

    fun backoffMs(attempt: Int): Long = minOf(60_000L, 1000L shl attempt.coerceIn(0, 16))

    private val MONTHS = listOf("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
    private const val DAY = "(?:mon|tue|wed|thu|fri|sat|sun)"
    private const val LONG_DAY = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)"
    private const val MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)"
    private const val TIME = "(\\d{2}):(\\d{2}):(\\d{2})"
    // Matched against the value with ASCII letters lowercased (names may come in any case).
    private val IMF_FIXDATE = Regex("^$DAY, (\\d{2}) $MONTH (\\d{4}) $TIME gmt$")
    private val RFC_850 = Regex("^$LONG_DAY, (\\d{2})-$MONTH-(\\d{2}) $TIME gmt$")
    private val ASCTIME = Regex("^$DAY $MONTH ( \\d|\\d{2}) $TIME (\\d{4})$")

    /** UTC epoch ms of a calendar date and time, or null when it isn't one (31 Nov, 24:00, a leap second). */
    private fun utc(year: Int, month: Int, day: Int, hour: Int, minute: Int, second: Int): Long? {
        if (month !in 0..11 || hour > 23 || minute > 59 || second > 59) return null
        return runCatching { LocalDateTime.of(year, month + 1, day, hour, minute, second).toEpochSecond(ZoneOffset.UTC) * 1000 }.getOrNull()
    }

    /** An HTTP-date (IMF-fixdate, RFC 850 or asctime; GMT only) as epoch ms, or null (see download-resume.ts). */
    fun httpDateMs(header: String, now: Long): Long? {
        val value = String(CharArray(header.length) { val c = header[it]; if (c in 'A'..'Z') c + 32 else c })
        IMF_FIXDATE.matchEntire(value)?.groupValues?.let { g ->
            return utc(g[3].toInt(), MONTHS.indexOf(g[2]), g[1].toInt(), g[4].toInt(), g[5].toInt(), g[6].toInt())
        }
        RFC_850.matchEntire(value)?.groupValues?.let { g ->
            val thisYear = Instant.ofEpochMilli(now).atZone(ZoneOffset.UTC).year
            var year = thisYear - thisYear % 100 + g[3].toInt()
            if (year > thisYear + 50) year -= 100
            return utc(year, MONTHS.indexOf(g[2]), g[1].toInt(), g[4].toInt(), g[5].toInt(), g[6].toInt())
        }
        ASCTIME.matchEntire(value)?.groupValues?.let { g ->
            return utc(g[6].toInt(), MONTHS.indexOf(g[1]), g[2].trim().toInt(), g[3].toInt(), g[4].toInt(), g[5].toInt())
        }
        return null
    }

    /** Retry-After as milliseconds from [now] (delta seconds or an HTTP-date), or null (see download-resume.ts). */
    fun retryAfterMs(header: String?, now: Long): Long? {
        val value = header?.trim { it == ' ' || it == '\t' }?.takeIf { it.isNotEmpty() } ?: return null
        if (value.all { it in '0'..'9' }) {
            val digits = value.trimStart('0').ifEmpty { "0" }
            return (if (digits.length > 9) 999_999_999L else digits.toLong()) * 1000
        }
        val at = httpDateMs(value, now) ?: return null
        return maxOf(0L, at - now)
    }

    /**
     * What to do after a request failed: [attempt] failures of this request so far, [reResolves]
     * runs in a row before this one that stopped without saving a media piece.
     */
    fun nextStep(failure: Failure, attempt: Int, reResolves: Int, now: Long): Step {
        if (failure is Failure.Network) {
            if (attempt < NETWORK_RETRIES) return Step.Retry(backoffMs(attempt))
            // Offline: wait for the network, however long. Online, the server isn't answering: a stall.
            return if (failure.online) Step.Pause(PauseReason.SERVER, now + UNREACHABLE_PAUSE_MS) else Step.Pause(PauseReason.NETWORK, null)
        }
        val http = failure as Failure.Http
        val status = http.status
        if (status == 429 || status == 503) {
            val asked = retryAfterMs(http.retryAfter, now)
            val delay = asked ?: backoffMs(attempt)
            if (asked != null && asked > MAX_RETRY_AFTER_MS) return Step.Pause(PauseReason.RATE_LIMIT, now + minOf(asked, MAX_PAUSE_MS))
            if (attempt < RATE_LIMIT_RETRIES) return Step.Retry(delay)
            return Step.Pause(PauseReason.RATE_LIMIT, now + maxOf(delay, PAUSE_MS))
        }
        if (status == 408 || status == 425 || status in 500..599) {
            return if (attempt < SERVER_RETRIES) Step.Retry(backoffMs(attempt)) else Step.Pause(PauseReason.SERVER, now + PAUSE_MS)
        }
        if (status == 401 || status == 403 || status == 410) return if (reResolves < MAX_RE_RESOLVES) Step.ReResolve else Step.Fail
        if (status == 404) return if (reResolves < 1) Step.ReResolve else Step.Fail
        return Step.Fail
    }

    /** A rate-sensitive stream is never retried at once: a retry becomes a pause, longer with each stall (see download-resume.ts). */
    fun conservativeStep(step: Step, failure: Failure, reResolves: Int, now: Long): Step {
        if (step !is Step.Retry) return step
        if (failure is Failure.Network && !failure.online) return Step.Pause(PauseReason.NETWORK, null)
        val least = minOf(MAX_RETRY_AFTER_MS, CONSERVATIVE_PAUSE_MS shl reResolves.coerceIn(0, 8))
        val limited = failure is Failure.Http && (failure.status == 429 || failure.status == 503)
        return Step.Pause(if (limited) PauseReason.RATE_LIMIT else PauseReason.SERVER, now + maxOf(step.delayMs, least))
    }

    /** Why a run stopped with its pieces kept: a pause's reason, or EXPIRED (resolve the stream again). */
    enum class StopReason(val wire: String) {
        NETWORK("network"), RATE_LIMIT("rate-limit"), SERVER("server"), EXPIRED("expired");

        companion object {
            fun of(reason: PauseReason) = when (reason) {
                PauseReason.NETWORK -> NETWORK
                PauseReason.RATE_LIMIT -> RATE_LIMIT
                PauseReason.SERVER -> SERVER
            }
        }
    }

    sealed class Verdict {
        /** Try again later, carrying this streak of stalls into the next run. */
        data class Wait(val reResolves: Int, val stalledSince: Long?) : Verdict()
        /** Give up: the download fails with [stalledMessage]. */
        data class Fail(val reason: StopReason) : Verdict()
    }

    /**
     * After a run stopped without finishing: wait and try again, or give up (see download-resume.ts).
     * Offline waits never count; a rate limit keeps waiting for about an hour of stalls; anything
     * else gives up at the third stall in a row. [progressed] (a media piece saved) ends the streak.
     */
    fun afterStop(reason: StopReason, reResolves: Int, stalledSince: Long?, progressed: Boolean, now: Long): Verdict {
        if (progressed) return Verdict.Wait(0, null)
        if (reason == StopReason.NETWORK) return Verdict.Wait(reResolves, stalledSince)
        val since = stalledSince ?: now
        if (reason == StopReason.RATE_LIMIT) {
            if ((reResolves > 0 && now - since >= MAX_RATE_LIMITED_MS) || reResolves >= MAX_RATE_LIMIT_STALLS) return Verdict.Fail(reason)
        } else if (reResolves >= MAX_RE_RESOLVES) {
            return Verdict.Fail(reason)
        }
        return Verdict.Wait(reResolves + 1, since)
    }

    enum class Subject(val wire: String) { EPISODE("episode"), CHAPTER("chapter") }

    /** The message a download that gave up shows, for an episode or a manga/novel chapter. */
    fun stalledMessage(reason: StopReason, item: Subject): String {
        val episode = item == Subject.EPISODE
        val from = if (episode) "server" else "source"
        return when (reason) {
            StopReason.RATE_LIMIT -> "The $from kept asking to wait. Try again later${if (episode) " or choose another server" else ""}."
            StopReason.EXPIRED -> if (episode) "The stream kept expiring before any of it could be saved. Try another server."
                else "The source's page addresses kept expiring before any page could be saved. Try again later."
            else -> "The $from kept failing on part of this ${item.wire}. ${if (episode) "Try another server." else "Try again later."}"
        }
    }

    /**
     * Captions are best-effort (see download-resume.ts): a couple of short retries, never a pause for
     * the server or a fresh stream. Fail means finish without captions; offline, Pause(NETWORK) waits for the network.
     */
    fun captionStep(failure: Failure, attempt: Int, conservative: Boolean, now: Long): Step {
        val transient = when (failure) {
            is Failure.Network -> true
            is Failure.Http -> failure.status == 408 || failure.status == 425 || failure.status == 429 || failure.status in 500..599
        }
        if (!transient) return Step.Fail
        if (attempt < CAPTION_RETRIES) {
            val asked = (failure as? Failure.Http)?.let { retryAfterMs(it.retryAfter, now) }
            val delay = maxOf(asked ?: backoffMs(attempt), if (conservative) CONSERVATIVE_PAUSE_MS else 0L)
            if (delay <= MAX_CAPTION_WAIT_MS) return Step.Retry(delay)
        }
        return if (failure is Failure.Network && !failure.online) Step.Pause(PauseReason.NETWORK, null) else Step.Fail
    }

    private val EXPIRY_PARAMS = listOf("expires", "expiry", "expire", "exp", "e", "validto")

    private fun epochMs(value: String): Long? {
        if (!Regex("^\\d{9,13}$").matches(value)) return null
        val n = value.toLong()
        return if (n >= 1_000_000_000_000L) n else n * 1000
    }

    /** When a signed URL says it stops working (epoch ms), or null when it doesn't say. */
    fun urlExpiresAt(url: String): Long? {
        val query = url.substringBefore('#').split('?').getOrNull(1) ?: return null
        if (query.isEmpty()) return null
        val params = LinkedHashMap<String, String>()
        for (part in query.split('&')) {
            val at = part.indexOf('=')
            if (at <= 0) continue
            params[decode(part.substring(0, at)).lowercase()] = decode(part.substring(at + 1))
        }
        for (name in EXPIRY_PARAMS) {
            params[name]?.let(::epochMs)?.let { return it }
        }
        val amzDate = Regex("^(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z$").matchEntire(params["x-amz-date"] ?: "")
        val amzExpires = params["x-amz-expires"]
        if (amzDate != null && amzExpires != null && amzExpires.isNotEmpty() && amzExpires.all { it in '0'..'9' }) {
            val (y, mo, d, h, mi, s) = amzDate.destructured
            val start = LocalDateTime.of(y.toInt(), mo.toInt(), d.toInt(), h.toInt(), mi.toInt(), s.toInt()).toEpochSecond(ZoneOffset.UTC) * 1000
            return start + amzExpires.toLong() * 1000
        }
        val akamai = Regex("(?:^|~)exp=(\\d{9,13})(?:~|$)").find(params["hdnts"] ?: params["hdnea"] ?: "")
        return akamai?.let { epochMs(it.groupValues[1]) }
    }

    fun reResolveBeforeFetch(url: String, resolvedAt: Long, now: Long): Boolean {
        val expires = urlExpiresAt(url)
        if (expires != null && now >= expires - EXPIRY_MARGIN_MS) return true
        return now - resolvedAt > MAX_RESOLVED_AGE_MS
    }
}
