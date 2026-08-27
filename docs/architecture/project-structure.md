# AniTrack project structure

AniTrack currently ships two maintained applications and retains one legacy
application for reference and migration support.

| Path | Status | Purpose |
| --- | --- | --- |
| `apps/desktop/renderer/` | Current | Electron renderer (React + Vite) |
| `apps/desktop/main/` | Current | Electron main process, IPC and desktop services |
| `apps/android/` | Current | Native Android application (Kotlin + Compose) |
| `packages/shared/` | Current | Desktop contracts and signed automation trust data |
| `legacy/capacitor/android/` | Legacy | Previous Capacitor-generated Android application |
| `legacy/capacitor/plugins/` | Legacy source | Capacitor plugin source/templates |
| `automation/` | Current | Signed provider rules and Android update metadata |
| `scripts/` | Current | Release, signing, health-check and build automation |
| `tests/` | Current | Desktop/shared regression and contract tests |

There is no Flutter application in this repository. No `pubspec.yaml` or Dart
source exists. The actively released Android app is `apps/android/`; the old
Capacitor implementation is isolated under `legacy/`.

## Dependency direction

```text
apps/desktop/renderer -> preload API -> IPC -> provider registry -> connectors
apps/android UI       -> provider registry -> connector adapters -> scrapers
                                         -> normalized playback/download models
```

UI, persistence and playback code should depend on normalized provider models,
not on `AnimePahe` or `Anikoto` classes. Provider-specific cookies, parsing,
anti-bot handling and resolution remain inside their connector.

## UI module boundaries

The desktop renderer keeps route-level orchestration in `pages/`, reusable UI in
`components/`, and provider-independent matching utilities in
`components/provider/`. Player-only helpers belong in `components/player/`.

The native Android UI keeps one route-level screen per file in
`apps/android/app/src/main/java/com/sanjay/anitrack/next/ui/`. Reusable cards,
episode controls and playback-progress helpers live beside those screens as
small focused modules. Do not recreate a single catch-all `Screens.kt` file.

The larger route families are intentionally split as follows:

- `HomeRoute.kt` coordinates the home route; `HomeHighlights.kt`,
  `ContinueCards.kt`, and `HomeComponents.kt` own reusable presentation.
- `AnimeDetailScreen.kt` coordinates details; relations, episode/provider
  selection, and list-status editing live in their respective `Detail*.kt`
  modules.
- Search, latest, downloads, schedule, continue-watching, and list routes each
  have their own screen file.
- `PlayerScreen.kt` owns playback state, while `NativePlayerControls.kt` and
  `PlayerGestureLayer.kt` own the control and gesture surfaces.
- `DownloadManager.kt` owns queue/state/persistence and
  `DownloadTransport.kt` owns HTTP, proxying, and direct-to-disk transfer.

Large screens may still coordinate state, but parsing, persistence, provider
selection and reusable UI must remain outside the route composable.

## Connector module boundaries

Desktop connectors live in `apps/desktop/main/services/providers/`. A connector
adapter implements the normalized contract in `types.ts`; provider-specific
configuration, browser/session management, and resolver logic may be adjacent
modules with the same connector prefix. AnimePahe therefore uses
`animepahe-config.ts` and `animepahe-kwik.ts`, while Anikoto uses
`anikoto-config.ts`, `anikoto-browser.ts`, and `anikoto-top.ts`.

The desktop player keeps route coordination in `StreamPlayer.tsx`. Its episode
panel, video surface, native HLS loader, provider-matching hook, and skip-time
client are separate modules. This keeps connector payload parsing out of the
visual components.

The still-compiled Capacitor compatibility bridge is similarly divided into
`capacitor-plugins.ts`, `capacitor-anilist.ts`, and `capacitor-anikoto.ts`.
These modules exist only to keep old installations buildable; new Android
product work belongs in the native Kotlin application.

## Repository policy

Keep shippable applications in `apps/`, reusable contracts in `packages/`, and
retired implementations in `legacy/`. Generated builds belong only in ignored
output directories. Temporary provider probes should not be committed; convert
repeatable cases into tests or fixtures instead.

Legacy Capacitor code is not a third maintained app. Do not add new product
features there unless a migration task explicitly requires it.
