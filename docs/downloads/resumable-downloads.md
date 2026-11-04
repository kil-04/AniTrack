# Resumable downloads

Interrupted downloads continue from where they stopped, in both apps. The causes
covered are a dropped network, the app being closed or killed, the phone going
to sleep, and the source's CDN rate-limiting partway through.

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
  - an encrypted segment must be a multiple of 16 bytes and not an error page;
  - an init segment needs an fMP4 box;
  - a manga page needs an image signature, and on Android the image must also
    decode.

  Keys are always fetched again. A key whose bytes differ from the recorded
  hash means a different rendition, so the download restarts. Fetching
  continues from the first missing piece, in plan order.
- **Failures.**
  - A network error, reset or timeout is retried 4 times with backoff. After
    that the download pauses until the network is back.
  - 429 and 503 wait for Retry-After (seconds or an HTTP date) or for backoff,
    retried up to 8 times. On desktop both workers wait together. A
    Retry-After over 10 min pauses at once until then (at most 6 h). After 8
    attempts the download pauses for at least 5 min.
  - 408, 425 and other 5xx responses are retried 6 times with backoff, then
    the download pauses for 5 min.
  - 401, 403 and 410 re-resolve the stream (or, for manga, the page list), at
    most 2 times without progress. A 404 re-resolves once. Novels have nothing
    to re-resolve, so these fail the chapter.
  - Any other 4xx, an HTTP 200 error page, or a source verification check
    fails as before.
  - Backoff is 1 s × 2^attempt, capped at 60 s.
  - Rate-sensitive (`conservativeNetwork`) streams, such as AniChan's, are
    still never retried at once. They pause for at least 30 s instead.
- **Re-resolving.** Every resumed run resolves the stream again: after a
  restart, a pause or an auth failure. Within a run, the stream is resolved
  again before a URL's own expiry parameter (`expires`, `exp`, `e`,
  `X-Amz-Date` with `X-Amz-Expires`, Akamai `hdnts`/`hdnea`) is less than 60 s
  away, or once it was resolved more than 6 h ago. Xanime's signed master lasts
  about a day, and Anikoto's tokens less.

## What resumes automatically

| Situation | Desktop | Android |
|---|---|---|
| Network drops | Episodes pause, keep their pieces and resume on the renderer's `online` event, re-checked every 60 s. Manga and novels wait in the main process (`net.isOnline()` every 15 s) | Every kind waits for a `ConnectivityManager` callback (`NetworkWatch`). If the process dies, a WorkManager job (network required) takes over |
| App closed or killed | Unfinished episodes with a ledger, unfinished chapters, and chapters listed in `pending.json` are queued again at the next start. Episodes are re-resolved first | Same at the next start. `DownloadResumeWorker` also resumes them without the app being opened |
| Phone sleeps | Not applicable | Doze cuts the network, which takes the network path above; WorkManager runs in Doze's maintenance windows |
| CDN rate-limits | Waits out Retry-After within the run. A long wait pauses the episode, and the queue holds the next episode until then | Same; the episode queue waits with it |
| Signed URL expires | The run stops before the expiry (or after 401/403/410) and keeps its pieces. The queue re-resolves the stream and starts it again | Same, within the job, through the persisted provider and resume key |

Subtitles (`subs.vtt`) are still saved best-effort after the video, as before.
On desktop, a run interrupted while fetching them resumes instead of finishing
without them. Manga pages keep their `001.ext` names and reading order. Novel
chapters keep their order, and `pending.json` holds the waiting chapters in
reading order.

## Limits

- Downloads started before this version have no ledger. Their first resume
  starts from zero once (desktop's old `download.plan` is removed), and every
  resume after that keeps pieces.
- A CDN that puts its token in the URL **path**, rather than the query string,
  gets a new rendition identity each time it is resolved. Such a download
  restarts instead of resuming. That is safe, but it doesn't save time.
- On Android, AnimePahe, Miruro and AniChan need the app's Activity to
  resolve a stream (`attach(this)` in `MainActivity`). The background worker
  can't resolve them, so their episodes fail there with a message and keep
  their pieces. Starting the episode again, or the next app start, continues
  from those pieces. Anikoto, which Smart downloads already resolves in the
  background, needs no Activity.
- Android records each episode's origin (provider, resume key, variant) when
  it is first resolved, capturing it through `OriginCapture` in
  `ProviderEpisode.resolve`. Episodes left unfinished by an older version
  have neither an origin nor a ledger. As before, they have to be started
  again by hand, and they start from zero once.
