package com.sanjay.anitrack.next.ui

import androidx.media3.exoplayer.ExoPlayer
import com.sanjay.anitrack.next.data.Db
import com.sanjay.anitrack.next.data.GistSync
import com.sanjay.anitrack.next.data.Mal
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
    // Only the episode actually loaded has a position to save: while another episode
    // is still resolving (or its server refused it), the player holds the old one's.
    if (com.sanjay.anitrack.next.data.PlayerHolder.loadedKey != com.sanjay.anitrack.next.data.PlayerHolder.keyFor(index)) return
    if (player.playerError != null) return // A failed stream has no watched position.
    savePlayerProgress(index, player.currentPosition, player.duration)
}

private suspend fun savePlayerProgress(index: Int, positionMs: Long, durationMs: Long) {
    val episode = PlaySession.episodeNumber(index)
    val updatedAt = System.currentTimeMillis()
    val resumeKey = PlaySession.resumeKey()
    val positionSeconds = positionMs / 1000.0
    val durationSeconds = durationMs / 1000.0
    // Read before saving, to spot the first time this episode passes "watched".
    val before = Db.watchedFraction(PlaySession.animeId, episode) ?: 0.0

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
    // Watched through (85%, as on desktop): raise MAL's episode count. Mal decides
    // against MAL's own entry, so a completed show or a further count is left alone.
    if (before < WATCHED_FRACTION && positionSeconds / durationSeconds >= WATCHED_FRACTION) {
        Mal.episodeWatched(PlaySession.animeId, PlaySession.anime?.malId, episode, PlaySession.animeTitle, PlaySession.animeCover)
    }
}

/** Watched through, as on desktop. */
internal const val WATCHED_FRACTION = 0.85
