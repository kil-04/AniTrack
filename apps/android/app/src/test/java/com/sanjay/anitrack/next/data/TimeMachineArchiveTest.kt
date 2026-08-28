package com.sanjay.anitrack.next.data

import org.junit.Assert.assertEquals
import org.junit.Test

class TimeMachineArchiveTest {
    @Test fun mapsClassicYearsToTheirEra() {
        assertEquals("1970s", TimeMachineArchive.eraFor(1979).label)
        assertEquals("The age of impossible ambition", TimeMachineArchive.eraFor(1988).headline)
        assertEquals("1990s", TimeMachineArchive.eraFor(1995).label)
    }

    @Test fun clampsYearsToTheSupportedArchive() {
        assertEquals(1960, TimeMachineArchive.clampYear(1945, 2026))
        assertEquals(2026, TimeMachineArchive.clampYear(2032, 2026))
    }

    @Test fun describesPositionInsideTheDecade() {
        assertEquals("Early 1980s transmission", TimeMachineArchive.transmission(1981))
        assertEquals("Mid-1980s transmission", TimeMachineArchive.transmission(1985))
        assertEquals("Late 1980s transmission", TimeMachineArchive.transmission(1989))
    }
}
