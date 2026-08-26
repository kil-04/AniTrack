# AniTrack project structure

AniTrack currently ships two maintained applications and retains one legacy
application for reference and migration support.

| Path | Status | Purpose |
| --- | --- | --- |
| `src/` | Current | Electron renderer (React + Vite) |
| `electron/` | Current | Electron main process, IPC and desktop services |
| `shared/` | Current | Contracts shared by both Electron TypeScript contexts |
| `anitrack-android/` | Current | Native Android application (Kotlin + Compose) |
| `android/` | Legacy | Previous Capacitor-generated Android application |
| `android-plugins/` | Legacy source | Capacitor plugin source/templates |
| `automation/` | Current | Signed provider rules and Android update metadata |
| `scripts/` | Current | Release, signing, health-check and build automation |
| `tests/` | Current | Desktop/shared regression and contract tests |
| `scratch/` | Diagnostic archive | Provider investigations; never imported by production code |
| `tools/diagnostics/` | Diagnostic archive | Standalone manual probes; never run by CI or releases |

There is no Flutter application in this repository. No `pubspec.yaml` or Dart
source exists. The folder named `android/` is the legacy Capacitor app; the
actively released Android app is `anitrack-android/`.

## Dependency direction

```text
Desktop renderer -> preload API -> IPC -> provider registry -> connectors
Native Android UI -> provider registry -> connector adapters -> scrapers
                                      -> normalized playback/download models
```

UI, persistence and playback code should depend on normalized provider models,
not on `AnimePahe` or `Anikoto` classes. Provider-specific cookies, parsing,
anti-bot handling and resolution remain inside their connector.

## Migration policy

The physical app folders stay in place until provider boundaries are stable.
Moving `src/`, `electron/` and both Android projects in one large change would
create release risk without improving runtime behavior. Logical boundaries and
tests are being established first; folder relocation can then be mechanical.

Legacy Capacitor code is not a third maintained app. Do not add new product
features there unless a migration task explicitly requires it.
