import test, { after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import ts from "typescript";

// Desktop manga downloads with a fake source: what an interrupted chapter keeps,
// how it waits and how it carries on (packages/shared/download-resume.ts).
const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "anitrack-manga-dl-test-"));
const harness = {
  online: true,
  pageLists: 0,
  pages: () => [],
  fetch: async () => { throw new Error("Unexpected page request"); },
};
globalThis.__anitrackMangaFixture = harness;
harness.app = { getPath: () => storageRoot };
harness.net = { isOnline: () => harness.online };
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const electron = moduleUrl("export const app = globalThis.__anitrackMangaFixture.app; export const net = globalThis.__anitrackMangaFixture.net;");
const sources = moduleUrl(`
  const h = globalThis.__anitrackMangaFixture;
  export class MangaSourceError extends Error {
    constructor(message, status, verify = false, retryAfter = null) { super(message); this.status = status; this.verify = verify; this.retryAfter = retryAfter; }
  }
  export function sourceById() { return { pageImages: async () => { h.pageLists++; return h.pages(); } }; }
  export function fetchPageImage(sourceId, target, signal) { return h.fetch(target.toString(), signal); }
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/services/manga/downloads.ts")) {
      if (specifier === "electron") return { url: electron, shortCircuit: true };
      if (specifier === "./sources") return { url: sources, shortCircuit: true };
    }
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});

const M = await import("../apps/desktop/main/services/manga/downloads.ts");
const R = await import("../packages/shared/download-resume.ts");
const { downloadMetaJson } = await import("../packages/shared/manga.ts");
M.setMangaRetryScale(0.001);
const events = [];
M.setMangaDownloadEmitter((event) => events.push(event));

const manga = { id: 777, title: "Fixture Manga", cover: null, country: "JP" };
const title = { sourceId: "xcomic", id: "fixture-title", title: "Fixture Manga" };
const chapter = (id, number) => ({ id, number, title: null, group: null, pageCount: null, uploadedAt: null });
const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, n)]);
const pageUrls = (token, n) => Array.from({ length: n }, (_, i) => ({ url: `https://img${token}.xcomic.example/c/p${i + 1}.jpg?token=${token}`, width: 800, height: 1200 }));
const indexOf = (url) => Number(/\/p(\d+)\.jpg/.exec(url)[1]) - 1;
const image = (i) => new Response(jpeg(i), { headers: { "content-type": "image/jpeg" } });
const dir = (chapterId) => path.join(storageRoot, "manga_downloads", String(manga.id), chapterId);
/** Polls until [condition] holds (timing differs under load and on Windows; never assert a moment). */
async function waitFor(condition, what, timeout = 8000) {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function settled(key, timeout = 8000) {
  const started = Date.now();
  for (;;) {
    const item = (await M.listMangaDownloads()).find((d) => d.key === key);
    if (item && (item.status === "done" || item.status === "failed")) return item;
    if (Date.now() - started > timeout) throw new Error(`Chapter ${key} did not settle: ${JSON.stringify(item)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const metaOf = (chapterId) => JSON.parse(fs.readFileSync(path.join(dir(chapterId), "meta.json"), "utf8"));

// Runs first: the folder below is what an app closed mid-chapter leaves behind.
test("after a restart, an unfinished chapter resumes with re-signed page URLs and keeps its pages in order", async () => {
  const id = "restart1";
  fs.mkdirSync(dir(id), { recursive: true });
  fs.writeFileSync(path.join(dir(id), "meta.json"), downloadMetaJson({ manga, title, chapter: chapter(id, 1), pages: [], complete: false, sizeBytes: 0 }));
  const oldPages = pageUrls("old", 5);
  const rendition = R.renditionId(`chapter ${id}`, oldPages.map((p) => ({ kind: "page", url: p.url })));
  let ledger = R.ledgerHeader(rendition, 5);
  for (const i of [0, 1, 3]) {
    fs.writeFileSync(path.join(dir(id), `00${i + 1}.jpg`), jpeg(i));
    ledger += R.ledgerLine(i, `00${i + 1}.jpg`, jpeg(i).length, "jpeg");
  }
  fs.writeFileSync(path.join(dir(id), "005.jpg.part"), Buffer.alloc(10));
  fs.writeFileSync(path.join(dir(id), R.LEDGER_FILE), ledger + "4 005.jpg 2"); // cut off by the kill
  const fetched = [];
  harness.pages = () => pageUrls("new", 5);
  harness.fetch = async (url) => { fetched.push(indexOf(url)); return image(indexOf(url)); };
  const done = await settled(`${manga.id}:${id}`);
  assert.equal(done.status, "done");
  assert.deepEqual(fetched.sort(), [2, 4], "only the missing pages were fetched");
  const meta = metaOf(id);
  assert.equal(meta.complete, true);
  assert.deepEqual(meta.pages.map((p) => p.file), ["001.jpg", "002.jpg", "003.jpg", "004.jpg", "005.jpg"]);
  for (let i = 0; i < 5; i++) assert.deepEqual(fs.readFileSync(path.join(dir(id), `00${i + 1}.jpg`)), jpeg(i));
  assert.equal(fs.existsSync(path.join(dir(id), "005.jpg.part")), false);
  const local = await M.localPages(manga.id, id);
  assert.deepEqual(local.map((p) => p.url.split("/").pop()), ["001.jpg", "002.jpg", "003.jpg", "004.jpg", "005.jpg"]);
});

test("a chapter waits for the network to come back and continues from the first missing page", async () => {
  const id = "network1";
  const fetched = [];
  harness.pages = () => pageUrls("a", 6);
  harness.fetch = async (url) => {
    const i = indexOf(url);
    if (!harness.online) throw new TypeError("net::ERR_INTERNET_DISCONNECTED");
    fetched.push(i);
    if (i === 2) harness.online = false; // the connection drops after page 3
    return image(i);
  };
  assert.equal(await M.downloadChapter(manga, title, chapter(id, 2)), true);
  // Offline until it shows it is waiting: no race with its retries.
  const waitingNow = () => events.some((e) => e.item?.key === `${manga.id}:${id}` && e.item.status === "queued" && /network/.test(e.item.error ?? ""));
  await waitFor(waitingNow, "the network wait");
  harness.online = true;
  const done = await settled(`${manga.id}:${id}`);
  assert.equal(done.status, "done");
  assert.deepEqual(new Set(fetched), new Set([0, 1, 2, 3, 4, 5]));
  assert.ok(fetched.length <= 6 + 2, `pages saved before the drop weren't fetched again: ${fetched}`);
  const waiting = events.map((e) => e.item).filter((item) => item?.key === `${manga.id}:${id}` && item.status === "queued" && item.error);
  assert.ok(waiting.some((item) => /network/.test(item.error)), "it showed it was waiting for the network");
  assert.deepEqual(metaOf(id).pages.map((p) => p.file), ["001.jpg", "002.jpg", "003.jpg", "004.jpg", "005.jpg", "006.jpg"]);
});

test("a rate-limited page waits out Retry-After instead of failing the chapter", async () => {
  const id = "limited1";
  let limited = 2;
  const times = [];
  harness.pages = () => pageUrls("a", 2);
  harness.fetch = async (url) => {
    if (indexOf(url) === 1 && limited-- > 0) { times.push(Date.now()); return new Response("", { status: 429, headers: { "retry-after": "30" } }); }
    return image(indexOf(url));
  };
  await M.downloadChapter(manga, title, chapter(id, 3));
  const done = await settled(`${manga.id}:${id}`);
  assert.equal(done.status, "done");
  assert.equal(limited, -1);
  assert.ok(times[1] - times[0] >= 28, "Retry-After: 30 (scaled to 30 ms) was honoured");
});

test("expired page addresses fetch the page list again; a page still missing fails the chapter but keeps the rest", async () => {
  const id = "expired1";
  let token = "a";
  harness.pageLists = 0;
  harness.pages = () => pageUrls(token, 3);
  harness.fetch = async (url) => {
    if (url.includes("token=a") && indexOf(url) === 2) { token = "b"; return new Response("", { status: 403 }); }
    return image(indexOf(url));
  };
  await M.downloadChapter(manga, title, chapter(id, 4));
  assert.equal((await settled(`${manga.id}:${id}`)).status, "done");
  assert.equal(harness.pageLists, 2, "the page list was fetched again once");

  const gone = "missing1";
  harness.pages = () => pageUrls("a", 3);
  harness.fetch = async (url) => (indexOf(url) === 1 ? new Response("", { status: 404 }) : image(indexOf(url)));
  await M.downloadChapter(manga, title, chapter(gone, 5));
  const failed = await settled(`${manga.id}:${gone}`);
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /Page 2 is missing/);
  assert.ok(fs.existsSync(path.join(dir(gone), "001.jpg")), "saved pages stay for the next try");
  const fetched = [];
  harness.fetch = async (url) => { fetched.push(indexOf(url)); return image(indexOf(url)); };
  await M.downloadChapter(manga, title, chapter(gone, 5));
  assert.equal((await settled(`${manga.id}:${gone}`)).status, "done");
  assert.ok(!fetched.includes(0), `the retry kept page 1: ${fetched}`);
});

test("a chapter whose page list changed starts over rather than mixing pages", async () => {
  const id = "changed1";
  harness.pages = () => pageUrls("a", 3);
  harness.fetch = async (url) => image(indexOf(url));
  await M.downloadChapter(manga, title, chapter(id, 6));
  assert.equal((await settled(`${manga.id}:${id}`)).status, "done");
  const saved = Object.fromEntries(fs.readdirSync(dir(id)).map((name) => [name, fs.readFileSync(path.join(dir(id), name))]));
  // Removed, then asked for again after the source re-uploaded it with four
  // pages, while the old (interrupted) files are still on disk.
  await M.removeMangaDownload(`${manga.id}:${id}`);
  fs.mkdirSync(dir(id), { recursive: true });
  for (const [name, bytes] of Object.entries(saved)) fs.writeFileSync(path.join(dir(id), name), bytes);
  const fetched = [];
  harness.pages = () => pageUrls("a", 4).map((p) => ({ ...p, url: p.url.replace("/c/", "/c2/") }));
  harness.fetch = async (url) => { fetched.push(indexOf(url)); return image(10 + indexOf(url)); };
  await M.downloadChapter(manga, title, chapter(id, 6));
  assert.equal((await settled(`${manga.id}:${id}`)).status, "done");
  assert.deepEqual(fetched.sort(), [0, 1, 2, 3]);
  for (let i = 0; i < 4; i++) assert.deepEqual(fs.readFileSync(path.join(dir(id), `00${i + 1}.jpg`)), jpeg(10 + i));
});

test("a source's own refusals fail the chapter instead of passing for a network drop", async () => {
  const { MangaSourceError } = await import(sources);
  const cases = [
    { why: "its one-time check", error: () => new MangaSourceError("Toonkotsu needs a quick check. Use Connect Toonkotsu, complete it, then retry.", undefined, true), message: /needs a quick check/ },
    { why: "a page it couldn't load", error: () => new MangaSourceError("Toonkotsu couldn't load this page. Retry or choose another source."), message: /couldn't load this page/ },
    { why: "an invalid image (not a network error)", error: () => new Error("Toonkotsu sent an invalid image."), message: /Page 1 couldn't be downloaded from the source/ },
    { why: "a refused local-network address", error: () => new Error("Unsafe Comix image destination."), message: /Page 1 couldn't be downloaded/ },
  ];
  let n = 10;
  for (const c of cases) {
    const id = `refused${n}`;
    let calls = 0;
    harness.pages = () => pageUrls("a", 1);
    harness.fetch = async () => { calls++; throw c.error(); };
    await M.downloadChapter(manga, title, chapter(id, n++));
    const failed = await settled(`${manga.id}:${id}`);
    assert.equal(failed.status, "failed", c.why);
    assert.match(failed.error, c.message, c.why);
    assert.equal(calls, 1, `${c.why}: never retried as a network drop`);
  }
  // A bug in a source's page list isn't the network either.
  const id = "pagelist1";
  harness.pages = () => { throw new TypeError("Cannot read properties of undefined (reading 'url')"); };
  await M.downloadChapter(manga, title, chapter(id, 30));
  assert.equal((await settled(`${manga.id}:${id}`)).status, "failed");
});

test("a page that keeps returning 5xx fails the chapter after three stalls, keeping its pages", async () => {
  const id = "broken1";
  let calls = 0;
  harness.pages = () => pageUrls("a", 2);
  harness.fetch = async (url) => {
    if (indexOf(url) === 1) { calls++; return new Response("", { status: 502 }); }
    return image(indexOf(url));
  };
  await M.downloadChapter(manga, title, chapter(id, 40));
  const failed = await settled(`${manga.id}:${id}`);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "The source kept failing on part of this chapter. Try again later.");
  assert.ok(calls >= 3 * 7, `three runs of six retries: ${calls}`);
  assert.ok(fs.existsSync(path.join(dir(id), "001.jpg")), "the saved page stays for the next try");
});

test("no answer while online is a stall, not a wait for the network, and fails after three", async () => {
  const id = "unreach1";
  harness.pages = () => pageUrls("a", 1);
  harness.fetch = async () => { throw new TypeError("net::ERR_CONNECTION_REFUSED"); };
  await M.downloadChapter(manga, title, chapter(id, 41));
  const failed = await settled(`${manga.id}:${id}`);
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /kept failing/);
  const labels = events.map((e) => e.item).filter((item) => item?.key === `${manga.id}:${id}` && item.status === "queued").map((item) => item.error ?? "");
  assert.ok(labels.length && labels.every((label) => !/network/.test(label)), `it never claimed to wait for the network: ${labels}`);
});

test("removing a chapter that waits out a long rate limit ends the wait and frees the worker", async () => {
  const id = "limited9";
  const after = "after9";
  harness.pages = () => pageUrls("a", 1);
  harness.fetch = async (url) => (url.includes("/c/") && harness.limit ? new Response("", { status: 429, headers: { "retry-after": "999999" } }) : image(indexOf(url)));
  harness.limit = true;
  await M.downloadChapter(manga, title, chapter(id, 50));
  await waitFor(() => events.some((e) => e.item?.key === `${manga.id}:${id}` && /asked to wait/.test(e.item.error ?? "")), "the rate-limit wait");
  harness.limit = false;
  await M.downloadChapter(manga, title, chapter(after, 51));
  const started = Date.now();
  await M.removeMangaDownload(`${manga.id}:${id}`);
  assert.equal((await settled(`${manga.id}:${after}`)).status, "done");
  assert.ok(Date.now() - started < 5000, "the next chapter didn't wait six hours");
});

// The source wrappers' own errors for a request that got no answer, made by the real code.
const requireHere = createRequire(import.meta.url);
function desktopModule(file, overrides) {
  const url = new URL(`../apps/desktop/main/services/${file}.ts`, import.meta.url);
  const code = ts.transpileModule(fs.readFileSync(url, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, require: (id) => overrides[id] ?? requireHere(id),
    Buffer, URL, Response, AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, console: { warn() {} },
  }, { filename: url.pathname, timeout: 2000 });
  return module.exports;
}
/** Comix's image request failing in the transport ([fail]: the request's error, or "dns"). */
async function comixError(fail) {
  const https = { request() {
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () => queueMicrotask(() => req.emit("error", fail));
    return req;
  } };
  const dns = fail === "dns"
    ? { lookup(_host, _options, callback) { callback(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" })); } }
    : { lookup(_host, _options, callback) { callback(null, [{ address: "8.8.8.8", family: 4 }]); } };
  const api = desktopModule("manga/comix-images", {
    "./comix-image-codec": {}, "electron": { nativeImage: {}, BrowserWindow: class {}, session: {} }, "node:https": https, "node:dns": dns,
  });
  // Offline, the socket's own lookup is what fails.
  if (fail === "dns") return new Promise((resolve) => api.comixImageLookup("cdn.comix.example", { family: 0, hints: 0, all: true }, resolve));
  return api.fetchComixImage("https://cdn.comix.example/p1.webp").then(() => null, (error) => error);
}
/** A verified page (MangaDot, Toonkotsu) whose in-page fetch or page load gets no answer. */
function verifiedPage({ fetchError = null, loadError = null, result = null } = {}) {
  class Window extends EventEmitter {
    constructor() {
      super();
      this.url = "";
      const contents = new EventEmitter();
      const session = Object.assign(new EventEmitter(), { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} });
      Object.assign(contents, {
        session, getURL: () => this.url, setAudioMuted() {}, setWindowOpenHandler() {}, executeJavaScript: async () => "MangaDot",
        executeJavaScriptInIsolatedWorld: async () => { if (fetchError) throw fetchError; return result; },
      });
      this.webContents = contents;
    }
    async loadURL(url) {
      if (loadError && url !== "https://mangadot.example/") throw loadError;
      this.url = url;
      this.webContents.emit("did-finish-load");
    }
    isDestroyed() { return false; } isVisible() { return false; } hide() {} show() {} focus() {} setTitle() {} destroy() {}
  }
  const api = desktopModule("providers/verified-page-session", { electron: { app: new EventEmitter(), BrowserWindow: Window } });
  return new api.VerifiedPageSession({ origin: "https://mangadot.example", partition: "test", label: "MangaDot", world: 1210 });
}
const rejection = (promise) => promise.then(() => null, (error) => error);
const chromiumError = (code, errno) => Object.assign(new Error(`${code} (${errno}) loading 'https://mangadot.example/title/1/2'`), { code, errno });

test("a reset, timeout or unreachable page from a source's own wrapper is retried like a network drop", async () => {
  const reset = await comixError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
  assert.match(reset.message, /Comix image request failed/);
  const dns = await comixError("dns");
  assert.match(dns.message, /DNS lookup failed/);
  const dot = await rejection(verifiedPage({ fetchError: new TypeError("Failed to fetch") }).get("https://mangadot.example/img/p1.webp", "image/*"));
  assert.equal(dot.name, "NoAnswerError");
  const unreachable = await rejection(verifiedPage({ loadError: chromiumError("ERR_INTERNET_DISCONNECTED", -106) }).readPage("https://mangadot.example/title/1/2", "reader"));
  assert.equal(unreachable.name, "NoAnswerError");
  const cases = [
    { why: "Comix: a connection reset", error: reset },
    { why: "Comix: a DNS failure", error: dns },
    { why: "Comix: its own deadline", error: Object.assign(new Error("Comix image took too long to load. Retry this page."), { name: "TimeoutError" }) },
    { why: "MangaDot: the in-page fetch got no answer", error: dot },
    { why: "a verified reader page that couldn't be reached", error: unreachable },
  ];
  let n = 60;
  for (const c of cases) {
    const id = `wrapped${n}`;
    let calls = 0;
    harness.pages = () => pageUrls("a", 2);
    harness.fetch = async (url) => {
      if (indexOf(url) === 1 && calls++ === 0) throw c.error;
      return image(indexOf(url));
    };
    await M.downloadChapter(manga, title, chapter(id, n++));
    const done = await settled(`${manga.id}:${id}`);
    assert.equal(done.status, "done", `${c.why}: ${done.error}`);
    assert.equal(calls, 2, `${c.why}: tried again`);
  }
});

test("a verified page's own refusals still aren't taken for the network", async () => {
  const malformed = await rejection(verifiedPage({ result: { nope: true } }).get("https://mangadot.example/img/p1.webp", "image/*"));
  assert.notEqual(malformed.name, "NoAnswerError");
  const replaced = await rejection(verifiedPage({ loadError: chromiumError("ERR_ABORTED", -3) }).readPage("https://mangadot.example/title/1/2", "reader"));
  assert.notEqual(replaced.name, "NoAnswerError");
  const id = "wrapped70";
  let calls = 0;
  harness.pages = () => pageUrls("a", 1);
  harness.fetch = async () => { calls++; throw malformed; };
  await M.downloadChapter(manga, title, chapter(id, 70));
  assert.equal((await settled(`${manga.id}:${id}`)).status, "failed");
  assert.equal(calls, 1);
});

test("offline, a page the source couldn't load waits for the network instead of failing the chapter", async () => {
  const { MangaSourceError } = await import(sources);
  const id = "offline80";
  const fetched = [];
  harness.pages = () => pageUrls("a", 3);
  harness.fetch = async (url) => {
    const i = indexOf(url);
    // Toonkotsu's reader page fails to load while the network is gone.
    if (!harness.online) throw new MangaSourceError("Toonkotsu couldn't load this page. Retry or choose another source.");
    fetched.push(i);
    if (i === 0) harness.online = false;
    return image(i);
  };
  await M.downloadChapter(manga, title, chapter(id, 80));
  await waitFor(() => events.some((e) => e.item?.key === `${manga.id}:${id}` && e.item.status === "queued" && /network/.test(e.item.error ?? "")), "the network wait");
  harness.online = true;
  const done = await settled(`${manga.id}:${id}`);
  assert.equal(done.status, "done", done.error);
  assert.deepEqual(new Set(fetched), new Set([0, 1, 2]));
});

after(() => {
  const resolved = path.resolve(storageRoot);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("anitrack-manga-dl-test-")) throw new Error("Invalid fixture cleanup path");
  fs.rmSync(resolved, { recursive: true, force: true });
  delete globalThis.__anitrackMangaFixture;
});
