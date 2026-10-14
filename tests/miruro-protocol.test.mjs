import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { gzipSync } from "node:zlib";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});

const { MiruroClient } = await import("../apps/desktop/main/services/providers/miruro-client.ts");
const {
  decodeMiruroResponse, miruroRequestUrl, parseMiruroEnvironment, MIRURO_MAX_RESPONSE_BYTES,
} = await import("../apps/desktop/main/services/providers/miruro-protocol.ts");
const fixture = JSON.parse(readFileSync(new URL("./fixtures/miruro-protocol.json", import.meta.url), "utf8"));
const env = `window.env=JSON.parse(${JSON.stringify(JSON.stringify({ VITE_PIPE_OBF_KEY: fixture.syntheticKey }))});`;
const config = { operation: "config" };
const { MiruroV1Client, decodeMiruroV1, miruroV1Url } = await import("../apps/desktop/main/services/providers/miruro-v1-client.ts");

function v1Wire(payload) {
  const bytes = gzipSync(Buffer.from(JSON.stringify(payload)));
  const mask = Buffer.from("miruro/catalog");
  for (let index = 0; index < bytes.length; index++) bytes[index] ^= mask[index % mask.length];
  return bytes;
}

test("Miruro current REST routes use exact approved queries and numeric episode identities", () => {
  assert.equal(miruroV1Url({ operation: "lookup", anilistId: 1 }), "https://www.miruro.ru/api/v1/anime?anilist_id_in=1&limit=100");
  assert.equal(miruroV1Url({ operation: "episodes", showId: "synthetic-show" }), "https://www.miruro.ru/api/v1/anime/synthetic-show/episodes?limit=10000");
  assert.equal(miruroV1Url({ operation: "play", showId: "synthetic-show", episode: 1.5 }), "https://www.miruro.ru/api/v1/anime/synthetic-show/episodes/1.5/play");
  for (const request of [
    { operation: "lookup", anilistId: 0 }, { operation: "episodes", showId: "../account" },
    { operation: "play", showId: "show", episode: NaN }, { operation: "play", showId: "show", episode: -1 },
    { operation: "delete", showId: "show" },
  ]) assert.throws(() => miruroV1Url(request));
});

test("Miruro current binary codec preserves Unicode without modifying input or executing code", () => {
  const payload = { title: "カウボーイビバップ", episode_number: 1 };
  const bytes = v1Wire(payload), original = Buffer.from(bytes);
  assert.deepEqual(decodeMiruroV1(bytes, "application/octet-stream; charset=binary"), payload);
  assert.deepEqual(bytes, original);
  assert.deepEqual(decodeMiruroV1(Buffer.from(JSON.stringify(payload)), "application/json"), payload);
  for (const body of [Buffer.from("[]"), Buffer.from("{bad}"), Buffer.from([255]), Buffer.alloc(MIRURO_MAX_RESPONSE_BYTES + 1)]) {
    assert.throws(() => decodeMiruroV1(body, "application/json"));
  }
  assert.throws(() => decodeMiruroV1(v1Wire({ value: "a".repeat(MIRURO_MAX_RESPONSE_BYTES) }), "application/octet-stream"));
  assert.throws(() => decodeMiruroV1(Buffer.from("unknown codec"), "application/octet-stream"));
});

test("Miruro current transport reads fresh binary responses and stops queued requests after rejection", async () => {
  let calls = 0;
  const client = new MiruroV1Client({ securityCooldownMs: 0, fetcher: async (url, init) => {
    calls++;
    assert.equal(init.redirect, "manual");
    assert.equal(init.credentials, "omit");
    assert.equal(url.includes("api/secure/pipe"), false);
    if (calls === 1) return new Response("blocked", { status: 403 });
    return new Response(v1Wire({ episode_number: 1 }), { headers: { "content-type": "application/octet-stream" } });
  } });
  const request = { operation: "play", showId: "synthetic-show", episode: 1 };
  const results = await Promise.allSettled([client.read(request), client.read(request)]);
  assert.deepEqual(results.map(result => result.reason.code), ["SECURITY_CHECK", "COOLDOWN"]);
  assert.equal(calls, 1);
  assert.deepEqual(await client.read(request), { episode_number: 1 });
  await client.read(request);
  assert.equal(calls, 3, "no cache of expiring /play responses");
});

test("Miruro current transport rejects oversized chunked responses, redirects and HTTP-200 challenges", async () => {
  const request = { operation: "lookup", anilistId: 1 };
  for (const response of [
    new Response(null, { status: 302, headers: { location: "https://other.example/api" } }),
    new Response("x".repeat(MIRURO_MAX_RESPONSE_BYTES + 1)),
    new Response("{}", { headers: { "content-length": String(MIRURO_MAX_RESPONSE_BYTES + 1) } }),
  ]) {
    let calls = 0;
    const client = new MiruroV1Client({ fetcher: async () => { calls++; return response; } });
    await assert.rejects(client.read(request));
    assert.equal(calls, 1);
  }
  let calls = 0;
  const client = new MiruroV1Client({ fetcher: async () => { calls++; return new Response("  <html><title>Just a moment</title></html>"); } });
  await assert.rejects(client.read(request), error => error.code === "SECURITY_CHECK");
  await assert.rejects(client.read(request), error => error.code === "COOLDOWN");
  assert.equal(calls, 1);
});

test("Miruro current transport stops queued reads on HTTP-503 website checks but not ordinary server errors", async () => {
  for (const [body, codes, expectedCalls] of [
    ["<html><title>Just a moment</title><div id='cf-chl-widget'></div></html>", ["SECURITY_CHECK", "COOLDOWN"], 1],
    ["Service temporarily unavailable", ["INVALID_RESPONSE", "INVALID_RESPONSE"], 2],
  ]) {
    let calls = 0;
    const client = new MiruroV1Client({ fetcher: async () => { calls++; return new Response(body, { status: 503 }); } });
    const request = { operation: "lookup", anilistId: 1 };
    const results = await Promise.allSettled([client.read(request), client.read(request)]);
    assert.deepEqual(results.map(result => result.reason.code), codes);
    assert.equal(calls, expectedCalls);
  }
});

test("Miruro encodes only bounded read operations and preserves source coordinates", () => {
  for (const [request, path, query] of [
    [config, "config", {}],
    [{ operation: "info", anilistId: 80 }, "info/80", {}],
    [{ operation: "episodes", anilistId: 80 }, "episodes", { anilistId: 80 }],
    [{ operation: "sources", anilistId: 80, provider: "bee", category: "ssub", episodeId: "series/1" },
      "sources", { anilistId: 80, provider: "bee", category: "ssub", episodeId: "series/1" }],
    [{ operation: "sources", anilistId: 80, provider: "bee", category: "dub", episodeId: "series/1?track=dub" },
      "sources", { anilistId: 80, provider: "bee", category: "dub", episodeId: "series/1?track=dub" }],
  ]) {
    const url = new URL(miruroRequestUrl(request));
    assert.equal(url.origin, "https://www.miruro.ru");
    assert.equal(url.pathname, "/api/secure/pipe");
    assert.deepEqual(JSON.parse(Buffer.from(url.searchParams.get("e"), "base64url")), { path, method: "GET", query, body: null });
  }
  for (const request of [
    { operation: "info", anilistId: -1 }, { operation: "info", anilistId: 2 ** 32 },
    { operation: "info", anilistId: 1.5 }, { operation: "delete" },
    { operation: "sources", anilistId: 80, provider: "../config", category: "sub", episodeId: "1" },
    { operation: "sources", anilistId: 80, provider: "bee", category: "sub", episodeId: "1\n" },
    { operation: "sources", anilistId: 80, provider: "bee", category: "unknown", episodeId: "1" },
  ]) assert.throws(() => miruroRequestUrl(request));
});

test("Miruro safely reads the environment string without executing scripts", () => {
  assert.equal(parseMiruroEnvironment(env), fixture.syntheticKey);
  assert.equal(parseMiruroEnvironment(` \n${env} \n`), fixture.syntheticKey);
  for (const script of [
    `${env}globalThis.miruroExecuted=true`, "window.env=JSON.parse(globalThis.miruroExecuted=true)",
    "window.env=JSON.parse('{}' + alert(1));", "window.env=JSON.parse(\"{}\");", " ".repeat(65_537),
  ]) assert.throws(() => parseMiruroEnvironment(script));
  assert.equal(globalThis.miruroExecuted, undefined);
});

test("Miruro plain, gzip and XOR-gzip envelopes match the shared Unicode fixture", () => {
  assert.deepEqual(decodeMiruroResponse(JSON.stringify(fixture.payload), null), fixture.payload);
  assert.deepEqual(decodeMiruroResponse(fixture.gzipBase64url, "1"), fixture.payload);
  assert.deepEqual(decodeMiruroResponse(fixture.xorGzipBase64url, "2", fixture.syntheticKey), fixture.payload);
});

test("Miruro rejects malformed envelopes, unknown codecs and decompression bombs", () => {
  for (const args of [
    ["[]", null], ["null", null], ["{} trailing", null], ["<html>not JSON</html>", null],
    [fixture.gzipBase64url, "3"], [fixture.xorGzipBase64url, "2"], ["%%%", "1"],
    [fixture.xorGzipBase64url, "2", "xyz"], [" ".repeat(MIRURO_MAX_RESPONSE_BYTES + 1), null],
    [gzipSync(Buffer.alloc(MIRURO_MAX_RESPONSE_BYTES + 1, 32)).toString("base64url"), "1"],
    [gzipSync(Buffer.from([255])).toString("base64url"), "1"],
  ]) assert.throws(() => decodeMiruroResponse(...args));
});

test("Miruro fetches the public environment lazily, expires it and never caches sources", async () => {
  let now = 0;
  const calls = [];
  const client = new MiruroClient({ now: () => now, fetcher: async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, "manual");
    assert.equal(init.credentials, "omit");
    assert.equal(init.method, "GET");
    return url.endsWith("/env2.js") ? new Response(env)
      : new Response(fixture.xorGzipBase64url, { headers: { "x-obfuscated": "2" } });
  } });
  assert.equal(calls.length, 0);
  const source = { operation: "sources", anilistId: 80, episodeId: "1", provider: "bee", category: "sub" };
  await client.read(source);
  await client.read(source);
  assert.equal(calls.length, 3);
  now = 30 * 60_000;
  await client.read(source);
  assert.equal(calls.length, 5);
  assert.equal(calls.filter((url) => url.endsWith("/env2.js")).length, 2);
});

test("Miruro plain JSON never requires an environment or key fetch", async () => {
  let calls = 0;
  const client = new MiruroClient({ fetcher: async () => { calls++; return Response.json({ streaming: {} }); } });
  assert.deepEqual(await client.read(config), { streaming: {} });
  assert.equal(calls, 1);
});

test("Miruro does not mistake ordinary catalogue text for a security challenge", async () => {
  const payload = { title: "Security Check", description: "Just a moment" };
  const client = new MiruroClient({ fetcher: async () => Response.json(payload) });
  assert.deepEqual(await client.read(config), payload);
  assert.deepEqual(await client.read(config), payload);
});

test("Miruro security blocks stop queued requests, then allow a later user request", async () => {
  let now = 1_000;
  let calls = 0;
  const client = new MiruroClient({ now: () => now, fetcher: async () => {
    calls++;
    return calls === 1 ? new Response("blocked", { status: 403 }) : Response.json({ streaming: {} });
  } });
  const results = await Promise.allSettled([client.read(config), client.read(config), client.read(config)]);
  assert.deepEqual(results.map((result) => result.reason.code), ["SECURITY_CHECK", "COOLDOWN", "COOLDOWN"]);
  assert.equal(calls, 1);
  now += 5 * 60_000;
  await client.read(config);
  assert.equal(calls, 2);
});

test("Miruro rate limits, HTML and encoded JSON challenges enter cooldown", async () => {
  for (const response of [
    () => new Response("", { status: 429 }),
    () => new Response("<title>Attention Required! | Cloudflare</title>"),
    () => new Response(gzipSync(JSON.stringify({ error: "CAPTCHA_REQUIRED" })).toString("base64url"), { headers: { "x-obfuscated": "1" } }),
  ]) {
    let calls = 0;
    const client = new MiruroClient({ fetcher: async () => { calls++; return response(); } });
    await assert.rejects(client.read(config), (error) => ["SECURITY_CHECK", "RATE_LIMITED"].includes(error.code));
    await assert.rejects(client.read(config), { code: "COOLDOWN" });
    assert.equal(calls, 1);
  }
});

test("Miruro rejects redirects without contacting another origin", async () => {
  let calls = 0;
  const client = new MiruroClient({ fetcher: async () => {
    calls++; return new Response("", { status: 302, headers: { location: "https://127.0.0.1/private" } });
  } });
  await assert.rejects(client.read(config), /redirected/);
  assert.equal(calls, 1);
});

test("Miruro enforces declared and streamed body limits", async () => {
  for (const response of [
    () => new Response("{}", { headers: { "content-length": String(MIRURO_MAX_RESPONSE_BYTES + 1) } }),
    () => new Response(" ".repeat(MIRURO_MAX_RESPONSE_BYTES + 1)),
  ]) {
    const client = new MiruroClient({ fetcher: async () => response() });
    await assert.rejects(client.read(config), /size limit/);
  }
});

test("Miruro request coordinates cannot mutate while queued", async () => {
  let observed;
  const client = new MiruroClient({ fetcher: async (url) => {
    observed = JSON.parse(Buffer.from(new URL(url).searchParams.get("e"), "base64url"));
    return Response.json({});
  } });
  const request = { operation: "episodes", anilistId: 80 };
  const pending = client.read(request);
  request.anilistId = 999;
  await pending;
  assert.equal(observed.query.anilistId, 80);
});
