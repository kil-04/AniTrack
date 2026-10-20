import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
const mocks = {
  electron: "export const app={getVersion:()=> 'test',getAppPath:()=>process.cwd()};export const net={fetch:()=>{throw Error('unexpected network')}};export class BrowserWindow{constructor(){throw Error('no window in tests')}};",
  sources: "export class SourceHttp{};export class MangaSourceError extends Error{};",
};
registerHooks({
  resolve(specifier, context, next) {
    const key = specifier === "electron" ? specifier : specifier.split("/").at(-1);
    if (key in mocks) return { url: "anichan-fixture:" + key, shortCircuit: true };
    try { return next(specifier, context); } catch (error) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(specifier + ".ts", context);
      throw error;
    }
  },
  load(url, context, next) {
    if (url.startsWith("anichan-fixture:")) return { format: "module", source: mocks[url.slice(16)], shortCircuit: true };
    return next(url, context);
  },
});
const { AniChanProvider } = await import("../apps/desktop/main/services/providers/anichan.ts");
const { aniChanPageReader } = await import("../apps/desktop/main/services/providers/anichan-session.ts");
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/anichan-${name}.json`, import.meta.url), "utf8"));
function provider() {
  const gets = [], reads = [], prepared = [];
  let title = fixture("title"), response = fixture("servers-overgeared-sub");
  const adapter = new AniChanProvider({
    get: async url => { gets.push(url); return structuredClone(title); },
    read: async r => { reads.push(r); return structuredClone(response); },
    prepareHls: async url => { prepared.push(url); return url; },
  });
  return { adapter, gets, reads, prepared, setTitle: v => { title = v; }, setResponse: v => { response = v; } };
}
test("AniChan lists four released episodes without reading protected media or inventing future episodes", async () => {
  const p = provider();
  const result = await p.adapter.getEpisodes("212888");
  assert.deepEqual(result.data.map(e => e.episodeNumber), [1, 2, 3, 4]);
  assert.equal(result.total, 4);
  assert.equal(p.gets.length, 1);
  assert.equal(p.reads.length, 0);
  assert.equal(p.adapter.capabilities.prefetch, false);
  assert.equal(p.adapter.capabilities.downloads, true);
});
test("AniChan reads fast server metadata and resolves the exact selected server freshly", async () => {
  const p = provider();
  const links = await p.adapter.getStreamLinks("ep:1", "212888");
  assert.ok(links.length > 0);
  assert.equal(p.reads.length, 2, "one fast metadata response per available language");
  assert.ok(p.reads.every(r => r.tier === "fast"));
  assert.ok(links.every(l => !l.id.includes("https:")));
  const media = await p.adapter.resolveStream(links[0].id);
  assert.equal(p.reads.length, 3);
  assert.equal(p.prepared.length, 1);
  assert.equal(media.hls, true);
  assert.equal(media.referer, undefined, "signed proxy requests must not add browser hotlink headers");
  assert.ok(media.subtitles.length > 0);
  const token = JSON.parse(links[0].id); token.s = "removed";
  await assert.rejects(p.adapter.resolveStream(JSON.stringify(token)), /no longer available/);
  assert.equal(p.prepared.length, 1);
});
test("AniChan rest tier is requested only when fast tier has no supported direct choices", async () => {
  const p = provider(); p.setResponse({ servers: [] });
  // No Sub server (here none at all) is a clear no-subtitled-stream error, never a Dub-only list.
  await assert.rejects(p.adapter.getStreamLinks("ep:1", "212888"), /no subtitled stream/);
  assert.deepEqual(p.reads.map(r => r.tier), ["fast", "rest", "fast", "rest"]);
});
test("AniChan invalid references and future episodes never trigger a protected read", async () => {
  const p = provider();
  await assert.rejects(p.adapter.getEpisodes("../1"), /Invalid/);
  await assert.rejects(p.adapter.getStreamLinks("ep:0", "212888"), /Invalid/);
  await assert.rejects(p.adapter.resolveStream('{"a":212888,"n":1}'), /Invalid/);
  await assert.rejects(p.adapter.getStreamLinks("ep:12", "212888"), /not listed/);
  assert.equal(p.reads.length, 0);
});
test("AniChan catalogue cache expires on configuration change and concurrent reads share one request", async () => {
  const p = provider();
  await Promise.all([p.adapter.getEpisodes("212888"), p.adapter.getEpisodes("212888")]);
  assert.equal(p.gets.length, 1);
  p.adapter.onConfigChanged();
  await p.adapter.getEpisodes("212888");
  assert.equal(p.gets.length, 2);
});

test("AniChan session retains the canonical watch document after the site's slug redirect", async () => {
  const urls = [];
  const read = aniChanPageReader({
    readPage: async (url, code) => {
      urls.push(url);
      return code.includes("const until=") ? { status: "ok", ready: true, pageUrl: "https://anichan.to/anime/212888/overgeared/1" }
        : { status: "ok", data: { servers: [] } };
    },
    requireVerification: () => { throw Error("unexpected verification"); },
  });
  const request = { animeId: 212888, episode: 1, category: "sub", tier: "fast" };
  await read(request);
  await read({ ...request, animeId: 1 });
  assert.deepEqual(urls, ["https://anichan.to/anime/212888/watch/1", ...Array(3).fill("https://anichan.to/anime/212888/overgeared/1")]);
});
