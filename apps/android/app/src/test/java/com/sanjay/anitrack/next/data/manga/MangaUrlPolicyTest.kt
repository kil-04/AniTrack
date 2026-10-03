package com.sanjay.anitrack.next.data.manga

import com.sanjay.anitrack.next.data.Html
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress

class MangaUrlPolicyTest {
    @Test fun acceptsPublicHttpsNames() {
        assertNotNull(MangaUrlPolicy.publicHttps("https://cdn.example.test/a/1.jpeg"))
        assertNotNull(MangaUrlPolicy.publicHttps("https://node.mangadex.network:44300/data/x", allowPort = true))
    }

    @Test fun refusesUnsafeAddresses() {
        for (url in listOf(
            "http://cdn.example.test/1.jpeg",
            "https://user:pw@cdn.example.test/1.jpeg",
            "https://localhost/1.jpeg",
            "https://printer.local/1.jpeg",
            "https://router.lan/1.jpeg",
            "https://intranet/1.jpeg",
            "https://192.168.0.2/1.jpeg",
            "https://8.8.8.8/1.jpeg",
            "https://[::1]/1.jpeg",
            "https://cdn.example.test:8443/1.jpeg",
            "https://cdn.example.test/a b.jpeg",
            "file:///sdcard/1.jpeg",
        )) assertNull(url, MangaUrlPolicy.publicHttps(url))
    }

    @Test fun dnsAnswersOnTheLocalNetworkAreNotPublic() {
        for (ip in listOf("10.1.2.3", "172.16.0.1", "192.168.1.1", "127.0.0.1", "169.254.1.1", "100.64.0.1", "::1", "fd00::1")) {
            assertTrue(ip, !MangaUrlPolicy.isPublicAddress(InetAddress.getByName(ip)))
        }
        assertTrue(MangaUrlPolicy.isPublicAddress(InetAddress.getByName("93.184.216.34")))
    }

    @Test fun normalizesTitlesAndDecodesEntities() {
        assertEquals("spyxfamily", MangaTitles.normalize("SPY x FAMILY"))
        assertEquals("gintama", MangaTitles.normalize("Gin Tama"))
        assertEquals("pokemonadventures", MangaTitles.normalize("Pokémon Adventures"))
        assertEquals("komicantcommunicate", MangaTitles.normalize("Komi Can&#39;t Communicate"))
        assertEquals("Tom & Jerry's <3", Html.decode("Tom &amp; Jerry&#x27;s &lt;3"))
    }
}
