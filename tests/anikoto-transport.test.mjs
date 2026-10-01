import test from "node:test";
import assert from "node:assert/strict";
import { createAnikotoTransport } from "../apps/desktop/main/services/providers/anikoto-transport.ts";

const endpoint = "https://provider.example/ajax/episodes";

test("Anikoto public requests preserve the requested URL, headers and response metadata", async () => {
  let calls = 0;
  const fetcher = createAnikotoTransport(async (url, init) => {
    calls++;
    assert.equal(url, endpoint);
    assert.equal(init.headers.Referer, "https://provider.example/watch/show");
    assert.equal(init.headers["User-Agent"], undefined);
    const response = Response.json({ title: "Security Check", description: "Just a moment" });
    Object.defineProperties(response, { url: { value: endpoint }, redirected: { value: false } });
    return response;
  });
  const response = await fetcher(endpoint, { headers: { Referer: "https://provider.example/watch/show" } });
  assert.equal(response.url, endpoint);
  assert.equal(response.redirected, false);
  assert.equal(response.ok, true);
  assert.deepEqual(await response.json(), { title: "Security Check", description: "Just a moment" });
  assert.equal(calls, 1);
});

test("Anikoto security/rate responses stop queued requests without retries or origin rotation", async () => {
  for (const status of [403, 429]) {
    let now = 100;
    let calls = 0;
    const fetcher = createAnikotoTransport(async (url) => {
      calls++;
      assert.equal(url, endpoint);
      return calls === 1 ? new Response("blocked", { status }) : Response.json({ episodes: [] });
    }, { now: () => now });
    const results = await Promise.allSettled([fetcher(endpoint), fetcher(endpoint), fetcher(endpoint)]);
    assert.deepEqual(results.map(result => result.reason.code), [status === 403 ? "SECURITY_CHECK" : "RATE_LIMITED", "COOLDOWN", "COOLDOWN"]);
    assert.equal(calls, 1);
    now += 60_000;
    assert.deepEqual(await (await fetcher(endpoint)).json(), { episodes: [] });
    assert.equal(calls, 2);
  }
});

test("Anikoto detects HTML and JSON security challenges even when the HTTP status succeeds", async () => {
  for (const body of [
    "<html><title>Just a moment...</title><form id=\"challenge-form\"></form></html>",
    "<title>Just a moment...</title>",
    "<title>Attention Required! | Cloudflare</title>",
    "{\"error\":\"CAPTCHA_REQUIRED\"}",
  ]) {
    let calls = 0;
    const fetcher = createAnikotoTransport(async () => { calls++; return new Response(body); });
    await assert.rejects(fetcher(endpoint), { code: "SECURITY_CHECK" });
    await assert.rejects(fetcher(endpoint), { code: "COOLDOWN" });
    assert.equal(calls, 1);
  }
});

test("Anikoto deadline covers a stalled response body and cancels it", async () => {
  let cancelled = false;
  const fetcher = createAnikotoTransport(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
    cancel() { cancelled = true; },
  })), { deadlineMillis: 20 });
  await assert.rejects(fetcher(endpoint), { code: "TIMEOUT" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test("Anikoto deadline releases a stalled fetch and permits a separate retry", async () => {
  let calls = 0;
  let firstSignal;
  const fetcher = createAnikotoTransport(async (_url, init) => {
    calls++;
    if (calls === 1) { firstSignal = init.signal; return new Promise(() => {}); }
    return Response.json({ episodes: [] });
  }, { deadlineMillis: 20 });
  await assert.rejects(fetcher(endpoint), { code: "TIMEOUT" });
  assert.equal(firstSignal.aborted, true);
  assert.deepEqual(await (await fetcher(endpoint)).json(), { episodes: [] });
  assert.equal(calls, 2);
});

test("Anikoto rejects declared and actual body sizes above the limit", async () => {
  for (const response of [
    () => new Response("{}", { headers: { "content-length": "9" } }),
    () => new Response("123456789"),
  ]) {
    let calls = 0;
    const fetcher = createAnikotoTransport(async () => { calls++; return response(); }, { maxResponseBytes: 8 });
    await assert.rejects(fetcher(endpoint), { code: "TOO_LARGE" });
    assert.equal(calls, 1);
  }
});

test("Anikoto keeps ordinary HTTP errors explicit and never retries them", async () => {
  let calls = 0;
  const fetcher = createAnikotoTransport(async () => { calls++; return new Response("Unavailable", { status: 503 }); });
  const response = await fetcher(endpoint);
  assert.equal(response.status, 503);
  assert.equal(response.ok, false);
  assert.equal(await response.text(), "Unavailable");
  assert.equal(calls, 1);
});

test("Anikoto cancelled queued requests never reach the network", async () => {
  let release;
  let calls = 0;
  const firstResponse = new Promise(resolve => { release = resolve; });
  const fetcher = createAnikotoTransport(async () => { calls++; return firstResponse; });
  const first = fetcher(endpoint);
  const controller = new AbortController();
  const second = fetcher(endpoint, { signal: controller.signal });
  controller.abort(new Error("Cancelled by caller"));
  await assert.rejects(second, /Cancelled by caller/);
  release(Response.json({}));
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
});
