/* Locally reviewed, public catalogue-only transport. Runs in the Comix profile,
 * never in AniTrack's main WebView. No native JS interface, account or cookie export. */
(function () {
  'use strict';
  const origin = 'https://comix.to';
  if (location.origin !== origin || location.pathname !== '/') return;
  const MAX_MODULE_BYTES = 2000000;
  const MAX_TOTAL_BYTES = 4000000;
  const MAX_CANDIDATES = 12;
  const pending = new Map();
  let client;
  const assetUrl = (value, base = location.href || origin + '/') => {
    const url = new URL(value, base);
    if (url.origin !== origin || url.username || url.password) throw new Error('Invalid website module origin.');
    if (url.search || url.hash) throw new Error('Invalid website module coordinates.');
    if (!/^\/assets\/[a-zA-Z0-9_./-]+\.js$/.test(url.pathname) || url.pathname.length > 400) throw new Error('Invalid website module path.');
    return url;
  };
  function checkActive(op) {
    if (op.controller.signal.aborted || pending.get(op.id) !== op) throw new Error('Catalogue request cancelled.');
  }
  async function readModule(url, op, budget) {
    checkActive(op);
    const response = await fetch(url.href, {method:'GET',credentials:'same-origin',redirect:'error',signal:op.controller.signal});
    if (!response.ok || response.headers.get('cf-mitigated') === 'challenge') {
      const error = new Error('Comix module request failed.');
      error.status = response.status;
      throw error;
    }
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_MODULE_BYTES || !response.body) throw new Error('Comix module bounds exceeded.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = '', size = 0;
    try {
      while (true) {
        checkActive(op);
        const {done,value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        budget.bytes += value.byteLength;
        if (size > MAX_MODULE_BYTES || budget.bytes > MAX_TOTAL_BYTES) throw new Error('Comix module bounds exceeded.');
        body += decoder.decode(value,{stream:true});
      }
      body += decoder.decode();
    } finally { await reader.cancel(); }
    return body;
  }
  // Parse only the inspected public HTTP wrapper syntax. Never evaluate source
  // strings, decode the secure VM natively, or invoke a candidate to identify it.
  function syntaxOnly(source) {
    // Preserve offsets while ignoring comments and string/template contents.
    // This is a bounded recognizer, not a general JavaScript evaluator/parser.
    const chars = source.split('');
    for (let i = 0; i < source.length; i++) {
      const quote = source[i];
      if (quote === '/' && source[i+1] === '/') {
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') chars[i++] = ' ';
      } else if (quote === '/' && source[i+1] === '*') {
        chars[i++] = ' ';chars[i] = ' ';
        while (++i < source.length) {
          if (source[i] === '*' && source[i+1] === '/') {chars[i++] = ' ';chars[i] = ' ';break;}
          if (source[i] !== '\n' && source[i] !== '\r') chars[i] = ' ';
        }
      } else if (quote === '"' || quote === "'" || quote === '`') {
        chars[i] = ' ';
        while (++i < source.length) {
          if (source[i] === '\\') {chars[i++] = ' ';if (i < source.length) chars[i] = ' ';continue;}
          chars[i] = ' ';
          if (source[i] === quote) break;
        }
      }
    }
    return chars.join('');
  }
  function facadeReferences(source) {
    source = syntaxOnly(source);
    const references = [];
    const objects = /(?:var|let|const)\s+([a-zA-Z_$][\w$]*)\s*=\s*\{([^{}]{1,2000})\}/g;
    const wrapper = /([a-zA-Z_$][\w$]*)\s*:\s*async\s*\([^)]{0,100}\)\s*=>\s*\(\s*await\s+([a-zA-Z_$][\w$]*)\.(get|post|put|patch|delete)\s*\([^)]{0,150}\)\s*\)\.data/g;
    for (const match of source.matchAll(objects)) {
      const methods = Array.from(match[2].matchAll(wrapper));
      if (methods.length !== 5 || new Set(methods.map(m => m[2])).size !== 1 ||
          new Set(methods.map(m => m[3])).size !== 5 || new Set(methods.map(m => m[1])).size !== 5) continue;
      const readKey = methods.find(m => m[3] === 'get')[1];
      for (const exports of source.matchAll(/export\s*\{([^{}]{1,6000})\}/g)) {
        for (const entry of exports[1].split(',')) {
          const parts = entry.trim().match(/^([a-zA-Z_$][\w$]*)(?:\s+as\s+([a-zA-Z_$][\w$]*))?$/);
          if (parts && parts[1] === match[1]) references.push({exportKey:parts[2] || parts[1],readKey});
        }
      }
    }
    return references;
  }
  async function load(op) {
    if (client) return client;
    const candidates = new Map();
    const addCandidate = value => {
      const url = assetUrl(value);
      candidates.set(url.href,url);
      if (candidates.size > MAX_CANDIDATES) throw new Error('Comix module bounds exceeded.');
    };
    // The ordinary homepage can preload unrelated third-party modules. They
    // are not candidates and cannot expand this Comix-only import boundary.
    const observedAsset = (value,base) => { try {return assetUrl(value,base);} catch {return null;} };
    for (const link of Array.from(document.querySelectorAll('link[rel="modulepreload"]'))) {
      const url = observedAsset(link.href);
      if (url) addCandidate(url.href);
    }
    const mains = Array.from(document.querySelectorAll('script[type="module"][src]'))
      .map(el => observedAsset(el.src)).filter(url => url && /\/main-[a-zA-Z0-9_-]+\.js$/.test(url.pathname));
    if (mains.length > 1) throw new Error('Comix HTTP facade ambiguous.');
    const budget = {bytes:0};
    const sources = new Map();
    if (mains.length === 1) {
      const main = mains[0];
      const source = await readModule(main,op,budget);
      sources.set(main.href,source);
      // Static import statements only; neither import() expressions nor arbitrary
      // strings authorize a module. Resolve against this observed main asset.
      const syntax = syntaxOnly(source);
      for (const match of source.matchAll(/\bimport\s*(?:\{[^}]{0,6000}\}\s*from\s*|\*\s+as\s+[\w$]+\s+from\s*|[\w$]+\s+from\s*)?["']([^"']{1,400})["']/g)) {
        if (syntax.slice(match.index,match.index+6) !== 'import') continue;
        const url = observedAsset(match[1],main);
        if (url) addCandidate(url.href);
      }
      candidates.delete(main.href);
    }
    if (candidates.size === 0) throw new Error('Comix module reference missing.');
    const matches = [];
    for (const url of candidates.values()) {
      const source = sources.get(url.href) || await readModule(url,op,budget);
      for (const reference of facadeReferences(source)) matches.push({url,...reference});
    }
    if (matches.length !== 1) throw new Error(matches.length ? 'Comix HTTP facade ambiguous.' : 'Comix HTTP facade changed.');
    checkActive(op);
    const {url,exportKey,readKey} = matches[0];
    // User-approved Comix-only exception: normal website modules execute only
    // inside its isolated browser session, not in Electron/Node/Kotlin.
    const module = await import(url.href);
    checkActive(op);
    const facade = Object.getOwnPropertyDescriptor(module,exportKey)?.value;
    const read = facade && Object.getOwnPropertyDescriptor(facade,readKey)?.value;
    if (!facade || Object.prototype.hasOwnProperty.call(facade,'interceptors') || typeof read !== 'function' ||
        !/\bawait\s+[a-zA-Z_$][\w$]*\.get\s*\([^)]*\)\s*\)\.data/.test(Function.prototype.toString.call(read))) {
      throw new Error('Comix HTTP facade changed.');
    }
    client = {read:(path,config) => Reflect.apply(read,facade,[path,config])};
    return client;
  }
  const text = (value,limit) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string' || value.length > limit) throw new Error('Invalid catalogue response.');
    return value;
  };
  const rows = (value,limit) => {
    if (!Array.isArray(value) || value.length > limit) throw new Error('Invalid catalogue response.');
    return value;
  };
  function title(row) {
    if (!row || typeof row !== 'object') throw new Error('Invalid catalogue response.');
    const output = {hid:text(row.hid,32),title:text(row.title,300),
      altTitles:row.altTitles === undefined ? undefined : rows(row.altTitles,100).map(v => text(v,300)),
      links:{al:text(row.links?.al,2048),mal:text(row.links?.mal,2048)}};
    for (const key of ['year','startYear']) {
      if (row[key] !== undefined && row[key] !== null) {
        if (!Number.isSafeInteger(row[key]) || row[key] < 0 || row[key] > 9999) throw new Error('Invalid catalogue response.');
        output[key] = row[key];
      }
    }
    for (const key of ['country','originalLanguage']) {
      if (row[key] !== undefined && row[key] !== null) output[key] = text(row[key],32);
    }
    if (row.latestChapter !== undefined && row.latestChapter !== null) {
      if (typeof row.latestChapter !== 'number' || !Number.isFinite(row.latestChapter) || row.latestChapter < 0) throw new Error('Invalid catalogue response.');
      output.latestChapter = row.latestChapter;
    }
    if (row.hasChapters !== undefined) {
      if (typeof row.hasChapters !== 'boolean') throw new Error('Invalid catalogue response.');
      output.hasChapters = row.hasChapters;
    }
    return output;
  }
  function pagination(value) {
    if (!value || typeof value !== 'object') return undefined;
    const output = {};
    for (const key of ['page','lastPage','last_page','total','perPage','from','to']) {
      if (value[key] !== undefined) {
        if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error('Invalid catalogue response.');
        output[key] = value[key];
      }
    }
    for (const key of ['hasNext','hasPrev']) {
      if (value[key] !== undefined) {
        if (typeof value[key] !== 'boolean') throw new Error('Invalid catalogue response.');
        output[key] = value[key];
      }
    }
    return output;
  }
  function project(path,value) {
    if (!value || typeof value !== 'object') throw new Error('Invalid catalogue response.');
    if (path === '/manga') return {items:rows(value.items,20).map(title)};
    if (/^\/manga\/\w+\/chapters$/.test(path)) return {
      items:rows(value.items,100).map(row => {
        if (!row || typeof row !== 'object' || !Number.isSafeInteger(row.id) || row.id <= 0 ||
            typeof row.number !== 'number' || !Number.isFinite(row.number) || row.number < 0) throw new Error('Invalid catalogue response.');
        return {id:row.id,number:row.number,name:text(row.name,300),group:row.group && {name:text(row.group.name,120)}};
      }),pagination:pagination(value.pagination),meta:pagination(value.meta)
    };
    if (/^\/manga\/\w+$/.test(path)) return title(value);
    if (/^\/chapters\/\d+$/.test(path)) {
      const pages = value.pages === undefined ? value : value.pages;
      const items = rows(Array.isArray(pages) ? pages : pages?.items,500);
      if (items.length === 0) throw new Error('Invalid catalogue response.');
      return {pages:{baseUrl:Array.isArray(pages) ? '' : text(pages.baseUrl,4096) || '',items:items.map(row => {
        if (!row || typeof row !== 'object') throw new Error('Invalid catalogue response.');
        const output = {url:text(row.url,4096)};
        if (!output.url) throw new Error('Invalid catalogue response.');
        if (row.s !== undefined) {
          if (row.s !== 0 && row.s !== 1) throw new Error('Invalid catalogue response.');
          output.s = row.s;
        }
        for (const key of ['width','height']) {
          if (row[key] !== undefined) {
            if (!Number.isSafeInteger(row[key]) || row[key] < 1 || row[key] > 20000) throw new Error('Invalid catalogue response.');
            output[key] = row[key];
          }
        }
        return output;
      })}};
    }
    throw new Error('Unsupported catalogue operation.');
  }
  function validRequest(path,params) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
    const keys = Object.keys(params).sort().join(',');
    if (path === '/manga') return keys === 'keyword,limit,order[relevance],page' &&
      typeof params.keyword === 'string' && params.keyword.length >= 1 && params.keyword.length <= 200 &&
      params.page === 1 && params.limit === 20 && params['order[relevance]'] === 'desc';
    if (/^\/manga\/[a-zA-Z0-9]{1,32}\/chapters$/.test(path)) return keys === 'limit,order[number],page' &&
      Number.isInteger(params.page) && params.page >= 1 && params.page <= 200 && params.limit === 100 && params['order[number]'] === 'asc';
    return (/^\/manga\/[a-zA-Z0-9]{1,32}$/.test(path) || /^\/chapters\/\d{1,15}$/.test(path)) && keys === '';
  }
  function websiteParams(path,params) {
    // Keep AniTrack's validated flat contract at the process boundary, but send
    // the ordinary website facade the nested query shape its UI supplies. This
    // is a fresh snapshot: neither discovery nor the facade can mutate callers.
    // Chapter lists use the site UI's 20 rows: on 14 Oct the API answered 100-row
    // requests with an origin 502 while 20-row ones work. With the 200-page cap,
    // that limits a list to 4,000 uploads.
    if (path === '/manga') return {keyword:params.keyword,page:1,limit:20,order:{relevance:'desc'}};
    if (/^\/manga\/[a-zA-Z0-9]{1,32}\/chapters$/.test(path)) return {page:params.page,limit:20,order:{number:'asc'}};
    return {};
  }
  Object.defineProperty(window,'__anitrackComix',{configurable:true,value:{
    start(id,path,params) {
      if (pending.size !== 0 || typeof id !== 'string' || id.length < 1 || id.length > 100 || !validRequest(path,params)) return false;
      const query = websiteParams(path,params);
      const op = {id,body:null,phase:'website-module',controller:new AbortController(),start:typeof performance !== 'undefined' ? performance.now() : 0};
      pending.set(id,op);
      op.timer = setTimeout(() => {
        if (pending.get(id) !== op || op.body !== null) return;
        op.controller.abort();
        op.body = JSON.stringify({ok:false,error:'Comix catalogue request timed out.'});
      },30000);
      (async () => {
        try {
          const api = await load(op);
          checkActive(op);
          op.phase = 'catalogue';
          const value = await api.read(path,{params:query,signal:op.controller.signal});
          checkActive(op);
          op.phase = 'response-format';
          const body = JSON.stringify({ok:true,value:project(path,value)});
          if (pending.get(id) === op) op.body = body.length <= 200000 ? body : JSON.stringify({ok:false,error:'Catalogue response too large.'});
        } catch (e) {
          if (pending.get(id) !== op || op.body !== null) return;
          const rawStatus = Number(e?.response?.status || e?.status || 0);
          const status = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : 0;
          const reason = String(e?.message || '');
          const kind = /failed to fetch dynamically imported module/i.test(reason) ? 'module-load' :
            /content security|csp/i.test(reason) ? 'website-policy' : /bounds exceeded/i.test(reason) ? 'module-bounds' :
            /invalid website module origin/i.test(reason) ? 'module-url-origin' : /invalid website module coordinates/i.test(reason) ? 'module-url-coordinates' :
            /invalid website module path/i.test(reason) ? 'module-url-path' : /failed to fetch/i.test(reason) ? 'module-fetch' :
            /module reference missing/i.test(reason) ? 'reference-missing' : /HTTP facade ambiguous/i.test(reason) ? 'http-facade-ambiguous' :
            /HTTP facade changed/i.test(reason) ? 'http-facade' : /invalid catalogue/i.test(reason) ? 'response-format' : 'request-error';
          // No upstream body, signature, cookie, key or URL is exported in errors.
          op.body = JSON.stringify({ok:false,status,error:status ? 'Comix HTTP '+status : 'Comix '+op.phase+' failed ('+kind+').'});
        } finally { clearTimeout(op.timer); }
      })();
      return true;
    },
    take(id) {
      const op = pending.get(id);
      if (!op) return JSON.stringify({ok:false,error:'Comix request expired.'});
      if (op.body !== null) { pending.delete(id);clearTimeout(op.timer); }
      return op.body;
    },
    phase(id) {
      const op = pending.get(id);
      if (!op) return 'idle';
      if (op.phase === 'catalogue' && typeof performance !== 'undefined') {
        const finished = performance.getEntriesByType('resource').some(entry => {
          try { const url = new URL(entry.name);return entry.startTime >= op.start && entry.duration > 0 && url.origin === origin && url.pathname.startsWith('/api/v1/'); }
          catch { return false; }
        });
        if (finished) return 'website-decode'; // Boolean phase only; never resource URLs/signatures.
      }
      return op.phase;
    },
    cancel(id) { const op = pending.get(id);if (op) {pending.delete(id);clearTimeout(op.timer);op.controller.abort();} }
  }});
})();
