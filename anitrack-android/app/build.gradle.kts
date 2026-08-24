plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val trustJson = rootProject.file("../shared/automation-trust.json").readText()
fun trustValue(name: String): String = Regex("\"$name\"\\s*:\\s*\"([^\"]+)\"")
    .find(trustJson)?.groupValues?.get(1)
    ?: throw GradleException("Missing $name in shared/automation-trust.json")

val releaseStorePath = System.getenv("ANITRACK_ANDROID_KEYSTORE_FILE")
val releaseStorePassword = System.getenv("ANITRACK_ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = System.getenv("ANITRACK_ANDROID_KEY_ALIAS")
val releaseKeyPassword = System.getenv("ANITRACK_ANDROID_KEY_PASSWORD")
val releaseSigningReady = listOf(
    releaseStorePath,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { !it.isNullOrBlank() }

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
        versionCode = 4
        versionName = "7.0.0"

        buildConfigField("String", "AUTOMATION_PUBLIC_KEY_B64", "\"${trustValue("publicKeySpkiBase64")}\"")
        buildConfigField("String", "ANDROID_RELEASE_CERT_SHA256", "\"${trustValue("androidReleaseCertSha256")}\"")
        buildConfigField("String", "AUTOMATION_CONFIG_URL", "\"${trustValue("configUrl")}\"")
        buildConfigField("String", "AUTOMATION_CONFIG_SIGNATURE_URL", "\"${trustValue("configSignatureUrl")}\"")
        buildConfigField("String", "ANDROID_UPDATE_MANIFEST_URL", "\"${trustValue("androidUpdateManifestUrl")}\"")
        buildConfigField("String", "ANDROID_UPDATE_SIGNATURE_URL", "\"${trustValue("androidUpdateSignatureUrl")}\"")
    }

    signingConfigs {
        if (releaseSigningReady) {
            create("release") {
                storeFile = rootProject.file(releaseStorePath!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (releaseSigningReady) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
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
    implementation("androidx.work:work-runtime-ktx:2.10.1")

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

if (gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) } && !releaseSigningReady) {
    throw GradleException(
        "Release signing is not configured. Run the Android key generator and build through the release script; " +
            "release builds never fall back to a debug certificate.",
    )
}
