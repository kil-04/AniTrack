import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { StreamAuthorizationRegistry } from "../apps/desktop/main/services/providers/stream-authorization.ts";
import { NativeMediaAccessObserver } from "../apps/desktop/main/services/providers/native-media-access.ts";

test("the real main-process denial notification exports only the current opaque receipt and status", () => {
  const source = readFileSync(new URL("../apps/desktop/main/main.ts", import.meta.url), "utf8");
  const start = source.indexOf("(mediaAccessId, status) => {");
  const end = source.indexOf("\n});", start);
  assert.ok(start > 0 && end > start);
  const registry = new StreamAuthorizationRegistry(10_000);
  registry.remember("https://cdn.example/private.mp4?signature=fixture-secret", { scope: "exact", mediaAccessId: "current", headers: { "X-Secret": "fixture-only" } }, 1_000);
  const notifications = [];
  const callback = new Function("recordResolvedStreamAccessRejection", "sendToRenderer", "IPC", `return ${source.slice(start, end)}\n};`)(
    (id, status) => registry.recordMediaAccessRejection(id, status, 1_100),
    (channel, value) => notifications.push({ channel, value }),
    { PROVIDERS_MEDIA_ACCESS_REJECTED: "providers:media-access-rejected" },
  );
  callback("old", 403);
  callback("current", 500);
  callback("current", 403);
  callback("current", 429);
  assert.deepEqual(notifications, [{ channel: "providers:media-access-rejected", value: { mediaAccessId: "current", status: 403 } }]);
});

test("native MP4 denials survive request completion until the authorization expires", () => {
  const registry = new StreamAuthorizationRegistry(1_000);
  registry.remember("https://cdn.example/episode.mp4?signature=fixture", { scope: "exact", mediaAccessId: "selected" }, 1_000);
  const observer = new NativeMediaAccessObserver(url => registry.get(url, 1_100), (id, status) => registry.recordMediaAccessRejection(id, status, 1_100));
  observer.begin({ id: 1, url: "https://cdn.example/episode.mp4?signature=fixture", resourceType: "media", webContentsId: 7 }, 7);
  observer.response({ id: 1, statusCode: 403, webContentsId: 7 });
  observer.finish(1);
  assert.equal(registry.mediaAccessStatus("selected", 1_200), 403, "the renderer's later IPC lookup sees the authoritative status");
  assert.throws(() => registry.mediaAccessStatus("selected", 2_001), /no longer available/);
});

test("reusing a native MP4 URL cannot rebind an old request to a new resolution", () => {
  const registry = new StreamAuthorizationRegistry(10_000);
  const url = "https://cdn.example/reused.mp4";
  const observer = new NativeMediaAccessObserver(url => registry.get(url, 1_100), (id, status) => registry.recordMediaAccessRejection(id, status, 1_100));
  registry.remember(url, { scope: "exact", mediaAccessId: "first-resolution" }, 1_000);
  observer.begin({ id: 1, url, resourceType: "media", webContentsId: 7 }, 7);
  registry.remember(url, { scope: "exact", mediaAccessId: "second-resolution" }, 1_050);
  observer.begin({ id: 1, url, resourceType: "media", webContentsId: 7 }, 7);
  observer.response({ id: 1, statusCode: 403, webContentsId: 7 });
  assert.equal(registry.mediaAccessStatus("second-resolution", 1_100), null, "a late denial does not poison the new resolution");
  observer.begin({ id: 2, url, resourceType: "media", webContentsId: 7 }, 7);
  observer.response({ id: 2, statusCode: 429, webContentsId: 7 });
  assert.equal(registry.mediaAccessStatus("second-resolution", 1_100), 429);
});

test("native access receipts exclude optional captions, HLS directories and other windows", () => {
  const registry = new StreamAuthorizationRegistry(10_000);
  registry.remember("https://cdn.example/main.mp4", { scope: "exact", mediaAccessId: "main" }, 1_000);
  registry.remember("https://cdn.example/caption.vtt", { scope: "exact" }, 1_000);
  registry.remember("https://cdn.example/hls/master.m3u8", { scope: "directory", mediaAccessId: "hls" }, 1_000);
  const rejected = [];
  const observer = new NativeMediaAccessObserver(url => registry.get(url, 1_100), (...args) => rejected.push(args));
  for (const request of [
    { id: 1, url: "https://cdn.example/caption.vtt", resourceType: "media", webContentsId: 7 },
    { id: 2, url: "https://cdn.example/hls/chunk.ts", resourceType: "media", webContentsId: 7 },
    { id: 3, url: "https://cdn.example/main.mp4", resourceType: "media", webContentsId: 8 },
    { id: 4, url: "https://cdn.example/main.mp4", resourceType: "xhr", webContentsId: 7 },
    { id: 5, url: "https://cdn.example/unregistered.mp4", resourceType: "media", webContentsId: 7 },
    { id: 6, url: "https://cdn.example/main.mp4", resourceType: "media", webContentsId: undefined },
  ]) {
    observer.begin(request, 7);
    observer.response({ ...request, statusCode: 403 });
  }
  assert.deepEqual(rejected, []);
  assert.equal(registry.mediaAccessStatus("main", 1_100), null);
  assert.equal(registry.mediaAccessStatus("hls", 1_100), null);
  observer.begin({ id: 7, url: "https://cdn.example/main.mp4", resourceType: "media" }, undefined);
  observer.response({ id: 7, statusCode: 403 });
  assert.deepEqual(rejected, []);
});

test("ordinary statuses cannot reject a native stream and receipt memory stays bounded", () => {
  const registry = new StreamAuthorizationRegistry(10_000, 2);
  const rejected = [];
  const observer = new NativeMediaAccessObserver(url => registry.get(url, 1_100), (...args) => rejected.push(args), 2);
  for (let id = 1; id <= 3; id++) {
    const url = `https://cdn.example/${id}.mp4`;
    registry.remember(url, { scope: "exact", mediaAccessId: `receipt-${id}` }, 1_000);
    observer.begin({ id, url, resourceType: "media", webContentsId: 7 }, 7);
  }
  assert.throws(() => registry.mediaAccessStatus("receipt-1", 1_100), /no longer available/);
  observer.response({ id: 1, statusCode: 403, webContentsId: 7 });
  observer.response({ id: 2, statusCode: 500, webContentsId: 7 });
  observer.response({ id: 2, statusCode: 200, webContentsId: 7 });
  observer.response({ id: 2, statusCode: 403, webContentsId: 8 });
  assert.deepEqual(rejected, []);
  observer.response({ id: 3, statusCode: 429, webContentsId: 7 });
  assert.deepEqual(rejected, [["receipt-3", 429]]);
  observer.clear();
  observer.response({ id: 3, statusCode: 403, webContentsId: 7 });
  assert.equal(rejected.length, 1);
});

test("keeps credentials isolated between streams on one CDN host", () => {
  const registry = new StreamAuthorizationRegistry(10_000);
  registry.remember("https://cdn.example/show-a/720/index.m3u8", "https://kwik.cx", "episode=a", 1_000);
  registry.remember("https://cdn.example/show-b/1080/index.m3u8", "https://kwik.si", "episode=b", 2_000);

  assert.equal(registry.get("https://cdn.example/show-a/720/segment-03.ts", 2_500)?.cookie, "episode=a");
  assert.equal(registry.get("https://cdn.example/show-b/1080/segment-03.ts", 2_500)?.cookie, "episode=b");
  assert.equal(registry.get("https://cdn.example/unresolved/segment-03.ts", 2_500), null);
});

test("uses the most specific stream directory and expires old authorization", () => {
  const registry = new StreamAuthorizationRegistry(1_000);
  registry.remember("https://cdn.example/show/master.m3u8", "https://kwik.cx", "master", 1_000);
  registry.remember("https://cdn.example/show/1080/index.m3u8", "https://kwik.cx", "quality", 1_100);

  assert.equal(registry.get("https://cdn.example/show/1080/chunk.ts", 1_500)?.cookie, "quality");
  assert.equal(registry.get("https://cdn.example/show/720/chunk.ts", 1_500)?.cookie, "master");
  assert.equal(registry.get("https://cdn.example/show/1080/chunk.ts", 2_101), null);
});

test("supports exact provider headers without authorizing sibling paths", () => {
  const registry = new StreamAuthorizationRegistry(10_000);
  registry.remember("https://video.example/embed/episode?id=1", {
    scope: "exact",
    headers: {
      "X-Provider-Token": "short-lived",
      Host: "must-not-be-overridden",
      "Bad\nHeader": "ignored",
    },
    referer: "https://mkissa.to",
    cors: false,
  }, 1_000);

  const authorization = registry.get("https://video.example/embed/episode?id=1", 1_500);
  assert.equal(authorization?.headers["X-Provider-Token"], "short-lived");
  assert.equal(authorization?.headers.Referer, "https://mkissa.to/");
  assert.equal(authorization?.headers.Origin, "https://mkissa.to");
  assert.equal(authorization?.headers.Host, undefined);
  assert.equal(authorization?.cors, false);
  assert.equal(registry.get("https://video.example/embed/episode?id=2", 1_500), null);
});

test("rejects non-HTTPS and local authorization targets", () => {
  const registry = new StreamAuthorizationRegistry(10_000);
  assert.throws(() => registry.remember("http://cdn.example/video.mp4", { scope: "exact" }));
  assert.throws(() => registry.remember("https://127.0.0.1/video.mp4", { scope: "exact" }));
  assert.throws(() => registry.remember("https://192.168.1.20/video.mp4", { scope: "exact" }));
  assert.throws(() => registry.remember("https://[::1]/video.mp4", { scope: "exact" }));
});
