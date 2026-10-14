package com.sanjay.anitrack.next.ui

/** Only returning to an already loaded player may reuse media; a retry must resolve fresh. */
internal fun canReusePlayerStream(
    retry: Int,
    pendingPositionMs: Long?,
    loadedKey: String?,
    requestedKey: String,
    mediaItemCount: Int,
): Boolean = retry == 0 && pendingPositionMs == null && loadedKey == requestedKey && mediaItemCount > 0
