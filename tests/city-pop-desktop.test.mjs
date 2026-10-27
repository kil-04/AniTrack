import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const archivePath = path.join(root, "apps/desktop/main/services/city-pop-archive.ts");
const playerPath = path.join(root, "apps/desktop/main/services/city-pop-player.ts");
const ipcPath = path.join(root, "apps/desktop/main/ipc/city-pop.ts");
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

/** Run complete production modules, replacing only process/platform boundaries (and, for timeouts, the clock). */
function loader(electron, fetch, overrides = new Map(), globals = {}) {
  const modules = new Map();
  const context = vm.createContext({ Buffer, URL, URLSearchParams, Request, Response, Headers, AbortController, AbortSignal, ReadableStream, Uint8Array, TextEncoder, setTimeout, clearTimeout, fetch, ...globals });
  const load = (filename) => {
    if (overrides.has(filename)) return overrides.get(filename);
    if (modules.has(filename)) return modules.get(filename).exports;
    if (filename.endsWith(".json")) return JSON.parse(fs.readFileSync(filename, "utf8"));
    const module = { exports: {} };
    modules.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true } }).outputText;
    const localRequire = (name) => {
      if (overrides.has(name)) return overrides.get(name);
      if (name === "electron") return electron;
      if (!name.startsWith(".")) return require(name);
      const resolved = path.resolve(path.dirname(filename), name);
      return load(fs.existsSync(resolved) ? resolved : `${resolved}.ts`);
    };
    vm.runInContext(`(function(require,module,exports){${code}\n})`, context, { filename })(localRequire, module, module.exports);
    return module.exports;
  };
  return load;
}

async function until(check, message = "operation completed", attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return;
    await delay(10);
  }
  assert.fail(`Timed out waiting for ${message}`);
}

function archiveFixture(t, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "anitrack-citypop-test-"));
  const calls = [];
  const bytes = Buffer.from("0123456789");
  const metadata = { metadata: { identifier: "test-album", mediatype: "audio", creator: "Fixture Artist" }, files: options.files ?? [{ name: "song.mp3", title: "Fixture Song", size: "10" }] };
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (String(url).includes("/metadata/")) return Response.json(metadata);
    return options.media ? options.media(url, init, calls) : new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 3)); controller.enqueue(bytes.subarray(3)); controller.close(); } }), { headers: { "content-type": "audio/mpeg", "content-length": "10" } });
  };
  const electron = { app: { getPath: () => temp, getVersion: () => "test" } };
  const service = loader(electron, fetch, new Map([["node:fs", options.fileSystem ?? fs]]), options.globals)(archivePath);
  const dir = path.join(temp, "city-pop-downloads");
  const settled = async (key, status) => until(() => {
    if (service.cityPopDownloads().find((row) => row.key === key)?.status !== status) return false;
    if (!fs.existsSync(dir) || fs.readdirSync(dir).some((name) => name.endsWith(".part"))) return false;
    try { return JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")).some((row) => row.key === key && row.status === status); } catch { return false; }
  }, `download ${status}`);
  t.after(async () => {
    for (const row of service.cityPopDownloads()) if (["queued", "downloading"].includes(row.status)) service.cancelCityPopDownload(row.key);
    await until(() => !fs.existsSync(dir) || !fs.readdirSync(dir).some((name) => name.endsWith(".part")), "temporary downloads cleaned");
    await delay(20);
    const resolved = fs.realpathSync(temp);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith("anitrack-citypop-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { service, calls, bytes, temp, dir, settled, metadata, reload: () => loader(electron, async () => { throw new TypeError("fetch failed"); })(archivePath) };
}

/** Long timers 250 times faster: a minute's stall window takes 240 ms (the old 15-minute cap would be 3.6 s). */
const fastTimers = { setTimeout: (fn, ms, ...args) => setTimeout(fn, ms >= 10_000 ? ms / 250 : ms, ...args), clearTimeout };

test("City Pop desktop: a download writes exact bytes, survives restart and serves full/ranged offline media", async (t) => {
  const fixture = archiveFixture(t);
  const { service, bytes } = fixture;
  const { key } = await service.downloadCityPopArchive("test-album", "song.mp3");
  await fixture.settled(key, "completed");
  const files = fs.readdirSync(fixture.dir).filter((name) => name.endsWith(".mp3"));
  assert.equal(files.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(fixture.dir, files[0])), bytes);
  assert.equal(service.cityPopDownloads()[0].bytes, 10);
  assert.ok(fixture.calls.every((call) => call.init.credentials === "omit" && call.init.redirect === "manual"));
  const offline = fixture.reload();
  const local = offline.localCityPopTrack(key);
  assert.equal(local.url, `anitrack-city-pop://download/${key}`);
  assert.equal(local.track.title, "Fixture Song");
  const full = await offline.serveCityPopDownload(new Request(local.url));
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
  for (const [range, body, contentRange] of [["bytes=2-5", "2345", "bytes 2-5/10"], ["bytes=-3", "789", "bytes 7-9/10"], ["bytes=8-", "89", "bytes 8-9/10"], ["bytes=0-99", "0123456789", "bytes 0-9/10"]]) {
    const response = await offline.serveCityPopDownload(new Request(local.url, { headers: { Range: range } }));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), contentRange);
    assert.equal(await response.text(), body);
  }
  const head = await offline.serveCityPopDownload(new Request(local.url, { method: "HEAD" }));
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "10");
  assert.equal(await head.text(), "");
});

test("City Pop desktop: local receipts reject paths, schemes, methods and malformed ranges", async (t) => {
  const fixture = archiveFixture(t);
  const { key } = await fixture.service.downloadCityPopArchive("test-album", "song.mp3");
  await fixture.settled(key, "completed");
  for (const url of [`https://download/${key}`, `anitrack-city-pop://download/${key}?file=secret`, `anitrack-city-pop://download/${key}#hash`, `anitrack-city-pop://download/../../secret`, `anitrack-city-pop://other/${key}`, `anitrack-city-pop://download:80/${key}`, `anitrack-city-pop://user@download/${key}`]) {
    const response = await fixture.service.serveCityPopDownload({ url, method: "GET", headers: new Headers() });
    assert.equal(response.status, 404, url);
  }
  const url = `anitrack-city-pop://download/${key}`;
  assert.equal((await fixture.service.serveCityPopDownload(new Request(url, { method: "POST" }))).status, 404);
  for (const range of ["bytes=-", "bytes=99-100", "bytes=7-2", "bytes=-0", "bytes=0-1,3-4", "anything", "bytes=999999999999999999999999-"]) {
    const response = await fixture.service.serveCityPopDownload(new Request(url, { headers: { Range: range } }));
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get("content-range"), "bytes */10");
  }
  fixture.service.removeCityPopDownload(key);
  assert.throws(() => fixture.service.localCityPopTrack(key), /not available offline/);
  assert.equal((await fixture.service.serveCityPopDownload(new Request(url))).status, 404);
  assert.equal(fs.readdirSync(fixture.dir).filter((name) => name.endsWith(".mp3")).length, 0);
});

test("City Pop desktop: cancellation aborts transport, removes partial bytes and permits a clean retry", async (t) => {
  let attempts = 0;
  const fixture = archiveFixture(t, { media: (_url, init) => {
    attempts++;
    if (attempts > 1) return new Response("0123456789", { headers: { "content-length": "10" } });
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode("012"));
      init.signal.addEventListener("abort", () => controller.error(new Error("Aborted")), { once: true });
    } }), { headers: { "content-length": "10" } });
  } });
  const { key } = await fixture.service.downloadCityPopArchive("test-album", "song.mp3");
  await until(() => fixture.service.cityPopDownloads()[0]?.bytes === 3, "partial bytes received");
  fixture.service.cancelCityPopDownload(key);
  await fixture.settled(key, "error");
  assert.equal(fixture.calls.at(-1).init.signal.aborted, true);
  assert.equal(fs.readdirSync(fixture.dir).filter((name) => /\.(mp3|part)$/.test(name)).length, 0);
  await fixture.service.downloadCityPopArchive("test-album", "song.mp3");
  await fixture.settled(key, "completed");
  assert.equal(fixture.service.cityPopDownloads()[0].bytes, 10);
  assert.equal(attempts, 2);
});

test("City Pop desktop: cancel and remove during final rename cannot complete or leave a saved file", async (t) => {
  for (const operation of ["cancel", "remove"]) {
    const entered = deferred(), release = deferred(), cleaned = deferred();
    const fixture = archiveFixture(t, { fileSystem: { ...fs, promises: { ...fs.promises,
      rename: async (...args) => { entered.resolve(); await release.promise; return fs.promises.rename(...args); },
      unlink: async (...args) => {
        try { return await fs.promises.unlink(...args); }
        finally { if (String(args[0]).endsWith(".part")) cleaned.resolve(); }
      },
    } } });
    const { key } = await fixture.service.downloadCityPopArchive("test-album", "song.mp3");
    await entered.promise;
    if (operation === "cancel") fixture.service.cancelCityPopDownload(key);
    else fixture.service.removeCityPopDownload(key);
    release.resolve();
    await cleaned.promise;
    if (operation === "cancel") await fixture.settled(key, "error");
    else assert.equal(fixture.service.cityPopDownloads().length, 0);
    assert.equal(fs.readdirSync(fixture.dir).filter((name) => /\.(mp3|part)$/.test(name)).length, 0, operation);
    assert.throws(() => fixture.service.localCityPopTrack(key), /not available offline/);
  }
});

test("City Pop desktop: retrying the same receipt during old rename cleanup preserves the replacement file", async (t) => {
  for (const operation of ["cancel", "remove"]) {
    const entered = deferred(), release = deferred();
    let renames = 0;
    const fixture = archiveFixture(t, { fileSystem: { ...fs, promises: { ...fs.promises,
      rename: async (...args) => {
        if (++renames === 1) { entered.resolve(); await release.promise; }
        return fs.promises.rename(...args);
      },
    } } });
    const { key } = await fixture.service.downloadCityPopArchive("test-album", "song.mp3");
    await entered.promise;
    if (operation === "cancel") fixture.service.cancelCityPopDownload(key);
    else fixture.service.removeCityPopDownload(key);
    assert.equal((await fixture.service.downloadCityPopArchive("test-album", "song.mp3")).key, key);
    release.resolve();
    await fixture.settled(key, "completed");
    assert.equal(renames, 2, operation);
    const response = await fixture.service.serveCityPopDownload(new Request(fixture.service.localCityPopTrack(key).url));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fixture.bytes);
    assert.equal(fs.readdirSync(fixture.dir).filter((name) => name.endsWith(".mp3")).length, 1);
  }
});

test("City Pop desktop: partial responses, truncated files and external redirects cannot complete", async (t) => {
  for (const variant of ["partial", "truncated", "missing-length", "changed-length", "redirect", "html"]) {
    const fixture = archiveFixture(t, { media: () => variant === "partial"
      ? new Response("012", { status: 206, headers: { "content-range": "bytes 0-2/10", "content-length": "3" } })
      : variant === "truncated" ? new Response("012", { headers: { "content-length": "10" } })
        : variant === "missing-length" ? new Response(new TextEncoder().encode("012"))
          : variant === "changed-length" ? new Response("012345", { headers: { "content-length": "6" } })
        : variant === "redirect" ? new Response(null, { status: 302, headers: { location: "https://evil.test/song.mp3" } })
          : new Response("<html>Login</html>", { headers: { "content-type": "text/html" } }) });
    const { key } = await fixture.service.downloadCityPopArchive("test-album", "song.mp3");
    await fixture.settled(key, "error");
    assert.equal(fs.readdirSync(fixture.dir).filter((name) => /\.(mp3|part)$/.test(name)).length, 0);
    assert.ok(fixture.calls.every((call) => !String(call.url).includes("evil.test")));
    assert.throws(() => fixture.service.localCityPopTrack(key), /not available offline/);
  }
});

test("City Pop desktop: a source403 or429 stops remaining queued downloads without an automatic retry", async (t) => {
  for (const status of [403, 429]) {
    const answer = deferred();
    const fixture = archiveFixture(t, {
      files: [{ name: "song.mp3", size: "10" }, { name: "second.mp3", size: "10" }],
      media: () => answer.promise,
    });
    const first = await fixture.service.downloadCityPopArchive("test-album", "song.mp3");
    const second = await fixture.service.downloadCityPopArchive("test-album", "second.mp3");
    assert.equal(fixture.service.cityPopDownloads().find((row) => row.key === second.key).status, "queued");
    answer.resolve(new Response(null, { status }));
    await fixture.settled(first.key, "error");
    await fixture.settled(second.key, "error");
    assert.equal(fixture.calls.filter((call) => String(call.url).includes("/download/")).length, 1);
    assert.match(fixture.service.cityPopDownloads().find((row) => row.key === second.key).error, /Try again later/);
    assert.equal(fs.readdirSync(fixture.dir).filter((name) => /\.(mp3|part)$/.test(name)).length, 0);
  }
});

test("City Pop desktop: a stalled download times out with its own message; a slow one that keeps moving finishes", async (t) => {
  const stalled = archiveFixture(t, { globals: fastTimers, media: (_url, init) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode("012"));
    init.signal.addEventListener("abort", () => controller.error(new Error("Aborted")), { once: true });
  } }), { headers: { "content-length": "10" } }) });
  const { key } = await stalled.service.downloadCityPopArchive("test-album", "song.mp3");
  await stalled.settled(key, "error");
  const row = stalled.service.cityPopDownloads()[0];
  assert.match(row.error, /stopped sending/);
  assert.doesNotMatch(row.error, /cancelled/i);
  assert.equal(fs.readdirSync(stalled.dir).filter((name) => /\.(mp3|part)$/.test(name)).length, 0);

  // 70 bytes, one every 60 ms: never a stall (240 ms here), but 4.2 s in all, past the old cap (3.6 s here).
  const slow = archiveFixture(t, { globals: fastTimers, files: [{ name: "song.mp3", title: "Slow Song", size: "70" }], media: () => new Response(new ReadableStream({ async start(controller) {
    for (let i = 0; i < 70; i++) { await delay(60); controller.enqueue(new TextEncoder().encode(String(i % 10))); }
    controller.close();
  } }), { headers: { "content-length": "70" } }) });
  const second = await slow.service.downloadCityPopArchive("test-album", "song.mp3");
  await until(() => slow.service.cityPopDownloads()[0]?.status !== "downloading" && slow.service.cityPopDownloads()[0]?.status !== "queued", "slow download finished", 1000);
  assert.equal(slow.service.cityPopDownloads()[0].status, "completed", slow.service.cityPopDownloads()[0].error ?? "");
  assert.equal(slow.service.cityPopDownloads()[0].bytes, 70);
  await slow.settled(second.key, "completed");
});

test("City Pop desktop: failures read as plain connection or disk messages, never Node internals", async (t) => {
  const offline = archiveFixture(t, { media: async () => { throw new TypeError("fetch failed"); } });
  const { key } = await offline.service.downloadCityPopArchive("test-album", "song.mp3");
  await offline.settled(key, "error");
  assert.equal(offline.service.cityPopDownloads()[0].error, "Couldn't reach Archive.org. Check your connection and try again.");

  const full = archiveFixture(t, { fileSystem: { ...fs, promises: { ...fs.promises, open: async (...args) => {
    const handle = await fs.promises.open(...args);
    return { writeFile: async () => { throw Object.assign(new Error(`ENOSPC: no space left on device, write '${args[0]}'`), { code: "ENOSPC" }); }, close: () => handle.close() };
  } } } });
  const second = await full.service.downloadCityPopArchive("test-album", "song.mp3");
  await full.settled(second.key, "error");
  assert.equal(full.service.cityPopDownloads()[0].error, "Not enough free disk space for this download.");

  // Calls the page makes reject with the same plain text.
  const reloaded = full.reload();
  await assert.rejects(reloaded.cityPopArchiveItem("test-album"), (error) => error.message === "Couldn't reach Archive.org. Check your connection and try again.");
  await assert.rejects(reloaded.resolveCityPopArchiveQueue("test-album", ["song.mp3"]), /Couldn't reach Archive\.org/);
  await assert.rejects(reloaded.searchCityPopArchive("Miki", 1), /Couldn't reach Archive\.org/);
});

test("City Pop desktop: partial files left by a quit or crash are removed at the next start", async (t) => {
  const fixture = archiveFixture(t);
  const { key } = await fixture.service.downloadCityPopArchive("test-album", "song.mp3");
  await fixture.settled(key, "completed");
  const stray = path.join(fixture.dir, `${"b".repeat(64)}.mp4.part`);
  fs.writeFileSync(stray, "half a video");
  const restarted = fixture.reload();
  assert.equal(restarted.cityPopDownloads().length, 1);
  assert.equal(fs.existsSync(stray), false);
  assert.equal(restarted.localCityPopTrack(key).url, `anitrack-city-pop://download/${key}`);
});

test("City Pop desktop: an index that can't be saved never stalls the download queue", async (t) => {
  let failures = 0;
  const fixture = archiveFixture(t, {
    files: [{ name: "song.mp3", size: "10" }, { name: "second.mp3", size: "10" }],
    fileSystem: { ...fs, renameSync: (from, to) => { failures++; throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), { code: "EPERM" }); } },
  });
  const first = await fixture.service.downloadCityPopArchive("test-album", "song.mp3");
  const second = await fixture.service.downloadCityPopArchive("test-album", "second.mp3");
  await until(() => fixture.service.cityPopDownloads().every((row) => row.status === "completed"), "both downloads completed");
  assert.deepEqual(Array.from(fixture.service.cityPopDownloads(), (row) => row.key).sort(), [first.key, second.key].sort());
  assert.ok(failures > 0);
});

test("City Pop desktop: an item with nothing playable is asked for again, not cached", async (t) => {
  const fixture = archiveFixture(t, { files: [] });
  assert.equal((await fixture.service.cityPopArchiveItem("test-album")).length, 0);
  fixture.metadata.files = [{ name: "song.mp3", title: "Fixture Song", size: "10" }];
  assert.deepEqual(Array.from(await fixture.service.cityPopArchiveItem("test-album"), (track) => track.fileName), ["song.mp3"]);
  assert.equal(fixture.calls.filter((call) => String(call.url).includes("/metadata/")).length, 2);
  // A real track list is kept for a while.
  await fixture.service.cityPopArchiveItem("test-album");
  assert.equal(fixture.calls.filter((call) => String(call.url).includes("/metadata/")).length, 2);
});

/** YouTube's desktop results page, trimmed to what the parser reads. */
const resultsPage = (rows) => `<html><script>var ytInitialData = ${JSON.stringify({ estimatedResults: String(rows.length), contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: rows } }] } } } } })};</script></html>`;

/** The queue the player page plays, read from its script. */
const playerQueue = (html) => JSON.parse(/const items=(.*?),MODE=/s.exec(html)[1]);

function playerFixture(options = {}) {
  const state = { windows: [], partitions: [], external: [], sent: [], handlers: new Map(), load: options.load };
  class Contents extends EventEmitter {
    mainFrame = {};
    send(...args) { state.sent.push(args); }
    setWindowOpenHandler(handler) { this.open = handler; }
    setAudioMuted(value) { this.muted = value; }
    executeJavaScript(source) { this.script = source; return Promise.resolve(); }
  }
  class Window extends EventEmitter {
    destroyed = false;
    webContents = new Contents();
    constructor(config) { super(); this.config = config; state.windows.push(this); }
    isDestroyed() { return this.destroyed; }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit("closed"); } }
    loadURL(url, options) { this.url = url; this.loadOptions = options; return state.load ? state.load(this) : Promise.resolve(); }
  }
  const owner = new EventEmitter();
  owner.destroyed = false;
  owner.webContents = new Contents();
  owner.isDestroyed = () => owner.destroyed;
  owner.destroy = () => { owner.destroyed = true; owner.emit("closed"); };
  const partition = new EventEmitter();
  partition.setPermissionRequestHandler = (fn) => { partition.permissionRequest = fn; };
  partition.setPermissionCheckHandler = (fn) => { partition.permissionCheck = fn; };
  partition.webRequest = { onBeforeSendHeaders: (filter, handler) => { partition.referrer = { filter, handler }; } };
  partition.protocol = { handle: (scheme, handler) => { partition.protocolHandler = { scheme, handler }; } };
  const electron = { BrowserWindow: Window, session: { fromPartition: (name) => { state.partitions.push(name); return partition; } }, shell: { openExternal: async (url) => { state.external.push(url); } }, ipcMain: { handle: (name, fn) => { state.handlers.set(name, fn); } } };
  const archive = { searchCityPopArchive: options.archiveSearch ?? (async () => ({ items: [], total: 0, page: 1 })), resolveCityPopArchiveQueue: options.resolve ?? (async (id, names) => names.map((fileName) => ({ track: { itemId: id, fileName, title: `Fixture ${fileName}`, artist: "Artist", url: `https://archive.org/download/${id}/${fileName}`, mediaType: "audio" }, url: `https://archive.org/download/${id}/${fileName}` }))), localCityPopTrack: () => ({ track: { itemId: "test-album", title: "Offline", artist: "Artist", mediaType: "audio" }, url: `anitrack-city-pop://download/${"a".repeat(64)}` }), serveCityPopDownload: () => new Response("offline") };
  const load = loader(electron, options.searchFetch ?? (async () => { throw new Error("Unexpected network"); }), new Map([[archivePath, archive]]));
  return { player: load(playerPath), owner, state, partition, load };
}

test("City Pop desktop: YouTube search sends the exact query and preserves relevance without a catalog filter", async () => {
  const calls = [];
  const rows = [
    { videoRenderer: { videoId: "T_lC2O1oIew", title: { runs: [{ text: "Mariya Takeuchi - Plastic Love (Official Music Video)" }] }, ownerText: { runs: [{ text: "Mariya Takeuchi" }] } } },
    { videoRenderer: { videoId: "WpQCCB0Lpik", title: { simpleText: "Plastic Love (Live Version)" }, ownerText: { simpleText: "Mariya Takeuchi" } } },
  ];
  const fixture = playerFixture({ searchFetch: async (url, init) => {
    calls.push({ url: new URL(url), init });
    return new Response(resultsPage(rows));
  } });
  const results = await fixture.player.searchCityPop("  plastic love live 日本語 & 1984  ");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, "https://www.youtube.com");
  assert.equal(calls[0].url.pathname, "/results");
  assert.equal(calls[0].url.searchParams.get("search_query"), "plastic love live 日本語 & 1984");
  assert.deepEqual([...calls[0].url.searchParams.keys()], ["search_query"]);
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.redirect, "error");
  assert.deepEqual(Array.from(results, (row) => row.videoId), ["T_lC2O1oIew", "WpQCCB0Lpik"]);
  assert.equal(fixture.state.windows.length, 0);
  await fixture.player.openCityPop(fixture.owner, [results[1].id], "watch");
  const win = fixture.state.windows[0];
  const playerHtml = decodeURIComponent(win.url.split(",").slice(1).join(","));
  assert.deepEqual(Array.from(playerQueue(playerHtml), (item) => item.media), ["WpQCCB0Lpik"]);
  assert.match(playerHtml, /<script src="https:\/\/www\.youtube\.com\/iframe_api"><\/script>/);
  // A real origin for the page (a data: page has none, and YouTube then skips some videos).
  assert.equal(win.loadOptions.baseURLForDataURL, "https://com.sanjay.anitrack/");
  assert.match(playerHtml, /origin:"https:\/\/com\.sanjay\.anitrack"/);
  fixture.player.closeCityPop();
});

test("City Pop desktop: YouTube check pages fail visibly while legitimate zero matches remain empty", async () => {
  for (const body of ["<html><title>Before you continue to YouTube</title></html>", "<html><title>Sorry...</title>Unusual traffic</html>", "<script>var ytInitialData = JSON.parse('untrusted');</script>", '<script>window["ytInitialData"] = {"contents":{}};</script>', "<script>var ytInitialData = {bad};</script>"]) {
    const fixture = playerFixture({ searchFetch: async () => new Response(body) });
    await assert.rejects(fixture.player.searchCityPop("plastic love"), /YouTube search is unavailable/);
    assert.equal(fixture.state.windows.length, 0);
  }
  const empty = playerFixture({ searchFetch: async () => new Response(resultsPage([]).replace("var ytInitialData", 'window["ytInitialData"]')) });
  assert.equal((await empty.player.searchCityPop("unmatched request")).length, 0);
});

test("City Pop desktop: the player uses an isolated session and prevents remote native access", async () => {
  const fixture = playerFixture();
  try {
    assert.throws(() => fixture.player.openCityPop(fixture.owner, ["invalid"], "watch"), /Unknown/);
    assert.equal(fixture.state.windows.length, 0);
    const result = await fixture.player.openCityPop(fixture.owner, ["miki-matsubara-stay-with-me"], "listen");
    assert.equal(result.ok, true);
    const win = fixture.state.windows[0];
    const preferences = win.config.webPreferences;
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.webSecurity, true);
    assert.equal(preferences.preload, undefined);
    assert.deepEqual(fixture.state.partitions, ["city-pop-player"]);
    let permitted = true;
    fixture.partition.permissionRequest({}, "camera", (value) => { permitted = value; });
    assert.equal(permitted, false);
    assert.equal(fixture.partition.permissionCheck(), false);
    assert.equal(fixture.partition.permissionCheck({}, "media"), false);
    // Fullscreen is the one exception: the YouTube player's button and the video controls.
    fixture.partition.permissionRequest({}, "fullscreen", (value) => { permitted = value; });
    assert.equal(permitted, true);
    assert.equal(fixture.partition.permissionCheck({}, "fullscreen"), true);
    let prevented = false;
    fixture.partition.emit("will-download", { preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(fixture.partition.protocolHandler.scheme, "anitrack-city-pop");
    assert.equal(win.webContents.open({ url: "https://evil.test" }).action, "deny");
    assert.equal(fixture.state.external.length, 0);
    win.webContents.open({ url: "https://www.youtube.com/watch?v=nuU2YHtxMik" });
    assert.equal(fixture.state.external.length, 1);
    const event = { preventDefault() { this.prevented = true; } };
    win.webContents.emit("will-navigate", event);
    assert.equal(event.prevented, true);
    win.emit("hide");
    assert.equal(win.webContents.muted, true);
    assert.match(win.webContents.script, /cityPopPause/);
    win.emit("show");
    assert.equal(win.webContents.muted, false);
    fixture.owner.destroy();
    assert.equal(fixture.player.cityPopIsOpen(), false);
    assert.equal(fixture.owner.listenerCount("closed"), 0);
  } finally { fixture.player.closeCityPop(); }
});

test("City Pop desktop: late Archive metadata cannot replace a newer player or reopen a closed player", async () => {
  const pending = [];
  const fixture = playerFixture({ resolve: () => { const wait = deferred(); pending.push(wait); return wait.promise; } });
  const track = { title: "Old request", artist: "Artist", mediaType: "audio", url: "https://archive.org/download/test/song.mp3" };
  const album = [{ track, url: track.url }];
  try {
    const old = fixture.player.playArchiveCityPop(fixture.owner, "old", ["song.mp3"], 0, "listen");
    await fixture.player.openCityPop(fixture.owner, ["miki-matsubara-stay-with-me"], "watch");
    pending[0].resolve(album);
    assert.equal((await old).ok, false);
    assert.equal(fixture.state.windows.length, 1);
    assert.equal(fixture.player.cityPopIsOpen(), true);
    const closing = fixture.player.playArchiveCityPop(fixture.owner, "old", ["song.mp3"], 0, "listen");
    fixture.player.closeCityPop();
    pending[1].resolve(album);
    assert.equal((await closing).ok, false);
    assert.equal(fixture.player.cityPopIsOpen(), false);
    const destroyed = fixture.player.playArchiveCityPop(fixture.owner, "old", ["song.mp3"], 0, "listen");
    fixture.owner.destroy();
    pending[2].resolve(album);
    assert.equal((await destroyed).ok, false);
    assert.equal(fixture.state.windows.length, 1);
  } finally { fixture.player.closeCityPop(); }
});

test("City Pop desktop: replacement and failed loading clean up windows and owner listeners", async () => {
  const pending = [];
  const fixture = playerFixture({ load: () => { const wait = deferred(); pending.push(wait); return wait.promise; } });
  try {
    const first = fixture.player.openCityPop(fixture.owner, ["miki-matsubara-stay-with-me"], "watch");
    const second = fixture.player.openCityPop(fixture.owner, ["mariya-takeuchi-plastic-love"], "watch");
    assert.equal(fixture.state.windows[0].destroyed, true);
    assert.equal(fixture.owner.listenerCount("closed"), 1);
    pending[0].resolve();
    assert.equal((await first).ok, false);
    pending[1].reject(new Error("Load failed"));
    await assert.rejects(second, /Couldn't open/);
    assert.equal(fixture.player.cityPopIsOpen(), false);
    assert.equal(fixture.owner.listenerCount("closed"), 0);
    fixture.owner.destroy();
    assert.equal((await fixture.player.openCityPop(fixture.owner, ["miki-matsubara-stay-with-me"], "watch")).ok, false);
    assert.equal(fixture.state.windows.length, 2);
  } finally { fixture.player.closeCityPop(); }
});

test("City Pop desktop: IPC accepts only the main frame and validates mode, receipts, pagination and media filters", async () => {
  const searches = [];
  const youtube = [];
  const fixture = playerFixture({
    archiveSearch: async (...args) => { searches.push(args); return { items: [], total: 0, page: args[1] }; },
    searchFetch: async (url) => { youtube.push(new URL(url).searchParams.get("search_query")); return new Response(resultsPage([])); },
  });
  fixture.load(ipcPath).registerCityPopIpc(() => fixture.owner);
  const event = { sender: fixture.owner.webContents, senderFrame: fixture.owner.webContents.mainFrame };
  const types = fixture.load(path.join(root, "packages/shared/types.ts")).IPC;
  const invoke = (key, ...args) => fixture.state.handlers.get(types[key])(event, ...args);
  assert.equal(invoke("CITY_POP_STATUS"), false);
  for (const [, handler] of fixture.state.handlers) {
    assert.throws(() => handler({ sender: {}, senderFrame: event.senderFrame }), /only available/);
    assert.throws(() => handler({ sender: event.sender, senderFrame: {} }), /only available/);
  }
  assert.throws(() => invoke("CITY_POP_OPEN", ["miki-matsubara-stay-with-me"], "background"), /Choose Listen/);
  assert.throws(() => invoke("CITY_POP_ARCHIVE_SEARCH", "Miki", 1.5), /Invalid search page/);
  assert.throws(() => invoke("CITY_POP_ARCHIVE_SEARCH", "Miki", 1001), /Invalid search page/);
  for (const media of ["movies", "video OR audio", null, {}, 1]) assert.throws(() => invoke("CITY_POP_ARCHIVE_SEARCH", "Miki", 1, media), /Invalid Archive media filter/);
  assert.equal(searches.length, 0);
  await invoke("CITY_POP_ARCHIVE_SEARCH", "Mariya", 2, "video");
  await invoke("CITY_POP_ARCHIVE_SEARCH", "Miki");
  assert.deepEqual(searches, [["Mariya", 2, "video"], ["Miki", 1, "all"]]);
  assert.throws(() => invoke("CITY_POP_DOWNLOAD_PLAY", "../../secret", "listen"), /Choose a City Pop download/);
  // An album: its files once each, and a starting track among them.
  for (const [names, start] of [["one.mp3", 0], [[], 0], [Array.from({ length: 201 }, (_, i) => `${i}.mp3`), 0], [["one.mp3", "one.mp3"], 0], [["one.mp3"], 1], [["one.mp3"], -1], [["one.mp3"], 0.5], [["one.mp3"], "0"], [["one\n.mp3"], 0], [[42], 0]]) {
    assert.throws(() => invoke("CITY_POP_ARCHIVE_PLAY", "test-album", names, start, "listen"), /Invalid City Pop selection/);
  }
  assert.throws(() => invoke("CITY_POP_ARCHIVE_PLAY", "test-album", ["one.mp3"], 0, "background"), /Choose Listen/);
  // Search text pasted from a tracklist keeps working: a tab or newline is a space. Ids stay strict.
  await invoke("CITY_POP_SEARCH", "Miki\tMatsubara\n");
  assert.deepEqual(youtube, ["Miki Matsubara"]);
  await invoke("CITY_POP_ARCHIVE_SEARCH", "Mariya\tTakeuchi");
  assert.deepEqual(searches.at(-1), ["Mariya Takeuchi", 1, "all"]);
  assert.throws(() => invoke("CITY_POP_SEARCH", "x".repeat(201)), /Invalid City Pop selection/);
  assert.throws(() => invoke("CITY_POP_ARCHIVE_ITEM", "item\n"), /Invalid City Pop selection/);
  assert.equal(fixture.state.windows.length, 0);
  // A valid album opens at its starting track.
  assert.equal((await invoke("CITY_POP_ARCHIVE_PLAY", "test-album", ["one.mp3", "two.mp3"], 1, "listen")).ok, true);
  assert.match(decodeURIComponent(fixture.state.windows[0].url), /let index=1,/);
  fixture.player.closeCityPop();
});

test("City Pop desktop: the page belongs to Songs, in Anime mode", async () => {
  const { modeForPath } = await import("../apps/desktop/renderer/lib/manga-api.ts");
  assert.equal(modeForPath("/songs/city-pop"), "anime");
  const sidebar = fs.readFileSync(path.join(root, "apps/desktop/renderer/components/AppSidebar.tsx"), "utf8");
  assert.doesNotMatch(sidebar, /city-pop"/, "City Pop has no sidebar entry of its own");
  const songs = fs.readFileSync(path.join(root, "apps/desktop/renderer/pages/Songs.tsx"), "utf8");
  assert.match(songs, /navigate\("\/songs\/city-pop"\)/);
});

test("City Pop desktop: saved favorites keep their titles after a restart, and one song plays once", async () => {
  const fixture = playerFixture();
  const html = () => decodeURIComponent(fixture.state.windows.at(-1).url.split(",").slice(1).join(","));
  const saved = { id: "youtube-abcdefghijk", title: "Stay With Me (Live 1980)", artist: "Miki Matsubara", year: null, videoId: "abcdefghijk", channel: "Archive Uploads", moods: [], note: "YouTube search result", sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk" };
  try {
    // No search ran in this session: the title comes from the page's validated saved record.
    await fixture.player.openCityPop(fixture.owner, [saved.id], "watch", [saved]);
    assert.equal(playerQueue(html())[0].title, "Stay With Me (Live 1980)");
    // A forged record can't change the video, and without one the video still plays under a stand-in name.
    await fixture.player.openCityPop(fixture.owner, [saved.id], "watch", [{ ...saved, sourceUrl: "https://evil.test" }]);
    assert.deepEqual({ ...playerQueue(html())[0] }, { title: "YouTube video", artist: "YouTube", source: saved.sourceUrl, media: "abcdefghijk", kind: "youtube" });
    // A single video has no Previous/Next.
    assert.match(html(), /id="controls" hidden/);
    // The same song as a curated track and as a search result: one player, the video once, no loop.
    const result = await fixture.player.openCityPop(fixture.owner, ["mariya-takeuchi-plastic-love", "youtube-T_lC2O1oIew", "tatsuro-yamashita-sparkle"], "listen");
    assert.equal(result.ok, true);
    assert.deepEqual(Array.from(playerQueue(html()), (item) => [item.title, item.media]), [["Plastic Love", "T_lC2O1oIew"], ["SPARKLE", "pqobRu9aR3M"]]);
    assert.match(html(), /let index=0,/);
    assert.doesNotMatch(html(), /id="controls" hidden/);
    // The last video ends the station; nothing starts over.
    assert.match(html(), /else say\('Station finished\.'\)/);
  } finally { fixture.player.closeCityPop(); }
});

test("City Pop desktop: an album plays from the chosen track with its cover, saved files offline, in dark controls", async (t) => {
  const fixture = archiveFixture(t, { files: [{ name: "one.mp3", title: "One", size: "10" }, { name: "two.mp3", title: "Two", size: "10" }, { name: "three.mp3", title: "Three", size: "10" }] });
  const { key } = await fixture.service.downloadCityPopArchive("test-album", "two.mp3");
  await fixture.settled(key, "completed");
  const queue = await fixture.service.resolveCityPopArchiveQueue("test-album", ["one.mp3", "two.mp3", "three.mp3"]);
  assert.deepEqual(Array.from(queue, (row) => [row.track.title, row.url]), [
    ["One", "https://archive.org/download/test-album/one.mp3"],
    ["Two", `anitrack-city-pop://download/${key}`],
    ["Three", "https://archive.org/download/test-album/three.mp3"],
  ]);
  await assert.rejects(fixture.service.resolveCityPopArchiveQueue("test-album", ["one.mp3", "gone.mp3"]), /no longer available/);

  const player = playerFixture();
  try {
    const result = await player.player.playArchiveCityPop(player.owner, "test-album", ["one.mp3", "two.mp3", "three.mp3"], 1, "listen");
    assert.equal(result.ok, true);
    const html = decodeURIComponent(player.state.windows[0].url.split(",").slice(1).join(","));
    assert.deepEqual(Array.from(playerQueue(html), (item) => item.title), ["Fixture one.mp3", "Fixture two.mp3", "Fixture three.mp3"]);
    assert.match(html, /let index=1,/);
    assert.match(html, /<img id="cover" src="https:\/\/archive\.org\/services\/img\/test-album"/);
    assert.match(html, /img-src https:\/\/archive\.org https:\/\/\*\.archive\.org/);
    // The browser's audio bar matches the dark page.
    assert.match(html, /:root\{color-scheme:dark\}/);
    // Only the album's page opens outside the app.
    assert.equal(player.state.windows[0].webContents.open({ url: "https://archive.org/details/test-album" }).action, "deny");
    assert.deepEqual(player.state.external, ["https://archive.org/details/test-album"]);
    player.state.windows[0].webContents.open({ url: "https://archive.org/details/other" });
    assert.equal(player.state.external.length, 1);
  } finally { player.player.closeCityPop(); }
});
