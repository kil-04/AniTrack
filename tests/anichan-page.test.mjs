import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const script = readFileSync(new URL("../apps/android/app/src/main/assets/anichan_page.js", import.meta.url), "utf8");
const left = Buffer.alloc(32, 0x31), right = Buffer.alloc(32, 0x17);
const chunk = `let exp="anichan_ws_exp",O="1234abcd",k="${left.toString("base64")}",b="${right.toString("base64")}";`;
const request = { operation: "servers", animeId: 1, episode: 1, category: "sub", tier: "fast" };
async function encrypted(value, nonce = "fixture-session") {
  const key = await webcrypto.subtle.importKey("raw", left.map((v, i) => v ^ right[i]), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(nonce));
  const aes = await webcrypto.subtle.importKey("raw", derived, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = Buffer.alloc(12, 7);
  const data = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(value)));
  return { v: 1, i: iv.toString("base64"), d: Buffer.from(data).toString("base64") };
}
function reader({ payload = { servers: [] }, status = 200, source = chunk, ready = true, origin = "https://anichan.to", large = false, hydrated = true, stallServer = false } = {}) {
  const calls = [], paused = [];
  let started, stalled = false;
  const serverStarted = new Promise(resolve => { started = resolve; });
  const storage = new Map([["anichan_ws_exp", String(Date.now() + 60_000)], ["anichan_ws_n", "fixture-session"], ["unrelated", "preserve"]]);
  if (!ready) storage.delete("anichan_ws_n");
  const video = { muted: false, pause() { paused.push(true); } };
  const context = vm.createContext({
    location: { origin }, document: { scripts: hydrated ? [{ src: "https://anichan.to/_next/static/chunks/7621-abcd1234.js" }] : [], querySelectorAll: () => [video] },
    localStorage: { getItem: key => storage.get(key) ?? null, removeItem: key => storage.delete(key) },
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Blob, URL, URLSearchParams, AbortController, atob, btoa, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("/_next/")) return new Response(source);
      if (stallServer && !stalled) {
        stalled = true;
        await new Promise((_, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          started();
        });
      }
      return new Response(JSON.stringify(payload), { status, headers: { "retry-after": "123", ...(large ? { "content-length": "9999999" } : {}) } });
    },
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(script, context);
  return { read: async data => JSON.parse(JSON.stringify(await context.AniTrackAniChan.read(data))), calls, storage, video, paused, serverStarted };
}

test("AniChan page decrypts the current public protocol as data and sends the explicit tier", async () => {
  const data = { servers: [{ name: "fixture", type: "hls", stream: "https://c.toroplay.cymru/api/watch/m3u8?test=1" }] };
  const r = reader({ payload: await encrypted(data) });
  assert.deepEqual(await r.read(request), { status: "ok", data });
  assert.equal(r.calls.length, 2);
  assert.equal(new URL(r.calls[1].url).searchParams.get("tier"), "fast");
  assert.equal(r.calls[1].options.headers["X-Wk"], "1234abcd");
  assert.equal(r.calls[1].options.credentials, "same-origin");
  assert.equal(r.calls[1].options.redirect, "error");
  assert.equal(r.video.muted, true);
  assert.ok(r.paused.length >= 2);
  await r.read(request);
  assert.equal(r.calls.length, 3, "protocol data cached only within this document");
});
test("AniChan page requires a site-created session and rejects bad inputs without any network", async () => {
  const r = reader({ ready: false });
  assert.equal((await r.read(request)).status, "connect");
  assert.equal((await r.read({ ...request, animeId: -1 })).status, "error");
  assert.equal((await r.read({ ...request, episode: 5001 })).status, "error");
  assert.equal((await r.read({ ...request, category: "anything" })).status, "error");
  assert.equal(r.calls.length, 0);
  assert.equal((await reader({ origin: "https://other.example" }).read(request)).status, "error");
});
test("AniChan page stops on session rejection or rate limiting, without retrying", async () => {
  for (const status of [401, 403, 429]) {
    const r = reader({ status });
    const result = await r.read(request);
    assert.equal(result.status, status === 429 ? "rate-limit" : "connect");
    if (status === 429) assert.equal(result.retryAfter, 123);
    assert.equal(r.calls.length, 2);
  }
});
test("AniChan page refuses changed protocol, oversized responses and invalid authenticated payloads", async () => {
  for (const options of [{ source: "throw new Error('never run remote code')" }, { large: true },
    { payload: { v: 1, i: "AAAA", d: "AAAA" } }, { payload: await encrypted({ servers: [] }, "wrong-session") },
    { payload: { servers: Array.from({ length: 65 }, () => ({})) } }]) {
    const r = reader(options);
    const result = await r.read(request);
    assert.equal(result.status, "error");
    assert.doesNotMatch(JSON.stringify(result), /fixture-session|1234abcd|never run/);
  }
});
test("AniChan page disconnect clears only its watch session keys", async () => {
  const r = reader();
  assert.equal((await r.read({ operation: "state" })).ready, true);
  await r.read({ operation: "reset" });
  assert.equal((await r.read({ operation: "state" })).ready, false);
  assert.equal(r.storage.get("unrelated"), "preserve");
  assert.equal(r.calls.length, 0);
});

test("AniChan readiness waits for the watch document's protocol chunk after navigation", async () => {
  const r = reader({ hydrated: false });
  assert.equal((await r.read({ operation: "state" })).ready, false);
  assert.equal((await r.read(request)).status, "connect");
  assert.equal(r.calls.length, 0);
});

test("AniChan cancellation aborts only the selected request and preserves the verified session", async () => {
  const r = reader({ stallServer: true });
  const pending = r.read({ ...request, requestId: "first_request" });
  await r.serverStarted;
  await r.read({ operation: "cancel", requestId: "other_request" });
  assert.equal(r.calls[1].options.signal.aborted, false);
  await r.read({ operation: "cancel", requestId: "first_request" });
  assert.equal((await pending).status, "error");
  assert.equal(r.calls[1].options.signal.aborted, true);
  assert.equal((await r.read({ operation: "state" })).ready, true);
  assert.deepEqual(await r.read({ ...request, requestId: "next_request" }), { status: "ok", data: { servers: [] } });
});
