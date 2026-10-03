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
        assertThrows(IllegalArgumentException::class.java) { ComixImageCodec.bytes(ByteArray(10),1,10,"unknown") }
        assertThrows(IllegalArgumentException::class.java) { ComixImageCodec.tileSources(12345,"unknown",null) }
        assertThrows(IllegalStateException::class.java) { ComixImageCodec.tileSources(12345,"3","unknown") }
    }
}
