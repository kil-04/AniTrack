import test, { after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "anitrack-download-test-"));
const harness = {
  pahe: new Map(),
  events: [],
  fetch: async () => { throw new Error("Unexpected fixture request"); },
};
globalThis.__anitrackDownloadFixture = harness;
harness.app = { getPath: () => storageRoot };
harness.net = { fetch: (...args) => harness.fetch(...args) };
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const electron = moduleUrl("export const app = globalThis.__anitrackDownloadFixture.app; export const net = globalThis.__anitrackDownloadFixture.net;");
const pahe = moduleUrl("export function getAuthorizedPaheRequestHeaders(url) { return globalThis.__anitrackDownloadFixture.pahe.get(url) ?? null; }");
const config = moduleUrl("export function getRuntimeConfig() { return { features: { downloads: true } }; }");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/services/downloads.ts")) {
      if (specifier === "electron") return { url: electron, shortCircuit: true };
      if (specifier === "./providers/animepahe") return { url: pahe, shortCircuit: true };
      if (specifier === "./remote-config") return { url: config, shortCircuit: true };
    }
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});

const { startDownload, removeDownload, setDownloadEmitter, downloadRetryDelay } = await import("../apps/desktop/main/services/downloads.ts");
const { authorizeResolvedStream, clearResolvedStreamAuthorizations } = await import("../apps/desktop/main/services/providers/stream-authorization.ts");
setDownloadEmitter((item) => harness.events.push(item));
let sequence = 0;
function options(extra = {}) {
  return {
    id: `9001:${++sequence}`, animeId: 9001, episode: sequence, title: "Download fixture",
    providerId: "anikoto", hlsUrl: "https://master.example/show/master.m3u8",
    referer: "https://untrusted-renderer.example/", ...extra,
  };
}
function resetFixture(fetcher) {
  harness.events.length = 0;
  harness.pahe.clear();
  clearResolvedStreamAuthorizations();
  harness.fetch = fetcher;
}
function folder(id) { return path.join(storageRoot, "anitrack_downloads", id.replace(/:/g, "_")); }
async function settle() { for (let i = 0; i < 6; i++) await new Promise(setImmediate); }
async function waitUntil(condition, timeout = 3000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeout) throw new Error("Download fixture did not settle");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function terminal(opts) {
  startDownload(opts);
  await waitUntil(() => harness.events.some((item) => item.id === opts.id && ["done", "failed"].includes(item.status)));
  return harness.events.findLast((item) => item.id === opts.id);
}
const mediaPlaylist = (...assets) => `#EXTM3U\n#EXT-X-TARGETDURATION:6\n${assets.map((asset) => `#EXTINF:6,\n${asset}`).join("\n")}\n#EXT-X-ENDLIST\n`;

test("downloads use fresh scoped headers for each manifest, media and key request", async () => {
  const root = "https://master.example/show/master.m3u8";
  const child = "https://segments.example/episode/720/index.m3u8";
  const key = "https://segments.example/keys/episode.key";
  const external = "https://segments.example/unrelated/extra.ts";
  const requests = [];
  resetFixture(async (url, init) => {
    requests.push({ url, headers: { ...init.headers } });
    assert.equal(init.redirect, "manual");
    assert.equal(init.credentials, "omit");
    if (url === root) return new Response(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\n${child}\n`);
    if (url === child) return new Response(`#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="${key}"\n#EXTINF:6,\npart.ts\n#EXTINF:6,\n${external}\n#EXT-X-ENDLIST\n`);
    return new Response(new Uint8Array([1, 2, 3]));
  });
  authorizeResolvedStream({ url: root, requestHeaders: { "X-Stream": "master" }, authorizationScope: "exact" });
  authorizeResolvedStream({ url: child, requestHeaders: { Referer: "https://player.example/embed", Cookie: "episode=selected" }, authorizationScope: "directory" });
  authorizeResolvedStream({ url: key, requestHeaders: { "X-Key": "selected" }, authorizationScope: "exact" });
  const opts = options();
  assert.equal((await terminal(opts)).status, "done");
  assert.deepEqual(requests.find((item) => item.url === root).headers, { "X-Stream": "master" });
  assert.deepEqual(requests.find((item) => item.url.endsWith("/part.ts")).headers, { Referer: "https://player.example/embed", Cookie: "episode=selected" });
  assert.deepEqual(requests.find((item) => item.url === key).headers, { "X-Key": "selected" });
  assert.deepEqual(requests.find((item) => item.url === external).headers, {});
  assert.ok(requests.every((item) => !Object.keys(item.headers).some((name) => name.toLowerCase() === "user-agent")));
  assert.match(fs.readFileSync(path.join(folder(opts.id), "index.m3u8"), "utf8"), /URI="key00.key"/);
});

test("AnimePahe cookies are looked up per URL and generic stream authorization wins", async () => {
  const root = "https://cdn.example/show-a/index.m3u8";
  const own = "https://cdn.example/show-a/part.ts";
  const other = "https://cdn.example/show-b/part.ts";
  const requests = [];
  resetFixture(async (url, init) => {
    requests.push({ url, headers: { ...init.headers } });
    return url === root ? new Response(mediaPlaylist(own, other)) : new Response("media");
  });
  harness.pahe.set(root, { host: "cdn.example", referer: "https://kwik.example", cookie: "stale=must-not-win" });
  harness.pahe.set(own, { host: "cdn.example", referer: "https://kwik.example", cookie: "episode=original" });
  authorizeResolvedStream({ url: root, requestHeaders: { Cookie: "episode=selected" }, authorizationScope: "exact" });
  assert.equal((await terminal(options({ providerId: "animepahe", hlsUrl: root }))).status, "done");
  assert.equal(requests.find((item) => item.url === root).headers.Cookie, "episode=selected");
  assert.equal(requests.find((item) => item.url === own).headers.Cookie, "episode=original");
  assert.deepEqual(requests.find((item) => item.url === other).headers, {});
});

test("redirects use the destination authorization and its URL for relative media", async () => {
  const redirected = "https://new-cdn.example/episode/index.m3u8";
  const requests = [];
  resetFixture(async (url, init) => {
    requests.push({ url, headers: { ...init.headers } });
    if (url.includes("master.example")) return new Response(null, { status: 302, headers: { location: redirected } });
    if (url === redirected) return new Response(mediaPlaylist("part.ts"));
    return new Response("media");
  });
  const opts = options();
  authorizeResolvedStream({ url: opts.hlsUrl, requestHeaders: { Cookie: "original=only" }, authorizationScope: "exact" });
  authorizeResolvedStream({ url: redirected, requestHeaders: { "X-New": "destination" }, authorizationScope: "directory" });
  assert.equal((await terminal(opts)).status, "done");
  assert.deepEqual(requests.find((item) => item.url === redirected).headers, { "X-New": "destination" });
  assert.deepEqual(requests.find((item) => item.url.endsWith("/part.ts")).headers, { "X-New": "destination" });
});

test("HTTP 403 and 429 stop immediately with errors that contain no signed URL", async () => {
  for (const status of [403, 429]) {
    let calls = 0;
    resetFixture(async () => { calls++; return new Response(null, { status, headers: { "retry-after": "999999" } }); });
    const item = await terminal(options({ hlsUrl: "https://media.example/index.m3u8?secret=fixture" }));
    assert.equal(calls, 1);
    assert.equal(item.status, "failed");
    assert.match(item.error, new RegExp(`HTTP ${status}`));
    assert.doesNotMatch(item.error, /https?:|secret|fixture/);
  }
});

test("temporary HTTP errors retry within bounds and large Retry-After values are clamped", async () => {
  let calls = 0;
  resetFixture(async () => {
    calls++;
    return calls === 1 ? new Response(null, { status: 503 }) : new Response(mediaPlaylist("part.ts"));
  });
  // Asset requests return bytes rather than another playlist.
  const fetcher = harness.fetch;
  harness.fetch = (url, init) => url.endsWith("part.ts") ? Promise.resolve(new Response("media")) : fetcher(url, init);
  assert.equal((await terminal(options())).status, "done");
  assert.equal(calls, 2);
  assert.equal(downloadRetryDelay("999999", 0), 5000);
  assert.equal(downloadRetryDelay("invalid", 20), 5000);
});

test("oversized bodies and unsafe redirects fail without reaching the unsafe address", async () => {
  resetFixture(async () => new Response("#EXTM3U\n#" + "x".repeat(2 * 1024 * 1024)));
  const oversized = await terminal(options());
  assert.equal(oversized.status, "failed");
  assert.match(oversized.error, /size limit/);
  let calls = 0;
  resetFixture(async () => { calls++; return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } }); });
  const unsafe = await terminal(options());
  assert.equal(calls, 1);
  assert.match(unsafe.error, /unsafe media address/);
});

test("removing a download aborts every body reader and prevents later file writes or events", async () => {
  let readers = 0;
  let cancelledReaders = 0;
  resetFixture(async (url) => {
    if (url.endsWith("master.m3u8")) return new Response(mediaPlaylist(...Array.from({ length: 6 }, (_, i) => `part-${i}.ts`)));
    return new Response(new ReadableStream({
      start(controller) { readers++; controller.enqueue(new Uint8Array([1])); },
      cancel() { cancelledReaders++; },
    }));
  });
  const opts = options();
  startDownload(opts);
  await waitUntil(() => readers === 2, 3000); // one hanging reader per worker
  await settle();
  removeDownload(opts.id);
  const eventCount = harness.events.length;
  await settle();
  assert.equal(cancelledReaders, 2);
  assert.equal(fs.existsSync(folder(opts.id)), false);
  assert.equal(harness.events.length, eventCount);
});

test("a failed worker aborts its peers before emitting a settled failure", async () => {
  let cancelledReaders = 0;
  resetFixture(async (url) => {
    if (url.endsWith("master.m3u8")) return new Response(mediaPlaylist(...Array.from({ length: 6 }, (_, i) => `part-${i}.ts`)));
    if (url.endsWith("part-0.ts")) return new Response(null, { status: 403 });
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1])); },
      cancel() { cancelledReaders++; },
    }));
  });
  const opts = options();
  const item = await terminal(opts);
  assert.equal(item.status, "failed");
  assert.equal(cancelledReaders, 1, "the peer worker's in-flight reader is aborted");
  assert.equal(harness.events.filter((event) => event.status === "failed").length, 1);
  assert.ok(fs.readdirSync(folder(opts.id)).every((file) => ["meta.json", "index.m3u8", "download.plan"].includes(file)));
});

test("resume reuses matching media but never mixes numbered files from another server", async () => {
  let server = "original";
  const mediaCalls = [];
  resetFixture(async (url) => {
    if (url.endsWith("master.m3u8")) return new Response(mediaPlaylist(`https://media.example/${server}/part.ts`));
    mediaCalls.push(url);
    return new Response(server);
  });
  const opts = options();
  assert.equal((await terminal(opts)).status, "done");
  harness.events.length = 0;
  assert.equal((await terminal(opts)).status, "done");
  assert.equal(mediaCalls.length, 1, "matching segment URLs can safely resume");
  server = "replacement";
  harness.events.length = 0;
  assert.equal((await terminal(opts)).status, "done");
  assert.equal(mediaCalls.length, 2, "a different server must replace the old segment");
  assert.equal(fs.readFileSync(path.join(folder(opts.id), "seg00000.ts"), "utf8"), "replacement");
});

test("HTTP 200 pages and empty responses cannot be saved as media, initialization data or keys", async () => {
  const fixtures = [
    { name: "seg00000.ts", playlist: mediaPlaylist("part.ts?secret=fixture"), badPath: "part.ts", body: "<!doctype html><html>denied</html>", type: "text/html" },
    { name: "init00.mp4", playlist: '#EXTM3U\n#EXT-X-MAP:URI="init.mp4?secret=fixture"\n#EXTINF:6,\npart.ts\n#EXT-X-ENDLIST\n', badPath: "init.mp4", body: '{"error":"denied"}', type: "application/json" },
    { name: "key00.key", playlist: '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.key?secret=fixture"\n#EXTINF:6,\npart.ts\n#EXT-X-ENDLIST\n', badPath: "key.key", body: ' \n<html>denied</html>', type: "application/octet-stream" },
    { name: "seg00000.ts", playlist: mediaPlaylist("part.ts?secret=fixture"), badPath: "part.ts", body: '{"error":"denied"}', type: "application/octet-stream" },
    { name: "seg00000.ts", playlist: mediaPlaylist("part.ts?secret=fixture"), badPath: "part.ts", body: "Access denied", type: "text/plain" },
    // A leading 0x47 alone is not an MPEG-TS signature.
    { name: "seg00000.ts", playlist: mediaPlaylist("part.ts?secret=fixture"), badPath: "part.ts", body: "Gateway Timeout", type: "text/html" },
    { name: "seg00000.ts", playlist: mediaPlaylist("part.ts?secret=fixture"), badPath: "part.ts", body: "", type: "video/mp2t" },
  ];
  for (const fixture of fixtures) {
    let badCalls = 0;
    resetFixture(async (url) => {
      if (url.endsWith("master.m3u8")) return new Response(fixture.playlist);
      if (new URL(url).pathname.endsWith(fixture.badPath)) {
        badCalls++;
        return new Response(fixture.body, { headers: { "content-type": fixture.type } });
      }
      return new Response(new Uint8Array([0x47, 1, 2, 3]));
    });
    const opts = options();
    const item = await terminal(opts);
    assert.equal(item.status, "failed");
    assert.match(item.error, /empty media file|error page instead of media/);
    assert.doesNotMatch(item.error, /https?:|secret|fixture/);
    assert.equal(badCalls, 1, "bad HTTP 200 responses must not trigger automatic retry");
    assert.equal(fs.existsSync(path.join(folder(opts.id), fixture.name)), false);
    assert.equal(fs.existsSync(path.join(folder(opts.id), fixture.name + ".part")), false);
  }
});

test("binary media remains valid when its CDN uses image, octet-stream or page content types", async () => {
  const transportStream = new Uint8Array(188 * 3).fill(0xff);
  for (let i = 0; i < transportStream.length; i += 188) transportStream[i] = 0x47;
  // Observed live: segments behind randomized .png/.ico/.html names are served
  // with the matching image/* or text/html type while the body is MPEG-TS.
  for (const type of ["image/jpeg", "application/octet-stream", "image/x-icon", "text/html"]) {
    resetFixture(async (url) => url.endsWith("master.m3u8")
      ? new Response(mediaPlaylist("part.ts"))
      : new Response(transportStream, { headers: { "content-type": type } }));
    const opts = options();
    assert.equal((await terminal(opts)).status, "done");
    assert.deepEqual(fs.readFileSync(path.join(folder(opts.id), "seg00000.ts")), Buffer.from(transportStream));
  }
});

test("segment requests stay within the CDN-safe concurrency limit", async () => {
  let inflight = 0;
  let peak = 0;
  resetFixture(async (url) => {
    if (url.endsWith("master.m3u8")) return new Response(mediaPlaylist(...Array.from({ length: 12 }, (_, i) => `part${i}.ts`)));
    peak = Math.max(peak, ++inflight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inflight--;
    return new Response(new Uint8Array([0x47, 1, 2, 3]));
  });
  assert.equal((await terminal(options())).status, "done");
  assert.equal(peak, 2);
});

test("hanging requests time out even when their transport ignores cancellation", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  resetFixture(async () => new Promise(() => {}));
  const opts = options();
  startDownload(opts);
  context.mock.timers.tick(30_001);
  await settle();
  const item = harness.events.findLast((event) => event.id === opts.id);
  assert.equal(item.status, "failed");
  assert.match(item.error, /timed out/);
});

after(() => {
  const resolved = path.resolve(storageRoot);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("anitrack-download-test-")) throw new Error("Invalid fixture cleanup path");
  fs.rmSync(resolved, { recursive: true, force: true });
  delete globalThis.__anitrackDownloadFixture;
});
