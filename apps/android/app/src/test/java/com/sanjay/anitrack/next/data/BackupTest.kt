package com.sanjay.anitrack.next.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BackupTest {
    @Test fun carriesPlainSettingsOnly() {
        listOf("reader_mode", "reader_volume_keys", "cap_size", "auto_skip", "autoplay", "home_mode", "manga_source_30002", "mangaball_match_151807", "toonkotsu_match_30013")
            .forEach { assertTrue(it, Backup.isBackedUpPref(it)) }
        // Sign-ins, device state and anything unknown stay out.
        listOf("mal_access_token", "mal_refresh_token", "gist_token", "github_token", "toonkotsu_session", "alerts_airing_check", "alerts_episodes", "unknown")
            .forEach { assertFalse(it, Backup.isBackedUpPref(it)) }
    }

    @Test fun describesWhatMoved() {
        assertEquals("1 watched episode, 2 anime list entries, 3 settings", Backup.Summary(1, 2, 0, 0, 3).describe())
        assertEquals("nothing new", Backup.Summary(0, 0, 0, 0, 0).describe())
    }
}
