package com.sanjay.anitrack.next.data

import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceInputStream
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener

/**
 * Wraps a DataSource so any HLS media playlist (.m3u8) it serves is normalized
 * to a STATIC VOD manifest: force #EXT-X-PLAYLIST-TYPE:VOD and guarantee an
 * #EXT-X-ENDLIST. Kwik re-serves its manifest without ENDLIST on the reload
 * ExoPlayer does after a seek, which makes ExoPlayer treat the stream as
 * live/dynamic and refuse to seek into it (infinite buffering). Segment
 * requests pass straight through to the wrapped source.
 */
@UnstableApi
class VodManifestDataSource(private val upstream: DataSource) : DataSource {

    private var buffer: ByteArray? = null   // set only for a playlist response
    private var pos = 0
    private var uri: android.net.Uri? = null

    class Factory(private val upstreamFactory: DataSource.Factory) : DataSource.Factory {
        override fun createDataSource(): DataSource = VodManifestDataSource(upstreamFactory.createDataSource())
    }

    override fun addTransferListener(transferListener: TransferListener) = upstream.addTransferListener(transferListener)

    override fun open(dataSpec: DataSpec): Long {
        uri = dataSpec.uri
        val isPlaylist = dataSpec.uri.path?.substringBefore('?')?.endsWith(".m3u8", true) == true
        if (!isPlaylist) {
            buffer = null
            return upstream.open(dataSpec)
        }
        // Read the whole manifest through the upstream source, then normalize.
        // Use a range-less spec so we always get the full document to rewrite.
        val fullSpec = dataSpec.buildUpon().setPosition(0).setLength(C_LENGTH_UNSET).build()
        val raw = DataSourceInputStream(upstream, fullSpec).use { it.readBytes() }
        val manifest = String(raw)
        val fixed = normalize(manifest).toByteArray()
        // Honor any requested position/length on the (rewritten) bytes.
        val start = dataSpec.position.toInt().coerceIn(0, fixed.size)
        val end = if (dataSpec.length == C_LENGTH_UNSET) fixed.size
        else (start + dataSpec.length).toInt().coerceAtMost(fixed.size)
        buffer = fixed.copyOfRange(start, end)
        pos = 0
        return buffer!!.size.toLong()
    }

    override fun read(target: ByteArray, offset: Int, length: Int): Int {
        val buf = buffer ?: return upstream.read(target, offset, length)
        if (pos >= buf.size) return androidx.media3.common.C.RESULT_END_OF_INPUT
        val n = minOf(length, buf.size - pos)
        System.arraycopy(buf, pos, target, offset, n)
        pos += n
        return n
    }

    override fun getUri(): android.net.Uri? = if (buffer != null) uri else upstream.uri

    override fun getResponseHeaders(): Map<String, List<String>> =
        if (buffer != null) emptyMap() else upstream.responseHeaders

    override fun close() {
        buffer = null
        upstream.close()
    }

    private fun normalize(text: String): String {
        // Only touch MEDIA playlists (with segments), not master playlists.
        if (!text.contains("#EXTINF")) return text
        val lines = text.split("\n").map { it.trimEnd('\r') }.toMutableList()
        // Drop live-indicating tags and any existing playlist-type/endlist.
        val out = ArrayList<String>(lines.size + 2)
        var headerDone = false
        for (line in lines) {
            when {
                line.startsWith("#EXT-X-PLAYLIST-TYPE") -> { /* replace below */ }
                line.startsWith("#EXT-X-ENDLIST") -> { /* re-add at end */ }
                else -> out += line
            }
            // Insert VOD type right after #EXTM3U.
            if (!headerDone && line.startsWith("#EXTM3U")) {
                out += "#EXT-X-PLAYLIST-TYPE:VOD"
                headerDone = true
            }
        }
        // Guarantee termination.
        if (out.none { it.startsWith("#EXT-X-ENDLIST") }) out += "#EXT-X-ENDLIST"
        return out.joinToString("\n")
    }

    private companion object {
        const val C_LENGTH_UNSET = androidx.media3.common.C.LENGTH_UNSET.toLong()
    }
}
