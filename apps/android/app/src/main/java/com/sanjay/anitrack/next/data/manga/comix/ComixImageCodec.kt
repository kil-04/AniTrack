package com.sanjay.anitrack.next.data.manga.comix

/** Public Comix image format interoperability; no request-signing secrets.
 * Format reference: Keiyoushi extensions-source Comix/Descrambler.kt (Apache-2.0).
 * Reimplemented with strict version/size checks and a native-cache handoff.
 * See assets/licenses/comix-image-format-notice.txt and Apache-2.0.txt. */
internal object ComixImageCodec {
    fun bytes(input: ByteArray, seed: Int?, length: Int?, algorithm: String?): ByteArray {
        if (seed == null || seed == 0) return input
        require(length != null && length in 0..input.size) { "Invalid Comix image encoding length." }
        require(algorithm == null || algorithm in setOf("1","2")) { "Unsupported Comix image encoding." }
        if (algorithm != "2") return xor(input, seed, length, false, false)
        // Published algorithm 2 has two seed conventions. Require an image
        // signature; never present undecoded data as a valid page.
        for ((initial, high) in listOf((seed or 1) to false, seed to false, (seed or 1) to true)) {
            val decoded = xor(input, initial, length, true, high)
            if (imageSignature(decoded)) return decoded
        }
        val legacy = xor(input, seed, length, false, false)
        require(imageSignature(legacy)) { "Comix image encoding changed." }
        return legacy
    }

    private fun xor(input: ByteArray, seed: Int, length: Int, shift: Boolean, high: Boolean): ByteArray {
        var state = seed
        return input.copyOf().also { out ->
            for (i in 0 until length) {
                state = if (shift) xorshift(state) else state * 1_000_005 + 1_234_567_891
                val key = if (!shift || high) state ushr 24 else state and 255
                out[i] = (out[i].toInt() xor key).toByte()
            }
        }
    }

    fun tileSources(seed: Int, algorithm: String?, hash: String?): IntArray {
        require(algorithm == null || algorithm in setOf("1","2","3")) { "Unsupported Comix tile encoding." }
        val mask = when (hash?.trim()) {
            null, "", "0" -> 0
            "03632" -> 58414
            "02900" -> 117532
            else -> error("Unsupported Comix tile hash.")
        }
        var state = seed xor mask
        if (algorithm == "3") state = state or 1
        val shuffled = IntArray(25) { it }
        for (last in 24 downTo 1) {
            state = if (algorithm == "3") xorshift(state) else state * 1_664_525 + 1_013_904_223
            val swap = ((state.toLong() and 0xffffffffL) % (last + 1)).toInt()
            val tmp = shuffled[last]
            shuffled[last] = shuffled[swap]
            shuffled[swap] = tmp
        }
        return IntArray(25).also { inverse -> shuffled.forEachIndexed { index, value -> inverse[value] = index } }
    }

    private fun xorshift(value: Int): Int {
        var x = value xor (value shl 13)
        x = x xor (x ushr 17)
        return x xor (x shl 5)
    }

    fun imageSignature(b: ByteArray): Boolean = b.size >= 12 && (
        (b[0] == 0xff.toByte() && b[1] == 0xd8.toByte()) ||
        (b[0] == 0x89.toByte() && b.copyOfRange(1,4).contentEquals("PNG".toByteArray())) ||
        (b.copyOfRange(0,4).contentEquals("RIFF".toByteArray()) && b.copyOfRange(8,12).contentEquals("WEBP".toByteArray()))
    )
}
