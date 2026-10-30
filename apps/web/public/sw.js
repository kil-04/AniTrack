const BUILD = '__ANITRACK_BUILD__';
const ASSETS = /* ANITRACK_ASSETS */ [];
const PREFIX = 'anitrack-web-shell-';
const SHELL = PREFIX + BUILD;
const required = ['/', ...ASSETS];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    let next = 0;
    // Save every reader/player chunk, including screens never opened online.
    const results = await Promise.allSettled(Array.from({length: 4}, async () => {
      while (next < required.length) {
        const url = required[next++];
        const response = await fetch(new Request(new URL(url, self.location.origin), {cache: 'reload'}));
        if (!response.ok || response.type !== 'basic') throw new Error('Offline setup could not finish.');
        await cache.put(url, response);
      }
    }));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) {
      await caches.delete(SHELL);
      throw failure.reason;
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = (await caches.keys()).filter(name => name.startsWith(PREFIX));
    // Already-open tabs may still need a chunk from the previous release.
    const previous = names.filter(name => name !== SHELL).at(-1);
    await Promise.all(names.filter(name => name !== SHELL && name !== previous).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/') || request.headers.has('range')) return;
  const navigation = request.mode === 'navigate';
  const asset = ASSETS.includes(url.pathname) || url.pathname.startsWith('/_next/static/');
  if (!navigation && !asset && !/\.(?:js|css|woff2?|png|svg|webmanifest|json)$/.test(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    if (asset) {
      const stored = await cache.match(request) || await caches.match(request);
      if (stored) return stored;
    }
    try {
      const response = await fetch(request);
      if (response.status === 200 && response.type === 'basic') {
        const copy = response.clone();
        event.waitUntil(cache.put(navigation ? '/' : request, copy).catch(() => {}));
      }
      return response;
    } catch {
      return (navigation ? await cache.match('/') : await cache.match(request)) || await caches.match(navigation ? '/' : request) || new Response('Unavailable offline', {status: 503});
    }
  })());
});
