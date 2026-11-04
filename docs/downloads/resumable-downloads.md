# Resumable downloads

Interrupted downloads continue from where they stopped, in both apps. The causes
covered are a dropped network, the app being closed or killed, the phone going
to sleep, and the source's CDN rate-limiting partway through.

Every wait has an end. A download that keeps stopping without saving anything
becomes `failed` with a message saying why, keeping its pieces so that asking
for it again continues from them (see [Final states](#final-states-stalls-and-caps)).

## How downloads behaved before (audit, 4 Nov 2026, v9.2.3)

### Desktop: anime (HLS), `apps/desktop/main/services/downloads.ts`

- The renderer queue (`apps/desktop/renderer/lib/downloads.ts`) resolves one
  episode just in time and hands the main process a signed playlist URL. The
  main process then downloads it with 2 workers.
- `download.plan` held a SHA-256 of every asset's **full URL**, query string
  included. `resumeAllowed` reused files only when the new plan's hash matched
  the old one exactly. Signed URLs (Anikoto tokens, Xanime's signed master,
  AnimePahe's kwik) change every time they are resolved. A Retry after an
  expiry therefore always started from zero, so the existing path only helped
  when the same URL was retried while it was still valid.
- Kept files were trusted when their size was above 0. Their contents were
  never checked.
- 429 was terminal: the request was never retried. Other retryable statuses
  (408, 5xx) were retried 3 times, with waits capped at 5 s. Network errors
  and timeouts failed the episode at once.
- If the app was closed, the next `list` turned the episode into
  `failed: "Download was interrupted. Retry to continue."`. Nothing resumed on
  its own, and a network that came back did not trigger anything either.
- The queue released the next episode only when the current one was done or
  had failed. A failed episode stayed failed until the user pressed Retry.

### Desktop: manga, `apps/desktop/main/services/manga/downloads.ts`

- Every run (including Retry) deleted the chapter folder and fetched every
  page again.
- Any page that failed (network error, timeout, 429) failed the whole chapter.
  There was no retry and Retry-After was ignored.
- After a restart, an unfinished chapter came back as
  `failed: "Download was interrupted. Download it again."`.

### Desktop: novels, `apps/desktop/main/services/novel/downloads.ts`

- Each chapter's text is its own file, so finished chapters were always kept.
- The waiting queue lived only in memory. Closing the app lost it, and the
  chapters that hadn't been saved were simply missing; nothing marked them as
  failed.
- A single 429, or three failures in a row, failed every waiting chapter
  ("Downloading stopped; try again later."). Nothing tried again on its own.

### Android: anime (HLS), `data/DownloadManager.kt` + `data/DownloadTransport.kt`

- Every attempt began with `folder(id).deleteRecursively()`. There was no plan
  or ledger, so a retry always started from zero.
- Pieces were fetched in chunks of 6 at a time. A retryable status (408, 425,
  429, 5xx) was retried up to 6 times with a linear wait of 1-8 s. Retry-After
  was ignored, and network exceptions failed the episode at once.
- The `resolve` lambda lived only in memory. After the process died, a
  restored episode without `index.m3u8` showed
  `FAILED: "Download was interrupted. Start it again from the episode list."`.
- Nothing watched the network. Doze (the phone sleeping) cuts the network, so
  the in-flight episode failed.
- Smart downloads deleted their failed episodes and queued them again from
  scratch.

### Android: manga, `data/manga/MangaDownloads.kt`

- Worked like desktop. The folder was deleted at the start of every run, one
  failed page failed the chapter, and an unfinished chapter came back as
  `FAILED` after a restart.

### Android: novels, `data/novel/NovelDownloads.kt`

- Worked like desktop. Saved chapters were kept, the queue lived only in
  memory, and a 429 or three failures stopped the whole title.

## The shared rules

These live in `packages/shared/download-resume.ts`, with a Kotlin twin in
`apps/android/.../data/DownloadResume.kt`. Both are tested against the same
cases in `tests/fixtures/download-resume.json`
(`tests/download-resume.test.mjs` and `DownloadResumeTest.kt`).

- **Rendition identity.** A hash (FNV-1a 64) over the chosen variant's
  attributes and, for every piece in order, its kind, its URL with the host and
  signing parameters removed (`token`, `expires`, `sig`, `X-Amz-*`, …), its
  `#EXTINF` duration exactly as written, and whether it is encrypted. A
  re-signed URL keeps the same identity. A different quality, server or encode
  gets a different one.
- **Ledger.** `download.ledger` is append-only. Its header line records the
  rendition identity and piece count. After that comes one line per finished
  piece, giving the file, its size and, for a key, a hash of its bytes. A line
  half-written when the process was killed is ignored.
- **Resume plan.** If the ledger has a different identity or version, the
  download restarts and every old numbered file is deleted, so pieces from two
  renditions never end up in one playlist. Otherwise a piece is kept only when
  the ledger recorded it, its size on disk matches, and its first bytes verify:
  - a plain segment needs the TS sync byte in every leading 188-byte packet,
    or an fMP4 box, or an ID3 tag;
  - an encrypted segment must be a multiple of 16 bytes, not an error page,
    and its first bytes must not all be zero (a power cut can keep a file's
    rename and size but lose its data, which then reads back as zeros; the same
    check applies to pieces no signature describes);
  - an init segment needs an fMP4 box;
  - a manga page needs an image signature, and on Android the image must also
    decode.

  Keys are always fetched again. A key whose bytes differ from the recorded
  hash means a different rendition, so the download restarts. Fetching
  continues from the first missing piece, in plan order.
- **Failures.** Only a request that got no answer at all (no route, refused,
  reset, DNS, TLS, a timeout) counts as the network. A source's refusal, an
  error page, a bad image, a page or caption that fails to decode, an unsafe
  address, a bug, or a local storage error (disk full, no permission) is never
  retried as though it were the network: it fails at once, with its own message.
  - No answer is retried 4 times with backoff. Then, **only if the device is
    offline**, the download pauses until the network is back (`network`). If
    the device is online, the server isn't answering: the download pauses for
    a minute as a `server` stall instead (see below), and the app never shows
    "Waiting for the network" while it has one.
  - 429 and 503 wait for Retry-After or for backoff, retried up to 8 times. On
    desktop both workers wait together. A Retry-After over 10 min pauses at once
    until then (at most 6 h). After 8 attempts the download pauses for at least
    5 min.
  - Retry-After is delta seconds (more than nine digits count as 999999999)
    or an HTTP-date in one grammar for both apps: IMF-fixdate
    (`Sun, 06 Nov 1994 08:49:37 GMT`), RFC 850 (`Sunday, 06-Nov-94 08:49:37 GMT`,
    the two-digit year read as the nearest one not over 50 years ahead) or
    asctime (`Sun Nov  6 08:49:37 1994`), GMT only, names in any case. Anything
    else (ISO 8601, a numeric zone, 31 November) is ignored, so backoff applies.
  - 408, 425 and other 5xx responses are retried 6 times with backoff, then
    the download pauses for 5 min.
  - 401, 403 and 410 re-resolve the stream (or, for manga, the page list), at
    most 2 times without progress. A 404 re-resolves once. Novels have nothing
    to re-resolve, so these fail the chapter.
  - Any other 4xx, an HTTP 200 error page, or a source verification check
    fails as before.
  - Backoff is 1 s × 2^attempt, capped at 60 s.
  - Rate-sensitive (`conservativeNetwork`) streams, such as AniChan's, are
    still never retried at once. They pause instead: at least 30 s, doubling
    with each stall in a row, up to 10 min.
- **Captions** are best-effort again: two retries at most, each no more than
  30 s away (30 s for a rate-sensitive stream), and never a pause for the server
  or a fresh stream. Then the episode finishes without them (a dead, refusing,
  5xx or 429 caption host, or a 404). Only when the device is offline does the
  episode wait for the network (keeping every segment) to fetch them after.
- **Re-resolving.** Every resumed run resolves the stream again: after a
  restart, a pause or an auth failure. Within a run, the stream is resolved
  again before a URL's own expiry parameter (`expires`, `exp`, `e`,
  `X-Amz-Date` with `X-Amz-Expires`, Akamai `hdnts`/`hdnea`) is less than 60 s
  away, or once it was resolved more than 6 h ago. Xanime's signed master lasts
  about a day, and Anikoto's tokens less.

## Final states: stalls and caps

`afterStop` in the shared rules decides, each time a run stops with its files
kept, whether to wait and try again or to give up.

- **A stall** is a run that stopped (paused or re-resolved) without saving a
  media piece: a segment, an init segment, a page or a novel chapter. Keys don't
  count (they are fetched again every run), nor does a run that discarded what
  an earlier run saved (another rendition, a key that changed), so neither can
  keep a download alive forever. Saving a piece ends the streak.
- **Waiting for the network while offline never counts**, however long it lasts.
- **A rate limit** keeps waiting until about an hour after the streak began, or
  12 stalls in a row, whichever comes first. Even a six-hour Retry-After is tried
  once more before giving up.
- **Anything else** (5xx, no answer while online, a stream that keeps expiring)
  gives up at the third stall in a row. With the retries and pauses, that is
  about 13 minutes for a 5xx, and 3 minutes for a host that refuses
  connections (longer when each request has to time out first).
- The download then becomes `failed` with a message from the shared rules, the
  same in both apps, for example "The server kept failing on part of this
  episode. Try another server." or "The source kept asking to wait. Try again
  later." Its pieces stay: asking for it again starts a fresh streak and
  continues from them.
- Desktop carries the streak in the episode's resume hint (`reResolves`,
  `stalledSince`), Android in the episode's `meta.json` with any pause still to
  wait out, so a restart neither resets nor revives it. On Android a failure is
  recorded in `meta.json` too, and stays failed after a restart (as on desktop)
  until it is asked for again.

### Who waits for what

- An episode that has to wait releases the queue at once and waits on its own:
  a timed pause, the network, or (Android) the app.
- A rate limit holds only the episodes of the provider whose CDN asked to wait;
  other providers carry on. A 5xx pause holds nothing but its own episode.
  Removing the rate-limited episode, or asking for it again, lifts its hold.
- Asking again for a paused episode starts it now. Removing one ends its wait.
- Manga chapters and novel chapters keep one worker each. A chapter waiting out
  a rate limit holds the chapters behind it (normally from the same source),
  but removing or cancelling it ends the wait within a couple of seconds, and
  the stall caps bound it.
- On Android, an AnimePahe, AniChan or Miruro episode that can't be resolved
  without the app (the background job's fresh process, or the app in the
  background) waits as "Waiting for the app" and continues when the app is
  opened (`Downloads.resumeWaiting()` from `MainActivity`).
- On Android, `DownloadResumeWorker` keeps the process (and its wakelock) only
  while something is downloading. A download in a timed pause doesn't count: the
  worker ends and asks for its next pass at the earliest wake. A network wait
  relies on the job's network constraint, and a wait for the app on the next
  app start.

## What resumes automatically

| Situation | Desktop | Android |
|---|---|---|
| Network drops | Episodes pause, keep their pieces and resume on the renderer's `online` event, re-checked every 60 s. Manga and novels wait in the main process (`net.isOnline()` every 15 s) | Every kind waits for a `ConnectivityManager` callback (`NetworkWatch`). If the process dies, a WorkManager job (network required) takes over |
| A host doesn't answer while online | A `server` stall: a minute's pause, then it fails after three in a row | Same |
| App closed or killed | Unfinished episodes with a ledger, unfinished chapters, and chapters listed in `pending.json` are queued again at the next start. Episodes are re-resolved first | Same at the next start. `DownloadResumeWorker` also resumes them without the app being opened |
| Phone sleeps | Not applicable | Doze cuts the network, which takes the network path above; WorkManager runs in Doze's maintenance windows |
| CDN rate-limits | Waits out Retry-After within the run. A long wait pauses the episode and holds that provider's other episodes until then; other providers carry on | Same, outside the queue lock |
| Signed URL expires | The run stops before the expiry (or after 401/403/410) and keeps its pieces. The queue re-resolves the stream and starts it again | Same, within the job, through the persisted provider and resume key |

Subtitles (`subs.vtt`) are saved best-effort after the video (see Captions
above), in both apps the same way. Manga pages keep their `001.ext` names and
reading order. Novel chapters keep their order, and `pending.json` holds the
waiting chapters in reading order; it is written before a chapter shows as
settled, so it is never stale.

## Limits

- Downloads started before this version have no ledger. Their first resume
  starts from zero once (desktop's old `download.plan` is removed), and every
  resume after that keeps pieces.
- A CDN that puts its token in the URL **path**, rather than the query string,
  gets a new rendition identity each time it is resolved. Such a download
  restarts instead of resuming. That is safe, but it doesn't save time.
- On Android, AnimePahe, Miruro and AniChan need the app's Activity to
  resolve a stream (`attach(this)` in `MainActivity`). The background worker
  can't resolve them, so their episodes wait as "Waiting for the app" (keeping
  their pieces) and continue when the app is opened. Anikoto, which Smart
  downloads already resolves in the background, needs no Activity.
- Smart downloads' failed episodes and chapters are tried again by the next
  pass, keeping their pieces, while they are still wanted. One goes, with its
  pieces, once it is watched or read, its show or series leaves the three-week
  window, or the plan no longer wants it.
- Pieces aren't fsynced before their ledger line. A power cut can still leave a
  piece whose first bytes survived but whose tail didn't; only a zero-filled
  head is caught. Syncing every segment would slow Windows downloads noticeably.
- Android records each episode's origin (provider, resume key, variant) when
  it is first resolved, capturing it through `OriginCapture` in
  `ProviderEpisode.resolve`. Episodes left unfinished by an older version
  have neither an origin nor a ledger. As before, they have to be started
  again by hand, and they start from zero once.
