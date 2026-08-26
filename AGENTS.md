# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What This Is

AniTrack is a Windows Electron desktop app for tracking anime, playing local video files, and streaming via AnimePahe. It syncs watch status two-way with MyAnimeList (MAL) and uses AniList as the metadata source.

## Commands

```bash
# Development (starts Vite dev server + Electron concurrently)
npm run dev

# Type-check both renderer and electron (run before committing)
npm run typecheck

# Production build (Vite + tsc for electron)
npm run build

# Regression tests for shared/desktop logic and native Android
npm test
npm run android:next:test

# Package into an NSIS installer
npm run pack

# Publish a GitHub Release (triggers electron-builder --publish always)
npm run publish
```

`npm test` runs the Node regression suite, `npm run android:next:test` runs native
Android unit tests, and `npm run typecheck` checks both TypeScript contexts.

## Architecture

The maintained applications are the Electron desktop app in `apps/desktop/`
and the native Kotlin app in `apps/android/`. The retired Capacitor app and its
plugin sources live in `legacy/capacitor/`. There is no Flutter/Dart application
in this repository.
See `docs/architecture/project-structure.md` and
`docs/providers/connector-contract.md` before changing provider boundaries.

The repo has **three TypeScript compilation contexts**:

| Context | tsconfig | Module format | Runs in |
|---|---|---|---|
| `apps/desktop/renderer/` | `apps/desktop/tsconfig.renderer.json` | ESNext | Electron renderer (Chromium) |
| `apps/desktop/main/` | `apps/desktop/tsconfig.main.json` | CommonJS → `dist-electron/` | Electron main process (Node) |
| `packages/shared/` | included in both above | — | Imported by both sides |

### IPC boundary

The renderer **never** calls Node APIs directly. All cross-process calls go through:

1. `packages/shared/types.ts` — defines the `IPC` constant map (channel names) and all shared data types (`AnimeMeta`, `ListEntry`, `PlaybackProgress`, etc.)
2. `apps/desktop/main/preload.ts` — exposes a typed `window.api` bridge via `contextBridge`
3. `apps/desktop/main/main.ts` — registers all `ipcMain.handle()` handlers in `registerIpc()`
4. `apps/desktop/renderer/types.d.ts` — declares `Window.api: ApiBridge` for TypeScript in the renderer

When adding a new IPC call: add the channel name to `IPC` in `packages/shared/types.ts`, add the handler in `registerIpc()` in `main.ts`, expose it in `preload.ts`, and declare it in `ApiBridge` in `apps/desktop/renderer/types.d.ts`.

### Electron main process (`apps/desktop/main/`)

- **`main.ts`** — app lifecycle, single-instance lock, `local-video://` custom protocol for serving local files to the renderer, CDN header injection (Referer/Origin spoofing + CORS injection for AnimePahe HLS streams), auto-updater, MAL flush timer
- **`ipc/providers.ts`** — provider-neutral streaming IPC registration; legacy `PAHE_*` channels remain for renderer compatibility during migration
- **`services/db.ts`** — SQLite via `node-sqlite3-wasm`; single lazy-initialized connection; schema created inline with `initSchema()`. DB file lives in Electron's `userData`. Tables: `anime`, `list_entry`, `local_episode`, `playback`, `library_folder`
- **`services/mal.ts`** — MAL OAuth 2.0 with PKCE (plain method); uses a shared public client ID; auth via in-app BrowserWindow; `flushDirty()` pushes `mal_dirty=1` entries every 30s
- **`services/anilist.ts`** — AniList GraphQL for search/metadata/trending
- **`services/animepahe.ts`** — AnimePahe scraping (search, episodes, kwik stream resolution); uses a hidden pre-warmed BrowserWindow to establish Cloudflare session cookies
- **`services/library.ts`** — scans registered folders for video files, matches them to anime by filename parsing
- **`services/legal-sites.ts`** — generates Crunchyroll/etc. links for a given anime
- **`services/store.ts`** — simple JSON file store (used for MAL OAuth tokens)

### Renderer (`apps/desktop/renderer/`)

- **`apps/desktop/renderer/store/useAppStore.ts`** — single Zustand store; holds MAL auth state, trending, continue-watching list, user library list, scan status
- **`apps/desktop/renderer/App.tsx`** — top-level router; player routes (`/player/*`) and streaming routes (`/stream`, `/stream-player`) render full-screen without the sidebar/topbar shell
- Pages: `Home`, `Library`, `Search`, `ShowDetail`, `Player` (local), `StreamingPage` + `StreamPlayer` (AnimePahe HLS via hls.js), `Settings`, `ContinueWatching`

### Key design decisions

- **AniList ID is the primary key** everywhere (DB, store, IPC). MAL IDs are stored as secondary. Anime watched only via AnimePahe (no AniList match) get a negative synthetic ID.
- **Stub-then-resolve pattern**: when playback starts for an unknown anime, a stub row is immediately inserted so continue-watching works. A background task fires to resolve the real AniList entry and migrate the stub.
- **`mal_dirty` flag** on `list_entry` drives background sync — entries are flushed to MAL every 30 seconds.
- **CDN header injection** in `main.ts` (`onBeforeSendHeaders`/`onHeadersReceived`) is essential for AnimePahe HLS playback — the CDN validates Referer/Origin and the browser blocks cross-origin responses without the injected CORS headers.
