package com.sanjay.anitrack.next.data.manga.comix

import org.junit.Assert.*
import org.junit.Test

class ComixImageCodecTest {
    @Test fun plainImagesAreNotModified() {
        val plain = byteArrayOf(-1,-40,1,2,3,4,5,6,7,8,9,10)
        assertSame(plain,ComixImageCodec.bytes(plain,null,null,null))
        assertTrue(ComixImageCodec.imageSignature(plain))
        assertFalse(ComixImageCodec.imageSignature("<html>blocked</html>".toByteArray()))
    }

    @Test fun legacyEncodingRoundTripsOnlyTheSpecifiedPrefix() {
        val plain = ByteArray(60) { it.toByte() }.apply { this[0]=-1; this[1]=-40 }
        val encoded = ComixImageCodec.bytes(plain,12345,32,"1")
        assertFalse(encoded.contentEquals(plain))
        assertArrayEquals(plain.copyOfRange(32,60),encoded.copyOfRange(32,60))
        assertArrayEquals(plain,ComixImageCodec.bytes(encoded,12345,32,"1"))
    }

    @Test fun xorshiftDecodesAPublishedFormatFixture() {
        val plain = "RIFFabcdefghWEBP".toByteArray().apply { "WEBP".toByteArray().copyInto(this,8) }
        var state = 12345 or 1
        val encoded = plain.copyOf()
        for (i in encoded.indices) {
            state = state xor (state shl 13); state = state xor (state ushr 17); state = state xor (state shl 5)
            encoded[i] = (encoded[i].toInt() xor (state and 255)).toByte()
        }
        assertArrayEquals(plain,ComixImageCodec.bytes(encoded,12345,encoded.size,"2"))
    }

    @Test fun algorithmTwoSupportsKnownSeedConventionsWithoutChangingTheTail() {
        val plain = hex("89504e470d0a1a0a0000000d4948445200000005000000050806000000000000")
        // Synthetic PNG-header fixtures generated independently from the
        // published integer recurrence; these contain no downloaded page data.
        for (encoded in listOf(
            "f3ffeeadde688232784cbed20b2f4fae5d724a87ef41cc680806000000000000", // odd seed, low byte
            "d2fe2be20fb898805d3875e58181ba1f557adb9edcf827270806000000000000", // raw seed, low byte
            "4f35e93327c9e5d18c822c100540ef1f06c11ec816a66f670806000000000000", // odd seed, high byte
            "a07a16733b61c79b79f18522445c92d636bde4011dd6f5750806000000000000", // legacy recurrence
        )) {
            val input = hex(encoded)
            assertArrayEquals(plain,ComixImageCodec.bytes(input,12344,24,"2"))
            assertArrayEquals(plain.copyOfRange(24,plain.size),input.copyOfRange(24,input.size))
        }
    }

    @Test fun tileSourcesMatchKnownLegacyAndVersionThreeHashFixtures() {
        assertArrayEquals(intArrayOf(2,1,0,7,4,9,5,10,6,18,22,21,3,17,12,20,14,11,24,23,13,19,16,15,8),
            ComixImageCodec.tileSources(12345,"1",null))
        assertArrayEquals(intArrayOf(13,3,17,19,22,23,8,20,10,15,21,14,16,4,12,24,1,9,7,18,6,11,5,0,2),
            ComixImageCodec.tileSources(12345,"3","03632"))
        assertArrayEquals(intArrayOf(10,18,4,22,3,9,23,11,12,24,20,6,15,7,5,16,21,8,0,17,19,13,1,14,2),
            ComixImageCodec.tileSources(12345,"3","02900"))
    }

    @Test fun tileMapsAreCompleteStablePermutations() {
        for (algo in listOf("1","2","3")) {
            val order = ComixImageCodec.tileSources(12345,algo,null)
            assertEquals((0..24).toSet(),order.toSet())
            assertArrayEquals(order,ComixImageCodec.tileSources(12345,algo,null))
            assertFalse(order.contentEquals(IntArray(25) { it }))
        }
        assertFalse(ComixImageCodec.tileSources(12345,"1",null).contentEquals(ComixImageCodec.tileSources(12345,"3",null)))
    }

    @Test fun unknownFormatsAndUnboundedLengthsAreRejected() {
        assertThrows(IllegalArgumentException::class.java) { ComixImageCodec.bytes(ByteArray(10),1,20,"1") }
        assertThrows(IllegalArgumentException::class.java) { ComixImageCodec.bytes(ByteArray(10),1,-1,"1") }
        assertThrows(IllegalArgumentException::class.java) { ComixImageCodec.bytes(ByteArray(10),1,10,"unknown") }
        assertThrows(IllegalArgumentException::class.java) { ComixImageCodec.bytes("<html>blocked</html>".toByteArray(),12344,16,"2") }
        assertThrows(IllegalArgumentException::class.java) { ComixImageCodec.tileSources(12345,"unknown",null) }
        assertThrows(IllegalStateException::class.java) { ComixImageCodec.tileSources(12345,"3","unknown") }
    }

    private fun hex(value: String): ByteArray = value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
