<p align="center">
  <img src="apps/desktop/build/icon.png" width="112" alt="AniTrack logo" />
</p>

<h1 align="center">AniTrack</h1>

<p align="center">
  Your anime and manga in one place: track your list, watch and download episodes,<br />
  read manga, and pick up where you left off on Windows or Android.
</p>

<p align="center">
  <a href="https://github.com/kil-04/AniTrack/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/kil-04/AniTrack?label=latest&color=3D8BFF" /></a>
  <a href="https://github.com/kil-04/AniTrack/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/kil-04/AniTrack/actions/workflows/ci.yml/badge.svg" /></a>
  <img alt="Windows 10/11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6?logo=windows&logoColor=white" />
  <img alt="Android 8.0+" src="https://img.shields.io/badge/Android-8.0%2B-3DDC84?logo=android&logoColor=white" />
</p>

<p align="center">
  <a href="https://github.com/kil-04/AniTrack/releases/latest"><b>Download</b></a> ·
  <a href="#features">Features</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="#building-from-source">Build from source</a>
</p>

---

## Download

Grab both files from the **[latest release](https://github.com/kil-04/AniTrack/releases/latest)** (under **Assets**):

| Platform | File | Notes |
|---|---|---|
| **Windows 10 / 11** (64-bit) | `AniTrack-Setup-<version>.exe` | Installs in one click and updates itself. |
| **Android 8.0+** (phone or tablet) | `AniTrack-Android-Next-<version>.apk` | Allow installs from your browser or file manager when asked. Updates are offered inside the app. |

The two apps are built separately (Electron on Windows, native Kotlin on Android) but share your accounts, and can share progress through a private GitHub gist.

## Features

### Track
- **MyAnimeList two-way sync.** Your list imports on sign-in, and watching an episode moves your progress forward on its own. Counts never go backwards when you rewatch an earlier episode, and a completed show stays completed while you rewatch it. The desktop app can sync **AniList** too.
- **Continue Watching** remembers where you stopped in every episode.
- **Schedule** with countdowns to the next episode of the shows you follow, plus new-episode and new-chapter **notifications** on Android.

### Watch
- **A built-in player.** On desktop it has YouTube-style controls and keyboard shortcuts. On Android it has swipe gestures, picture-in-picture and a mini player that keeps playing while you browse.
- **Skip the intro and outro** with one click, or automatically on Android, using community timestamps.
- **Offline downloads** in both apps; on Android, a whole range of episodes at once.
- Streams come from built-in **source connectors**, and you can switch to another source if one has trouble.

### Read
- **Manga mode**, one tap away from anime, with several manga sources.
- Vertical scrolling or pages (left to right or right to left, one or two at a time), picked automatically for each title.
- **Chapter downloads** for offline reading, and new-chapter updates.
- Reading progress **syncs between your devices**.

### Discover
- **Home**: trending shows, the **latest episodes** to air, and top airing, popular, movie and highest-rated rows.
- **For You** recommendations built from what you've watched and rated.
- **Continue the story**: see the manga or novel an anime adapts, and where you are in it.
- **Theme songs** for every show (openings and endings), plus a shuffled **theme radio** of the shows you love.
- **Time Machine**: browse anime by year, and what premiered on this day.

### And more
- **Background music** while you browse: a built-in piano track, or your own music (audio files or a `.zip`), with play, pause, previous, next and repeat. It pauses itself for episodes and theme songs.
- **Cross-device sync** of Continue Watching and manga reading through a private GitHub gist.
- **Backup and restore** of your library on Android, and **smart downloads** that keep the next episodes of your current shows ready.
- A midnight-blue dark theme designed for both big screens and phones.

## Getting started

1. **Install** the app for your device (see [Download](#download)).
2. **Sign in to MyAnimeList** in **Settings → MyAnimeList**. Your list comes across, and episodes you finish are marked as watched.
3. *(Optional)* **Sync between devices.** Create a GitHub token with only the `gist` scope at [github.com/settings/tokens](https://github.com/settings/tokens) and paste it in **Settings → Cross-device sync** on each device.
4. *(Optional)* **Background music.** Turn it on in **Settings → Background music**, or with the music button in the top bar.

## Privacy

AniTrack has **no server of its own**. Your library lives on your devices. It is shared only with the services you connect: your MyAnimeList and AniList accounts, and the private gist you choose to use for sync. Anime and manga information comes from AniList.

## Building from source

**You'll need:** Node.js 24 with npm. For Android you'll also need JDK 17 and the Android SDK (`apps/android/local.properties` should point to it).

```bash
npm ci                      # install dependencies
npm run dev                 # desktop app with hot reload (Vite + Electron)
npm run typecheck           # TypeScript checks (renderer and main process)
npm test                    # Node regression tests
npm run build               # production desktop build
npm run android:next:debug  # Android debug APK
npm run android:next:test   # Android unit tests
```

### Project layout

| Path | What's there |
|---|---|
| `apps/desktop/` | Desktop app: Electron main process (`main/`) and the React + Tailwind UI (`renderer/`) |
| `apps/android/` | Native Android app (Kotlin, Jetpack Compose, Media3 ExoPlayer) |
| `packages/shared/` | TypeScript types and logic shared by the desktop app's two halves |
| `tests/` | Node regression tests |
| `scripts/` | Release, signing and health-check tools |
| `automation/` | Signed remote settings and Android update metadata |
| `docs/` | Architecture notes and developer guides |
| `legacy/capacitor/` | The retired Capacitor Android app, kept for reference |

**Developer guides:** [How AniTrack works](docs/architecture/how-anitrack-works.md) · [Project structure](docs/architecture/project-structure.md) · [Source connector contract](docs/providers/connector-contract.md) · [Native Android setup](docs/android/native-setup.md)

### Releases

Every push to `main` is verified by CI. Continuous deployment then tags the next version, builds the Windows installer and the signed Android APK, and publishes them together as one release, with notes generated from the commit messages.

## Disclaimer

AniTrack is an unofficial personal project. It is not affiliated with MyAnimeList, AniList, AnimeThemes, AniSkip, or any streaming or manga site. AniTrack does not host or distribute any video, images or chapters: everything is loaded from the third-party sites you use. Please respect their terms and the laws where you live.
