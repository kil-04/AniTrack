// AniTrack Next — native Kotlin + Jetpack Compose Android app.
// Lives beside the Capacitor app (../android) during the transition; ships as a
// separate applicationId so both can be installed side-by-side while porting.
plugins {
    id("com.android.application") version "9.2.1" apply false
    id("org.jetbrains.kotlin.android") version "2.2.10" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.10" apply false
}
