# shonen.to downloads — 19 Oct 2026

The source already resolves an HLS stream and separate subtitle tracks. Downloads
were disabled by its desktop and Android capability flags, and Android also
marked the resolved media as non-downloadable. Both connectors now expose the
existing download queue and Android marks the resolved HLS media downloadable.

The existing queue resolves the selected episode immediately before downloading;
expiring proxy URLs are not saved as reusable episode identities. Its playlist
and caption URLs can end in `/api/proxy/m3u8?t=…` and `/api/proxy/vtt?t=…` rather
than file extensions. Both downloaders parse playlist contents, follow the chosen
rendition, save media locally and keep a subtitle file beside the episode.
No change to the common download transport or its retry policy was needed.

## Verification

- A live Cowboy Bebop episode 1 request returned a 1080p HLS rendition and English
  subtitle tracks. Teekyuu episode 1 (AniList 15125) returned 720p and English,
  Portuguese and Spanish captions.
- In an isolated desktop profile, Teekyuu episode 1 downloaded all 34 media
  segments with English captions: 22,488,228 bytes. Temporary proxy HTTP 502s
  recovered through the existing bounded retries. An earlier attempt failed
  before media was saved; the manual retry resolved a fresh stream.
- The native desktop player opened the saved episode through `anitrack-dl://`:
  duration 120.187 seconds, 1280-pixel video width, 52 decoded frames and advancing
  playback, with no media error. Audio output was not tested in the muted QA app.
- A downloader regression fixture covers an extensionless proxy master,
  rendition, segment and VTT caption, checking the local playlist and saved bytes.
  All 429 Node tests, typecheck and the desktop production build passed.
- Native Android unit tests and the debug APK build passed. On the tablet's
  separate debug app, the episode's Download button saved all 34 segments and a
  4,303-byte `subs.vtt`. Downloads showed the completed 21 MB episode as available
  offline. Its Play action opened the local playlist; video rendered with captions
  and playback advanced from 0:00 to 0:35 of 2:00. Playback was stopped afterward.

## Update: 20 Oct 2026 — same-origin streams and server choices

shonen.to now returns same-origin `/api/v1/shonen-media?u=…` links (playlists and
segments on shonen.to itself) with English subtitles burned into the video, so the
Primary stream lists no subtitle tracks. Some episodes add an "Anivexa fallback"
stream (`/api/v1/anivexa-media`) with its own English VTT tracks; whether it is
listed varies between requests. Primary streams sometimes fail or answer slowly
(Attack on Titan episode 13's playlist took 5 s, earlier failed), and some
episodes have no shonen.to stream at all (One Piece 1000, Naruto 100, Frieren 20,
Cowboy Bebop and Teekyuu return `SOURCE_NOT_FOUND`).

- Both apps list every stream as a server ("Sub · Primary", "Sub · Anivexa
  fallback", "Dub · Primary"). Desktop's player moves to the next server with the
  same audio when one fails; Android's default play checks each Sub stream's
  playlist (12 s limit) and uses the first that loads.
- shonen.to answers 403 to any request with an `Origin` header. A desktop
  `<track>` sends one, so the desktop player now fetches captions and gives the
  track a blob URL, as the site's own player does; Android sends only a Referer.
- The backup stream appears only after shonen.to's background lookup (about 12 s
  after an episode's first request), and `SOURCE_NOT_FOUND` can flip both ways for
  an hour or more. Server lists are therefore always fetched fresh (Retry shows a
  newly found backup); only playing a listed server reuses a list under a minute old.
- Without a Sub stream nothing is offered and the message says shonen.to may find
  one later. AniTrack never starts a dub on its own; Dub is a manual choice.
- Tablet (debug app): Sub · Primary plays with burned-in subtitles; a Sub-less
  episode shows the no-subtitled-stream error instead of playing Dub; the server
  panel's "could not load" note clears when the next episode's list loads.
- Verified on desktop: Attack on Titan episode 1 downloaded (154 segments,
  205,667,349 bytes); episode 25's fallback played with 423 English cues showing.
