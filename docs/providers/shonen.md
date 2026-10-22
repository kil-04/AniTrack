# shonen.to

Newest first. Downloads: see `shonen-downloads.md`.

## 23 Oct 2026 — streams moved to anigato.lol

**Symptom.** In 9.1.6, shonen.to episodes didn't start on desktop: the player waited
about 38 s, then reported a manifest load error. The health monitor (GitHub issue #3)
had flagged shonen.to on 21 Oct, but that "search HTTP 403" was the site refusing
GitHub's runners; search works from home connections.

**Cause.** `/sources/shonen` now returns two HLS links, both labelled "Primary":

- `https://anigato.lol/api/stream/proxy?url=…`: the master and rendition playlists
  answer only with `Referer: https://shonen.to/` (otherwise 403 "A browser is required
  to play this stream."). An `Origin` header is accepted. Segments are on
  `p16/p19-ad-site-sign-sg.tiktokcdn.com`, served as `image/png`: a ~70-byte PNG,
  then MPEG-TS (first sync run at byte ~252). They need no Referer. hls.js and
  ExoPlayer both find the TS and play it.
- `https://stream.shonen.to/media/…`: resolves (91.188.254.229) but never connects
  from this connection (TCP timeout), so it may be down or blocked.

The desktop app sent no Referer, and the shared label made the second stream
impossible to choose. Android already sent the Referer, but its stream check could
only reach shonen.to's own host, so it never saw anigato.lol answer.

**Fix.**

- Both apps send shonen.to's Referer for its streams, and the playlists are authorized
  under `/api/stream/`.
- Before listing servers, both apps try each stream's master playlist (3 s on desktop,
  4 s on Android) and put the ones that answer first, so a dead link doesn't hold up
  playback.
- A repeated label gets a number ("Primary", "Primary 2") in `parseShonenStreams` and
  `Shonen.streams`, with a test on each side.

**Verified.** Cowboy Bebop played on desktop (1448×1080 H.264, frames advancing)
and on the tablet's debug app ("Sub · Primary", subtitles, segments loading in
0.1–0.4 s).
