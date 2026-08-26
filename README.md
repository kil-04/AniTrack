# AniTrack

Anime tracker with MAL sync, local video playback, and connector-based streaming
through Anikoto and AnimePahe.

## Download

**[⬇ Download Latest Installer](https://github.com/kil-04/AniTrack/releases/latest)**

Click the link above → expand **Assets** → download `AniTrack-Setup-x.x.x.exe`.

## Features

- Browse and stream through Anikoto and AnimePahe connectors
- Track watch progress with MAL two-way sync
- Local video library with episode matching
- Continue Watching across sessions
- Auto-updates when new versions are released

## Applications

- Desktop: Electron + React (`src/`, `electron/`, `shared/`)
- Current Android: native Kotlin + Compose (`anitrack-android/`)
- Legacy Android: Capacitor (`android/`, retained for migration reference)

There is currently no Flutter app in this repository.

Developer documentation:

- [Project structure](docs/architecture/project-structure.md)
- [Provider connector contract](docs/providers/connector-contract.md)
- [Native Android setup](docs/android/native-setup.md)
- [Legacy Capacitor setup](docs/legacy/capacitor-setup.md)
