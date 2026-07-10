plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.sanjay.anitrack.next"
    compileSdk = 36

    defaultConfig {
        // Separate id so it installs BESIDE the Capacitor app while we port.
        // If it ever fully replaces the old app, keep this id and ship it as a
        // new listing, or coordinate a data-export path — the old id can't be
        // upgraded in place from a different package name.
        applicationId = "com.sanjay.anitrack.next"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.06.01")
    implementation(composeBom)

    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.navigation:navigation-compose:2.8.9")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    // Images
    implementation("io.coil-kt:coil-compose:2.7.0")

    // Native video: ExoPlayer via media3 (HLS + UI + PiP-ready)
    implementation("androidx.media3:media3-exoplayer:1.6.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.6.1")
    implementation("androidx.media3:media3-ui:1.6.1")
    // Cronet = Chromium's network stack. The pahe CDN TLS-fingerprints
    // clients (browser stacks pass, Java/OkHttp get 403) — stream through
    // Cronet so playback looks like Chrome on the wire.
    implementation("androidx.media3:media3-datasource-cronet:1.6.1")
    implementation("com.google.android.gms:play-services-cronet:18.1.0")

    // HTTP for AniList/gist/providers
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
