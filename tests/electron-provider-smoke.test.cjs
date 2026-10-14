const test = require("node:test");
const assert = require("node:assert/strict");
const { createMediaProbe, mediaFormat, publicHttpsUrl, safeMessage } = require("../scripts/electron-provider-smoke-common");

test("playback fixture identity accepts MAL-only providers but rejects conflicting IDs", () => {
  const { verificationIdsMatch } = require("../scripts/electron-provider-smoke-common");
  const expected = { anilistId: 1, malId: 1 };
  assert.equal(verificationIdsMatch({ malId: 1 }, expected), true);
  assert.equal(verificationIdsMatch({ anilistId: 1 }, expected), true);
  assert.equal(verificationIdsMatch({ anilistId: 2, malId: 1 }, expected), false);
  assert.equal(verificationIdsMatch({ malId: 2 }, expected), false);
  assert.equal(verificationIdsMatch({}, expected), false);
  assert.equal(verificationIdsMatch({ malId: 1 }, { anilistId: 1 }), false);
});

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

test("MKissa website diagnostic guards and durable-report checks run offline", () => {
  const output = require("node:child_process").execFileSync(process.execPath, [
    require.resolve("../scripts/electron-mkissa-session-smoke.js"), "--self-test",
  ], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.match(output, /Offline guard, redaction and bounded exclusive-report checks passed; no website request or file was created/);
  assert.doesNotMatch(output, /session-opening|isolated-profile-ready|report-saved/);
});

test("MKissa public request-format inspection parses metadata without executing or exporting website code", () => {
  const { staticShape } = require("../scripts/mkissa-request-format-audit.cjs");
  const secret = "fixture-private-key-token-never-exported";
  const source = `throw new Error(${JSON.stringify(secret)});
    const request = { extensions: { persistedQuery: { version: 1, sha256Hash: ${JSON.stringify(secret)} } } };
    delete request.query;
    const options = { includeQuery: false };
    const catalogue = 'query ($search: SearchInput) { shows(search: $search) { edges { _id } } }';
    const protectedRead = 'query { episode { sourceUrls } }';
    const unreviewed = 'mutation { account { email } }';`;
  const shape = staticShape(source);
  assert.deepEqual(shape, { persistedQuery: true, omitQueryOption: true, explicitQueryRemoval: true,
    readDocuments: { shows: 1, show: 0, episode: 1 } });
  assert.equal(JSON.stringify(shape).includes(secret), false);
  assert.deepEqual(staticShape('// delete fake.query; persistedQuery\nconst text = "delete fake.query; persistedQuery";'),
    { persistedQuery: false, omitQueryOption: false, explicitQueryRemoval: false,
      readDocuments: { shows: 0, show: 0, episode: 0 } });
});

test("MKissa query candidates parse bounded static strings without executing expressions", () => {
  const { readDocuments } = require("../scripts/mkissa-request-format-audit.cjs");
  const source = 'throw new Error("must not run"); const fields = "_id name"; ' +
    'const search = `query { shows { edges { ${fields} } } }`; ' +
    'const unsafe = `query { show { ${globalThis.execute()} } }`; ' +
    'const mutation = "mutation { show { _id } }"; ' +
    'const alias = "query { catalogue: account { email } }";';
  assert.deepEqual(readDocuments(source), ['query { shows { edges { _id name } } }']);
  assert.deepEqual(readDocuments('const a = b; const b = a; const q = `query { show { ${a} } }`;'), []);
  assert.deepEqual(readDocuments('const a = "_id"; function f() { const a = "email"; } const q = `query { show { ${a} } }`;'), []);
  assert.deepEqual(readDocuments('const a = "_id"; const q = `query { show { ${a.toString()} } }`;'), []);
  assert.deepEqual(readDocuments('x'.repeat(5 * 1024 * 1024 + 1)), []);
  assert.deepEqual(readDocuments('const invalid = `'), []);
});

test("MKissa hash-only guard admits only exact reviewed read documents", () => {
  const { requestDecision, reviewedQueryHashes } = require("../scripts/electron-mkissa-session-smoke");
  const { createHash } = require("node:crypto");
  const search = 'query { shows { edges { _id } } }';
  const episode = 'query { episode { sourceUrls } }';
  const mutation = 'mutation { account { email } }';
  const hash = document => createHash('sha256').update(document).digest('hex');
  const reviewed = reviewedQueryHashes([search, episode, mutation, 'query { account { email } }']);
  assert.equal(reviewed.size, 2);
  for (const [document, kind] of [[search, 'catalogue'], [episode, 'protected'], [mutation, 'blocked']]) {
    const payload = { extensions: { persistedQuery: { version: 1, sha256Hash: hash(document) } } };
    const url = 'https://api.mkissa.net/api?extensions=' + encodeURIComponent(JSON.stringify(payload.extensions));
    assert.equal(requestDecision(url, 'GET', 'xhr', undefined, reviewed).kind, kind);
    assert.equal(requestDecision('https://api.mkissa.net/api', 'POST', 'xhr', [{ bytes: Buffer.from(JSON.stringify(payload)) }], reviewed).kind, kind);
    assert.equal(requestDecision(url, 'GET', 'xhr').kind, 'blocked', 'No implicit global operation registry');
  }
  const mismatch = 'https://api.mkissa.net/api?query=' + encodeURIComponent(search) + '&extensions=' +
    encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash(mutation) } }));
  assert.equal(requestDecision(mismatch, 'GET', 'xhr', undefined, reviewed).rejectionDetail, 'persisted-query-mismatch');
  assert.equal(requestDecision(mismatch.replace(hash(mutation), hash(search)), 'GET', 'xhr', undefined, reviewed).kind, 'catalogue');
  for (const extensions of [
    { persistedQuery: { version: 2, sha256Hash: hash(mutation) } },
    { persistedQuery: { version: 1, sha256Hash: 'invalid' } },
  ]) {
    const url = 'https://api.mkissa.net/api?query=' + encodeURIComponent(search) + '&extensions=' + encodeURIComponent(JSON.stringify(extensions));
    assert.equal(requestDecision(url, 'GET', 'xhr', undefined, reviewed).kind, 'blocked');
  }
  assert.equal(requestDecision(mismatch + '&query=' + encodeURIComponent(mutation), 'GET', 'xhr', undefined, reviewed).kind, 'blocked');
  const body = [{ bytes: Buffer.from(JSON.stringify({ query: search, extensions: { persistedQuery: { version: 1, sha256Hash: hash(search) } } })) }];
  assert.equal(requestDecision(mismatch, 'POST', 'xhr', body, reviewed).kind, 'blocked', 'URL/body extensions must agree');
});
