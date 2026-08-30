# WebView invokes the native AnimePahe playback bridge by its annotated method
# names. Keep those entry points while allowing the surrounding app to shrink.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Room creates WorkManager's generated database implementation reflectively.
# Its no-argument constructor otherwise looks unused to R8 full mode.
-keepclassmembers class androidx.work.impl.WorkDatabase_Impl {
    <init>();
}
