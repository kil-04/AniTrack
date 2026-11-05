package com.sanjay.anitrack.next.data

/**
 * Side-loaded captions that don't load. A provider can list a caption file that is missing
 * on its host (Xanime's Cowboy Bebop dub answers HTTP 404 for its English track on every
 * host). The video must keep playing without it: no endless retries, and no empty track in
 * the captions menu.
 */
object SideCaptions {
    /**
     * Whether a failed caption load is worth retrying. A load that got an HTTP answer
     * (404, 403, 5xx) gets the same one again; only network errors without one may pass.
     */
    fun retries(responseCode: Int?): Boolean = responseCode == null

    /** Whether [uri] is one of [stream]'s side-loaded captions. */
    fun isCaption(stream: PlaySession.Resolved?, uri: String?): Boolean =
        uri != null && stream?.subtitles?.any { it.url == uri } == true

    /** [stream] without the caption at [failedUri], or null when that isn't one of its captions. */
    fun withoutFailed(stream: PlaySession.Resolved?, failedUri: String?): PlaySession.Resolved? {
        if (stream == null || !isCaption(stream, failedUri)) return null
        return stream.copy(subtitles = stream.subtitles.filter { it.url != failedUri })
    }
}
