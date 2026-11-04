import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// The desktop renderer's download queue (apps/desktop/renderer/lib/downloads.ts)
// with a fake main process: a paused download releases the queue at once, a rate
// limit holds only its own provider, and removing or re-asking ends a wait.
const harness = {
  starts: [],
  removed: [],
  progress: null,
  resolves: 0,
};
globalThis.__anitrackQueueFixture = harness;
const listeners = new Map();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    addEventListener: (name, cb) => listeners.set(name, cb),
    api: {
      on: (channel, cb) => { if (channel === "download:progress") harness.progress = cb; },
      downloads: {
        start: async (opts) => { harness.starts.push(opts); },
        list: async () => ({ items: [] }),
        remove: async (id) => { harness.removed.push(id); },
        getPlayUrl: async (id) => ({ url: `anitrack-dl://d/${id}/index.m3u8` }),
      },
    },
  },
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });

const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const capacitor = moduleUrl("export function registerPlugin() { throw new Error('not on Capacitor'); }");
const platform = moduleUrl("export const isCapacitor = false;");
const providers = moduleUrl(`
  const h = globalThis.__anitrackQueueFixture;
  export const providerClient = {
    links: async () => [{ id: "link" }],
    list: async () => [],
    resolve: async () => { h.resolves++; return { url: "https://cdn.example/episode.m3u8", hls: true }; },
  };
  export function preferredStreamLinkIndex() { return 0; }
  export function providerVariantPreference() { return undefined; }
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/renderer/lib/downloads.ts")) {
      if (specifier === "@capacitor/core") return { url: capacitor, shortCircuit: true };
      if (specifier === "./platform") return { url: platform, shortCircuit: true };
      if (specifier === "./provider-api") return { url: providers, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const Q = await import("../apps/desktop/renderer/lib/downloads.ts");

let sequence = 0;
const entry = (providerId = "anikoto") => {
  const n = ++sequence;
  return { id: `500:${n}`, animeId: 500, episode: n, title: "Queue fixture", providerId, animeSession: "show", episodeSession: `ep-${n}` };
};
/** Lets the queue's resolve → start chain run (setImmediate isn't mocked). */
async function flush() { for (let i = 0; i < 8; i++) await new Promise(setImmediate); }
const startsOf = (id) => harness.starts.filter((s) => s.id === id);
/** What the main process reports for [e]. */
function report(e, status, extra = {}) {
  harness.progress({ id: e.id, animeId: e.animeId, episode: e.episode, title: e.title, providerId: e.providerId,
    animeSession: e.animeSession, episodeSession: e.episodeSession, status, progress: 40, updatedAt: Date.now(), ...extra });
}

test("an expired stream is resolved and started again in the same session, with its stall count", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_000_000 });
  const a = entry();
  assert.equal(Q.enqueueDownload(a), true);
  await flush();
  assert.equal(startsOf(a.id).length, 1);
  report(a, "queued", { resume: { reason: "expired", reResolves: 1, stalledSince: 1_000_000 } });
  await flush();
  assert.equal(startsOf(a.id).length, 2, "it didn't wait for an app restart");
  assert.equal(startsOf(a.id)[1].reResolves, 1);
  assert.equal(startsOf(a.id)[1].stalledSince, 1_000_000);
  report(a, "done", { progress: 100 });
  await flush();
});

test("a rate limit holds only its own provider; removing the paused download lifts the hold", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 2_000_000 });
  const a = entry("anikoto");
  const b = entry("anikoto");
  const c = entry("anichan");
  Q.enqueueBatch([a, b, c]);
  await flush();
  assert.equal(startsOf(a.id).length, 1);
  report(a, "queued", { resume: { reason: "rate-limit", at: Date.now() + 3_600_000, reResolves: 1, stalledSince: Date.now() } });
  await flush();
  assert.equal(startsOf(b.id).length, 0, "the same CDN is left alone");
  assert.equal(startsOf(c.id).length, 1, "another provider carries on at once");
  report(c, "done", { progress: 100 });
  await flush();
  assert.equal(startsOf(b.id).length, 0, "still held after the other provider finished");
  assert.match(Q.resumeLabel(Q.getDownload(a.id)), /asked to wait \(about 60 min\)/);
  await Q.removeDownload(a.id);
  await flush();
  assert.equal(startsOf(b.id).length, 1, "removing the rate-limited download lifts its hold");
  report(b, "done", { progress: 100 });
  await flush();
  t.mock.timers.tick(3_600_000);
  await flush();
  assert.equal(startsOf(a.id).length, 1, "the removed download's wait ended with it");
});

test("asking again for a rate-limited download starts it now, and its hold ends when it does", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 3_000_000 });
  const a = entry("anikoto");
  const b = entry("anikoto");
  Q.enqueueBatch([a, b]);
  await flush();
  report(a, "queued", { resume: { reason: "rate-limit", at: Date.now() + 600_000, reResolves: 1, stalledSince: Date.now() } });
  await flush();
  assert.equal(startsOf(b.id).length, 0);
  assert.equal(Q.enqueueDownload(a), false, "already queued");
  await flush();
  assert.equal(startsOf(a.id).length, 2, "the user's ask overrides the wait");
  report(a, "done", { progress: 100 });
  await flush();
  assert.equal(startsOf(b.id).length, 1, "its hold went with it");
  report(b, "done", { progress: 100 });
  await flush();
});

test("a server pause holds nothing, waits its time, then resumes on its own", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 4_000_000 });
  const a = entry("anikoto");
  const b = entry("anikoto");
  Q.enqueueBatch([a, b]);
  await flush();
  report(a, "queued", { resume: { reason: "server", at: Date.now() + 300_000, reResolves: 1, stalledSince: Date.now() } });
  await flush();
  assert.equal(startsOf(b.id).length, 1, "a server error on one episode doesn't hold its provider");
  assert.match(Q.resumeLabel(Q.getDownload(a.id)), /busy \(about 5 min\)/);
  report(b, "done", { progress: 100 });
  await flush();
  assert.equal(startsOf(a.id).length, 1);
  t.mock.timers.tick(300_000);
  await flush();
  assert.equal(startsOf(a.id).length, 2, "it continues once the wait is over");
  report(a, "failed", { error: "The server kept failing on part of this episode. Try another server." });
  await flush();
});

test("a download removed while its stream resolves is never started", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 5_000_000 });
  const a = entry();
  const b = entry();
  Q.enqueueBatch([a, b]);
  // Removed before the resolve chain gets to start it.
  await Q.removeDownload(a.id);
  await flush();
  assert.equal(startsOf(a.id).length, 0);
  assert.equal(startsOf(b.id).length, 1, "the next one starts instead");
  report(b, "done", { progress: 100 });
  await flush();
});
