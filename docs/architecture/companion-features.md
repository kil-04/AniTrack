# Companion features (Oct 2026)

Features that connect what you watch to what you read and listen to, on both
apps unless noted.

## Continue the story (anime → manga)

An anime page shows the book it comes from and where you are in it.

- AniList relations are fetched once per anime with both labels: v1
  `relationType` (Watch Order / Related keep using it) and
  `relationType(version: 2)`, which marks the adapted material `SOURCE` (v1
  calls it `ADAPTATION`, the same as manga made *from* the anime).
- The anime's `source` decides what the books are:
  - `MANGA` / `COMIC` / `DOUJINSHI` → the source manga (SOURCE edges first, then
    ADAPTATION, then ALTERNATIVE; the most popular wins, so One Piece beats its
    one-shots).
  - `LIGHT_NOVEL` / `NOVEL` / `WEB_NOVEL` → the novel, plus its most popular
    manga version to read (Re:Zero's arc manga are ALTERNATIVE edges).
  - Anything else (original, game…) → its manga retelling, if any.
  - Everything else in print (spin-offs, side stories) is listed as **More in
    print** (15 at most, most popular first).
- Android: `data/StoryBridge.kt` (`StorySection` / `MoreInPrintSection` in
  `ui/DetailStory.kt`); the card shows "You're on chapter N" from the reading
  history and opens the manga page. Manga pages show **Watch the anime**
  (`AdaptationsSection`, with the last episode watched).
- Desktop: `packages/shared/story-bridge.ts`, `components/StoryCard.tsx`,
  IPC `anilist:story`. Desktop's Related row no longer lists manga as anime.

## Theme songs (AnimeThemes.moe)

Openings and endings from AnimeThemes' public API, matched by AniList id
(`/anime?filter[site]=AniList&filter[external_id]=…`, up to 25 shows per
request; the API allows 90 requests a minute, so answers are cached: Android 3
days on disk, desktop 6 hours in memory). Each theme keeps its first entry and a
creditless video (`nc`, no overlap, no lyrics/subs, ≤1080p) plus that video's
audio (`.ogg`). Only `a.animethemes.moe` / `v.animethemes.moe` HTTPS media is
played.

- **Theme songs** section on anime pages: play/pause per song, Play all, and the
  creditless video full screen (hidden for NSFW entries).
- A now-playing bar (bottom-left) follows you across pages: previous, play/pause,
  next, stop; tapping it opens the show.
- **Theme radio** (Continue Watching header on Home): up to four songs per show
  from Continue Watching and your Completed / Watching lists, shuffled so the
  same show never plays twice in a row when another can play.
- Theme songs and episodes never play together: starting one pauses the other.
- Android: `data/AnimeThemes.kt`, `data/ThemePlayer.kt` (own ExoPlayer, music
  audio focus), `data/ThemeRadio.kt`, `ui/DetailThemes.kt`.
- Desktop: `packages/shared/anime-themes.ts`, `main/services/animethemes.ts`
  (IPC `themes:for-anime`, `themes:radio`), `store/useThemePlayer.ts`,
  `components/ThemeSongs.tsx`.

## Smart downloads (Android)

Settings → **Smart downloads** keeps the next 1–3 episodes of recent shows
(Continue Watching, last 3 weeks, up to 4 shows) downloaded, and optionally the
next 5/10/20 chapters of manga you're reading (up to 4).

- Episodes come from **Anikoto** only: it resolves without a browser check.
  AnimePahe may need its interactive Cloudflare page, which a background job
  must never trigger.
- Runs when the app opens (at most every 20 min), when you leave the player
  (2 min), and every 4 hours via WorkManager (unmetered network when **Wi-Fi
  only** is on, battery and storage not low). A background run waits up to
  8 minutes for its downloads. Pauses below 1.5 GB free.
- **Delete after watching** removes only the downloads smart downloads made, once
  watched (≥85%) or read. Failed ones are dropped quietly and retried next run.
- Turning it on waits 15 s before the first run so the counts can be set.
- `data/SmartDownloads.kt` (`SmartPlan` is the tested planner), `ui/SmartDownloadsCard.kt`;
  preferences `smart_dl_*` in `anitrack_next`.

## Time Machine (both apps)

Year steppers, Random year, all decades, a **passport** of visited years
(Android `time_machine_visited` preference, desktop `anitrack.timeMachine.visited`),
seasons and Top rated / Most popular, format counts, the year's busiest studios,
genre signal, "More from YEAR" paging, **From your history** (your list and
Continue Watching, grouped by year) and **On this day** (AniList
`startDate_like: "%MMDD"`, each card's year jumps there).
