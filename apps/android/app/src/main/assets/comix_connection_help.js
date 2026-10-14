/* AniTrack-owned connection UI only. No website requests, verification actions,
 * account access, native bridge or reader navigation. Bundled with both apps. */
(() => {
  'use strict';
  const origin = 'https://comix.to';
  const titlePath = '/title/[a-zA-Z0-9]{1,32}(?:-[a-zA-Z0-9-]{1,200})?';
  const publicPage = new RegExp('^(?:/|/browse|' + titlePath + ')$');
  const chapterPage = new RegExp('^' + titlePath + '/[0-9]{1,15}-chapter-[0-9]{1,6}(?:\\.[0-9]{1,3})?$');
  if (window.top !== window || location.origin !== origin || !publicPage.test(location.pathname)) return false;

  // Reinjection replaces only our own previous listener. A single delegated
  // capture handler also covers title/chapters inserted by the site's SPA.
  window.__anitrackComixConnectionHelp?.disable?.();
  let active = true;
  let hint = null;
  const isChapter = raw => {
    if (typeof raw !== 'string' || raw.length > 1024 || /[\u0000-\u0020\u007f\\%#]/.test(raw)) return false;
    // Check before URL normalization, so traversal and encoded paths fail closed.
    const absolute = /^https:\/\/[^/?#]+([^?#]*)$/i.exec(raw);
    const path = absolute ? absolute[1] || '/' : raw.startsWith('/') ? raw : '';
    if (!chapterPage.test(path)) return false;
    try {
      const url = new URL(raw, location.href);
      return url.origin === origin && !url.username && !url.password && !url.search && !url.hash && chapterPage.test(url.pathname);
    } catch { return false; }
  };
  const onClick = event => {
    if (!active || location.origin !== origin || !publicPage.test(location.pathname)) return;
    const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
    const anchor = target?.closest?.('a[href]');
    if (!anchor || !isChapter(anchor.getAttribute('href'))) return;
    // The website reader remains outside AniTrack's connection policy. Prevent
    // its own navigation handler from fetching a deliberately blocked page.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!document.body) return;
    if (!hint || !hint.isConnected) {
      hint = document.createElement('div');
      hint.setAttribute('role', 'status');
      hint.setAttribute('aria-live', 'polite');
      hint.setAttribute('data-anitrack-connection-help', '');
      hint.style.cssText = 'position:fixed;top:12px;left:5%;width:90%;box-sizing:border-box;z-index:2147483647;padding:16px;border:1px solid #a78bfa;border-radius:12px;background:#191526;color:#fff;font:600 16px/1.5 sans-serif;box-shadow:0 4px 24px #0008';
      hint.textContent = 'This window is for connecting Comix. Tap Continue to AniTrack above, then open the chapter in AniTrack.';
      document.body.appendChild(hint);
    }
  };
  const disable = () => {
    active = false;
    window.removeEventListener('click', onClick, true);
    hint?.remove();
    hint = null;
  };
  window.addEventListener('click', onClick, true);
  // This exposes only disposal of an app-owned DOM listener, not an app bridge
  // or connection/readiness signal. No website callback grants native access.
  Object.defineProperty(window, '__anitrackComixConnectionHelp', {
    configurable: true, value: Object.freeze({ disable }),
  });
  return true;
})();
