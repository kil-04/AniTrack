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

const { startDownload, removeDownload, setDownloadEmitter, setDownloadRetryScale, listDownloads } = await import("../apps/desktop/main/services/downloads.ts");
const { authorizeResolvedStream, clearResolvedStreamAuthorizations } = await import("../apps/desktop/main/services/providers/stream-authorization.ts");
setDownloadEmitter((item) => harness.events.push(item));
// Backoff and Retry-After waits run at 1/1000 speed (a 10 s wait takes 10 ms).
setDownloadRetryScale(0.001);
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
async function terminal(opts, timeout = 3000) {
  startDownload(opts);
  // Settled: finished, failed, or stopped with its files kept to resume later.
  await waitUntil(() => harness.events.some((item) => item.id === opts.id && (["done", "failed"].includes(item.status) || item.resume)), timeout);
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

test("HTTP 403 stops for a fresh stream and a long Retry-After pauses, keeping no signed URL", async () => {
  let calls = 0;
  resetFixture(async () => { calls++; return new Response(null, { status: 403 }); });
  const expired = await terminal(options({ hlsUrl: "https://media.example/index.m3u8?secret=fixture" }));
  assert.equal(calls, 1);
  assert.equal(expired.status, "queued");
  assert.deepEqual(expired.resume, { reason: "expired", reResolves: 1 });
  calls = 0;
  const before = Date.now();
  resetFixture(async () => { calls++; return new Response(null, { status: 429, headers: { "retry-after": "999999" } }); });
  const limited = await terminal(options({ hlsUrl: "https://media.example/index.m3u8?secret=fixture" }));
  assert.equal(calls, 1, "a wait longer than ten minutes pauses instead of holding the worker");
  assert.equal(limited.status, "queued");
  assert.equal(limited.resume.reason, "rate-limit");
  assert.ok(limited.resume.at >= before + 6 * 3600_000 - 1000 && limited.resume.at <= Date.now() + 6 * 3600_000, "capped at six hours");
  for (const item of [expired, limited]) assert.doesNotMatch(JSON.stringify([item.error, item.resume]), /https?:|secret|fixture/);
});

test("temporary HTTP errors and 429 retry with backoff, honouring Retry-After", async () => {
  let calls = 0;
  const waits = [];
  let last = 0;
  resetFixture(async (url) => {
    if (url.endsWith("part.ts")) {
      calls++;
      if (last) waits.push(Date.now() - last);
      last = Date.now();
      if (calls === 1) return new Response(null, { status: 503 });
      if (calls === 2) return new Response(null, { status: 429, headers: { "retry-after": "40" } });
      return new Response("media");
    }
    return new Response(mediaPlaylist("part.ts"));
  });
  assert.equal((await terminal(options())).status, "done");
  assert.equal(calls, 3);
  assert.ok(waits[1] >= 38, `Retry-After: 40 (scaled to 40 ms) was honoured, waited ${waits[1]} ms`);
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
  assert.equal(item.status, "queued");
  assert.equal(item.resume.reason, "expired");
  assert.equal(cancelledReaders, 1, "the peer worker's in-flight reader is aborted");
  assert.equal(harness.events.filter((event) => event.resume).length, 1);
  assert.ok(fs.readdirSync(folder(opts.id)).every((file) => ["meta.json", "index.m3u8", "download.ledger"].includes(file)));
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

test("Shonen proxy playlists and captions without file extensions become an offline episode", async () => {
  const master = "https://vidcloud.sbs/api/proxy/m3u8?t=master";
  const media = "https://vidcloud.sbs/api/proxy/m3u8?t=media";
  const segment = "https://vidcloud.sbs/api/proxy/segment?t=part";
  const captions = "https://vidcloud.sbs/api/proxy/vtt?t=english";
  const bytes = new Uint8Array([0x47, 1, 2, 3]);
  const requests = [];
  resetFixture(async url => {
    requests.push(url);
    if (url === master) return new Response(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1600000,RESOLUTION=1448x1080\n${media}\n`);
    if (url === media) return new Response(mediaPlaylist(segment));
    if (url === segment) return new Response(bytes);
    if (url === captions) return new Response("WEBVTT\n\n00:00.000 --> 00:01.000\nOffline caption\n");
    throw new Error("Unexpected proxy request");
  });
  const opts = options({ providerId: "shonen", hlsUrl: master, subtitleUrl: captions });
  assert.equal((await terminal(opts)).status, "done");
  assert.deepEqual(requests, [master, media, segment, captions]);
  const local = fs.readFileSync(path.join(folder(opts.id), "index.m3u8"), "utf8");
  assert.match(local, /seg00000\.ts/);
  assert.doesNotMatch(local, /https?:|\?t=/);
  assert.deepEqual(fs.readFileSync(path.join(folder(opts.id), "seg00000.ts")), Buffer.from(bytes));
  assert.match(fs.readFileSync(path.join(folder(opts.id), "subs.vtt"), "utf8"), /Offline caption/);
});

test("AniChan signed proxy playlists, disguised segments and captions become self-contained offline files", async () => {
  const master = "https://c.toroplay.cymru/api/watch/m3u8?fixture=master";
  const rendition = "https://c.toroplay.cymru/api/watch/m3u8?fixture=720";
  const segments = ["https://c.toroplay.cymru/assets/token-a/seg-1.css", "https://c.toroplay.cymru/assets/token-b/seg-2.png"];
  const captions = "https://c.toroplay.cymru/api/watch/vtt?fixture=english";
  const bytes = Buffer.alloc(376); bytes[0] = bytes[188] = 0x47;
  const requested = [];
  const starts = [];
  let inflight = 0, peak = 0;
  resetFixture(async (url, init) => {
    requested.push(url);
    starts.push(Date.now());
    peak = Math.max(peak, ++inflight);
    await new Promise(resolve => setTimeout(resolve, 10));
    inflight--;
    assert.deepEqual(init.headers, {}, "the signed proxy needs no source cookies or hotlink headers");
    if (url === master) return new Response(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\n${rendition}\n`);
    if (url === rendition) return new Response(mediaPlaylist(...segments));
    if (segments.includes(url)) return new Response(bytes, { headers: { "Content-Type": "image/png" } });
    if (url === captions) return new Response("WEBVTT\n\n00:00.000 --> 00:01.000\nAniChan offline caption\n");
    throw new Error("Unexpected AniChan request");
  });
  const opts = options({ providerId: "anichan", hlsUrl: master, subtitleUrl: captions, conservativeNetwork: true });
  const done = await terminal(opts, 15000);
  assert.equal(done.status, "done");
  assert.equal(done.doneSegments, 2);
  assert.deepEqual(new Set(requested), new Set([master, rendition, ...segments, captions]));
  assert.equal(peak, 1, "rate-sensitive downloads never overlap file requests");
  assert.ok(starts.slice(1).every((time, i) => time - starts[i] >= 450), "requests are paced rather than burst together");
  const local = fs.readFileSync(path.join(folder(opts.id), "index.m3u8"), "utf8");
  assert.doesNotMatch(local, /https?:|token-|fixture=|\.css|\.png/);
  assert.match(local, /seg00000\.ts[\s\S]*seg00001\.ts/);
  for (const file of ["seg00000.ts", "seg00001.ts"]) assert.deepEqual(fs.readFileSync(path.join(folder(opts.id), file)), bytes);
  assert.match(fs.readFileSync(path.join(folder(opts.id), "subs.vtt"), "utf8"), /AniChan offline caption/);
});

test("hanging requests time out and are tried again even when their transport ignores cancellation", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  for (const [conservativeNetwork, timeout] of [[false, 30_000], [true, 90_000]]) {
    let calls = 0;
    resetFixture(async () => { calls++; return new Promise(() => {}); });
    const opts = options({ conservativeNetwork });
    startDownload(opts);
    await settle();
    context.mock.timers.tick(timeout - 1);
    await settle();
    assert.equal(harness.events.findLast(event => event.id === opts.id).status, "downloading");
    assert.equal(calls, 1);
    context.mock.timers.tick(2);
    await settle();
    if (conservativeNetwork) {
      // A rate-sensitive stream is never retried at once: it pauses for the network.
      const item = harness.events.findLast((event) => event.id === opts.id);
      assert.equal(item.status, "queued");
      assert.deepEqual(item.resume, { reason: "network", at: null, reResolves: 0 });
    } else {
      context.mock.timers.tick(10);
      await settle();
      assert.equal(calls, 2, "a timeout counts as a network failure and is retried");
      removeDownload(opts.id);
    }
  }
});

const ts = (fill) => { const b = Buffer.alloc(376, fill); b[0] = b[188] = 0x47; return b; };
const signed = (token, n) => Array.from({ length: n }, (_, i) => `https://cdn${token}.example/show/1080/seg-${i}.ts?token=${token}&expires=4102444800`);

test("an interrupted episode keeps its segments and continues from the first missing one with re-signed URLs", async () => {
  let token = "a";
  let online = true;
  const fetched = [];
  resetFixture(async (url) => {
    if (url.endsWith("master.m3u8") || url.includes("master.m3u8?")) return new Response(mediaPlaylist(...signed(token, 6)));
    if (!online) throw new TypeError("net::ERR_INTERNET_DISCONNECTED");
    const index = Number(/seg-(\d+)/.exec(url)[1]);
    fetched.push(index);
    if (index === 3) online = false; // the connection drops after segment 3
    return new Response(ts(index));
  });
  const opts = options();
  const paused = await terminal(opts, 6000);
  assert.equal(paused.status, "queued");
  assert.equal(paused.resume.reason, "network");
  assert.ok(paused.doneSegments >= 3 && paused.doneSegments < 6, `kept ${paused.doneSegments} of 6`);
  const kept = new Set(fetched);
  // The app starts it again later with a freshly resolved, differently signed stream.
  token = "b";
  online = true;
  fetched.length = 0;
  harness.events.length = 0;
  const done = await terminal({ ...opts, hlsUrl: "https://master.example/show/master.m3u8?token=b", reResolves: paused.resume.reResolves });
  assert.equal(done.status, "done");
  assert.equal(done.doneSegments, 6);
  assert.ok(fetched.every((index) => !kept.has(index) || index === 3), `only missing segments were fetched again: ${fetched}`);
  assert.ok(fetched.length <= 6 - paused.doneSegments + 1);
  for (let i = 0; i < 6; i++) assert.deepEqual(fs.readFileSync(path.join(folder(opts.id), `seg${String(i).padStart(5, "0")}.ts`)), ts(i));
  assert.match(fs.readFileSync(path.join(folder(opts.id), "index.m3u8"), "utf8"), /seg00000\.ts[\s\S]*seg00005\.ts/);
});

test("a truncated or corrupted segment is fetched again; another quality starts over", async () => {
  let quality = "1080";
  const fetched = [];
  resetFixture(async (url) => {
    if (url.includes("master.m3u8")) return new Response(mediaPlaylist(...[0, 1, 2].map((i) => `https://cdn.example/${quality}/seg-${i}.ts`)));
    fetched.push(url);
    return new Response(ts(quality === "1080" ? 1 : 2));
  });
  const opts = options();
  assert.equal((await terminal(opts)).status, "done");
  fs.truncateSync(path.join(folder(opts.id), "seg00001.ts"), 100);
  fs.writeFileSync(path.join(folder(opts.id), "seg00002.ts"), Buffer.alloc(376, 0));
  fetched.length = 0;
  harness.events.length = 0;
  assert.equal((await terminal(opts)).status, "done");
  assert.deepEqual(fetched.map((url) => url.slice(-8)), ["seg-1.ts", "seg-2.ts"]);
  quality = "720";
  fetched.length = 0;
  harness.events.length = 0;
  assert.equal((await terminal(opts)).status, "done");
  assert.equal(fetched.length, 3, "segments of another rendition are never mixed in");
  for (let i = 0; i < 3; i++) assert.deepEqual(fs.readFileSync(path.join(folder(opts.id), `seg0000${i}.ts`)), ts(2));
});

test("a key that changed on the server discards the segments it encrypted", async () => {
  let keyBytes = Buffer.alloc(16, 1);
  const fetched = [];
  const playlist = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/k.key?token=x"\n#EXTINF:6,\nhttps://cdn.example/a.ts\n#EXTINF:6,\nhttps://cdn.example/b.ts\n#EXT-X-ENDLIST\n';
  resetFixture(async (url) => {
    if (url.includes("master.m3u8")) return new Response(playlist);
    fetched.push(url.replace(/\?.*/, "").split("/").pop());
    return new Response(url.includes("k.key") ? keyBytes : Buffer.alloc(32, 7));
  });
  const opts = options();
  assert.equal((await terminal(opts)).status, "done");
  fetched.length = 0;
  harness.events.length = 0;
  assert.equal((await terminal(opts)).status, "done");
  assert.deepEqual(fetched, ["k.key"], "the key is checked again, the encrypted segments are kept");
  keyBytes = Buffer.alloc(16, 2);
  fetched.length = 0;
  harness.events.length = 0;
  assert.equal((await terminal(opts)).status, "done");
  assert.deepEqual(fetched, ["k.key", "k.key", "a.ts", "b.ts"]);
});

test("a stream expiring mid-episode stops for a fresh one before its URLs are refused", async () => {
  const soon = Math.floor((Date.now() + 30_000) / 1000);
  resetFixture(async (url) => url.includes("master.m3u8")
    ? new Response(mediaPlaylist(`https://cdn.example/a.ts?expires=${soon}`))
    : new Response(ts(1)));
  const item = await terminal(options());
  assert.equal(item.status, "queued");
  assert.deepEqual(item.resume, { reason: "expired", reResolves: 1 });
});

test("after a restart, an unfinished episode with a ledger comes back queued to resume", async () => {
  resetFixture(async (url) => {
    if (url.includes("master.m3u8")) return new Response(mediaPlaylist("https://cdn.example/a.ts", "https://cdn.example/b.ts"));
    return new Promise(() => {}); // the app is closed while this hangs
  });
  const opts = options({ animeSession: "show-1", episodeSession: "ep-1" });
  startDownload(opts);
  await waitUntil(() => fs.existsSync(path.join(folder(opts.id), "download.ledger")));
  // Simulate the next launch: no worker owns the folder any more.
  const meta = JSON.parse(fs.readFileSync(path.join(folder(opts.id), "meta.json"), "utf8"));
  const other = { ...opts, id: `${opts.animeId}:${opts.episode}.5` };
  fs.mkdirSync(folder(other.id), { recursive: true });
  fs.writeFileSync(path.join(folder(other.id), "meta.json"), JSON.stringify({ ...meta, id: other.id, status: "downloading" }));
  fs.copyFileSync(path.join(folder(opts.id), "download.ledger"), path.join(folder(other.id), "download.ledger"));
  const legacy = { ...opts, id: `${opts.animeId}:${opts.episode}.25` };
  fs.mkdirSync(folder(legacy.id), { recursive: true });
  fs.writeFileSync(path.join(folder(legacy.id), "meta.json"), JSON.stringify({ ...meta, id: legacy.id, status: "downloading" }));
  const listed = listDownloads().items;
  const resumed = listed.find((item) => item.id === other.id);
  assert.equal(resumed.status, "queued");
  assert.deepEqual(resumed.resume, { reason: "restart", reResolves: 0 });
  const old = listed.find((item) => item.id === legacy.id);
  assert.equal(old.status, "failed", "a folder without a ledger (an older download) can't resume");
  assert.equal(listed.find((item) => item.id === opts.id).status, "downloading", "a live job is left alone");
  removeDownload(opts.id);
  removeDownload(other.id);
  removeDownload(legacy.id);
});

after(() => {
  const resolved = path.resolve(storageRoot);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("anitrack-download-test-")) throw new Error("Invalid fixture cleanup path");
  fs.rmSync(resolved, { recursive: true, force: true });
  delete globalThis.__anitrackDownloadFixture;
});
