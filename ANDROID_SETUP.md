# AniTrack Android Setup

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
npx cap init AniTrack com.sanjay.anitrack --web-dir dist
npx cap add android
```

## Step 3 — Build the web app

```powershell
npm run build:vite
```

## Step 4 — Copy the Kotlin plugins

Copy the contents of `android-plugins/src/` into:
```
android/app/src/main/java/
```

So the result is:
```
android/app/src/main/java/com/sanjay/anitrack/plugins/
  AniTrackDbPlugin.kt
  AniTrackPahePlugin.kt
  AniTrackMalPlugin.kt
  AniTrackSettingsPlugin.kt
```

## Step 5 — Replace MainActivity.kt

Copy `android-plugins/MainActivity.kt.template` to:
```
android/app/src/main/java/com/sanjay/anitrack/MainActivity.kt
```
(overwrite the generated one)

## Step 6 — Add dependencies to build.gradle

Open `android/app/build.gradle` and add inside `dependencies {}`:

```groovy
implementation("com.squareup.okhttp3:okhttp:4.12.0")
```

## Step 7 — Add deep-link intent filter to AndroidManifest.xml

In `android/app/src/main/AndroidManifest.xml`, inside the `<activity>` tag, add:

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
npx cap sync android
npx cap open android
```

## Step 9 — Build the APK

In Android Studio:
- Build → Generate Signed Bundle/APK → APK
- Or for a debug APK: Build → Build Bundle(s)/APK(s) → Build APK(s)

The APK will be at `android/app/build/outputs/apk/debug/app-debug.apk`

## Install on your Samsung device

Enable "Install from unknown sources" in Samsung settings, then:
```powershell
adb install android/app/build/outputs/apk/debug/app-debug.apk
```
Or transfer the APK to your phone and open it.

## Development workflow (after initial setup)

```powershell
# Rebuild web + sync to Android
npm run android:sync

# Open Android Studio to run on device
npm run android:open
```
