# Native Android setup

The maintained Android application is `anitrack-android/`. It is a native
Kotlin/Jetpack Compose project and does not use Capacitor or Flutter.

## Prerequisites

- Android Studio with the Android SDK
- JDK 17 (Android Studio's bundled JDK is suitable)
- Node.js, used by the repository's release helper scripts

Create `anitrack-android/local.properties` if Android Studio has not already
written it, and set `sdk.dir` to the local Android SDK path.

## Verify and build

From the repository root:

```powershell
npm run android:next:test
npm run android:next:debug
```

The debug APK is written below
`anitrack-android/app/build/outputs/apk/debug/`.

For the signed release workflow, copy `.env.example` to `.env`, fill the
Android keystore variables, then use the repository release scripts. Secrets
and keystores remain local and are ignored by Git.

## Install on a connected device

With USB debugging enabled:

```powershell
adb install -r anitrack-android/app/build/outputs/apk/debug/app-debug.apk
```

The legacy Capacitor instructions are archived in
[`../legacy/capacitor-setup.md`](../legacy/capacitor-setup.md).
