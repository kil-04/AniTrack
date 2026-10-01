import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCipheriv } from "node:crypto";
import { BUILTIN_RUNTIME_CONFIG } from "../packages/shared/runtime-config.ts";

// Exercise the actual provider with isolated public-response fixtures. Electron
// sessions and persisted runtime configuration are never read by these tests.
const browserMock = "data:text/javascript," + encodeURIComponent(`
  export const anikotoFetch = (...args) => globalThis.anikotoFixtureFetch(...args);
  export const prewarmAnikoto = () => {};
  export const rememberAnikotoStreamOrigin = () => {};
  export const getAnikotoPlayerOrigin = () => "";
  export const getAnikotoPlayerOriginForUrl = () => "";
`);
const configMock = "data:text/javascript," + encodeURIComponent(`
  export const getRuntimeConfig = () => globalThis.anikotoFixtureConfig;
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./anikoto-browser") return { url: browserMock, shortCircuit: true };
    if (specifier === "../remote-config") return { url: configMock, shortCircuit: true };
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const { AnikotoProvider } = await import("../apps/desktop/main/services/providers/anikoto.ts");
const { clearResolvedStreamAuthorizations, getResolvedStreamAuthorization } = await import("../apps/desktop/main/services/providers/stream-authorization.ts");
const episodeId = "ep-1:101:fixture-servers";
const animeId = "classic-show";
const link = (subType) => JSON.stringify({ episodeId, animeId, subType });
const type = (label, id) => `<div class="type"><label>${label}</label><ul><li data-link-id="${id}">Fixture Player</li></ul></div>`;

function fixture(fetcher, sourceRoute) {
  const config = structuredClone(BUILTIN_RUNTIME_CONFIG);
  config.providers.anikoto.baseUrls = ["https://provider.example"];
  if (sourceRoute) config.providers.anikoto.routes.sources = sourceRoute;
  globalThis.anikotoFixtureConfig = config;
  globalThis.anikotoFixtureFetch = fetcher;
  clearResolvedStreamAuthorizations();
  return new AnikotoProvider();
}

test("Anikoto hard-sub hash sources keep their fragment and return an authorized working HLS quality", async () => {
  const master = "https://playlist.example/title/master.m3u8";
  const iframe = "https://player.example/plyr.php#" + Buffer.from(master).toString("base64url");
  const calls = [];
  const provider = fixture(async url => {
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname === "/ajax/server/list") return Response.json({ result: type("H SUB", "hard-server") });
    if (parsed.pathname === "/ajax/server") return Response.json({ result: { url: iframe } });
    if (url === master) return new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=9000000\ngone.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000000\navailable.m3u8\n");
    if (url.endsWith("gone.m3u8")) return new Response("", { status: 404 });
    if (url.endsWith("available.m3u8")) return new Response("#EXTM3U\n#EXTINF:6,\nhttps://media.example/title/seg1.ts\n#EXT-X-ENDLIST");
    assert.fail(`Unexpected fixture request: ${url}`);
  });
  const links = await provider.getStreamLinks(episodeId, animeId);
  assert.deepEqual(links.map(item => item.variant), ["hard"]);
  const stream = await provider.resolveStream(links[0].id);
  assert.equal(stream.url, "https://playlist.example/title/available.m3u8");
  assert.equal(stream.authorizationScope, "directory");
  assert.equal(stream.referer, "https://player.example");
  assert.deepEqual(stream.subtitles, []);
  assert.ok(getResolvedStreamAuthorization("https://media.example/title/seg1.ts"));
  assert.equal(calls.some(url => new URL(url).hostname === "player.example"), false, "A hash source needs no embed navigation or script execution");
});

test("Anikoto never substitutes dub or hard subtitles for a missing soft-sub selection", async () => {
  for (const availableLabel of ["DUB", "H SUB"]) {
    const calls = [];
    const provider = fixture(async url => {
      calls.push(url);
      assert.equal(new URL(url).pathname, "/ajax/server/list");
      return Response.json({ result: type(availableLabel, "wrong-audio-server") });
    });
    if (availableLabel === "DUB") assert.deepEqual(await provider.getStreamLinks(episodeId, animeId), []);
    await assert.rejects(provider.resolveStream(link("soft")), /does not currently offer soft subtitles/);
    assert.equal(calls.some(url => new URL(url).pathname === "/ajax/server"), false);
  }
});

test("Anikoto never substitutes soft subtitles for a missing hard-sub selection", async () => {
  let calls = 0;
  const provider = fixture(async url => {
    calls++;
    assert.equal(new URL(url).pathname, "/ajax/server/list");
    return Response.json({ result: type("SUB", "soft-server") });
  });
  await assert.rejects(provider.resolveStream(link("hard")), /does not currently offer hard subtitles/);
  assert.equal(calls, 1);
});

test("Anikoto videojs players use their current source/client paths and accept encrypted sources with an empty legacy shape", async () => {
  const metadata = 'function decoder(){var k=(new TextEncoder).encode("abcdefghijklmnop");var v=(new TextEncoder).encode("0123456789abcdef");return crypto.subtle.decrypt({name:"AES-CBC",iv:v},k,input)};resolveUrlSync:decode;';
  const key = Buffer.alloc(32);
  Buffer.from("abcdefghijklmnop").copy(key);
  const encryptor = createCipheriv("aes-256-cbc", key, Buffer.from("0123456789abcdef"));
  const enc = Buffer.concat([encryptor.update(JSON.stringify({ file: "https://media.example/title/video.mp4" })), encryptor.final()]).toString("base64url");
  for (const signedRoute of [undefined, "/videojs/stream/getSources?id={playerId}", "/custom/sources/{playerId}"]) {
    const expectedPath = signedRoute?.startsWith("/custom/") ? "/custom/sources/player-id" : "/videojs/stream/getSources";
    const calls = [];
    const provider = fixture(async url => {
      calls.push(url);
      const parsed = new URL(url);
      if (parsed.pathname === "/ajax/server/list") return Response.json({ result: type("SUB", "soft-server") });
      if (parsed.pathname === "/ajax/server") return Response.json({ result: { url: "https://player.example/videojs/e/episode" } });
      if (parsed.pathname === "/videojs/e/episode") return new Response('<div id="megaplay-player" data-id="player-id"></div>');
      if (parsed.pathname === expectedPath) return Response.json({ sources: {}, enc, tracks: [{ kind: "captions", label: "English", file: "https://subs.example/title/en.vtt" }] });
      if (parsed.pathname === "/videojs/lib/newclient.min.js") return new Response(metadata);
      assert.fail(`Unexpected fixture request: ${url}`);
    }, signedRoute);
    const stream = await provider.resolveStream(link("soft"));
    assert.equal(stream.url, "https://media.example/title/video.mp4");
    assert.equal(stream.authorizationScope, "exact");
    assert.equal(stream.subtitles.length, 1);
    assert.ok(calls.some(url => new URL(url).pathname === expectedPath));
    assert.ok(calls.some(url => new URL(url).pathname === "/videojs/lib/newclient.min.js"));
    assert.equal(calls.some(url => new URL(url).pathname === "/stream/getSources"), false);
    // Another episode on the same player reuses the parsed client constants.
    const otherEpisode = JSON.stringify({ episodeId: "ep-2:102:fixture-servers", animeId, subType: "soft" });
    assert.equal((await provider.resolveStream(otherEpisode)).url, "https://media.example/title/video.mp4");
    assert.equal(calls.filter(url => new URL(url).pathname === "/videojs/lib/newclient.min.js").length, 1);
  }
});

test("Anikoto /stream/ players fall back to the same-origin readable client constants and remember unreadable clients", async () => {
  const metadata = 'function decoder(){var k=(new TextEncoder).encode("abcdefghijklmnop");var v=(new TextEncoder).encode("0123456789abcdef");return crypto.subtle.decrypt({name:"AES-CBC",iv:v},k,input)};resolveUrlSync:decode;';
  // Shape observed live: the /stream/ client's only AES code is a telemetry
  // encryptor with no literal decoder parameters.
  const telemetry = 'function t(e){var k=e.pick(["a","b"],"c");return crypto.subtle.importKey("raw",k,{name:"AES-CBC"},!1,["encrypt"])}';
  const key = Buffer.alloc(32);
  Buffer.from("abcdefghijklmnop").copy(key);
  const encryptor = createCipheriv("aes-256-cbc", key, Buffer.from("0123456789abcdef"));
  const enc = Buffer.concat([encryptor.update(JSON.stringify({ file: "https://media.example/title/video.mp4" })), encryptor.final()]).toString("base64url");
  const calls = [];
  const provider = fixture(async url => {
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname === "/ajax/server/list") return Response.json({ result: type("SUB", "soft-server") });
    if (parsed.pathname === "/ajax/server") return Response.json({ result: { url: "https://player.example/stream/s-2/episode" } });
    if (parsed.pathname === "/stream/s-2/episode") return new Response('<div id="megaplay-player" data-id="player-id"></div>');
    if (parsed.pathname === "/stream/getSources") return Response.json({ sources: {}, enc, tracks: [{ kind: "captions", file: "https://subs.example/title/en.vtt" }] });
    if (parsed.pathname === "/lib/newclient.min.js") return new Response(telemetry);
    if (parsed.pathname === "/videojs/lib/newclient.min.js") return new Response(metadata);
    assert.fail(`Unexpected fixture request: ${url}`);
  }, "/stream/getSources?id={playerId}");
  assert.equal((await provider.resolveStream(link("soft"))).url, "https://media.example/title/video.mp4");
  const otherEpisode = JSON.stringify({ episodeId: "ep-2:102:fixture-servers", animeId, subType: "soft" });
  assert.equal((await provider.resolveStream(otherEpisode)).url, "https://media.example/title/video.mp4");
  const clientFetches = (pathname) => calls.filter(url => new URL(url).pathname === pathname).length;
  assert.equal(clientFetches("/lib/newclient.min.js"), 1, "an unreadable client is not refetched");
  assert.equal(clientFetches("/videojs/lib/newclient.min.js"), 1);
});

test("Anikoto stops at a security check while reading player constants", async () => {
  const { AnikotoTransportError } = await import("../apps/desktop/main/services/providers/anikoto-transport.ts");
  const calls = [];
  const provider = fixture(async url => {
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname === "/ajax/server/list") return Response.json({ result: type("SUB", "soft-server") });
    if (parsed.pathname === "/ajax/server") return Response.json({ result: { url: "https://player.example/stream/s-2/episode" } });
    if (parsed.pathname === "/stream/s-2/episode") return new Response('<div id="megaplay-player" data-id="player-id"></div>');
    if (parsed.pathname === "/stream/getSources") return Response.json({ sources: {}, enc: "abcd" });
    if (parsed.pathname === "/lib/newclient.min.js") throw new AnikotoTransportError("SECURITY_CHECK");
    assert.fail(`Unexpected fixture request: ${url}`);
  }, "/stream/getSources?id={playerId}");
  await assert.rejects(provider.resolveStream(link("soft")), /ANIKOTO_SECURITY_CHECK/);
  assert.equal(calls.some(url => new URL(url).pathname === "/videojs/lib/newclient.min.js"), false);
});

test("Anikoto forged and oversized stream coordinates fail before any request", async () => {
  let calls = 0;
  const provider = fixture(async () => { calls++; assert.fail("Invalid coordinates must not fetch"); });
  for (const invalid of [
    "not json", "null", "[]", "x".repeat(16_385),
    JSON.stringify({ episodeId: 1, animeId, subType: "soft" }),
    JSON.stringify({ episodeId, animeId: "https://private.example", subType: "soft" }),
    JSON.stringify({ episodeId: "ep-1::servers", animeId, subType: "soft" }),
    JSON.stringify({ episodeId: "ep-1:101:" + "x".repeat(4097), animeId, subType: "soft" }),
    JSON.stringify({ episodeId, animeId, subType: "unknown" }),
  ]) await assert.rejects(provider.resolveStream(invalid), /Invalid Anikoto/);
  await assert.rejects(provider.getStreamLinks("ep-1::servers", animeId), /Invalid Anikoto/);
  assert.equal(calls, 0);
});
