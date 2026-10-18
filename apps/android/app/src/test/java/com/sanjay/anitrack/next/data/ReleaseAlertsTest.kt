package com.sanjay.anitrack.next.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleaseAlertsTest {
    @Test fun routesANotificationMayOpen() {
        assertTrue(ReleaseAlerts.isRoute("anime/21"))
        assertTrue(ReleaseAlerts.isRoute("manga/30013"))
        assertTrue(ReleaseAlerts.isRoute("novel/novelbuddy/WAY3LXDy"))
        assertTrue(ReleaseAlerts.isRoute("novel/novelarchive/6a1637414f942c668d69a5a9"))
        // Unknown sources, ids the source can't have, and anything else stay out.
        assertFalse(ReleaseAlerts.isRoute("novel/lnori/4557"))
        assertFalse(ReleaseAlerts.isRoute("novel/novelarchive/WAY3LXDy"))
        assertFalse(ReleaseAlerts.isRoute("novel/novelbuddy/../settings"))
        assertFalse(ReleaseAlerts.isRoute("settings"))
        assertFalse(ReleaseAlerts.isRoute("anime/21?x=1"))
    }

    @Test fun novelLines() {
        assertEquals("Chapter 2061 is out on NovelBuddy — tap to read.", ReleaseAlerts.novelText(1, "Chapter 2061", "NovelBuddy"))
        assertEquals("3 new chapters on NovelArchive, up to Chapter 2063 — tap to read.", ReleaseAlerts.novelText(3, "Chapter 2063", "NovelArchive"))
        assertEquals("2 new chapters on NovelBuddy — tap to read.", ReleaseAlerts.novelText(2, null, "NovelBuddy"))
    }
}
