package com.sanjay.anitrack.next.data.manga.comix

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class ComixImageCompositingTest {
    @Test fun nativeTileDrawingUsesReplacementRatherThanAlphaBlending() {
        // Local JVM tests have stubbed Android Bitmap/Canvas APIs. This narrow
        // source guard protects the actual native drawing mode; it does not
        // claim to render a bitmap on a device.
        val relative = "apps/android/app/src/main/java/com/sanjay/anitrack/next/data/manga/comix/ComixImages.kt"
        val source = generateSequence(File(".").absoluteFile) { it.parentFile }
            .map { File(it, relative) }.first { it.isFile }.readText(Charsets.UTF_8)
        assertTrue(Regex("val\\s+tilePaint\\s*=\\s*Paint\\(\\)\\.apply\\s*\\{\\s*xfermode\\s*=\\s*PorterDuffXfermode\\(PorterDuff\\.Mode\\.SRC\\)\\s*\\}")
            .containsMatchIn(source))
        val tileLoop = source.substringAfter("for (dst in 0 until 25)").substringBefore("tmp.outputStream()")
        assertTrue("The restored tile must use the replacement paint", Regex("canvas\\.drawBitmap\\([\\s\\S]*?,\\s*tilePaint\\)").containsMatchIn(tileLoop))
    }
}
