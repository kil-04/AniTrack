# Legacy Capacitor Android setup

> This document describes the retired Capacitor application in `legacy/capacitor/`.
> For the maintained native Kotlin app, use
> [`../android/native-setup.md`](../android/native-setup.md).

## Prerequisites

- Android Studio (latest stable) with Android SDK
- JDK 17 (bundled with Android Studio)
- Node 18+

## Step 1 — Install dependencies

```powershell
npm install
```

## Step 2 — Initialize Capacitor & add Android platform

```powershell
npm run legacy:capacitor:sync
```

## Step 3 — Build the web app

```powershell
npm run build:vite
```

## Step 4 — Copy the Kotlin plugins

Copy the contents of `legacy/capacitor/plugins/src/` into:
```
legacy/capacitor/android/app/src/main/java/
```

So the result is:
```
legacy/capacitor/android/app/src/main/java/com/sanjay/anitrack/plugins/
  AniTrackDbPlugin.kt
  AniTrackPahePlugin.kt
  AniTrackMalPlugin.kt
  AniTrackSettingsPlugin.kt
```

## Step 5 — Replace MainActivity.kt

Copy `legacy/capacitor/plugins/MainActivity.kt.template` to:
```
legacy/capacitor/android/app/src/main/java/com/sanjay/anitrack/MainActivity.kt
```
(overwrite the generated one)

## Step 6 — Add dependencies to build.gradle

Open `legacy/capacitor/android/app/build.gradle` and add inside `dependencies {}`:

```groovy
implementation("com.squareup.okhttp3:okhttp:4.12.0")
```

## Step 7 — Add deep-link intent filter to AndroidManifest.xml

In `legacy/capacitor/android/app/src/main/AndroidManifest.xml`, inside the `<activity>` tag, add:

```xml
<intent-filter android:autoVerify="false">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="anitrack" />
</intent-filter>
```

## Step 8 — Sync Capacitor and open Android Studio

```powershell
npm run legacy:capacitor:sync
npm run legacy:capacitor:open
```

## Step 9 — Build the APK

In Android Studio:
- Build → Generate Signed Bundle/APK → APK
- Or for a debug APK: Build → Build Bundle(s)/APK(s) → Build APK(s)

The APK will be at `legacy/capacitor/android/app/build/outputs/apk/debug/app-debug.apk`

## Install on your Samsung device

Enable "Install from unknown sources" in Samsung settings, then:
```powershell
adb install legacy/capacitor/android/app/build/outputs/apk/debug/app-debug.apk
```
Or transfer the APK to your phone and open it.

## Development workflow (after initial setup)

```powershell
# Rebuild web + sync to Android
npm run legacy:capacitor:sync

# Open Android Studio to run on device
npm run legacy:capacitor:open
```
