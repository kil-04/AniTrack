package com.sanjay.anitrack.next.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProviderProbeServerNavigationTest {
    @Test fun serverHeadingMatchesTheRealPanelForEnabledAndStagedProviders() {
        assertEquals("MIRURO SERVERS", ProviderProbeServerNavigation.panelHeading("Miruro"))
        assertEquals("MKISSA SERVERS", ProviderProbeServerNavigation.panelHeading("MKissa"))
        assertEquals("STREAM SERVERS", ProviderProbeServerNavigation.panelHeading(null))
    }

    private val ready = ProviderProbeServerNavigation.Observation(1, targetVisible = true, targetEnabled = true, panelVisible = true)

    private class Driver(
        private val observations: List<ProviderProbeServerNavigation.Observation?>,
        private val failedActions: Set<ProviderProbeServerNavigation.Action> = emptySet(),
    ) : ProviderProbeServerNavigation.Driver {
        val actions = mutableListOf<ProviderProbeServerNavigation.Action>()
        var waits = 0
        private var index = 0
        override fun observe() = observations[index.coerceAtMost(observations.lastIndex)].also { index++ }
        override fun act(action: ProviderProbeServerNavigation.Action) = actions.add(action).let { action !in failedActions }
        override fun settle() { waits++ }
    }

    @Test fun visibleExactServerIsClickedOnceWithoutOpeningOrScrollingAnything() {
        val driver = Driver(listOf(ready))
        assertTrue(ProviderProbeServerNavigation.select(driver))
        assertEquals(listOf(ProviderProbeServerNavigation.Action.CLICK_TARGET), driver.actions)
    }

    @Test fun hiddenExactServerIsShownAndScrolledOnlyThroughItsOwnAncestors() {
        val hidden = ready.copy(targetVisible = false)
        val driver = Driver(listOf(hidden, hidden, ready), setOf(ProviderProbeServerNavigation.Action.SHOW_TARGET))
        assertTrue(ProviderProbeServerNavigation.select(driver))
        assertEquals(listOf(ProviderProbeServerNavigation.Action.SHOW_TARGET,
            ProviderProbeServerNavigation.Action.SCROLL_TARGET_ANCESTOR,
            ProviderProbeServerNavigation.Action.CLICK_TARGET), driver.actions)
    }

    @Test fun absentPanelRevealsControlsExitsFullscreenThenClicksTheExactServer() {
        val driver = Driver(listOf(
            ProviderProbeServerNavigation.Observation(0, videoVisible = true),
            ProviderProbeServerNavigation.Observation(0, fullscreenControlVisible = true, videoVisible = true),
            ProviderProbeServerNavigation.Observation(0, videoVisible = true), // Layout transition.
            ready,
        ))
        assertTrue(ProviderProbeServerNavigation.select(driver))
        assertEquals(listOf(ProviderProbeServerNavigation.Action.REVEAL_CONTROLS,
            ProviderProbeServerNavigation.Action.EXIT_FULLSCREEN,
            ProviderProbeServerNavigation.Action.CLICK_TARGET), driver.actions)
    }

    @Test fun ambiguousAbsentOrForeignWindowDoesNotClickAnyServer() {
        for (state in listOf(null, ready.copy(exactMatches = 2), ready.copy(exactMatches = 0))) {
            val driver = Driver(listOf(state))
            assertFalse(ProviderProbeServerNavigation.select(driver))
            assertTrue(driver.actions.isEmpty())
        }
    }

    @Test fun rejectedClickIsNotRetriedOrSubstituted() {
        val driver = Driver(listOf(ready), setOf(ProviderProbeServerNavigation.Action.CLICK_TARGET))
        assertFalse(ProviderProbeServerNavigation.select(driver))
        assertEquals(listOf(ProviderProbeServerNavigation.Action.CLICK_TARGET), driver.actions)
    }

    @Test fun failureReportsUseOnlyFixedReasonsAndTheLastBoundedObservation() {
        val unavailable = ProviderProbeServerNavigation.selectResult(Driver(listOf(null)))
        assertEquals(ProviderProbeServerNavigation.StopReason.UNOWNED_OR_UNREADY_WINDOW, unavailable.stopReason)
        assertEquals(null, unavailable.lastObservation)
        assertTrue(unavailable.actions.isEmpty())
        val ambiguous = ready.copy(exactMatches = 2)
        val ambiguity = ProviderProbeServerNavigation.selectResult(Driver(listOf(ambiguous)))
        assertEquals(ProviderProbeServerNavigation.StopReason.AMBIGUOUS_TARGET, ambiguity.stopReason)
        assertEquals(ambiguous, ambiguity.lastObservation)
        assertTrue(ambiguity.actions.isEmpty())
        val rejected = ProviderProbeServerNavigation.selectResult(Driver(listOf(ready),
            setOf(ProviderProbeServerNavigation.Action.CLICK_TARGET)))
        assertEquals(ProviderProbeServerNavigation.StopReason.CLICK_REJECTED, rejected.stopReason)
        assertEquals(listOf(ProviderProbeServerNavigation.Action.CLICK_TARGET), rejected.actions)
        assertFalse(rejected.selected)
    }

    @Test fun unscrollableOrPersistentlyHiddenTargetStopsAfterABoundedAttempt() {
        val hidden = ready.copy(targetVisible = false)
        val driver = Driver(listOf(hidden))
        assertFalse(ProviderProbeServerNavigation.select(driver))
        assertEquals(1, driver.actions.count { it == ProviderProbeServerNavigation.Action.SHOW_TARGET })
        assertEquals(4, driver.actions.count { it == ProviderProbeServerNavigation.Action.SCROLL_TARGET_ANCESTOR })
        assertFalse(driver.actions.contains(ProviderProbeServerNavigation.Action.CLICK_TARGET))
        assertTrue(driver.waits <= 5)
    }
}
