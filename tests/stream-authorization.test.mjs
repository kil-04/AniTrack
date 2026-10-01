import test from "node:test";
import assert from "node:assert/strict";
import { StreamAuthorizationRegistry } from "../apps/desktop/main/services/providers/stream-authorization.ts";

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
