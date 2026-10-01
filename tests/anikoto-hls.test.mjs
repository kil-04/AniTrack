import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const { prepareAnikotoHlsAuthorization } = await import("../apps/desktop/main/services/providers/anikoto-hls.ts");
const root = "https://playlist.example/show/master.m3u8";
const referer = "https://player.example/";
const master = (variants) => "#EXTM3U\n" + variants.map(uri => `#EXT-X-STREAM-INF:BANDWIDTH=1000\n${uri}\n`).join("");
const media = "#EXTM3U\n#EXTINF:6,\nhttps://media.example/episode/seg1.ts\n#EXT-X-ENDLIST\n";

test("Anikoto verifies HLS renditions and authorizes observed segment/key/map directories without fetching video", async () => {
  const calls = [];
  const authorized = [];
  const playlists = new Map([
    [root, master(["low/index.m3u8", "high/index.m3u8"])],
    ["https://playlist.example/show/low/index.m3u8", media],
    ["https://playlist.example/show/high/index.m3u8", "#EXTM3U\n"
      + "#EXT-X-KEY:METHOD=AES-128,URI=\"https://keys.example/episode/key.bin\"\n"
      + "#EXT-X-MAP:URI=\"https://media.example/episode/init.mp4\"\n"
      + "#EXTINF:6,\nhttps://media.example/episode/seg2.m4s\n#EXT-X-ENDLIST\n"],
  ]);
  const playable = await prepareAnikotoHlsAuthorization(root, referer, async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Referer, referer);
    assert.equal(options.headers.Origin, "https://player.example");
    assert.ok(playlists.has(url), "Video, keys and maps must not be requested during resolution");
    return new Response(playlists.get(url));
  }, { authorize: stream => authorized.push(stream) });
  assert.equal(playable, root, "Complete masters preserve adaptive quality selection");
  assert.deepEqual(calls, [...playlists.keys()]);
  assert.deepEqual(authorized.map(stream => new URL(".", stream.url).toString()), [
    "https://playlist.example/show/", "https://playlist.example/show/low/", "https://playlist.example/show/high/",
    "https://media.example/episode/", "https://keys.example/episode/",
  ]);
  assert.ok(authorized.every(stream => stream.authorizationScope === "directory" && stream.referer === referer && stream.cookies === undefined));
});

test("Anikoto keeps accessible ordinary renditions when another rendition is missing", async () => {
  const calls = [];
  const authorized = [];
  const playable = await prepareAnikotoHlsAuthorization(root, referer, async url => {
    calls.push(url);
    if (url === root) return new Response(master(["gone.m3u8", "available.m3u8"]));
    return url.endsWith("gone.m3u8") ? new Response("", { status: 404 }) : new Response(media);
  }, { authorize: stream => authorized.push(stream) });
  assert.equal(playable, "https://playlist.example/show/available.m3u8", "The original master must not advertise the missing rendition to playback or downloads");
  assert.equal(calls.length, 3);
  assert.ok(authorized.some(stream => stream.url.startsWith("https://media.example/episode/")));
});

test("Anikoto selects the highest-bandwidth available quality instead of a missing quality", async () => {
  const playlist = "#EXTM3U\n"
    + "#EXT-X-STREAM-INF:BANDWIDTH=1000000\nlow.m3u8\n"
    + "#EXT-X-STREAM-INF:BANDWIDTH=9000000\ngone.m3u8\n"
    + "#EXT-X-STREAM-INF:BANDWIDTH=5000000\nhigh.m3u8\n";
  const playable = await prepareAnikotoHlsAuthorization(root, referer, async url => {
    if (url === root) return new Response(playlist);
    return url.endsWith("gone.m3u8") ? new Response("", { status: 404 }) : new Response(media);
  }, { authorize: () => {} });
  assert.equal(playable, "https://playlist.example/show/high.m3u8");
});

test("Anikoto missing nested descendants do not return a parent that still advertises them", async () => {
  const playable = await prepareAnikotoHlsAuthorization(root, referer, async url => {
    if (url === root) return new Response(master(["nested.m3u8"]));
    if (url.endsWith("nested.m3u8")) return new Response(master(["gone.m3u8", "available.m3u8"]));
    return url.endsWith("gone.m3u8") ? new Response("", { status: 404 }) : new Response(media);
  }, { authorize: () => {} });
  assert.equal(playable, "https://playlist.example/show/available.m3u8");
});

test("Anikoto unavailable nested masters permit another accessible branch", async () => {
  const playable = await prepareAnikotoHlsAuthorization(root, referer, async url => {
    if (url === root) return new Response(master(["nested.m3u8", "available.m3u8"]));
    if (url.endsWith("nested.m3u8")) return new Response(master(["gone.m3u8"]));
    return url.endsWith("gone.m3u8") ? new Response("", { status: 404 }) : new Response(media);
  }, { authorize: () => {} });
  assert.equal(playable, "https://playlist.example/show/available.m3u8");
});

test("Anikoto refuses a master when every video rendition is missing", async () => {
  let authorizations = 0;
  await assert.rejects(prepareAnikotoHlsAuthorization(root, referer, async url =>
    url === root ? new Response(master(["gone.m3u8"])) : new Response("", { status: 404 }),
  { authorize: () => authorizations++ }), /no accessible media rendition/);
  assert.equal(authorizations, 0);
});

test("Anikoto never discards separate audio when bypassing a missing quality", async () => {
  let authorizations = 0;
  const playlist = "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",URI=\"audio.m3u8\"\n"
    + "#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO=\"audio\"\navailable.m3u8\n"
    + "#EXT-X-STREAM-INF:BANDWIDTH=9000000,AUDIO=\"audio\"\ngone.m3u8\n";
  await assert.rejects(prepareAnikotoHlsAuthorization(root, referer, async url => {
    if (url === root) return new Response(playlist);
    return url.endsWith("gone.m3u8") ? new Response("", { status: 404 }) : new Response(media);
  }, { authorize: () => authorizations++ }), /separate audio/);
  assert.equal(authorizations, 0);
});

test("Anikoto HLS stops immediately on a security/rate response and commits no partial authorization", async () => {
  for (const status of [403, 429]) {
    let calls = 0;
    let authorizations = 0;
    await assert.rejects(prepareAnikotoHlsAuthorization(root, referer, async url => {
      calls++;
      return url === root ? new Response(master(["blocked.m3u8", "other.m3u8"])) : new Response("", { status });
    }, { authorize: () => authorizations++ }), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 2);
    assert.equal(authorizations, 0);
  }
});

test("Anikoto HLS rejects unsafe and encrypted media children before any media request", async () => {
  for (const child of [
    "http://media.example/seg.ts", "https://127.0.0.1/seg.ts", "https://local.internal/seg.ts",
    "https://media.example/segment/" + "A".repeat(64),
  ]) {
    let calls = 0;
    let authorizations = 0;
    await assert.rejects(prepareAnikotoHlsAuthorization(root, referer, async () => {
      calls++; return new Response(`#EXTM3U\n#EXTINF:6,\n${child}\n#EXT-X-ENDLIST`);
    }, { authorize: () => authorizations++ }), /unsafe media|encrypted playlist/);
    assert.equal(calls, 1);
    assert.equal(authorizations, 0);
  }
});

test("Anikoto HLS bounds rendition counts, response sizes and circular links", async () => {
  for (const response of [
    () => new Response(master(["1.m3u8", "2.m3u8", "3.m3u8", "4.m3u8", "5.m3u8"])),
    () => new Response(master([root])),
    () => new Response("#EXTM3U", { headers: { "content-length": String(2 * 1024 * 1024 + 1) } }),
    () => new Response("{}"),
  ]) {
    let calls = 0;
    await assert.rejects(prepareAnikotoHlsAuthorization(root, referer, async () => { calls++; return response(); }, { authorize: () => assert.fail("Incomplete traversal must not authorize URLs") }));
    assert.equal(calls, 1);
  }
});

test("Anikoto HLS whole traversal deadline covers a stalled playlist body", async () => {
  let cancelled = false;
  await assert.rejects(prepareAnikotoHlsAuthorization(root, referer, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("#EXTM3U\n")); },
    cancel() { cancelled = true; },
  })), { deadlineMillis: 20, authorize: () => assert.fail("Timed out traversal must not authorize URLs") }), /timed out/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test("Anikoto HLS reuses shared subtitle renditions without mistaking them for a loop", async () => {
  let subtitleRequests = 0;
  await prepareAnikotoHlsAuthorization(root, referer, async url => {
    if (url === root) return new Response(master(["low.m3u8", "high.m3u8"]));
    if (url.endsWith("subtitles.m3u8")) { subtitleRequests++; return new Response("#EXTM3U\n#EXTINF:6,\ncaption.vtt\n#EXT-X-ENDLIST"); }
    return new Response("#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI=\"subtitles.m3u8\"\n#EXTINF:6,\nhttps://media.example/episode/seg.ts\n#EXT-X-ENDLIST");
  }, { authorize: () => {} });
  assert.equal(subtitleRequests, 1);
});
