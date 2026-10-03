import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

// Shared synthetic fixture with the Android connector tests; no real episode
// ids, session data or signed media URLs.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/miruro-catalogue.json", import.meta.url), "utf8"));

const mocks = {
  electron: "export const net={fetch:()=>{throw new Error('unexpected network')}}; export class BrowserWindow{constructor(){throw new Error('no window in tests')}}",
  anilist: "export const searchAnime=async()=>{throw new Error('inject search')};",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const key = specifier === "electron" ? "electron" : specifier.split("/").at(-1);
    if (key in mocks) return { url: `miruro-fixture:${key}`, shortCircuit: true };
    try { return nextResolve(specifier, context); } catch (error) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url.startsWith("miruro-fixture:")) return { format: "module", source: mocks[url.slice("miruro-fixture:".length)], shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { MiruroProvider } = await import("../apps/desktop/main/services/providers/miruro.ts");
const { miruroDirectMedia, miruroHttps } = await import("../apps/desktop/main/services/providers/miruro-media.ts");
const { MiruroClient } = await import("../apps/desktop/main/services/providers/miruro-client.ts");

function provider({ data = fixture, prepared = [] } = {}) {
  const reads = [];
  const adapter = new MiruroProvider({
    read: async (request) => {
      reads.push(request);
      if (request.operation === "info") return structuredClone(data.info);
      if (request.operation === "config") return structuredClone(data.config);
      if (request.operation === "episodes") return structuredClone(data.episodes);
      if (request.operation === "sources") return structuredClone(data.source);
      throw new Error("unexpected read");
    },
    search: async () => [{ id: 1, title: "Cowboy Bebop", coverImage: "https://img.example/1.jpg", year: 1998, episodes: 26, format: "TV" }],
    prepareHls: async (url, referer) => { prepared.push({ url, referer }); return url; },
  });
  return { adapter, reads, prepared };
}

test("Miruro lists episodes and server variants without resolving any source", async () => {
  const { adapter, reads } = provider();
  const page = await adapter.getEpisodes("1", 1);
  assert.deepEqual(page.data.map((episode) => episode.episodeNumber), [1, 1.5, 2]);
  assert.equal(page.data[0].title, "First");
  const links = await adapter.getStreamLinks(page.data[0].id, "1");
  assert.deepEqual(links.map((link) => link.quality), ["BEE · Soft sub", "HOP · Sub", "BEE · Dub"]);
  assert.deepEqual(links.map((link) => link.audio), ["jpn", "jpn", "eng"]);
  assert.equal(adapter.capabilities.downloads, false);
  assert.deepEqual(reads.map((read) => read.operation), ["info", "config", "episodes"], "catalogue read once, no sources");
});

test("Miruro resolves only the selected server, fresh each time, as direct HLS", async () => {
  const { adapter, reads, prepared } = provider();
  const [, hop] = await adapter.getStreamLinks("ep:2", "1");
  const stream = await adapter.resolveStream(hop.id);
  await adapter.resolveStream(hop.id);
  const sources = reads.filter((read) => read.operation === "sources");
  assert.equal(sources.length, 2);
  assert.deepEqual(sources[0], { operation: "sources", anilistId: 1, episodeId: "synthetic-hop-2", provider: "hop", category: "sub" });
  assert.equal(stream.url, "https://media.example.net/show/episode.m3u8", "the embed entry is ignored");
  assert.equal(stream.authorizationScope, "directory");
  assert.deepEqual(stream.requestHeaders, { Referer: "https://player.example.net/" });
  assert.deepEqual(prepared[0], { url: "https://media.example.net/show/episode.m3u8", referer: "https://player.example.net/" });
});

test("Miruro never substitutes another server for an unavailable selection", async () => {
  const { adapter, reads } = provider();
  const forged = JSON.stringify({ a: 1, n: 2, s: "hidden", c: "sub" });
  await assert.rejects(adapter.resolveStream(forged), /not available/);
  assert.equal(reads.some((read) => read.operation === "sources"), false);
});

test("Miruro rejects another show's catalogue and malformed references without network", async () => {
  const wrong = structuredClone(fixture);
  wrong.info.media.id = 2;
  await assert.rejects(provider({ data: wrong }).adapter.getEpisodes("1"), /identity/);
  const remapped = structuredClone(fixture);
  remapped.episodes.mappings.aniId = 5;
  await assert.rejects(provider({ data: remapped }).adapter.getEpisodes("1"), /another show/);
  const { adapter, reads } = provider();
  for (const bad of ["0", "-1", "abc", "1e3", "12345678901"]) await assert.rejects(adapter.getEpisodes(bad), /Invalid Miruro show/);
  for (const bad of ["not json", "{}", JSON.stringify({ a: 1, n: 1, s: "../x", c: "sub" }), JSON.stringify({ a: 1, n: 1, s: "bee", c: "raw" })]) {
    await assert.rejects(adapter.resolveStream(bad), /Invalid Miruro server link/);
  }
  await assert.rejects(adapter.getStreamLinks("1", "1"), /Invalid Miruro episode/);
  assert.equal(reads.length, 0);
});

test("Miruro search uses AniList metadata only, so matching never opens its page", async () => {
  const { adapter, reads } = provider();
  const results = await adapter.search("Cowboy Bebop");
  assert.deepEqual(results.map((item) => [item.id, item.providerId, item.year, item.externalLookupId]), [["1", "miruro", 1998, 1]]);
  assert.deepEqual(await adapter.getExternalIds("1"), { anilistId: 1 });
  assert.equal(reads.length, 0);
});

test("Miruro media keeps direct HTTPS video and WebVTT captions only", () => {
  const media = miruroDirectMedia({
    subtitles: [
      { file: "https://subs.example.net/en.vtt", label: "English", language: "eng" },
      { file: "https://subs.example.net/thumbs.vtt", label: "Thumbnails", kind: "thumbnails" },
      { file: "https://subs.example.net/es.ass", label: "Español", format: "ass" },
      { file: "http://subs.example.net/plain.vtt", label: "Insecure" },
    ],
    streams: [
      { url: "https://cdn.example.net/a.m3u8", type: "hls" },
      { url: "https://cdn.example.net/b.mp4", type: "mp4", default: true, referer: "https://player.example.net/" },
      { url: "https://10.0.0.1/c.m3u8", type: "hls" },
      { url: "https://player.example.net/embed", type: "embed" },
      { url: "https://cdn.example.net/d.m3u8", type: "hls", referer: "javascript:alert(1)" },
    ],
  });
  assert.deepEqual(media.map((item) => [item.url, item.hls]), [["https://cdn.example.net/b.mp4", false], ["https://cdn.example.net/a.m3u8", true]]);
  assert.deepEqual(media[0].subtitles.map((sub) => sub.label), ["English"]);
  for (const bad of ["https://user:pw@cdn.example.net/a", "https://cdn.example.net:8443/a", "https://localhost/a", "https://cdn.local/a", "ftp://cdn.example.net/a"]) {
    assert.equal(miruroHttps(bad), null, bad);
  }
});

test("Miruro without a security cooldown still stops requests queued behind a block", async () => {
  let calls = 0;
  const client = new MiruroClient({ securityCooldownMs: 0, fetcher: async () => {
    calls++;
    return calls === 1 ? new Response("blocked", { status: 403 }) : Response.json({ streaming: {} });
  } });
  const queued = await Promise.allSettled([client.read({ operation: "config" }), client.read({ operation: "config" })]);
  assert.deepEqual(queued.map((result) => result.reason?.code), ["SECURITY_CHECK", "COOLDOWN"]);
  assert.equal(calls, 1);
  // After the user completes the check, a new request goes through at once.
  await client.read({ operation: "config" });
  assert.equal(calls, 2);
});
