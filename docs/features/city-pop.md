# City Pop expansion

The optional City Pop room searches Internet Archive for audio and video,
opens album track lists, and provides playback and downloads in both
applications. A separate YouTube section adds three curated stations (Night
Drive, Sunset Coast, and After Hours), favorites, and online song search.
City Pop has no menu entry of its own: it opens from a pink City Pop tab beside
Songs' Chart · Seasons · Search tabs (on phones, on the hint line under them).
Desktop serves it at `/songs/city-pop` (the old `/city-pop` redirects), and both
apps keep the Songs tab highlighted while it is open; Back returns to Songs. Both apps share one layout, wording and pink
accent: a banner (full with Enable while the pack is off, short once it is on),
then Music & Videos (Browse · Videos · Downloads) and YouTube Classics. Videos
defaults to YouTube search, with an Internet Archive source option; it waits for
a search, offering suggestions. Searching sends the entered song or artist
query to YouTube and preserves its result order, independently of the curated
starter catalog. Source changes retain the query and discard stale results.
Archive's video option searches the `movies` media type, excludes audio-only
entries, and offers Watch and Download. Its pagination resets on collection changes.
The starter catalog is shared at `packages/catalogs/city-pop.json`; Android
packages that same directory as an asset source. Kotlin data helpers mirror
`packages/shared/city-pop.ts` and `packages/shared/city-pop-archive.ts`.

## Retrowave pixel look

City Pop has its own retrowave pixel-art style in both apps: neon pink, cyan
and yellow on deep purple; square panels and buttons with hard shadows that
press down when tapped; scanlines over covers; and a pixel font for titles,
labels, buttons and tabs. Body text stays in the app font for readability.

- **Font:** `scripts/build-city-pop-font.py` (fontTools) builds the pixel font
  from its glyph table. It writes `apps/desktop/renderer/fonts/city-pop-pixel.woff`,
  `apps/android/app/src/main/res/font/city_pop_pixel.ttf` and
  `packages/shared/city-pop-pixel-font.ts` (base64, embedded in desktop's
  player window). Small letters map to the capitals. Rerun it after a glyph change.
- **Banner scene:** `packages/shared/city-pop-scene.ts` draws the sunset (sky,
  stars, striped sun, mountains, skyline, palm, grid) as rectangles on a grid
  of art pixels, using integer math only. `data/CityPopScene.kt` is its exact
  twin; `tests/city-pop-scene.test.mjs` and `CityPopSceneTest.kt` pin the same
  checksums. The station icons (`CITY_POP_ICONS` / `CityPopScene.ICONS`) are
  9 × 9 sprites. Desktop draws the scene on a canvas; Android draws it into a
  bitmap that is scaled up without smoothing (3 dp per art pixel).
- **Phones:** the tall full banner draws the scene in its bottom 300 dp under
  starry night sky, because the palm grows with the scene's height. On wide
  Android screens, Disable pack sits at the end of the pack tabs, clear of the
  floating music pill.

## Internet Archive research

Checked on 24 October 2026 using the public Advanced Search and Item Metadata
APIs. Searches for audio/movie items matching city pop terms returned more than
1,100 items during research; the production query returned 1,325 during desktop
testing. Search results include
user-uploaded albums, performances, mixes, and unrelated matches: this number
is not a count of unique songs or a guarantee of a complete city pop catalog.
Artist and song queries match all words within an item's title or creator, or
the complete phrase in its subject tags. This allows reordered titles without
matching unrelated film transcripts or combining words from unrelated fields.
Quotes, backslashes and source query syntax remain literal text.

| Sample | Observed delivery |
| --- | --- |
| [Tatsuro Yamashita — For You](https://archive.org/details/tatsuro-yamashita-for-you-bvcr-17018) | Public metadata included FLAC originals with MP3 derivatives. SPARKLE's MP3 was 6,152,644 bytes; both copies share original/track metadata. |
| [Miki Matsubara — Blue Eyes](https://archive.org/details/miki-blue-eyes) | Public metadata included original MP3 album tracks with numbered order and artist/title metadata. |
| [Mariya Takeuchi live](https://archive.org/details/mariya-takeuchi-live) | Public metadata included an MP4 original and a browser-oriented `.ia.mp4` derivative, both 49,538,281 bytes. |

The parser chooses one format per original file chain (MP3 preferred for audio,
`.ia.mp4` for video), preserves disc/track order when fully numbered, and falls
back to metadata file order otherwise. URLs are constructed under
`https://archive.org/download/`; metadata cannot supply an arbitrary media URL.
Restricted/dark/private items or files and unsafe paths are excluded. Search
pages contain at most 24 items; item metadata processing is bounded to 5,000
files and 500 playable tracks. Public metadata availability does not establish
uploader authorization or guarantee future file availability.

API reference: [Internet Archive Item Metadata read API](https://archive.org/developers/md-read.html).

## Media delivery and limitations

Internet Archive provides direct public audio/video file endpoints for native
playback and offline downloads. Audio may be listened to without a video.
Supported file extensions are MP3, M4A, OGG, FLAC, WAV, MP4, and WebM; actual
codec playback depends on the platform. Item search years come from uploaded
metadata and may describe a reissue rather than an original recording.

YouTube uses its own embedded player with its controls, attribution,
advertising, and availability restrictions intact. Online search reads public
video metadata from a bounded YouTube results page. It does not extract media
URLs, decode signatures, download tracks, or provide an audio-only stream.
Listening means playing the same visible YouTube video. YouTube may disable
embedding for a video or restrict it by region; the original watch link is
available as a fallback. A valid search result does not imply official-upload
status or that the song belongs to the city pop genre.

**YouTube download limitation:** these videos have no provider-supported offline
file endpoint in this integration. YouTube playback does not enter AniTrack's
download queues. The Archive section supplies the expansion's downloadable
audio/video catalog. Background playback for the YouTube player is not promised.

Search stores metadata favorites, not video files. Persisted results are
validated again when loaded. A search result for a curated video is that
curated track: favoriting it stores the catalog id, so each song is one
favorite. IPC accepts catalog IDs or strict `youtube-<videoId>` identifiers;
the page sends the validated metadata of saved search favorites with them, so
the player keeps their titles after a restart. The player page receives only
validated 11-character video IDs, as JSON data. Search parsing ignores Shorts, live streams,
and scheduled videos, deduplicates IDs, and returns at most 20 videos.
Public-page checks, unreadable pages and unrecognised result layouts show an
availability error rather than being presented as a successful search with no
matches.

Playing a card plays the visible list once, from that card round to the one
before it; stations and selections start at their first track. Each video plays
once (at most 100), and the queue stops at the end in both apps. Both players
use the YouTube IFrame API from an app-owned https origin (a desktop data: page
has none, and YouTube then skipped Mayonaka no Door): the title, artist and
"2 / 12" follow the playing video, with Previous and Next.

An album's Play album starts it from the first file and Listen from the chosen
one; Previous goes back up the album, and files already saved play offline.
Download all saves the album's remaining files. The listen player shows the
album's cover on a record with dark controls.

Archive downloads use a persistent queue and device-local files. Desktop checks
the received size before marking a file complete and serves saved media through
an app-owned local protocol. Archive gets 30 seconds to answer a download and
then a minute between chunks: a slow download that keeps moving finishes however
long it takes, and a stalled one stops with its own message (not as a cancel).
Partial files left by a quit or crash are removed at the next start, and a
failed index write never stops the queue. Android uses DownloadManager and opens
completed files directly in Media3. Both enforce a 2 GB per-file limit; Android
requires a known metadata size before enqueueing. Unsupported or oversized
downloads show an error instead of silently disabling downloads. Archive error
answers and non-JSON pages show as errors in both apps, never as "no items";
network and disk failures show plain messages. The enable toggle and YouTube
favorites are included in Android backups; downloaded media remains device-local.

City Pop belongs to Anime mode, under Songs; its player window allows
fullscreen and no other permission.

## Starter catalog research

Checked on 24 October 2026. All 12 starter videos returned title and channel
metadata through YouTube's public oEmbed endpoint. Artist, label, and distributor
uploads were preferred; no fan-uploaded compilation is included. Current
embeddability and regional availability can change independently of metadata.

| Song | Artist | Video/channel evidence |
| --- | --- | --- |
| Mayonaka no Door / Stay With Me | Miki Matsubara | [Pony Canyon lyric video](https://www.youtube.com/watch?v=nuU2YHtxMik), also [linked by the label](https://ponycanyon.us/news-cat/miki-matsubara/) |
| Plastic Love | Mariya Takeuchi | [Official artist video](https://www.youtube.com/watch?v=T_lC2O1oIew), [Warner product page](https://wmg.jp/mariya/discography/25074/) |
| SPARKLE | Tatsuro Yamashita | [Official artist video](https://www.youtube.com/watch?v=pqobRu9aR3M), [artist discography](https://www.tatsuro.co.jp/discography/) |
| 4:00 A.M. | Taeko Onuki | [Artist Topic audio](https://www.youtube.com/watch?v=_sOKkON_UnQ), [original album on artist site](https://onukitaeko.jp/en/project/mignonne/) |
| Windy Summer | ANRI | [Official artist video](https://www.youtube.com/watch?v=-8WTumwpvmg), [For Life album](https://www.forlife.co.jp/disco/flcf4243/) |
| Remember Summer Days | ANRI | [For Life-provided Topic audio](https://www.youtube.com/watch?v=3agC6do-624) |
| I Can't Stop the Loneliness | ANRI | [For Life-provided Topic audio](https://www.youtube.com/watch?v=Io57r9R0HcE), [For Life album](https://www.forlife.co.jp/disco/flcf4243/) |
| Midnight Pretenders | Tomoko Aran | [Warner Music Japan-provided Topic audio](https://www.youtube.com/watch?v=7pPb5fmumNo) |
| Machi No Dorufin | Kingo Hamada | [Warner Music Japan-provided Topic audio](https://www.youtube.com/watch?v=VDuDQNkSC6g) |
| Fly-day Chinatown | Yasuha | [Universal Music Japan lyric video](https://www.youtube.com/watch?v=g0p_jI6T2WQ) |
| LOVE TRIP | Takako Mamiya | [Universal-provided Topic audio](https://www.youtube.com/watch?v=M0HmUICJRZc), [Universal product page](https://www.universal-music.co.jp/p/upgy-6002/) |
| Last Summer Whisper | ANRI | [Official artist video](https://www.youtube.com/watch?v=uWqnsVMc8CQ) |

The catalog's year is the original recording's release year where confirmed by
artist/label metadata, rather than the current video upload or reissue year.
Unconfirmed years remain `null`. Station moods and brief listening notes are
AniTrack's curation, not claims from the rights holders. No lyrics are bundled.

## Validation

Desktop type checking and the production build passed. Electron was rebuilt
after the final Archive query refinement. The Node regression suite passed all 507
tests, including cancellation/removal during the final download save and an
immediate retry of the same file. The Android
unit suite reported 467 tests, zero failures/errors, and three existing skips;
the debug APK built successfully.

Runtime checks used an isolated desktop profile and the separate Android debug
app, without modifying the installed release apps or their accounts. On desktop:

- The optional room started disabled, enabled successfully, and searched Archive
  metadata and ordered album tracks.
- SPARKLE played as full audio, and the Mariya Takeuchi live sample decoded
  1920-pixel video with an advancing playback position.
- INTERLUDE B Part I downloaded completely (342,248 bytes) and played through
  the local-media protocol after restarting the app with web access blocked.
- The visible official Stay With Me YouTube embed played, and online search
  returned additional results.

The final debug APK was installed as an in-place upgrade of the separate debug
app on the Samsung tablet. Tablet checks confirmed:

- The disabled landing page, enable flow, Archive search, and native MP3 playback.
- A completed Miki Matsubara MP3 (7,431,869 bytes) remained available after the
  upgrade/restart and opened from Downloads in the native player using its local
  file URI. Device-wide connectivity was not changed for this check.
- The Mariya Takeuchi live MP4 played through Media3's native video decoder;
  successive screenshots showed advancing video frames.
- Disable and the global Music control remained separate after the layout fix.

Videos → YouTube was exercised with real song searches in both apps. Plastic
Love returned the official Mariya Takeuchi music video first, and Watch played
it in the visible YouTube embed with advancing playback and decoded video
frames. Miki Matsubara Stay With Me also returned performances and music videos.
These results came from YouTube's online search, independently of the starter
catalog; no genre suffix or local catalog filter was added to the entered query.

The Archive source option retained search text and its watch/download actions.
Its default genre query returned 415 video items. The refined Plastic Love
query returned 79 items with song-related results first; Miki Matsubara Stay
With Me returned 19 items with genuine performances first. Search counts and
ordering are observations, not fixed catalog guarantees. Archive pagination
reset on collection changes. The sunset icon was visually distinct from Songs
on desktop and tablet.
