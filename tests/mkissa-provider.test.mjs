import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

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
} = await import("../apps/desktop/main/services/providers/mkissa-utils.ts");

function source(name, url, priority = 0) {
  return { sourceName: name, sourceUrl: url, type: "player", priority };
}

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
    async getEpisodeSources(_show, _episode, audio) {
      sourceCalls++;
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
