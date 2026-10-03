/* Locally reviewed, public catalogue-only transport. Runs in the Comix profile,
 * never in AniTrack's main WebView. No native JS interface, account or cookie export. */
(function () {
  'use strict';
  const origin = 'https://comix.to';
  if (location.origin !== origin || location.pathname !== '/') return;
  const pending = new Map();
  const phases = new Map();
  const timings = new Map();
  let client;
  const assetUrl = value => {
    const url = new URL(value, location.href || origin + '/');
    if (url.origin !== origin || !url.pathname.startsWith('/assets/')) throw new Error('Invalid website module.');
    return url;
  };
  async function environmentUrl() {
    const link = Array.from(document.querySelectorAll('link[rel="modulepreload"]'))
      .find(el => /\/env-[a-zA-Z0-9_-]+\.js$/.test(new URL(el.href).pathname));
    if (link) return assetUrl(link.href);
    // The homepage need not preload env separately. Read ONLY the observed
    // main module's bounded static import path; no code is evaluated here.
    const main = Array.from(document.querySelectorAll('script[type="module"][src]'))
      .find(el => /\/main-[a-zA-Z0-9_-]+\.js$/.test(new URL(el.src).pathname));
    if (!main) throw new Error('Comix module reference missing.');
    const mainUrl = assetUrl(main.src);
    const response = await fetch(mainUrl.href, {method:'GET',credentials:'same-origin',redirect:'error'});
    if (!response.ok || Number(response.headers.get('content-length') || 0) > 2000000 || !response.body) throw new Error('Comix module reference missing.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = '', size = 0;
    try {
      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2000000) throw new Error('Comix module reference missing.');
        body += decoder.decode(value,{stream:true});
      }
      body += decoder.decode();
    } finally { await reader.cancel(); }
    const match = body.match(/(?:from|import)\s*["'](\.\/env-[a-zA-Z0-9_-]+\.js)["']/);
    if (!match) throw new Error('Comix module reference missing.');
    return assetUrl(new URL(match[1],mainUrl).href);
  }
  async function load() {
    if (client) return client;
    const url = await environmentUrl();
    // User-approved Comix-only exception: normal website signs and decodes its
    // own catalogue calls; native Kotlin receives only selected public fields.
    const module = await import(url.href);
    // Bundlers may rename exports without changing the website API. Match the
    // inspected public HTTP facade, not the raw Axios instance or account API.
    const candidates = Object.values(module).filter(value => value && typeof value === 'object' &&
      typeof value.get === 'function' && typeof value.post === 'function' &&
      typeof value.put === 'function' && typeof value.patch === 'function' &&
      typeof value.delete === 'function' && !value.interceptors);
    if (candidates.length !== 1) throw new Error('Comix HTTP facade changed.');
    client = candidates[0];
    return client;
  }
  function project(path, value) {
    if (!value || typeof value !== 'object') throw new Error('Invalid catalogue response.');
    const title = row => ({hid: row.hid, title: row.title, altTitles: row.altTitles,
      links: {al: row.links?.al, mal: row.links?.mal}});
    if (path === '/manga') return {items: (value.items || []).slice(0,20).map(title)};
    if (/^\/manga\/\w+\/chapters$/.test(path)) return {
      items: (value.items || []).slice(0,101).map(row => ({id: row.id, number: row.number,
        name: row.name, group: row.group && {name: row.group.name}})),
      pagination: value.pagination, meta: value.meta
    };
    if (/^\/manga\/\w+$/.test(path)) return title(value);
    if (/^\/chapters\/\d+$/.test(path)) return {pages: value.pages};
    throw new Error('Unsupported catalogue operation.');
  }
  Object.defineProperty(window, '__anitrackComix', {configurable: true, value: {
    start(id, path, params) {
      if (pending.size !== 0) return false;
      const allowed = path === '/manga' || /^\/manga\/[a-zA-Z0-9]{1,32}(\/chapters)?$/.test(path) || /^\/chapters\/\d{1,15}$/.test(path);
      if (!allowed) return false;
      pending.set(id, null);
      phases.set(id, 'website-module');
      timings.set(id, {path, start: typeof performance !== 'undefined' ? performance.now() : 0});
      (async () => {
        let phase = 'website-module';
        try {
          const api = await load();
          phase = 'catalogue';
          if (pending.has(id)) phases.set(id, phase);
          const value = await api.get(path, {params});
          phase = 'response-format';
          if (pending.has(id)) phases.set(id, phase);
          const body = JSON.stringify({ok:true, value:project(path,value)});
          if (pending.has(id)) pending.set(id, body.length <= 200000 ? body : JSON.stringify({ok:false,error:'Catalogue response too large.'}));
        } catch (e) {
          const status = Number(e?.response?.status || 0);
          const reason = String(e?.message || '');
          const kind = /failed to fetch dynamically imported module/i.test(reason) ? 'module-load' :
            /content security|csp/i.test(reason) ? 'website-policy' :
            /module reference missing/i.test(reason) ? 'reference-missing' :
            /HTTP facade changed/i.test(reason) ? 'http-facade' :
            /invalid catalogue/i.test(reason) ? 'response-format' : 'request-error';
          // Never export server bodies, authorization material or signed URLs in an error.
          if (pending.has(id)) pending.set(id, JSON.stringify({ok:false, status, error: status ? 'Comix HTTP '+status : 'Comix '+phase+' failed ('+kind+').'}));
        }
      })();
      return true;
    },
    take(id) {
      if (!pending.has(id)) return JSON.stringify({ok:false,error:'Comix request expired.'});
      const value = pending.get(id);
      if (value !== null) { pending.delete(id); phases.delete(id); timings.delete(id); }
      return value;
    },
    phase(id) {
      const phase = phases.get(id) || 'idle';
      const timing = timings.get(id);
      if (phase === 'catalogue' && timing && typeof performance !== 'undefined') {
        const finished = performance.getEntriesByType('resource').some(entry =>
          entry.startTime >= timing.start && entry.duration > 0 &&
          new URL(entry.name).origin === origin && new URL(entry.name).pathname === '/api/v1' + timing.path);
        if (finished) return 'website-decode'; // Boolean phase only; never expose resource URLs/signatures.
      }
      return phase;
    },
    cancel(id) { pending.delete(id); phases.delete(id); timings.delete(id); }
  }});
})();
