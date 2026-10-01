const test = require("node:test");
const assert = require("node:assert/strict");
const { createMediaProbe, mediaFormat, publicHttpsUrl, safeMessage } = require("../scripts/electron-provider-smoke-common");

const transportPackets = (count) => {
  const bytes = new Uint8Array(188 * count).fill(0xff);
  for (let i = 0; i < bytes.length; i += 188) bytes[i] = 0x47;
  return bytes;
};

test("media smoke follows nested playlists without copying headers onto a rotated CDN", async () => {
  const calls = [];
  const cancelled = [];
  const stages = [];
  const responses = [
    new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500\nvariant.m3u8\n"),
    new Response("#EXTM3U\n#EXTINF:10,\nhttps://rotated.example/one.ts\n#EXTINF:10,\nhttps://rotated.example/two.ts\n"),
  ];
  // An endless segment body: the probe must stop after its prefix and cancel.
  // The CDN's text/html label (seen on disguised segments) must not matter.
  function media(status) {
    return new Response(new ReadableStream({
      pull(controller) { controller.enqueue(transportPackets(4)); },
      cancel() { cancelled.push(status); },
    }), { status, headers: { "content-type": "text/html" } });
  }
  responses.push(media(200), media(200), media(206));
  const probe = createMediaProbe({
    async fetch(url, options) { calls.push({ url, options }); return responses.shift(); },
    authorization(url) { return new URL(url).hostname === "origin.example" ? { headers: { Referer: "https://player.example/", Cookie: "fixture-only" } } : null; },
    report(name, detail) { stages.push({ name, detail }); },
  });
  const result = await probe.verifyHls("https://origin.example/anime/master.m3u8?signature=fixture");
  assert.equal(result.manifestDepth, 2);
  assert.equal(result.rangeStatus, 206);
  assert.equal(calls.length, 5);
  assert.equal(calls[0].options.headers.Cookie, "fixture-only");
  assert.equal(calls[0].options.credentials, "omit", "authorized headers do not enable ambient-cookie credential mode");
  assert.deepEqual(calls[2].options.headers, {});
  assert.equal(calls[2].options.credentials, "omit");
  assert.deepEqual(calls[4].options.headers, { Range: "bytes=0-1023" });
  assert.equal(calls[4].options.redirect, "manual");
  assert.deepEqual(cancelled, [200, 200, 206], "media bodies are cancelled without reading whole segments");
  assert.equal(stages.filter((item) => item.name.includes("media")).length, 2);
  assert.match(stages.find((item) => item.name === "last media").detail, /MPEG-TS/);
});

test("media smoke rejects real pages and empty bodies whatever their media label", async () => {
  for (const [body, type, expected] of [
    ["<!doctype html><html>denied</html>", "video/mp2t", /returned a page/],
    ['{"error":"denied"}', "image/png", /returned a page/],
    ["Gateway Timeout", "text/html", /returned a page/],
    ["", "video/mp2t", /empty body/],
  ]) {
    const responses = [
      new Response("#EXTM3U\n#EXTINF:10,\none.ts\n#EXTINF:10,\ntwo.ts\n"),
      new Response(body, { headers: { "content-type": type } }),
    ];
    const probe = createMediaProbe({ async fetch() { return responses.shift(); }, authorization() { return null; } });
    await assert.rejects(() => probe.verifyHls("https://origin.example/media.m3u8"), expected);
  }
});

test("media classification recognizes HLS segment formats, not a lone sync byte", () => {
  const box = (type) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(type, "latin1"), Buffer.alloc(16)]);
  assert.equal(mediaFormat(Buffer.from(transportPackets(2))), "MPEG-TS");
  assert.equal(mediaFormat(box("ftyp")), "fMP4");
  assert.equal(mediaFormat(box("moof")), "fMP4");
  assert.equal(mediaFormat(Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 10])), "packed audio");
  assert.equal(mediaFormat(Buffer.from("Gateway Timeout. ".repeat(40))), "");
  const brokenSync = Buffer.from(transportPackets(5));
  brokenSync[188 * 3] = 0;
  assert.equal(mediaFormat(brokenSync), "", "every packet boundary in the prefix must carry a sync byte");
  assert.equal(mediaFormat(Buffer.from("﻿  <HTML><body>blocked</body>")), "page");
  assert.equal(mediaFormat(Buffer.alloc(0)), "empty");
});

test("media smoke validates redirect targets before sending another request", async () => {
  let calls = 0;
  const probe = createMediaProbe({
    async fetch() { calls++; return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } }); },
    authorization() { return null; },
  });
  await assert.rejects(() => probe.verifyHls("https://origin.example/master.m3u8"), /public HTTPS/);
  assert.equal(calls, 1);
});

test("media smoke stops on HTTP 403 without fallback or retry", async () => {
  let calls = 0;
  const probe = createMediaProbe({
    async fetch() { calls++; return new Response(null, { status: 403 }); },
    authorization() { return null; },
  });
  await assert.rejects(() => probe.verifyHls("https://origin.example/master.m3u8"), /HTTP 403; no retry/);
  assert.equal(calls, 1);
});

test("media smoke only accepts public HTTPS and sanitizes signed URL errors", () => {
  for (const url of [
    "http://cdn.example/video.ts", "https://localhost/video.ts", "https://127.0.0.1/video.ts",
    "https://[::1]/video.ts", "https://user:pass@cdn.example/video.ts", "https://cdn.example:8443/video.ts",
  ]) assert.throws(() => publicHttpsUrl(url), /public HTTPS/);
  assert.equal(safeMessage(new Error("HTTP 403 for https://cdn.example/video.ts?signature=secret")), "HTTP 403 for [URL omitted]");
});
