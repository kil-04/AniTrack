/* Locally bundled page reader, shared by Electron and Android. No native bridge.
 * Normal website scripts handle catalogue/reader data. Export only bounded bytes
 * of the selected page's already-decoded same-origin image blob. */
(async (request) => {
  const origin = 'https://toonkotsu.com', maxBytes = 16 * 1024 * 1024;
  const check = () => /just a moment|attention required/i.test(document.title) || /quick check|verify you are human/i.test(document.body?.innerText.slice(0, 5000) || '');
  if (location.origin !== origin) return { error: 'origin' };
  if (check()) return { error: 'check' };
  if (request.operation === 'get') {
    if (!/^\/cdn\/v1\/(?:series\/[a-z][a-z0-9]{4}|search\?q=[^&]{0,1500}&limit=5)$/.test(request.path)) return { error: 'path' };
    const response = await fetch(request.path, { credentials: 'same-origin', redirect: 'error', cache: 'no-cache' });
    if ([401,403,429,503].includes(response.status)) { await response.body?.cancel(); return { error: response.status === 429 ? 'rate' : 'check', retryAfter: response.headers.get('retry-after') }; }
    if (!response.ok) return { error: 'http', status: response.status };
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > maxBytes) { await reader.cancel(); return { error: 'size' }; } chunks.push(r.value); }
    return { body: await new Blob(chunks).text() };
  }
  if (request.operation !== 'image' || !Number.isInteger(request.page) || request.page < 1 || request.page > 500) return { error: 'request' };
  if (!/^[1-9]\d{0,14}$/.test(String(request.chapterId))) return { error: 'request' };
  // Since 20 Oct 2026 the site redirects /title/<hid>-<slug>/ to its own /title/<code>-<slug>/,
  // so only the chapter part of the path identifies the page.
  const chapterPath = new RegExp(`^/title/[a-z0-9-]{1,190}/${request.chapterId}-chapter-`);
  const atChapter = () => chapterPath.test(location.pathname);
  if (!atChapter()) return { error: 'chapter' };
  const until = Date.now() + 24000;
  while (Date.now() < until) {
    if (check()) return { error: 'check' };
    if (location.origin !== origin || !atChapter()) return { error: 'chapter' };
    const image = [...document.images].find(i => i.alt === `Page ${request.page}` && i.complete && i.naturalWidth > 0);
    if (image) {
      const src = image.currentSrc || image.src;
      if (!src.startsWith(`blob:${origin}/`)) return { error: 'image' };
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(src, { signal: controller.signal });
        const blob = await response.blob();
        if (blob.size < 1 || blob.size > maxBytes || !/^image\/(?:jpeg|png|webp|avif|gif)$/.test(blob.type)) return { error: 'image' };
        const data = await new Promise((resolve, reject) => { const f = new FileReader(); f.onload = () => resolve(f.result); f.onerror = reject; f.readAsDataURL(blob); });
        return { data, width: image.naturalWidth, height: image.naturalHeight, chapterId: request.chapterId, page: request.page };
      } finally { clearTimeout(timer); }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return { error: 'timeout' };
})(/*ANITRACK_REQUEST*/)
