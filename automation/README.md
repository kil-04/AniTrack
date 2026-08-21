# AniTrack automation channel

`remote-config.json` is a deliberately small, data-only control plane shared by
the Electron and native Android apps. It can change provider domains, streaming
host matching, bounded request routes, safe HTML attribute/class identifiers,
provider order, notices, and feature kill-switches without downloading
executable code.

Both apps accept a config only when:

1. its ECDSA P-256 signature is valid;
2. its schema is strictly valid;
3. its revision is not older than the cached revision; and
4. all configured endpoints use HTTPS.

The last valid config remains cached if GitHub is unavailable or a new config is
invalid. Rollbacks are published as the old values with a **higher** revision.

## First-time setup

1. Copy `.env.example` to `.env` if `.env` does not already exist.
2. Run `npm run automation:keygen` once.
3. Back up `.env` securely. Losing the automation private key means installed
   clients cannot trust newly signed configuration.
4. Commit `shared/automation-trust.json`, `remote-config.json`, and the generated
   `remote-config.sig`. Never commit `.env` or `.release-secrets`.

Back up these two local files together in a password manager or encrypted
offline archive:

- `.env` (automation private key and Android signing passwords)
- `.release-secrets/anitrack-next.jks` (the permanent Android release key)

Losing either key prevents future installed clients from accepting the
corresponding config or APK updates. Replacing the Android key also prevents an
in-place update for every existing release install.

## GitHub production setup

Create a protected GitHub Actions environment named `production`, require a
reviewer for it, and restrict release/tag and `main` changes. Add these
environment secrets:

- `ANITRACK_AUTOMATION_PRIVATE_KEY_B64`
- `ANITRACK_ANDROID_KEYSTORE_B64`
- `ANITRACK_ANDROID_KEYSTORE_PASSWORD`
- `ANITRACK_ANDROID_KEY_ALIAS`
- `ANITRACK_ANDROID_KEY_PASSWORD`

For Windows publisher identity and SmartScreen reputation, also add a real
Authenticode certificate as `WINDOWS_CSC_LINK` and its password as
`WINDOWS_CSC_KEY_PASSWORD`. These are wired to electron-builder as `CSC_LINK`
and `CSC_KEY_PASSWORD`. Until a certificate is obtained and configured, the
desktop installer remains unsigned even though updater hashes and GitHub release
metadata are verified; treat that as a known residual release-channel risk.

The release workflow uses GitHub's short-lived `GITHUB_TOKEN`; a personal
GitHub token is not compiled into either app. The long-lived signing keys must
remain available only to the protected environment.

## Publishing a remote fix

Edit `remote-config.json`, increment `revision`, update `issuedAt`, then run:

```bash
npm run automation:sign
npm run automation:verify
```

Review and commit the JSON and signature together. Clients refresh on startup
and periodically while running, retry transient failures with bounded backoff,
and expose a manual refresh in Settings. The GitHub workflow also validates and
re-signs a config change before publishing its detached signature.

Route templates are origin-relative, have a strict provider-specific key set,
and may contain only the required bounded placeholders. Selectors are plain HTML
identifiers such as `data-id` or `item`; arbitrary regular expressions and
scripts are rejected. This lets common endpoint and markup-attribute changes be
continuously deployed while keeping the app's trust boundary data-only.

## Provider monitoring

`npm run providers:health` probes every enabled signed origin using the same
routes and primary selectors consumed by the apps. The scheduled
`provider-health.yml` workflow runs four times per hour. If every approved
origin for a provider fails, it opens one GitHub issue and appends fresh
diagnostics on later failures; it closes that issue after recovery. A normal
AnimePahe anti-bot challenge is reported separately and does not create a false
outage by itself.

Clients independently fail over across the ordered, signed `baseUrls`, so a
working secondary origin takes over without waiting for a config edit. Adding a
new origin or changing a route/selector is continuous deployment: update the
signed config with a higher revision and merge it to `main`.

## Android code updates

Native code still requires an APK. The release pipeline creates a signed update
manifest containing the APK URL, SHA-256 and version metadata. The app verifies
the manifest signature, APK hash, package name, and APK signing certificate
before asking Android to install it.

The first permanent-key APK cannot update a previously distributed debug-signed
APK. Those testers need a one-time uninstall/reinstall of this foundation
release. Every later APK can update in place as long as the package id, signing
key, and increasing `versionCode` are preserved. Android always retains the
final user-controlled Install confirmation.

Remote config can fix provider domains, trusted stream-host rules, request
routes, the supported markup identifiers, provider priority, and feature
availability without an app release. Structural parsing logic, database, UI,
playback-engine, or other compiled-code bugs still require a new binary;
desktop installs it through the existing updater, while Android automatically
downloads and verifies it before the one required Install tap.
