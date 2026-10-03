# Comix manga (native Android)

Comix is implemented for the native Android manga-source registry introduced by
Claude, but is **not currently registered**: the user chose other sources (since
2026-10-03, MangaDot only; see `manga-sources.md`). MangaDot mirrors Comix's
catalogue through a plain JSON API.
Add `ComixSource` to `MangaSources.all` to offer it again. No desktop manga mode,
retired Capacitor implementation, release or remote executable update is added.

## Public website flow inspected on 2026-10-02

- Homepage: <https://comix.to/>
- Search: `/browse?q=...&sort=relevance%3Adesc`
- Title: `/title/{hid}-{slug}`; public detail includes AniList/MAL manga links.
- Chapter reader: `/title/{hid}-{slug}/{chapterId}-chapter-{number}`.
- Website API `/api/v1`: `/manga`, `/manga/{hid}`,
  `/manga/{hid}/chapters`, `/chapters/{chapterId}`.
- The public module-preload `env-*.js` exposes the website's catalogue client.
  It signs requests and decodes protected responses through its own website
  modules. Plain HTML contains title identity, not the complete chapter/images
  catalogue. A direct unsigned catalogue request returned HTTP 403; that alone
  is not proof of a CAPTCHA or an outage.
- Normal browser search, chapter pagination and Berserk chapter 377 reader
  images were visible. This is browser evidence, not proof of Android playback.

Protocol/image-format reference (not an executable runtime dependency):
<https://github.com/keiyoushi/extensions-source/tree/main/src/en/comix/src/eu/kanade/tachiyomi/extension/en/comix>.
The locally reviewed image codec's format attribution/license is bundled in
`apps/android/app/src/main/assets/licenses/`.

## User-approved website-session exception

The user explicitly asked to remove the blanket prohibition on running website
code for this connector. The exception permits Comix's ordinary same-origin
website modules in a dedicated `:comix` process with the `comix` WebView data
directory suffix (Android 9+). It does **not** permit remotely downloaded native
connectors, app-account access or automatic verification bypass.

- `WebsiteSessionApplication` establishes the separate profile before WebView
  initialization. Comix has no shared MAL/Pahe/Miruro website cookie profile.
- `ComixConnectActivity` shows the normal homepage after the user selects
  **Connect Comix**. No account sign-in is needed. Any verification is manual.
- No `JavascriptInterface`, file/content access, mixed content, popup, chooser,
  permission grant, site-initiated download or app-account bridge is exposed.
- The internal, non-exported service accepts only reviewed public catalogue GET
  paths and bounded parameters. It cannot accept arbitrary script/URL commands.
- The website transport exports selected public title/chapter/page fields only;
  no cookies, signature values, account details or cipher material are exported.
- Only Comix website assets/catalogue routes and the explicitly displayed manual
  verification flow can load. Advertising, account and unrelated hosts are
  blocked. Certificate checks and Android safe browsing remain enabled.
- Security rejections stop the native attempt and require a new manual
  connection. No provider/mirror rotation, timed lockout or automatic retry loop
  is introduced. A page-image failure does not invalidate catalogue access.

## Native reader integration

`ComixSource` searches English/romaji names, checks tracker identity and rejects
conflicting same-named titles. Chapter pages are sequential; IDs, fractional
numbers and groups are retained before the existing generic chapter dedup/order
logic. Missing/repeated pagination fails instead of silently returning a partial
list. Title/chapter metadata caches are bounded; image lists resolve on demand.

`MangaSource.resolvePage` is a default pass-through extension point for ordinary
sources. Comix overrides it to fetch and, if necessary, decode one image into a
native cache file. Coil and the existing Compose reader still own page display,
width controls, chapter changes, prefetch and reading progress. Failed/unloaded
pages must not be marked read merely because their placeholders were visible.

Image requests have exact-target public hotlink headers only, no cookies,
redirects or connection retries. HTTPS URLs, credential/port checks and DNS
private-address rejection protect the native fetcher. Encoding versions/grid
metadata are validated; unknown formats fail rather than showing scrambled data.

Bounds: 200 KB catalogue response, 25-second website request, 30-second process
request, 100 uploads per catalogue page, at most 200 pagination pages/120 seconds,
500 images per chapter, 24 MB compressed image, 12 million decoded pixels, one
native image decode at a time, 128 MB decoded-file cache target. No live source
response, signed image URL, token or decoding material is saved in test fixtures.

## Validation

Synthetic JVM fixtures cover identity, routes, response shapes, pagination,
fractional chapters, image URL/DNS policy, byte decoding and tile permutations.
`node --check` validates the bundled local transport's syntax. Run:

```text
apps\android\gradlew.bat -p apps/android :app:testDebugUnitTest :app:assembleDebug --console=plain
```

The debug-only `ComixMangaActivity` opens the **real** manga detail/reader screens
for tablet checks; it is absent from release manifests. The test entry contains
only an optional positive AniList manga ID, not tokens or arbitrary URLs.

Device acceptance still requires a successful connection, correct series and
complete chapter list, visibly readable images (including an encoded sample),
forward/back chapter changes, resume, retry/cancellation and regression checks
of existing anime providers. Do not call the provider production-verified based
on compilation or ordinary-browser success alone.
