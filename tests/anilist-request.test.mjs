import test from "node:test";
import assert from "node:assert/strict";
import { fetchAniListResponse } from "../apps/desktop/main/services/anilist-request.ts";

const never = () => new Promise(() => {});

test("AniList deadline includes a stalled JSON body and lets the next request finish", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  const stalled = fetchAniListResponse("query { fixture }", {}, {
    timeoutMs: 30,
    fetcher: async (_url, options) => {
      signal = options.signal;
      return { status: 200, ok: true, headers: new Headers(), json: never };
    },
  });
  await Promise.resolve();
  t.mock.timers.tick(30);
  await assert.rejects(stalled, /timed out/);
  assert.equal(signal.aborted, true);
  const next = await fetchAniListResponse("query { next }", {}, {
    fetcher: async () => Response.json({ data: { next: true } }),
  });
  assert.deepEqual(next.json.data, { next: true });
});

test("AniList deadline also covers error bodies and a fetch that ignores abort", async () => {
  for (const fetcher of [never, async () => ({ status: 500, ok: false, headers: new Headers(), text: never })]) {
    await assert.rejects(fetchAniListResponse("query", {}, { fetcher, timeoutMs: 20 }), /timed out/);
  }
});

test("AniList disposes a response that arrives after its deadline", async () => {
  let deliver;
  let cancelled = 0;
  let parsed = 0;
  await assert.rejects(fetchAniListResponse("query", {}, {
    timeoutMs: 20,
    fetcher: () => new Promise(resolve => { deliver = resolve; }),
  }), /timed out/);
  deliver({ body: { cancel: async () => { cancelled++; } }, json: async () => { parsed++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, 1);
  assert.equal(parsed, 0);
});

test("AniList rate-limit response preserves Retry-After and discards its body", async () => {
  let cancelled = 0;
  const result = await fetchAniListResponse("query", {}, {
    fetcher: async () => ({
      status: 429, ok: false, headers: new Headers({ "retry-after": "3" }),
      body: { cancel: async () => { cancelled++; } }, text: never,
    }),
  });
  assert.deepEqual(result, { status: 429, retryAfter: "3" });
  assert.equal(cancelled, 1);
});

test("AniList sends the original query and variables and preserves success/API errors", async () => {
  const query = "query($id: Int) { Media(id: $id) { id } }";
  const variables = { id: 1 };
  const result = await fetchAniListResponse(query, variables, {
    fetcher: async (url, options) => {
      assert.equal(url, "https://graphql.anilist.co");
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { query, variables });
      return Response.json({ data: { Media: { id: 1 } }, errors: [{ message: "fixture" }] });
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.json.data.Media.id, 1);
  assert.equal(result.json.errors[0].message, "fixture");
  const failed = await fetchAniListResponse("query", {}, { fetcher: async () => new Response("unavailable", { status: 503 }) });
  assert.equal(failed.errorText, "unavailable");
});
