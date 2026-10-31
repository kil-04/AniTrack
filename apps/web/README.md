# AniTrack on Render

The browser application is served at the existing Render service's public root.
It reuses the maintained browser port's screens, players, readers, account flows
and title-folder downloads. Its API runs alongside the native source service;
there is no extra paid service and no desktop companion requirement.

Build with `npm run web:build`, check with `npm run web:typecheck`, and preview
with `npm run web:preview`. The build creates `dist-web/public` and a private
`dist-web/server.cjs`. The source-service Dockerfile builds both applications.
Only the public directory's explicit asset map is served. `/operator` and `/v1/`
retain their separate authentication; public visitors use the bounded `/api/`
routes. Native-source calls stay inside the process through the existing
validated service client and handler.

The optional server catalogue route coalesces public read-only queries in a
bounded two-minute cache. Authenticated account calls are excluded. Source
429 responses pause that host's new and queued reads for its Retry-After period;
the app does not automatically change hosts or transports after a denial.

Media signatures use a dedicated secret derived from the existing service key
unless `ANITRACK_MEDIA_SECRET` is configured. The native enabled-source list
defaults to individually validated AniChan. Other existing public connectors
keep their normal transports and reported availability. Hosting the interface
on Render does not transfer a desktop verification session or remove a source's
access restrictions. No source is marked complete just because its UI loads.

Lists, account tokens and folder permissions belong to this browser origin.
Existing ChatGPT Site data remains at that origin; use the app's existing backup
or account sync controls to move records. MAL/AniList login still requires web
OAuth client registrations for the Render origin. Downloads write local files
when a destination is selected, and the service worker caches the app screens.

This directory deliberately excludes Sites identity, Git credentials, runtime
secrets, browser profiles and local QA captures.
