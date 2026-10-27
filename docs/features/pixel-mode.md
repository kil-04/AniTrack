# Pixel mode

An optional look for the whole app, in both apps: City Pop's retrowave pixel art
everywhere. Turn it on in **Settings → Appearance**; it is saved per device
(desktop `localStorage` `anitrack.skin` / `anitrack.skin.palette`, Android prefs
`pixel_mode` / `pixel_palette_blue` in `anitrack_next`) and is applied before the
first frame (desktop `main.tsx`, Android `MainActivity.onCreate`).

## What changes

- **Colours:** Neon (night-purple surfaces, hot pink accent; violet in manga
  mode, sunset orange for desktop novels) or **AniTrack blue**, an uncertain
  future: a cold near-black navy, cyan neon with a red glitch edge (gradients
  band cyan → blue → red, hard shadows are red).
- **Blue's glitch:** headings split into cyan and red copies; the banner's
  scene is recoloured by a cold haze (`mix-blend-mode: color` on desktop,
  `BlendMode.Color` on Android), a bright bar rolls down it every 6 s, and the
  banner title jumps briefly every 7 s (off under `prefers-reduced-motion` on
  desktop).
- **Shapes:** square corners. Desktop squares every element (`index.css`)
  except those marked `pixel-round`, things round in themselves (the Songs
  record), which stay round as on Android;
  Android screens draw corners with `aniShape()` (`ui/AniTheme.kt`), which in
  Pixel mode returns `PixelCornerShape`, a single notched pixel per corner.
  Use `aniShape()` instead of `RoundedCornerShape` in new Android UI.
- **Type:** the AniTrack Pixel font (`scripts/build-city-pop-font.py`) for
  headings, row titles, labels, buttons, chips and the wordmark. Desktop sizes
  it by cap height (`font-size-adjust: cap-height 0.7`) so text keeps its room;
  Android's `PixelTypography` swaps display, headline, `titleLarge` and
  `labelLarge`. Card titles and body text stay in the normal font.
- **Shadows:** hard offset shadows instead of glows; gradients banded into three steps.
- **Home:** the hero's trending art is pixelated (Android decodes it at 4 dp
  cells and scales it up unfiltered via `PosterImage(pixelCell = 4.dp)`; desktop
  uses the `#pixelate-8` SVG filter from `PixelFilters`) under a CRT screen.
  Covers in rows stay sharp. Home ends on a footer of sprites ("Save point").
- **Banners:** every page header (`PageHeader` on desktop, `ScreenHeader` on
  Android, plus Settings) becomes a pixel-art banner under scanlines, with the
  page's icon, title and subtitle. Actions move under the banner.
- **Time Machine and Songs:** their own heroes keep their layout. The Time
  Machine shows the scene for the year on the dial (`pixelSceneForYear` /
  `PixelScenes.forYear`, the table below) instead of the year's art, its year in
  the pixel font and sprites on its rows. The Songs jukebox sets each chart in
  its own scene (`pixelSongScene` / `PixelScenes.forSongs`: the jukebox for all
  time, then one per decade, the table below) with a cassette sprite.
- **Interludes:** wide scene banners between Home's rows that open other parts
  of the app (`PixelInterlude` in both apps), each showing its page's scene: the
  station → Schedule, the jukebox → Songs, starlight → the Time Machine; the
  bookshop → My Manga / My Novels on the reading homes.
- **Sprites:** 16-wide pictures in `packages/catalogs/pixel-sprites.json` (one
  file: desktop imports it through `packages/shared/pixel-sprites.ts`, Android
  reads it as an asset through `data/PixelSprites.kt`). Row headers show the
  row's sprite (the file's `sections` map, by title or by a prefix ending in
  " *", e.g. "new in *" for the Time Machine's "New in 1988": Continue Watching →
  TV, Trending → flame, Top 10 → trophy...), Android falling back to a stair-step
  sprite; empty states show a bobbing sprite chosen by their icon (`ICON_SPRITES`
  in `components/PixelSprite.tsx`, `pixelSpriteForIcon` in `ui/PixelAmbient.kt`).
  Sprites are drafted with auto-outlines and previewed before they go in the
  file; `pixelSpriteRects` / `PixelScenes.spriteRects` turn rows into runs.

## Animated background

Behind the pages (Settings → Appearance → Animated background, on by default):
twinkling stars, a skyline strip (`pixelSkyline`, two frames whose windows and
rooftop beacons differ) along the bottom, a cat walking the street, a shooting
star now and then and, in the blue palette, rain. It holds still while the
player is open (desktop) or the player or a reader is in front (Android), under
reduced motion (desktop) or with Android's animations removed.

- **Desktop** (`components/PixelAmbient.tsx`, `index.css` `.pixel-ambient`): CSS
  animations of `transform` and `opacity` only, in `steps()`, which the
  compositor runs; measured on the QA copy, Home used as much CPU with Pixel mode
  on as off. The blue palette's rolling bars are `.pixel-roll` elements moved by
  `transform`, not `background-position` (which repaints every frame).
- **Android** (`ui/PixelAmbient.kt`): one clock, `PixelTime.tick` (tenths of a
  second), ticks every 150 ms while something moves (blue rain and rolling bars,
  the cat crossing, a shooting star) and every 700 ms otherwise. Everything reads
  it while drawing or placing a layer, never while composing, and each moving
  part has its own `graphicsLayer`, so a tick redraws only that part; the stars
  and rain are small bitmaps drawn once. Do not add `rememberInfiniteTransition`
  or a separate timer to Pixel mode: the first version did, and an idle Home
  rendered 60 frames a second at about 137% CPU on the tablet (now about 8 frames
  a second at most).

## Scenes

`packages/shared/pixel-scenes.ts` draws twenty-three seeded, whole-number
scenes; the Kotlin twin `data/PixelScenes.kt` mirrors it line for line, and
`tests/pixel-scenes.test.mjs` and `PixelScenesTest.kt` pin the same checksums.
Every page has its own picture: no page banner reuses one of the Time Machine's
decade scenes, and Songs has its own scene for all time and for each decade.

| Scene | Picture | Where |
|---|---|---|
| `shinkansen` | A bullet train on a sea bridge at sunset | Time Machine: the 1960s |
| `fuji` | Mount Fuji at dawn over a lake, a torii in the water | Time Machine: the 1970s |
| `sunset` | City Pop's sunset (`city-pop-scene.ts`) | Time Machine: the 1980s; City Pop's own hero |
| `arcade` | A game centre: a neon GAME sign, glowing cabinets | Time Machine: the 1990s |
| `neon-city` | A city at night in the rain, neon signs on the wet street | Time Machine: the 2000s |
| `ramen-stand` | A ramen stall at night: power lines, a vending machine, lanterns | Time Machine: the 2010s |
| `starlight` | Nebulae, a ringed planet, a shooting star | Time Machine: 2020 on; Home's Time Machine interlude |
| `jukebox` | A jukebox glowing in a diner: its rainbow arch and buttons, notes rising | Songs: all time; Home's Songs interlude |
| `radio` | A valve radio on a chest of drawers, the evening sun through the window | Songs: the 1960s |
| `hifi` | A turntable between wooden speakers, a lava lamp, a crate of records | Songs: the 1970s |
| `night-drive` | A night drive: a cassette in the deck, the highway's lamps running to the city | Songs: the 1980s |
| `karaoke` | A karaoke box: lyrics lighting up on screen, a disco ball, two microphones | Songs: the 1990s |
| `rooftop-band` | An after-school band on the school roof at sunset, the water tank above | Songs: the 2000s |
| `stage` | A concert stage: spotlights, an equalizer, the band, light sticks | Songs: the 2010s |
| `hologram` | A virtual singer live as a hologram, floating screens, light sticks | Songs: 2020 on |
| `bedroom` | A bedroom at night: an episode on the CRT, a cabinet of tapes | Downloads (anime, manga, novels) |
| `cinema` | A little cinema: the projector's beam, an episode on screen | Continue Watching |
| `tower` | A broadcast tower over the town, its waves going out | Latest Episodes, Manga Updates |
| `observatory` | An observatory on a hill under the Milky Way | Search (anime, manga, novels) |
| `station` | A station: the departure board, the clock, the yellow line | Schedule; Home's Schedule interlude |
| `terminal` | A desk at night: a beige computer's green prompt, a lamp | Settings |
| `sakura` | A cherry tree in bloom under a full moon | My List; the Appearance preview |
| `library` | A bookshop at night, a lamp and a cat | My Manga, My Novels; the reading homes' interludes |

Keep a scene's interesting parts right of about a third of its width: the
banner shades its left side under the title. Songs' header also runs its text
across the middle, so its scenes put their subject further right (the hologram
singer stands at 68%). After changing a scene, update the checksums on both
sides together.
