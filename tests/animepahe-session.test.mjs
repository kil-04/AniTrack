import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerHooks } from "node:module";
import {
  PaheAccessError,
  PaheResolvedStreamCache,
  PaheVerificationState,
  paheResponseError,
} from "../apps/desktop/main/services/providers/animepahe-session.ts";
import { awaitKwikStage, extractKwikStreamUrls, readKwikHtml, unpackKwikJs } from "../apps/desktop/main/services/providers/animepahe-kwik-parser.ts";

const fixture = {
  windows: [], requests: [], responses: [], title: "AnimePahe", base: "https://animepahe.test",
  kwikCookies: {}, cookieLookups: [],
};
globalThis.__animepaheFixture = fixture;

class FakeBrowserWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.destroyed = false;
    this.visible = false;
    this.title = fixture.title;
    this.url = "";
    this.webContents = new EventEmitter();
    this.webContents.session = new EventEmitter();
    Object.assign(this.webContents.session, {
      setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
      async fetch(url) {
        fixture.requests.push(url);
        const response = fixture.responses.shift();
        assert.ok(response, "unexpected network attempt");
        return response;
      },
    });
    this.webContents.setWindowOpenHandler = (handler) => { this.popupHandler = handler; };
    this.webContents.getURL = () => this.url;
    this.webContents.executeJavaScript = async () => this.title;
    // Provider requests run as a fixed script in an isolated page world; the
    // request data is its marked argument line. Like the real world, globals
    // persist between calls, so a top-level declaration would fail the second.
    this.worldGlobals = new Set();
    this.webContents.executeJavaScriptInIsolatedWorld = async (world, scripts) => {
      assert.equal(scripts.length, 1);
      for (const [, name] of scripts[0].code.matchAll(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
        if (this.worldGlobals.has(`${world}:${name}`)) throw new SyntaxError(`Identifier '${name}' has already been declared`);
        this.worldGlobals.add(`${world}:${name}`);
      }
      const request = JSON.parse(/^\/\* request \*\/ (.*)$/m.exec(scripts[0].code)[1]);
      this.isolatedWorlds = [...(this.isolatedWorlds ?? []), world];
      this.lastRequest = request;
      return this.webContents.session.fetch(new URL(request.path, this.url).toString())
        .then(async (response) => ({ status: response.status, body: await response.text() }));
    };
    // The real reload shows the website check; the fixture keeps the page as-is.
    this.reloads = 0;
    this.webContents.reloadIgnoringCache = () => { this.reloads++; };
    fixture.windows.push(this);
  }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  focus() {}
  setTitle(value) { this.windowTitle = value; }
  async loadURL(url, options) {
    this.url = url;
    this.loadOptions = options;
    queueMicrotask(() => this.webContents.emit("did-finish-load"));
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("closed");
  }
}
fixture.BrowserWindow = FakeBrowserWindow;
fixture.kwikSession = {
  async fetch(url) {
    fixture.requests.push(url);
    const response = fixture.responses.shift();
    assert.ok(response, "unexpected Kwik network attempt");
    return response;
  },
  cookies: {
    async get({ url }) {
      fixture.cookieLookups.push(url);
      return fixture.kwikCookies[url] ?? [];
    },
  },
};

// Exercise the real provider with a fresh, fake Electron session. These hooks
// never load an installed app's store, cookies, profile, or network transport.
const mocks = {
  electron: "export const BrowserWindow=globalThis.__animepaheFixture.BrowserWindow; export const session={fromPartition:()=>globalThis.__animepaheFixture.kwikSession};",
  "animepahe-config": `
    const f=globalThis.__animepaheFixture;
    export const animePaheEnabled=()=>true, assertAnimePaheEnabled=()=>{},
      getPaheBaseUrl=()=>f.base, getManualPaheBaseUrl=()=>undefined, paheBaseUrl=()=>f.base,
      savePaheBaseUrl=(base)=>{f.base=base;}, selectConfiguredPaheBase=(base)=>{const changed=f.base!==base;f.base=base;return changed;};
    export const paheRoute=(name,values={})=>name==='home'?'/':'/api?'+new URLSearchParams({name,...values});
  `,
  "animepahe-kwik": `
    export const prefetchKwik=()=>{}, resetKwikForBaseChange=()=>{}, resolveKwik=()=>{},
      syncPaheRuntimeConfig=()=>{}, getAuthorizedPaheRequestHeaders=()=>{}, getKwikCookies=()=>'',
      isAuthorizedPaheStreamUrl=()=>false;
  `,
  "remote-config": `
    export const getRuntimeConfig=()=>({features:{animepaheStreaming:true},providers:{animepahe:{
      enabled:true,baseUrls:['https://animepahe.test','https://mirror.animepahe.test'],selectors:{},
      streamHostFragments:['kwik.cx','uwucdn.top']
    }}});
  `,
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const key = specifier === "electron" ? "electron" : specifier.split("/").at(-1);
    if (key in mocks) return { url: `animepahe-fixture:${key}`, shortCircuit: true };
    try { return nextResolve(specifier, context); } catch (error) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url.startsWith("animepahe-fixture:")) return {
      format: "module", source: mocks[url.slice("animepahe-fixture:".length)], shortCircuit: true,
    };
    return nextLoad(url, context);
  },
});
const { AnimePaheProvider, setPaheBaseUrl } = await import("../apps/desktop/main/services/providers/animepahe.ts");
const { resolveKwik, getAuthorizedPaheRequestHeaders, resetKwikForBaseChange } = await import("../apps/desktop/main/services/providers/animepahe-kwik.ts");

function resetFixture(title = "AnimePahe") {
  setPaheBaseUrl("https://animepahe.test");
  fixture.windows.length = 0;
  fixture.requests.length = 0;
  fixture.responses.length = 0;
  fixture.cookieLookups.length = 0;
  fixture.title = title;
}

test("AnimePahe challenged API makes one request and manual completion enables retry", async () => {
  resetFixture();
  fixture.responses.push(new Response("<title>Just a moment...</title>", { status: 403 }));
  const provider = new AnimePaheProvider();
  await assert.rejects(() => provider.search("Bebop"), (error) => error instanceof PaheAccessError && error.code === "PAHE_SECURITY_CHECK");
  await assert.rejects(() => provider.search("Bebop"), /PAHE_SECURITY_CHECK/);
  assert.equal(fixture.requests.length, 1, "no request retry or mirror rotation after a challenge");
  assert.equal(fixture.windows.length, 1, "verification does not recreate the window");
  const win = fixture.windows[0];
  assert.equal(win.visible, true);
  assert.match(win.loadOptions?.extraHeaders ?? "", /Cache-Control: no-cache/i, "a cached homepage cannot mark the session ready");
  assert.equal(win.reloads, 1, "one cache-bypassing reload brings up the check; later blocked calls send nothing");
  assert.equal(win.options.webPreferences.partition, "persist:animepahe");
  assert.deepEqual(win.popupHandler(), { action: "deny" });
  win.title = "AnimePahe";
  win.webContents.emit("did-finish-load");
  await new Promise((resolve) => setImmediate(resolve));
  fixture.responses.push(Response.json({ data: [] }));
  assert.deepEqual(await provider.search("Bebop"), []);
  assert.equal(fixture.requests.length, 2);
  assert.equal(win.visible, false);
  win.destroy();
});

test("AnimePahe challenge homepage never marks readiness or calls its API", async () => {
  resetFixture("Just a moment...");
  const provider = new AnimePaheProvider();
  await assert.rejects(() => provider.search("Bebop"), /PAHE_SECURITY_CHECK/);
  await assert.rejects(() => provider.search("Bebop"), /PAHE_SECURITY_CHECK/);
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.windows.length, 1);
  assert.equal(fixture.windows[0].visible, true);
  fixture.windows[0].destroy();
});

test("AnimePahe ordinary homepage uses the verified session transport", async () => {
  resetFixture();
  fixture.responses.push(Response.json({ data: [{ session: "show", title: "Cowboy Bebop", id: 123 }] }));
  const provider = new AnimePaheProvider();
  assert.equal((await provider.search("Bebop"))[0].title, "Cowboy Bebop");
  assert.equal(fixture.requests.length, 1);
  assert.equal(new URL(fixture.requests[0]).origin, "https://animepahe.test");
  const win = fixture.windows[0];
  assert.equal(win.isolatedWorlds.length, 1);
  assert.ok(![0, 999].includes(win.isolatedWorlds[0]), "neither the page's own world nor Electron's preload world");
  assert.equal(win.lastRequest.xhr, true);
  assert.ok(win.lastRequest.path.startsWith("/"), "only a same-origin path reaches the page");
  assert.equal(win.visible, false);
  win.destroy();
});

test("AnimePahe startup prewarm never pops the website check; a user request shows it", async () => {
  resetFixture("Just a moment...");
  const provider = new AnimePaheProvider();
  provider.prewarm();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.windows.length, 1);
  assert.equal(fixture.windows[0].visible, false, "no window appears unprompted at launch");
  await assert.rejects(() => provider.search("Bebop"), /PAHE_SECURITY_CHECK/);
  assert.equal(fixture.windows[0].visible, true);
  assert.equal(fixture.requests.length, 0);
  fixture.windows[0].destroy();
});

test("AnimePahe closes its idle hidden window but never a check the user is completing", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  resetFixture();
  fixture.responses.push(Response.json({ data: [] }));
  const provider = new AnimePaheProvider();
  const search = provider.search("Bebop");
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  await search;
  const idle = fixture.windows[0];
  context.mock.timers.tick(9 * 60_000);
  assert.equal(idle.destroyed, false);
  context.mock.timers.tick(60_000);
  assert.equal(idle.destroyed, true, "an idle AnimePahe window is released after ten minutes");

  resetFixture("Just a moment...");
  await assert.rejects(() => provider.search("Bebop"), /PAHE_SECURITY_CHECK/);
  context.mock.timers.tick(30 * 60_000);
  assert.equal(fixture.windows[0].destroyed, false);
  fixture.windows[0].destroy();
});

test("AnimePahe sends nothing through a window that has left the configured site", async () => {
  resetFixture();
  fixture.responses.push(Response.json({ data: [] }), Response.json({ data: [] }));
  const provider = new AnimePaheProvider();
  await provider.search("Bebop");
  const departed = fixture.windows[0];
  departed.url = "https://elsewhere.test/";
  // The ordinary mirror fallback may open a fresh window for the next origin.
  await provider.search("Bebop");
  assert.equal(departed.isolatedWorlds.length, 1, "only the request made before leaving");
  assert.ok(fixture.requests.every((url) => new URL(url).origin !== "https://elsewhere.test"));
  for (const win of fixture.windows) win.destroy();
});

test("AnimePahe rate limit blocks requests briefly and stale windows cannot restore readiness", () => {
  let now = 1000;
  const state = new PaheVerificationState(() => now);
  const oldWindow = state.reset();
  const currentWindow = state.reset();
  assert.equal(state.markReady(oldWindow), false);
  assert.equal(state.ready, false);
  assert.equal(state.markReady(currentWindow), true);
  state.reject(paheResponseError(429, ""));
  assert.throws(() => state.assertRequestAllowed(), /PAHE_RATE_LIMITED/);
  state.reset();
  assert.throws(() => state.assertRequestAllowed(), /PAHE_RATE_LIMITED/, "closing a window cannot retry a rate limit");
  now += 60_000;
  assert.doesNotThrow(() => state.assertRequestAllowed());
});

test("AnimePahe detects challenge HTML even when the server returns HTTP 200", () => {
  assert.equal(paheResponseError(200, '<html><title>Just a moment...</title></html>').code, "PAHE_SECURITY_CHECK");
  assert.equal(paheResponseError(503, '<script src="/cdn-cgi/challenge-platform/a"></script>').code, "PAHE_SECURITY_CHECK");
  assert.equal(paheResponseError(503, "upstream unavailable"), null);
  // Observed live: ordinary 200 pages carry Cloudflare's injected loader.
  assert.equal(paheResponseError(200, `<title>Cowboy Bebop Ep. 1 :: animepahe</title><script>var s=document.createElement('script');s.src='/cdn-cgi/challenge-platform/scripts/precursor/main.js';</script>`), null);
  assert.equal(paheResponseError(200, '<script>window._cf_chl_opt={cvId:"3"}</script>').code, "PAHE_SECURITY_CHECK");
  assert.equal(paheResponseError(200, '{"data":[]}'), null);
});

test("Kwik cache preserves each URL's own credentials and cookie expiry", () => {
  const cache = new PaheResolvedStreamCache(120_000, 30_000);
  const a = { url: "https://cdn.example/a/master.m3u8", cookies: "session=A", resolvedAt: 1000, cookiesAt: 1000 };
  cache.set("kwik-a", a);
  cache.set("kwik-b", { url: "https://cdn.example/b/master.m3u8", cookies: "session=B", resolvedAt: 20_000, cookiesAt: 20_000 });
  a.cookies = "changed after insertion";
  assert.equal(cache.get("kwik-a", 25_000).cookies, "session=A");
  assert.equal(cache.get("kwik-b", 25_000).cookies, "session=B");
  assert.equal(cache.get("kwik-a", 31_000), null, "a newer cookie for B cannot extend A's lifetime");
  assert.equal(cache.get("kwik-b", 31_000).cookies, "session=B");
});

test("Kwik cached resolve keeps stream A's authorization after stream B rotates cookies", async () => {
  resetFixture();
  const embedA = "https://kwik.cx/e/stream-a", embedB = "https://kwik.cx/e/stream-b";
  fixture.kwikCookies = {
    [embedA]: [{ name: "session", value: "A" }],
    [embedB]: [{ name: "session", value: "B" }],
  };
  fixture.responses.push(new Response("<script>const source='https://uwucdn.top/anime-a/master.m3u8';</script>"));
  const first = await resolveKwik(embedA);
  assert.equal(first.cookies, "session=A");
  fixture.responses.push(new Response("<script>const source='https://uwucdn.top/anime-b/master.m3u8';</script>"));
  const second = await resolveKwik(embedB);
  assert.equal(second.cookies, "session=B");
  const again = await resolveKwik(embedA);
  assert.equal(again.cookies, "session=A");
  assert.equal(getAuthorizedPaheRequestHeaders(again.url).cookie, "session=A");
  assert.equal(getAuthorizedPaheRequestHeaders(second.url).cookie, "session=B");
  assert.equal(fixture.requests.length, 2, "each initial resolve fetches exactly once; cached resolve does not fetch again");
  assert.deepEqual(fixture.cookieLookups, [embedA, embedB]);
  assert.equal(fixture.windows.length, 0, "resolving a source never displays or executes its embed page");
});

test("Kwik security response never falls back to a fresh browser request", async () => {
  resetFixture();
  fixture.responses.push(new Response("security check", { status: 403 }));
  await assert.rejects(() => resolveKwik("https://kwik.cx/e/rejected"), /PAHE_SECURITY_CHECK/);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.windows.length, 0, "the failed fetch does not create or navigate an embed window");
  assert.equal(fixture.cookieLookups.length, 0);
});

test("Kwik challenge HTML stops before cookie capture or a second request", async () => {
  resetFixture();
  resetKwikForBaseChange();
  fixture.responses.push(new Response("<title>Just a moment...</title>"));
  await assert.rejects(() => resolveKwik("https://kwik.cx/e/html-challenge"), /PAHE_SECURITY_CHECK/);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.cookieLookups.length, 0);
  assert.equal(fixture.windows.length, 0);
});

test("Kwik missing stream cookies fails actionably without executing site code", async () => {
  resetFixture();
  fixture.responses.push(new Response("<script>const source='https://uwucdn.top/no-cookies/master.m3u8';</script>"));
  await assert.rejects(() => resolveKwik("https://kwik.cx/e/no-cookies"), /did not supply the stream cookies/);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.windows.length, 0);
  assert.equal(getAuthorizedPaheRequestHeaders("https://uwucdn.top/no-cookies/master.m3u8"), null);
});

test("Kwik static parser decodes quoted packer data and rejects invalid radix", () => {
  const url = "https://uwucdn.top/fixture/master.m3u8";
  const double = `eval(function(p,a,c,k,e,d){return p}("0='1'",2,2,"source|${url}".split('|'),0,{}))`;
  const single = `eval(function(p,a,c,k,e,d){return p}('0=\\'1\\'',2,2,'source|${url}'.split('|'),0,{}))`;
  assert.equal(unpackKwikJs(double), `source='${url}'`);
  assert.equal(unpackKwikJs(single), `source='${url}'`);
  assert.deepEqual(extractKwikStreamUrls(double), [url]);
  assert.deepEqual(extractKwikStreamUrls(single), [url]);
  assert.equal(unpackKwikJs(double.replace(",2,2,", ",1,2,")), null);
  assert.equal(unpackKwikJs(double.replace(",2,2,", ",0,2,")), null);
  assert.equal(unpackKwikJs(double.replace(",2,2,", ",63,2,")), null);
});

test("Kwik stalled body deadline returns even when stream cancellation never settles", async () => {
  const controller = new AbortController();
  const response = new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }));
  const timer = setTimeout(() => controller.abort(), 10);
  try {
    await assert.rejects(() => readKwikHtml(response, controller.signal), /Kwik request timed out/);
  } finally { clearTimeout(timer); }
});

test("Kwik stage deadline bounds a cookie or fetch promise that ignores abort", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10);
  try {
    await assert.rejects(() => awaitKwikStage(new Promise(() => {}), controller.signal), /Kwik request timed out/);
  } finally { clearTimeout(timer); }
});
