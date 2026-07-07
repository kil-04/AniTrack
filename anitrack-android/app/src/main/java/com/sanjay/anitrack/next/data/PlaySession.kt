package com.sanjay.anitrack.next.data

/** What the player screen should play — set right before navigating to it.
 *  (Server tokens are large base64 blobs; a singleton beats route-encoding.) */
object PlaySession {
    var animeTitle: String = ""
    var slug: String = ""
    var episodes: List<Anikoto.Episode> = emptyList()
    var index: Int = 0
}
