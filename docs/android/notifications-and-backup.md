# Notifications and backup (native Android)

## New-episode and new-chapter notifications

Settings → **Notifications** has two switches; both are off by default. Turning
one on asks for Android's notification permission (Android 13+). If it's refused,
the card offers **Allow notifications** (the prompt once more, then Android's
settings page). **Check now** runs a pass at once and says what it found.

`data/ReleaseAlerts.kt` schedules `ReleaseAlertsWorker`: periodic WorkManager
work, every 2 hours (30 min flex), network required. It is cancelled when both
switches are off.

- **Episodes**: shows on My List as Watching or Plan to watch, plus Continue
  Watching (up to 150). One AniList `airingSchedules(mediaId_in, airingAt_greater,
  airingAt_lesser)` query per 50 shows covers everything since the last check
  (`alerts_airing_check`, epoch seconds). The very first check looks back 24 h.
  There is one notification per show; several episodes since the last check share it
  ("Episodes 4–5 are out").
- **Chapters**: manga in Continue Reading or the manga list (Reading / Plan to
  read), up to 40, on the source each reads from: the picked source, else a saved
  match. Titles never matched on a source are skipped ("open them once to link a
  source"); there is no searching in the background. The newest chapter seen
  is kept per title (`alerts_chapter_<id>`). The first sighting only records it, and
  a higher number later notifies.
- Tapping a notification opens the title's page: the intent carries
  `anitrack_route` = `anime/<id>` or `manga/<id>` (validated), which
  `MainActivity` hands to `AppShell` through `ReleaseAlerts.pendingRoute`.
- Channels: "New episodes" (`new_episodes`), "New chapters" (`new_chapters`).

## Backup and restore

Settings → **Backup & restore** writes and reads a JSON file through Android's
document picker (`data/Backup.kt`):

```json
{ "format": "anitrack-backup", "version": 1, "exportedAt": 0, "app": "8.0.0",
  "tables": { "playback": [], "list_entry": [], "reading": [], "manga_list": [] },
  "prefs": { "reader_mode": { "type": "string", "value": "Auto" } } }
```

- Tables are exported row by row (`Db.exportTables`). Restoring merges
  (`Db.importTables`). A row is taken when its primary key is missing here, or its
  `updated_at` is later than ours, so an old backup never rolls progress back. Unknown
  columns are ignored.
- Settings: only plain preferences are carried. These are `autoplay`, `auto_next`,
  `auto_skip`, `home_mode`, and keys starting with `reader_`, `cap_`, `manga_source_`,
  `manga_group_`, `mangadot_match_` and `mangaball_match_` (`Backup.isBackedUpPref`,
  covered by `BackupTest`).
- Never included: MyAnimeList and GitHub sign-ins, the MAL outbox, notification
  state, search history.
- Files over 64 MB, other formats, and newer backup versions are refused with a message.

## Smaller preferences (all in `anitrack_next`)

| Key | Where | Default |
| --- | --- | --- |
| `auto_skip` | Player settings: skip intro and outro once per stream when the provider marks them | off |
| `reader_volume_keys` | Reader settings: volume down / up turn pages | off |
| `reader_spread` | Reader settings, page modes: `Auto` (two pages side by side when the screen is wider than tall), `Single`, `Double` | `Auto` |
| `reader_spread_shift` | Pair from the first page instead of showing the cover alone (`MangaSpreads`) | off |
| `search_history_anime`, `search_history_manga` | Last 8 searches that led to a result or "View all" | — |

## Player and list behaviour worth knowing

- **Up next**: with auto-next on, a card appears in the last 15 s of an episode, or
  once the provider's ending (outro) starts. **Play now** goes on at once. ✕ cancels
  auto-next for that episode.
- **Sleep timer** (player settings, not saved): end of episode (stops there instead of
  auto-next, and hides the up-next card) or 15 / 30 / 45 / 60 minutes (pauses).
- **Two-page reading**: wide pages (joined spreads) always stand alone. For sources
  that don't report page sizes (MangaBall), shapes are learned as pages load and
  from the prefetch a few pages ahead. A pair splits in place without moving the
  pager.
- **Mark watched / read**: long-press an episode or chapter row. "This and earlier"
  marks everything up to it. Marked rows are timestamped older than a later real
  watch or read (`Db.markEpisodesWatched`, `Db.markChaptersRead`), so Continue
  Watching and Reading keep pointing at what you actually played last.
- **Continue Watching**: an episode at 85% or more counts as finished. Its card offers
  the next episode once one is out ("Up next · Episode N"), and resuming starts it
  (`prepareResume`).
