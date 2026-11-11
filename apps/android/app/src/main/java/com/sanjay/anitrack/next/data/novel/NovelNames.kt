package com.sanjay.anitrack.next.data.novel

import java.security.MessageDigest

/**
 * File and folder names for novel ids (mirrors the desktop's services/novel/names.ts).
 * NovelBuddy ids are case-sensitive, so ids are hex-encoded; Novel Phoenix ids are
 * address slugs of up to 120 characters, whose hex would overrun the 255-byte file
 * name limit, so a long id keeps the start of its hex and ends in a hash of the whole
 * id. Short ids (every NovelBuddy and NovelArchive id) are named exactly as before.
 */
internal object NovelNames {
    private const val HEX_MAX = 96

    fun hex(value: String): String = value.toByteArray(Charsets.UTF_8).joinToString("") { "%02x".format(it) }
    fun unhex(value: String): String = String(value.chunked(2).map { it.toInt(16).toByte() }.toByteArray(), Charsets.UTF_8)

    private fun digest(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    /** A name for [id] that is safe as a file name, the same on every run, and never shared by two ids. */
    fun stem(id: String): String {
        val full = hex(id)
        // Plain hex never contains "-", so the two forms can't collide.
        return if (full.length <= HEX_MAX) full else "${full.take(64)}-${digest(id).take(32)}"
    }
}
