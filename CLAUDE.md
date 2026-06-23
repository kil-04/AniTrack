# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

# Package into an NSIS installer
npm run pack

# Publish a GitHub Release (triggers electron-builder --publish always)
npm run publish
```

There is no test suite. `npm run typecheck` is the only automated correctness check.

## Architecture

The repo has **three TypeScript compilation contexts**:

| Context | tsconfig | Module format | Runs in |
|---|---|---|---|
| `src/` | `tsconfig.json` (Vite bundler) | ESNext | Electron renderer (Chromium) |
| `electron/` | `tsconfig.electron.json` | CommonJS → `dist-electron/` | Electron main process (Node) |
| `shared/` | included in both above | — | Imported by both sides |

### IPC boundary

The renderer **never** calls Node APIs directly. All cross-process calls go through:

1. `shared/types.ts` — defines the `IPC` constant map (channel names) and all shared data types (`AnimeMeta`, `ListEntry`, `PlaybackProgress`, etc.)
2. `electron/preload.ts` — exposes a typed `window.api` bridge via `contextBridge`
3. `electron/main.ts` — registers all `ipcMain.handle()` handlers in `registerIpc()`
4. `src/types.d.ts` — declares `Window.api: ApiBridge` for TypeScript in the renderer

When adding a new IPC call: add the channel name to `IPC` in `shared/types.ts`, add the handler in `registerIpc()` in `main.ts`, expose it in `preload.ts`, and declare it in `ApiBridge` in `src/types.d.ts`.

### Electron main process (`electron/`)

- **`main.ts`** — app lifecycle, single-instance lock, `local-video://` custom protocol for serving local files to the renderer, CDN header injection (Referer/Origin spoofing + CORS injection for AnimePahe HLS streams), auto-updater, MAL flush timer
- **`services/db.ts`** — SQLite via `node-sqlite3-wasm`; single lazy-initialized connection; schema created inline with `initSchema()`. DB file lives in Electron's `userData`. Tables: `anime`, `list_entry`, `local_episode`, `playback`, `library_folder`
- **`services/mal.ts`** — MAL OAuth 2.0 with PKCE (plain method); uses a shared public client ID; auth via in-app BrowserWindow; `flushDirty()` pushes `mal_dirty=1` entries every 30s
- **`services/anilist.ts`** — AniList GraphQL for search/metadata/trending
- **`services/animepahe.ts`** — AnimePahe scraping (search, episodes, kwik stream resolution); uses a hidden pre-warmed BrowserWindow to establish Cloudflare session cookies
- **`services/library.ts`** — scans registered folders for video files, matches them to anime by filename parsing
- **`services/legal-sites.ts`** — generates Crunchyroll/etc. links for a given anime
- **`services/store.ts`** — simple JSON file store (used for MAL OAuth tokens)

### Renderer (`src/`)

- **`src/store/useAppStore.ts`** — single Zustand store; holds MAL auth state, trending, continue-watching list, user library list, scan status
- **`src/App.tsx`** — top-level router; player routes (`/player/*`) and streaming routes (`/stream`, `/stream-player`) render full-screen without the sidebar/topbar shell
- Pages: `Home`, `Library`, `Search`, `ShowDetail`, `Player` (local), `StreamingPage` + `StreamPlayer` (AnimePahe HLS via hls.js), `Settings`, `ContinueWatching`

### Key design decisions

- **AniList ID is the primary key** everywhere (DB, store, IPC). MAL IDs are stored as secondary. Anime watched only via AnimePahe (no AniList match) get a negative synthetic ID.
- **Stub-then-resolve pattern**: when playback starts for an unknown anime, a stub row is immediately inserted so continue-watching works. A background task fires to resolve the real AniList entry and migrate the stub.
- **`mal_dirty` flag** on `list_entry` drives background sync — entries are flushed to MAL every 30 seconds.
- **CDN header injection** in `main.ts` (`onBeforeSendHeaders`/`onHeadersReceived`) is essential for AnimePahe HLS playback — the CDN validates Referer/Origin and the browser blocks cross-origin responses without the injected CORS headers.
- **Electron webRequest only supports ONE listener per event per session** — registering `onBeforeSendHeaders` or `onHeadersReceived` twice silently replaces the first. All header manipulation must live in a single merged handler (`registerWebRequestHandlers()` in `main.ts`).
- **AnimePahe Cloudflare bypass**: a hidden pre-warmed `BrowserWindow` solves the CF challenge. `net.fetch` with the session still gets 403 because CF validates `cf_clearance` against the exact browser fingerprint. The fix is `paheInPageFetch()` in `animepahe.ts` — it runs `fetch()` inside the hidden window via `executeJavaScript`, so CF sees a full browser fingerprint with all cookies. Used as fallback in `paheWindowFetch` and both `fetchPlayPage` paths.
- **`app.userAgentFallback`** strips `Electron/x.y` and `anitrack/x.y` tokens so Cloudflare doesn't fingerprint the Electron UA. Set at startup in `main.ts` before `app.whenReady`.
- **Provider detection in Home/ContinueWatching**: AnimePahe sessions are UUIDs (always contain dashes), so `includes("-")` cannot distinguish them from Anikoto slugs. Use a full UUID regex: `/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i`.
- **Shared match utilities**: `src/lib/match.ts` exports `scoreMatch` and `getSeasonNumber` — do not re-define them in page/component files.
- **Supabase dismiss sync**: `ContinueWatching.dismiss()` must call `deleteAnimeProgress(animeId)` so Supabase doesn't resurrect dismissed shows on next `pullAndMerge()`.

### Providers

- **`electron/services/providers/animepahe.ts`** — AnimePahe scraping. Key: `getPaheWindow()` waits for a non-CF-challenge title before marking session ready (checks `document.title` on `did-finish-load`). `paheInPageFetch()` executes fetch inside the hidden window for CF bypass.
- **`electron/services/providers/anikoto.ts`** — Anikoto scraping. Key: HTML tag-stripping regex must be `/<[^>]+>/g` (not `/<[^+]+/g`); in-flight dedup `.finally()` chains need `.catch(() => {})` to suppress unhandled rejections.
- Both providers are pre-warmed at startup (`pahePrewarm()`, `prewarmAnikoto()`).

### IPC modules

IPC handlers are split into `electron/ipc/` subfiles:
- `electron/ipc/pahe.ts` — AnimePahe IPC; exports `registerPaheIpc(registerWebRequestHandlers)`
- `electron/ipc/auth.ts` — MAL/AniList OAuth
- `electron/ipc/db.ts` — DB read/write operations
