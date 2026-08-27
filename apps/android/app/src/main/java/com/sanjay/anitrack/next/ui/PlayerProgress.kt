package com.sanjay.anitrack.next.ui

import androidx.media3.exoplayer.ExoPlayer
import com.sanjay.anitrack.next.data.Db
import com.sanjay.anitrack.next.data.GistSync
import com.sanjay.anitrack.next.data.PlaySession

internal fun formatPlayerTime(milliseconds: Long): String {
    if (milliseconds <= 0) return "0:00"
    val total = milliseconds / 1000
    val hours = total / 3600
    val minutes = (total % 3600) / 60
    val seconds = total % 60
    return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, seconds)
    else "%d:%02d".format(minutes, seconds)
}

internal suspend fun saveWebProgress(index: Int, positionMs: Long, durationMs: Long) {
    if (index >= PlaySession.count || durationMs <= 0) return
    savePlayerProgress(index, positionMs, durationMs)
}

internal suspend fun saveProgress(player: ExoPlayer, index: Int) {
    if (index >= PlaySession.count || player.duration <= 0) return
    savePlayerProgress(index, player.currentPosition, player.duration)
}

private suspend fun savePlayerProgress(index: Int, positionMs: Long, durationMs: Long) {
    val episode = PlaySession.episodeNumber(index)
    val updatedAt = System.currentTimeMillis()
    val resumeKey = PlaySession.resumeKey()
    val positionSeconds = positionMs / 1000.0
    val durationSeconds = durationMs / 1000.0

    Db.save(
        PlaySession.animeId,
        episode,
        positionSeconds,
        durationSeconds,
        PlaySession.animeTitle,
        PlaySession.animeCover,
        resumeKey,
        providerId = PlaySession.provider,
        updatedAt = updatedAt,
    )
    GistSync.pushProgress(
        Db.CwRow(
            PlaySession.animeId,
            episode,
            positionSeconds,
            durationSeconds,
            PlaySession.animeTitle,
            PlaySession.animeCover,
            resumeKey,
            PlaySession.provider,
            updatedAt,
        ),
    )
}
