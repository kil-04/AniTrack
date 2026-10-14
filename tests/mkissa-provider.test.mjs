import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";

// The Electron TypeScript sources intentionally use extensionless imports for
// their CommonJS build. Teach Node's source-level test runner the same mapping.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { MkissaProvider } = await import("../apps/desktop/main/services/providers/mkissa.ts");
const { MkissaClient } = await import("../apps/desktop/main/services/providers/mkissa-client.ts");
const { assertByseAccess, byseApiUrl, byseMedia, decodeBysePlayback } = await import("../apps/desktop/main/services/providers/mkissa-byse.ts");
const { clearResolvedStreamAuthorizations, getResolvedStreamAuthorization } = await import("../apps/desktop/main/services/providers/stream-authorization.ts");
const { MkissaKeyManager } = await import("../apps/desktop/main/services/providers/mkissa-key-manager.ts");
const { MkissaApiCookies } = await import("../apps/desktop/main/services/providers/mkissa-api-cookies.ts");
const { parseMkissaBundle } = await import("../apps/desktop/main/services/providers/mkissa-bundle.ts");
const {
  bootTokenCandidates,
  decodeMkissaSourceUrl,
  deriveMaskCandidates,
  encodeMkissaSourceUrlForFixture,
} = await import("../apps/desktop/main/services/providers/mkissa-crypto.ts");
const {
  MkissaProviderError,
  publicHttpsUrl,
  responseText,
  safeRedirectFetch,
  mkissaResponseFailure,
} = await import("../apps/desktop/main/services/providers/mkissa-utils.ts");

function source(name, url, priority = 0) {
  return { sourceName: name, sourceUrl: url, type: "player", priority };
}

function cookieHeaders(...cookies) {
  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}
const cookieBuild = { buildId: "149", seeds: ["YWJjZGVmZ2g=", "aWprbG1ub3A=", "cXJzdHV2d3g=", "eXoxMjM0NTY="] };
const cookieBootstrap = { k: "k7", epoch: 1, partB: Buffer.alloc(32, 5).toString("base64") };

test("MKissa ordinary API cookie jar respects exact origin, paths, domain validation and secure prefixes", () => {
  const jar = new MkissaApiCookies("https://api.mkissa.net");
  const bootstrap = new URL("https://api.mkissa.net/client-crypto/v1/bootstrap");
  jar.remember(bootstrap, cookieHeaders(
    "root=fixture_root; Path=/; Secure; HttpOnly", "narrow=fixture_narrow; Path=/client-crypto/; Secure",
    "default=fixture_default; Secure", "api=fixture_api; Path=/api; Secure",
    "parent=fixture_parent; Domain=.mkissa.net; Path=/; Secure",
    "wrong=fixture_wrong; Domain=other.example; Path=/; Secure",
    "public_suffix=fixture_wrong; Domain=net; Path=/; Secure",
    "__Host-good=fixture_host; Path=/; Secure", "__Host-bad=fixture_bad; Domain=mkissa.net; Path=/; Secure",
    "__Secure-bad=fixture_bad; Path=/", "empty=; Path=/; Secure",
  ));
  const api = jar.header(new URL("https://api.mkissa.net/api"));
  assert.equal(api, "api=fixture_api; root=fixture_root; parent=fixture_parent; __Host-good=fixture_host; empty=");
  assert.equal(jar.header(new URL("https://api.mkissa.net/apiculture")), "root=fixture_root; parent=fixture_parent; __Host-good=fixture_host; empty=");
  assert.match(jar.header(bootstrap), /^default=fixture_default; narrow=fixture_narrow; root=/);
  for (const url of ["https://mkissa.to/api", "https://mkissa.net/api", "https://other.api.mkissa.net/api",
    "https://bysekoze.com/api", "https://cdn.mkissa.net/api", "https://api.mkissa.net:444/api", "http://api.mkissa.net/api"]) {
    assert.equal(jar.header(new URL(url)), "");
    jar.remember(new URL(url), cookieHeaders("foreign=fixture_foreign; Path=/; Secure"));
  }
  assert.equal(jar.header(new URL("https://api.mkissa.net/api")), api);
  const atRoot = new MkissaApiCookies("https://api.mkissa.net");
  atRoot.remember(new URL("https://api.mkissa.net/"), cookieHeaders("__Host-no_path=fixture_bad; Secure"));
  assert.equal(atRoot.header(new URL("https://api.mkissa.net/")), "");
  atRoot.remember(bootstrap, cookieHeaders("same=host; Path=/; Secure", "same=parent; Domain=mkissa.net; Path=/; Secure"));
  assert.equal(atRoot.header(new URL("https://api.mkissa.net/api")), "same=host; same=parent");
  atRoot.remember(bootstrap, cookieHeaders("same=; Path=/; Max-Age=0; Secure"));
  assert.equal(atRoot.header(new URL("https://api.mkissa.net/api")), "same=parent");
});

test("MKissa API cookies expire, honor Max-Age precedence, combine Expires safely and remain bounded", () => {
  let now = Date.UTC(2026, 9, 6, 12);
  const jar = new MkissaApiCookies("https://api.mkissa.net", () => now);
  const url = new URL("https://api.mkissa.net/api");
  jar.remember(url, new Headers({ "Set-Cookie":
    `short=fixture; Path=/; Max-Age=1; Expires=${new Date(now + 500_000).toUTCString()}, dated=fixture; Path=/; Expires=${new Date(now + 1000).toUTCString()}`,
  }));
  assert.equal(jar.header(url), "short=fixture; dated=fixture");
  now += 1001;
  assert.equal(jar.header(url), "");
  jar.remember(url, cookieHeaders("same=wide; Path=/", "same=specific; Path=/api", "deleted=fixture; Path=/; Max-Age=0"));
  assert.equal(jar.header(url), "same=specific; same=wide");
  jar.remember(url, cookieHeaders("same=; Path=/api; Max-Age=-1"));
  assert.equal(jar.header(url), "same=wide");
  for (let index = 0; index < 40; index++) jar.remember(url, cookieHeaders(`entry${index}=fixture; Path=/`));
  assert.equal(jar.header(url).split("; ").length, 32);
  const large = new MkissaApiCookies("https://api.mkissa.net", () => now);
  large.remember(url, cookieHeaders("invalid=" + "x".repeat(5000) + "; Path=/", "a=" + "x".repeat(4000) + "; Path=/",
    "b=" + "x".repeat(4000) + "; Path=/", "c=" + "x".repeat(4000) + "; Path=/"));
  assert.ok(large.header(url).length <= 8192);
  assert.equal(large.header(url).includes("invalid="), false);
  now += 24 * 60 * 60_000 + 1;
  assert.equal(jar.header(url), "", "ordinary session cookies have a bounded in-memory lifetime");
  jar.remember(url, cookieHeaders("saturated=fixture; Path=/; Max-Age=999999999999999999999999999999999999999; Expires=Thu, 01 Jan 1970 00:00:00 GMT"));
  assert.equal(jar.header(url), "saturated=fixture", "valid Max-Age still overrides Expires when its duration is capped");
});

test("MKissa shares applicable ordinary bootstrap cookies with the protected API, never bootstrap-only cookies", async () => {
  const requests = [];
  const client = new MkissaClient({ buildResolver: async () => cookieBuild, fetch: async (value, init) => {
    const url = new URL(value); requests.push(url.pathname);
    assert.equal(init.credentials, "omit");
    if (url.pathname === "/client-crypto/v1/bootstrap") {
      assert.equal(init.headers.get("Cookie"), null);
      return Response.json(cookieBootstrap, { headers: cookieHeaders("normal=fixture; Path=/; Secure",
        "crypto_only=fixture; Path=/client-crypto/; Secure", "default_only=fixture; Secure") });
    }
    assert.equal(url.hostname, "api.mkissa.net");
    assert.equal(init.headers.get("Cookie"), "normal=fixture");
    return Response.json({ data: { episode: { show: { _id: "show" }, sourceUrls: [source("Direct", "https://video.example/video.mp4")] } } });
  } });
  const sources = await client.getEpisodeSources("show", "1", "sub", { fresh: true });
  assert.equal(sources.length, 1);
  assert.deepEqual(requests, ["/client-crypto/v1/bootstrap", "/api"]);
});

test("MKissa recalculates API-cookie applicability for redirect hops and never imports ambient Cookie", async () => {
  const jar = new MkissaApiCookies("https://api.mkissa.net");
  jar.remember(new URL("https://api.mkissa.net/api"), cookieHeaders("root=fixture; Path=/; Secure", "local=fixture; Path=/api; Secure"));
  const requests = [];
  const wrapped = jar.fetch(async (value, init) => {
    const url = new URL(value); requests.push({ origin: url.origin, path: url.pathname, cookie: init.headers.get("Cookie") });
    assert.equal(init.credentials, "omit");
    if (url.pathname === "/api") return new Response(null, { status: 302, headers: { Location: "/different", "Set-Cookie": "hop=fixture; Path=/different; Secure" } });
    if (url.pathname === "/different") return new Response(null, { status: 302, headers: { Location: "https://bysekoze.com/e/fixture" } });
    return new Response("fixture");
  });
  await safeRedirectFetch(wrapped, new URL("https://api.mkissa.net/api"), { headers: { Cookie: "imported=not_allowed" } }, () => {});
  assert.deepEqual(requests, [
    { origin: "https://api.mkissa.net", path: "/api", cookie: "local=fixture; root=fixture" },
    { origin: "https://api.mkissa.net", path: "/different", cookie: "hop=fixture; root=fixture" },
    { origin: "https://bysekoze.com", path: "/e/fixture", cookie: null },
  ]);
});

test("MKissa protected API denies cross-origin redirects before transmitting ordinary cookies", async () => {
  const jar = new MkissaApiCookies("https://api.mkissa.net");
  jar.remember(new URL("https://api.mkissa.net/api"), cookieHeaders("normal=fixture; Path=/; Secure"));
  let calls = 0;
  const client = new MkissaClient({ apiCookies: jar, keyManager: { async material() { return { key: Buffer.alloc(32), epoch: 1, buildId: "149" }; } },
    fetch: async (_value, init) => {
      calls++; assert.equal(init.headers.get("Cookie"), "normal=fixture");
      return new Response(null, { status: 302, headers: { Location: "https://other.example/api" } });
    },
  });
  await assert.rejects(client.getEpisodeSources("show", "1", "sub"), error => error.code === "UNSAFE_URL");
  assert.equal(calls, 1);
  assert.throws(() => new MkissaClient({ apiCookies: new MkissaApiCookies("https://other.example") }), /does not match/);
});

test("MKissa API cookies never authorize website, embed or CDN hosts", async () => {
  const jar = new MkissaApiCookies("https://api.mkissa.net");
  jar.remember(new URL("https://api.mkissa.net/api"), cookieHeaders("normal=fixture; Path=/; Secure"));
  let calls = 0;
  const client = new MkissaClient({ apiCookies: jar, fetch: async (value, init) => {
    calls++; assert.equal(new URL(value).hostname, "mp4upload.com");
    assert.equal(init.headers.get("Cookie"), null);
    return new Response('player.src({src:"https://video.example/video.mp4"})');
  } });
  const stream = await client.resolveSource({ ...source("Mp4", "https://mp4upload.com/embed-fixture.html"), type: "iframe" });
  assert.equal(stream.url, "https://video.example/video.mp4");
  assert.equal(stream.cookies, undefined);
  assert.equal(stream.requestHeaders.Cookie, undefined);
  assert.equal(calls, 1);
});

test("MKissa cookie continuity cannot clear a denial, trigger rebootstrap or retry queued requests", async () => {
  let calls = 0, bootstraps = 0;
  const client = new MkissaClient({ buildResolver: async () => cookieBuild, fetch: async (value, init) => {
    calls++;
    if (new URL(value).pathname.includes("bootstrap")) {
      bootstraps++;
      return Response.json(cookieBootstrap, { headers: cookieHeaders("normal=fixture; Path=/; Secure") });
    }
    assert.equal(init.headers.get("Cookie"), "normal=fixture");
    return new Response("Forbidden", { status: 403, headers: cookieHeaders("ordinary=fixture; Path=/; Secure") });
  } });
  const failures = await Promise.allSettled([client.getEpisodeSources("show", "1", "sub"), client.getEpisodeSources("show", "2", "sub")]);
  assert.deepEqual(failures.map(result => result.reason.code), ["CAPTCHA_REQUIRED", "CAPTCHA_REQUIRED"]);
  assert.equal(calls, 2); assert.equal(bootstraps, 1);
  client.reset();
  await assert.rejects(client.getEpisodeSources("show", "3", "sub"), error => error.code === "CAPTCHA_REQUIRED");
  assert.equal(calls, 2);
});

const byseFixture = JSON.parse(await readFile(new URL("./fixtures/mkissa-byse.json", import.meta.url), "utf8"));
function encryptByseFixture(value, version = "1") {
  const key = Buffer.alloc(32, 7), iv = Buffer.alloc(12, 3);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value))), cipher.final(), cipher.getAuthTag()]);
  const parts = Array.from({ length: 30 }, () => Buffer.alloc(16, 9).toString("base64url"));
  const numeric = Number(version);
  parts[numeric - 1] = key.subarray(0, 16).toString("base64url");
  parts[30 - numeric] = key.subarray(16).toString("base64url");
  return { version, key_parts: parts, iv: iv.toString("base64url"), payload: payload.toString("base64url"), algorithm: "AES-GCM" };
}

test("MKissa Byse codec decodes only bounded authenticated public response data", () => {
  for (const version of ["1", "15", "20"]) {
    const encrypted = encryptByseFixture(byseFixture.playback, version);
    assert.deepEqual(decodeBysePlayback(encrypted), byseFixture.playback);
    const media = byseMedia({ playback: encrypted, skip_intro: byseFixture.skip_intro });
    assert.equal(media.url.toString(), "https://video.example/episode/master.m3u8");
    assert.equal(media.hls, true);
    assert.deepEqual(media.intro, { start: 5, end: 95 });
    assert.deepEqual(media.subtitles.map(track => track.label), ["English"]);
  }
  const encrypted = encryptByseFixture(byseFixture.playback);
  assert.throws(() => decodeBysePlayback({ ...encrypted, algorithm: "AES-CBC" }), /unsupported/);
  assert.throws(() => decodeBysePlayback({ ...encrypted, key_parts: Array(65).fill("AA") }), /unsupported/);
  assert.throws(() => decodeBysePlayback({ ...encrypted, iv: "%%%" }), /invalid/);
  assert.throws(() => decodeBysePlayback({ ...encrypted, payload: "AA" }), /invalid/);
  const corrupted = Buffer.from(encrypted.payload, "base64url"); corrupted[0] ^= 1;
  assert.throws(() => decodeBysePlayback({ ...encrypted, payload: corrupted.toString("base64url") }), /could not be decoded/);
  assert.throws(() => byseMedia({ playback: encryptByseFixture({ sources: [{ url: "https://127.0.0.1/private.mp4", mime_type: "video/mp4" }] }) }), /unsafe/);
  assert.throws(() => byseMedia({ playback: encryptByseFixture({ sources: [{ url: "https://embed.example/e/token", mime_type: "text/html" }] }) }), /direct media/);
  assert.throws(() => byseMedia({ playback: encryptByseFixture({ sources: [{ url: "https://video.example/master.m3u8", mime_type: "video/mp4" }] }) }), /direct media/);
});

test("MKissa Byse API routes and explicit website gates fail closed", () => {
  assert.equal(byseApiUrl(new URL("https://bysekoze.com/e/fixture_video"), "playback").toString(),
    "https://bysekoze.com/api/videos/fixture_video/embed/playback");
  assert.throws(() => byseApiUrl(new URL("https://bysekoze.com/e/a/b"), "playback"), /route changed/);
  assert.doesNotThrow(() => assertByseAccess(byseFixture.settings));
  for (const payload of [{ captcha_required: true }, { captcha_required: 1 }, { fingerprint_required: true },
    { error: "Fingerprint attestation required" }, { pow_token: "fixture-only" }, { code: "NEED_CAPTCHA" }]) {
    assert.throws(() => assertByseAccess(payload), error => error.code === "CAPTCHA_REQUIRED");
  }
  assert.throws(() => assertByseAccess({ premium_only: true }), /upstream account/);
  assert.throws(() => assertByseAccess({ processing: { locked: true } }), /processing/);
});

test("MKissa resolves current Byse frontend through only its same-origin catalogue and native HLS", async () => {
  clearResolvedStreamAuthorizations();
  const requests = [];
  const client = new MkissaClient({ fetch: async (value, init) => {
    const url = new URL(value); requests.push(url.toString());
    if (url.hostname === "bysekoze.com") {
      if (url.pathname.startsWith("/api/")) {
        assert.equal(init.headers.get("X-Embed-Origin"), "mkissa.to");
        assert.equal(init.headers.get("X-Embed-Referer"), "https://mkissa.to/");
        assert.equal(init.headers.get("Referer"), "https://bysekoze.com/e/fixture_video");
        return Response.json(url.pathname.endsWith("/settings") ? byseFixture.settings : {
          playback: encryptByseFixture(byseFixture.playback), skip_intro: byseFixture.skip_intro,
        });
      }
      return new Response('<html><title>Byse Frontend</title><div id="root"></div><script src="/assets/fixture.js"></script></html>');
    }
    assert.equal(url.toString(), "https://video.example/episode/master.m3u8");
    assert.equal(init.headers.get("Referer"), "https://bysekoze.com/e/fixture_video");
    assert.equal(init.headers.get("Origin"), "https://bysekoze.com");
    assert.equal(init.headers.get("X-Embed-Origin"), null, "catalogue context is not sent to media");
    return new Response("#EXTM3U\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST\n");
  } });
  const stream = await client.resolveSource({ ...source("Fm-Hls", "https://bysekoze.com/e/fixture_video"), type: "iframe" });
  assert.equal(stream.url, "https://video.example/episode/master.m3u8");
  assert.equal(stream.authorizationScope, "directory");
  assert.deepEqual(stream.intro, { start: 5, end: 95 });
  assert.equal(stream.subtitles[0].file, "https://captions.example/episode/en.vtt");
  assert.equal(requests.length, 4);
  assert.equal(requests.some(url => url.includes(".js") || url.includes("captcha") || url.includes("fingerprint")), false);
  assert.equal(getResolvedStreamAuthorization("https://video.example/episode/segment.ts")?.referer, "https://bysekoze.com/e/fixture_video");
  assert.equal(getResolvedStreamAuthorization("https://video.example/unrelated/segment.ts"), null);
  assert.equal(getResolvedStreamAuthorization("https://captions.example/episode/en.vtt")?.referer, "https://bysekoze.com/e/fixture_video");
  assert.equal(getResolvedStreamAuthorization("https://captions.example/episode/other.vtt"), null);
  clearResolvedStreamAuthorizations();
});

test("MKissa Byse rejects plaintext and encrypted access errors without media probes or rotation", async () => {
  for (const encrypted of [false, true]) {
    let calls = 0;
    const client = new MkissaClient({ fetch: async value => {
      calls++;
      const path = new URL(value).pathname;
      if (!path.startsWith("/api/")) return new Response("<title>Byse Frontend</title>");
      if (path.endsWith("/settings")) return Response.json(byseFixture.settings);
      if (encrypted) return Response.json({ playback: encryptByseFixture({ captcha_required: true }) });
      return new Response("", { status: 403 });
    } });
    await assert.rejects(client.resolveSourceChoices([
      { ...source("Fm-Hls", "https://bysekoze.com/e/fixture_video"), type: "iframe" },
      source("Different", "https://video.example/video.mp4"),
    ], 0), error => error.code === "CAPTCHA_REQUIRED");
    assert.equal(calls, 3);
    await assert.rejects(client.resolveSource({ ...source("Fm-Hls", "https://bysekoze.com/e/fixture_video"), type: "iframe" }));
    assert.equal(calls, 3);
  }
});

test("MKissa Byse settings gates stop before playback and prevent subsequent network retries", async () => {
  for (const gate of [{ captcha_required: true }, { error: "Fingerprint attestation required" }]) {
    let calls = 0;
    const client = new MkissaClient({ fetch: async value => {
      calls++;
      return new URL(value).pathname.startsWith("/api/") ? Response.json(gate)
        : new Response("<title>Byse Frontend</title>");
    } });
    const selected = { ...source("Fm-Hls", "https://bysekoze.com/e/fixture_video"), type: "iframe" };
    await assert.rejects(client.resolveSource(selected), error => error.code === "CAPTCHA_REQUIRED");
    assert.equal(calls, 2);
    await assert.rejects(client.resolveSource(selected), error => error.code === "CAPTCHA_REQUIRED");
    assert.equal(calls, 2);
  }
});

test("MKissa Byse catalogue redirects cannot leak context to another origin", async () => {
  let calls = 0;
  const client = new MkissaClient({ fetch: async value => {
    calls++;
    return new URL(value).pathname.startsWith("/api/")
      ? new Response(null, { status: 302, headers: { location: "https://other.example/api" } })
      : new Response("<title>Byse Frontend</title>");
  } });
  await assert.rejects(client.resolveSource({ ...source("Fm-Hls", "https://bysekoze.com/e/fixture_video"), type: "iframe" }),
    error => error.code === "UNSAFE_URL");
  assert.equal(calls, 2);
});

test("MKissa Sl-mp4 reports unsupported Streamlare without probing it", async () => {
  let calls = 0;
  const client = new MkissaClient({ fetch: async () => { calls++; throw Error("not authorized"); } });
  await assert.rejects(client.resolveSource({ ...source("Sl-mp4", "https://streamlare.com/e/fixture_video"), type: "iframe" }),
    /unsupported Streamlare player/);
  assert.equal(calls, 0);
});

test("MKissa bundle parser accepts four fragments and an inline constant alias", () => {
  const fragments = [
    "YWJ", "jZG", "VmZ", "2g=",
    "aWp", "rbG", "1ub", "3A=",
    "cXJ", "zdH", "V2d", "3g=",
    "eXo", "xMj", "M0N", "TY=",
    "154", "dummy:",
  ];
  const calls = (start) => [0, 1, 2, 3].map((offset) => `mix(0,${start + offset + 101})`).join("+");
  const fixture = [
    `function table(){const values=${JSON.stringify(fragments)};return values}`,
    "function base(value){return value=value-100,table()[value]}",
    "function mix(first,second){return base(second-{offset:1}.offset)}",
    "const build=mix(0,117),next=1",
    "function request({buildId:value=build}){return 'aaReq'}",
    `const masks=[${[0, 4, 8, 12].map(calls).join(",")}]`,
    'const config={saltMul:6,saltAdd:244,fragMul:190,fragAdd:88,bootPrefix:mix(0,118e0),join:".",parts:["group","host","lane","buildId","epoch"],omitEmptyLane:!1}',
  ].join(";");

  const parsed = parseMkissaBundle(fixture);
  assert.equal(parsed?.buildId, "154");
  assert.deepEqual(parsed?.seeds, [
    "YWJjZGVmZ2g=", "aWprbG1ub3A=", "cXJzdHV2d3g=", "eXoxMjM0NTY=",
  ]);
  assert.equal(parsed?.cryptoScheme?.bootPrefix, "dummy:");
  assert.deepEqual(parsed?.cryptoScheme?.fields, ["group", "host", "lane", "buildId", "epoch"]);
  assert.equal(parseMkissaBundle(fixture.replace("118e0", "118e999"))?.cryptoScheme, undefined);
});

test("MKissa provider exposes servers lazily and preserves server identity", async () => {
  let sourceCalls = 0;
  let resolvedIndex = -1;
  const baseSources = [
    source("Default", "https://media.example/default.m3u8", 2),
    source("Ok", "https://media.example/ok.m3u8", 1),
  ];
  const client = {
    async search() {
      return [{
        id: "show_1",
        name: "Classic Robot",
        thumbnail: "/poster.webp",
        anilistId: 80,
        subEpisodes: ["1", "2"],
        dubEpisodes: ["1"],
        totalEpisodes: 2,
      }];
    },
    async getSeries() {
      return { id: "show_1", subEpisodes: ["2", "1"], dubEpisodes: ["1"] };
    },
    async getEpisodeSources(_show, _episode, audio, options) {
      sourceCalls++;
      if (sourceCalls > 2) assert.equal(options?.fresh, true);
      if (audio === "dub") return [source("Default", "https://media.example/dub.m3u8")];
      return sourceCalls > 2 ? [...baseSources].reverse() : baseSources;
    },
    async resolveSource(selectedSource) {
      resolvedIndex = selectedSource.sourceName === "Default" ? 1 : 0;
      return {
        url: "https://media.example/default.m3u8",
        requestHeaders: { Referer: "https://allanime.day/" },
        authorizationScope: "directory",
        cors: true,
      };
    },
    normalizePoster(value) { return new URL(value, "https://mkissa.to").toString(); },
  };
  const provider = new MkissaProvider({ client });

  const [result] = await provider.search("robot");
  assert.equal(result.providerId, "mkissa");
  assert.equal(result.externalLookupId, 80);
  assert.equal(result.poster, "https://mkissa.to/poster.webp");

  const episodes = await provider.getEpisodes("show_1", 1);
  assert.deepEqual(episodes.data.map((episode) => episode.episodeNumber), [1, 2]);
  const links = await provider.getStreamLinks(episodes.data[0].id, "show_1");
  assert.deepEqual(links.map((link) => link.quality), ["Default", "Ok", "Default · Dub"]);
  assert.deepEqual(links.map((link) => link.variant), ["default", "ok", "default"]);
  assert.equal(sourceCalls, 2, "listing links discovers each audio source once");

  const stream = await provider.resolveStream(links[0].id);
  assert.equal(sourceCalls, 3, "the selected server is resolved only when playback starts");
  assert.equal(resolvedIndex, 1, "server name survives provider-side source reordering");
  assert.equal(stream.authorizationScope, "directory");
  assert.deepEqual(await provider.getExternalIds("show_1"), { anilistId: 80 });
});

test("MKissa never substitutes another mirror when the selected server disappears", async () => {
  let calls = 0, resolved = 0;
  const provider = new MkissaProvider({ client: {
    async getSeries() { return { id: "show_1", subEpisodes: ["1"], dubEpisodes: [] }; },
    async getEpisodeSources() { return ++calls === 1 ? [source("Selected", "https://media.example/one.mp4")] : [source("Different", "https://media.example/two.mp4")]; },
    async resolveSource() { resolved++; throw Error("must not resolve"); },
  } });
  const episode = (await provider.getEpisodes("show_1")).data[0];
  const [link] = await provider.getStreamLinks(episode.id, "show_1");
  await assert.rejects(provider.resolveStream(link.id), /no longer available/);
  assert.equal(resolved, 0);
});

test("MKissa source listing may cache metadata but playback explicitly refreshes expiring URLs", async () => {
  let calls = 0;
  const client = new MkissaClient({ keyManager: { async material() { return { key: Buffer.alloc(32), epoch: 1, buildId: "149" }; } },
    fetch: async () => { calls++; return Response.json({ data: { episode: { sourceUrls: [source("Direct", "https://media.example/" + calls + ".mp4")] } } }); },
  });
  const first = await client.getEpisodeSources("show", "1", "sub");
  assert.deepEqual(await client.getEpisodeSources("show", "1", "sub"), first);
  const fresh = await client.getEpisodeSources("show", "1", "sub", { fresh: true });
  assert.notEqual(fresh[0].sourceUrl, first[0].sourceUrl);
  assert.equal(calls, 2);
});

test("MKissa malformed or wrong-show source responses do not trigger crypto refresh retries", async () => {
  for (const episode of [{ sourceUrls: [] }, { sourceUrls: [source("Direct", "https://media.example/video.mp4")], show: { _id: "another" } }]) {
    let calls = 0, invalidations = 0;
    const client = new MkissaClient({ keyManager: {
      async material() { return { key: Buffer.alloc(32), epoch: 1, buildId: "149" }; },
      invalidateBuild() { invalidations++; },
    }, fetch: async () => { calls++; return Response.json({ data: { episode } }); } });
    await assert.rejects(client.getEpisodeSources("show", "1", "sub"));
    assert.equal(calls, 1);
    assert.equal(invalidations, 0);
  }
});

test("MKissa malformed protected envelopes do not refresh keys or repeat source reads", async () => {
  for (const tobeparsed of ["not-base64", "AQ==", Buffer.alloc(32, 2).toString("base64")]) {
    let reads = 0, materials = 0, invalidations = 0;
    const client = new MkissaClient({ keyManager: {
      async material() { materials++; return { key: Buffer.alloc(32), epoch: 1, buildId: "149" }; },
      invalidateBuild() { invalidations++; },
    }, fetch: async () => { reads++; return Response.json({ data: { tobeparsed } }); } });
    await assert.rejects(client.getEpisodeSources("show", "1", "sub"), error => error.code === "INVALID_RESPONSE");
    assert.equal(reads, 1);
    assert.equal(materials, 1);
    assert.equal(invalidations, 0);
  }
});

test("MKissa authentication failure permits at most one source key refresh", async () => {
  let reads = 0, materials = 0, invalidations = 0;
  const blob = Buffer.alloc(32);
  blob[0] = 1;
  const client = new MkissaClient({ keyManager: {
    async material() { materials++; return { key: Buffer.alloc(32), epoch: 1, buildId: "149" }; },
    invalidateBuild() { invalidations++; },
  }, fetch: async () => { reads++; return Response.json({ data: { tobeparsed: blob.toString("base64") } }); } });
  await assert.rejects(client.getEpisodeSources("show", "1", "sub"), error => error.code === "CRYPTO_STALE");
  assert.equal(reads, 2);
  assert.equal(materials, 2);
  assert.equal(invalidations, 1);
});

test("MKissa treats unknown 403 and challenge HTML as access rejection, not stale crypto", async () => {
  assert.equal(mkissaResponseFailure(403, "Forbidden").code, "CAPTCHA_REQUIRED");
  assert.equal(mkissaResponseFailure(403, JSON.stringify({ errors: [{ extensions: { code: "AA_CRYPTO_STALE" } }] })).code, "CRYPTO_STALE");
  assert.equal(mkissaResponseFailure(200, "<html><title>Just a moment</title></html>").code, "CAPTCHA_REQUIRED");
  assert.equal(mkissaResponseFailure(200, JSON.stringify({ data: { title: "Captcha", description: "Security check" } })), null);
  let calls = 0, materials = 0, invalidations = 0;
  const client = new MkissaClient({ keyManager: {
    async material() { materials++; return { key: Buffer.alloc(32), epoch: 1, buildId: "149" }; },
    invalidateBuild() { invalidations++; },
  }, fetch: async () => { calls++; return new Response("<html><title>Just a moment</title></html>", { status: 403 }); } });
  const results = await Promise.allSettled([client.getEpisodeSources("show", "1", "sub"), client.getEpisodeSources("show", "2", "sub")]);
  assert.deepEqual(results.map(result => result.reason.code), ["CAPTCHA_REQUIRED", "CAPTCHA_REQUIRED"]);
  assert.equal(calls, 1);
  assert.equal(materials, 1);
  assert.equal(invalidations, 0, "a security rejection must not refresh crypto");
  client.reset();
  await assert.rejects(client.getEpisodeSources("show", "3", "sub"));
  assert.equal(calls, 1, "config reset cannot clear an upstream rejection");
});

test("MKissa bootstrap stops on the first security response instead of trying more tokens", async () => {
  let calls = 0;
  const manager = new MkissaKeyManager({
    buildResolver: async () => ({ buildId: "149", seeds: ["YWJjZGVmZ2g=", "aWprbG1ub3A=", "cXJzdHV2d3g=", "eXoxMjM0NTY="] }),
    fetch: async () => { calls++; return new Response("<html><title>Just a moment</title></html>", { status: 403 }); },
  });
  await assert.rejects(manager.material(), error => error.code === "CAPTCHA_REQUIRED");
  assert.equal(calls, 1);
});

test("MKissa oversized API denials stop queued sources without refreshing keys", async () => {
  for (const declared of [false, true]) {
    let calls = 0, cancelled = 0, invalidations = 0;
    const client = new MkissaClient({ keyManager: {
      async material() { return { key: Buffer.alloc(32), epoch: 1, buildId: "149" }; },
      invalidateBuild() { invalidations++; },
    }, fetch: async () => {
      calls++;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(65_537)); },
        cancel() { cancelled++; },
      }), { status: 403, headers: declared ? { "content-length": "65537" } : {} });
    } });
    const results = await Promise.allSettled([client.getEpisodeSources("show", "1", "sub"), client.getEpisodeSources("show", "2", "sub")]);
    assert.deepEqual(results.map(result => result.reason.code), ["CAPTCHA_REQUIRED", "CAPTCHA_REQUIRED"]);
    assert.equal(calls, 1);
    assert.equal(cancelled, 1);
    assert.equal(invalidations, 0);
  }
});

test("MKissa oversized bootstrap denial never tries another token", async () => {
  let calls = 0, cancelled = 0;
  const manager = new MkissaKeyManager({
    buildResolver: async () => ({ buildId: "149", seeds: ["YWJjZGVmZ2g=", "aWprbG1ub3A=", "cXJzdHV2d3g=", "eXoxMjM0NTY="] }),
    fetch: async () => {
      calls++;
      return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 403, headers: { "content-length": "65537" } });
    },
  });
  await assert.rejects(manager.material(), error => error.code === "CAPTCHA_REQUIRED");
  assert.equal(calls, 1);
  assert.equal(cancelled, 1);
});

test("MKissa reports deleted files and stops server rotation after media access rejection", async () => {
  const deleted = new MkissaClient({ fetch: async () => new Response("File was deleted") });
  await assert.rejects(deleted.resolveSource({ ...source("Mp4", "https://mp4upload.com/embed-token.html"), type: "iframe" }), /file was deleted/);
  let calls = 0;
  const blocked = new MkissaClient({ fetch: async () => { calls++; return new Response("blocked", { status: 403 }); } });
  await assert.rejects(blocked.resolveSourceChoices([
    { ...source("Mp4", "https://mp4upload.com/embed-token.html"), type: "iframe" },
    source("Different", "https://media.example/video.mp4"),
  ], 0), error => error.code === "CAPTCHA_REQUIRED");
  assert.equal(calls, 1);
});

test("MKissa provider rejects forged link coordinates before making a request", async () => {
  let calls = 0;
  const provider = new MkissaProvider({
    client: {
      async search() { return []; },
      async getSeries() { calls++; throw new Error("should not run"); },
      async getEpisodeSources() { calls++; return []; },
      async resolveSource() { calls++; throw new Error("should not run"); },
      async resolveSourceChoices() { calls++; throw new Error("should not run"); },
      normalizePoster() { return ""; },
    },
  });
  await assert.rejects(() => provider.resolveStream("mk1.not-json"), /Invalid MKissa server link/);
  assert.equal(calls, 0);
});

test("MKissa source decoder accepts only its bounded known encodings", () => {
  const media = "https://cdn.example/anime/master.m3u8";
  for (const prefix of ["--", "#-", "##", "-#", "#"]) {
    assert.equal(decodeMkissaSourceUrl(encodeMkissaSourceUrlForFixture(media, prefix)), media);
  }
  assert.equal(decodeMkissaSourceUrl("#not-hex"), "#not-hex");
});

test("MKissa live crypto scheme is tried before bounded fallbacks", () => {
  const base = {
    buildId: "153",
    seeds: ["YWJjZGVmZ2g=", "aWprbG1ub3A=", "cXJzdHV2d3g=", "eXoxMjM0NTY="],
  };
  const cryptoScheme = {
    saltMultiplier: 6,
    saltOffset: 244,
    fragmentMultiplier: 190,
    fragmentOffset: 88,
    bootPrefix: "dynamic:",
    separator: ".",
    fields: ["group", "host", "lane", "buildId", "epoch"],
    omitEmptyLane: false,
  };
  const fallbackMasks = deriveMaskCandidates(base);
  const masks = deriveMaskCandidates({ ...base, cryptoScheme });
  assert.notDeepEqual(masks[0], fallbackMasks[0]);
  assert.deepEqual(masks.slice(1), fallbackMasks);

  const fallbackTokens = bootTokenCandidates(fallbackMasks[0], "153", 1, "mkissa", "mkissa.to", "k7");
  const tokens = bootTokenCandidates(fallbackMasks[0], "153", 1, "mkissa", "mkissa.to", "k7", cryptoScheme);
  assert.notEqual(tokens[0], fallbackTokens[0]);
  assert.deepEqual(tokens.slice(1), fallbackTokens);
});

test("MKissa server fallback skips an unsafe source and returns scoped media headers", async () => {
  const client = new MkissaClient({ fetch: async () => { throw new Error("unexpected fetch"); } });
  const stream = await client.resolveSourceChoices([
    source("Bad", "https://127.0.0.1/private.m3u8", 2),
    source("Good", "https://cdn.example/anime/master.m3u8", 1),
  ], 0);
  assert.equal(stream.url, "https://cdn.example/anime/master.m3u8");
  assert.equal(stream.authorizationScope, "directory");
  assert.equal(stream.requestHeaders?.Referer, "https://allanime.day/");
  assert.equal(stream.cors, true);
});

test("MKissa resolves absolute clock URLs before interpreting player metadata", async () => {
  const reads = [];
  const client = new MkissaClient({ fetch: async value => {
    reads.push(String(value));
    return Response.json({ links: [{ link: "https://media.example/resolved.mp4", mp4: true }] });
  } });
  const stream = await client.resolveSource(source("Default", "https://allanime.day/apivtwo/clock?id=fixture"));
  assert.deepEqual(reads, ["https://allanime.day/apivtwo/clock.json?id=fixture"]);
  assert.equal(stream.url, "https://media.example/resolved.mp4");
});

test("MKissa known embed resolvers take precedence even when marked player", async () => {
  for (const [name, url, body, expected] of [
    ["Mp4", "https://mp4upload.com/embed-fixture.html", 'player.src({src:"https://media.example/resolved.mp4"})', "https://media.example/resolved.mp4"],
    ["Fm-Hls", "https://bysekoze.com/e/token", "<script>}('0://1/2.3',10,4,'https|media.example|master|m3u8'.split('|'))</script>", "https://media.example/master.m3u8"],
  ]) {
    const reads = [];
    const client = new MkissaClient({ fetch: async value => { reads.push(String(value)); return new Response(body); } });
    const stream = await client.resolveSource(source(name, url));
    assert.equal(stream.url, expected);
    assert.equal(reads.length, 1);
    assert.equal(reads[0], url);
  }
});

test("MKissa rejects unsupported player pages but retains declared extensionless direct formats", async () => {
  const client = new MkissaClient({ fetch: async () => { throw new Error("unexpected fetch"); } });
  await assert.rejects(client.resolveSource(source("Embed", "https://embed.example/watch/episode")),
    error => error.code === "UNSUPPORTED_SOURCE");
  const stream = await client.resolveSource(source("Yt-mp4", "https://tools.fast4speed.rsvp/video-token"));
  assert.equal(stream.url, "https://tools.fast4speed.rsvp/video-token");
  assert.equal(stream.authorizationScope, "exact");
});

test("MKissa safely unpacks single- and double-quoted HLS embed data", async () => {
  const fixtures = [
    "}('0://1/2.3',10,4,'https|media.example|master|m3u8'.split('|'))",
    '}("0://1/2.3",10,4,"https|media.example|master|m3u8".split("|"))',
  ];
  for (const html of fixtures) {
    let requests = 0;
    const client = new MkissaClient({
      fetch: async (_url, init) => {
        requests++;
        assert.equal(init.headers.get("Referer"), "https://bysekoze.com/");
        return new Response(`<script>${html}</script>`, { status: 200 });
      },
    });
    const stream = await client.resolveSource({
      sourceName: "Fm-Hls",
      sourceUrl: "https://bysekoze.com/e/token",
      type: "iframe",
      priority: 1,
    });
    assert.equal(requests, 1);
    assert.equal(stream.url, "https://media.example/master.m3u8");
    assert.equal(stream.authorizationScope, "directory");
    assert.equal(stream.requestHeaders?.Referer, "https://bysekoze.com/e/token");
    assert.equal(stream.requestHeaders?.Origin, "https://bysekoze.com");
  }
});

test("MKissa CAPTCHA response starts cooldown and prevents retry storms", async () => {
  let requests = 0;
  let now = 1_800_000_000_000;
  const keyManager = {
    async material() {
      return { key: Buffer.alloc(32, 7), epoch: 1, buildId: "149", expiresAt: now + 60_000 };
    },
    invalidateBuild() {},
  };
  const client = new MkissaClient({
    keyManager,
    now: () => now,
    challengeCooldownMs: 60_000,
    fetch: async () => {
      requests++;
      return new Response(JSON.stringify({ errors: [{ message: "NEED_CAPTCHA" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await assert.rejects(
    () => client.getEpisodeSources("show", "1", "sub"),
    (error) => error instanceof MkissaProviderError && error.code === "CAPTCHA_REQUIRED",
  );
  await assert.rejects(
    () => client.getEpisodeSources("show", "1", "sub"),
    (error) => error instanceof MkissaProviderError && error.code === "CAPTCHA_REQUIRED",
  );
  assert.equal(requests, 1);
  now += 60_001;
  await assert.rejects(() => client.getEpisodeSources("show", "1", "sub"));
  assert.equal(requests, 2);
});

test("MKissa URL and response guards reject local targets and oversized bodies", async () => {
  for (const value of [
    "http://cdn.example/video.mp4",
    "https://localhost/video.mp4",
    "https://192.168.1.2/video.mp4",
    "https://[::1]/video.mp4",
    "https://[::ffff:7f00:1]/video.mp4",
  ]) {
    assert.throws(() => publicHttpsUrl(value), /unsafe/);
  }
  const oversized = new Response("x".repeat(33));
  await assert.rejects(() => responseText(oversized, 32, "fixture"), /unexpectedly large/);
});

test("MKissa validates redirects before issuing the redirected request", async () => {
  let requests = 0;
  const fetcher = async (_url, init) => {
    requests++;
    assert.equal(init.redirect, "manual");
    return new Response(null, {
      status: 302,
      headers: { location: "https://127.0.0.1/private" },
    });
  };
  await assert.rejects(
    () => safeRedirectFetch(fetcher, new URL("https://api.mkissa.net/api"), {}, () => {}),
    (error) => error instanceof MkissaProviderError && error.code === "UNSAFE_URL",
  );
  assert.equal(requests, 1);
});
