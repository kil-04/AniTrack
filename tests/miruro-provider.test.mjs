import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/miruro-v1.json", import.meta.url), "utf8"));
const mocks = {
  electron: "export const net={fetch:()=>{throw new Error('unexpected network')}}; export class BrowserWindow{constructor(){throw new Error('no window in tests')}}",
  anilist: "export const searchAnime=async()=>{throw new Error('inject search')};",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const key = specifier === "electron" ? "electron" : specifier.split("/").at(-1);
    if (key in mocks) return { url: "miruro-fixture:" + key, shortCircuit: true };
    try { return nextResolve(specifier, context); } catch (error) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
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
const { miruroV1Choices, miruroV1Episodes, miruroV1Show } = await import("../apps/desktop/main/services/providers/miruro-v1-catalogue.ts");

function provider({ data = fixture, prepared = [], now = Date.now } = {}) {
  const reads = [];
  const adapter = new MiruroProvider({
    read: async request => {
      reads.push(request);
      const value = structuredClone(data[request.operation]);
      if (request.operation === "play") value.episode_number = request.episode;
      return value;
    },
    search: async () => [{ id: 1, title: "Cowboy Bebop", coverImage: "https://img.example/1.jpg", year: 1998, episodes: 26, format: "TV" }],
    prepareHls: async (url, referer, headers) => { prepared.push({ url, referer, headers }); return url; },
    now,
  });
  return { adapter, reads, prepared };
}

test("Miruro v1 lists correct numeric episodes without requesting any media", async () => {
  const { adapter, reads } = provider();
  const page = await adapter.getEpisodes("1", 1);
  assert.deepEqual(page.data.map(episode => episode.episodeNumber), [1, 1.5, 2]);
  assert.equal(page.data[0].title, "First");
  assert.equal(adapter.capabilities.downloads, false);
  assert.deepEqual(reads, [{ operation: "lookup", anilistId: 1 }, { operation: "episodes", showId: "synthetic-show" }]);
});

test("Miruro v1 exposes direct servers as distinct track/provider/server variants", async () => {
  const { adapter, reads } = provider();
  const links = await adapter.getStreamLinks("ep:1", "1");
  assert.deepEqual(links.map(link => link.quality), ["ANIKOTO · HD-1 · Soft sub", "ANIWAVES · Vidplay · Sub", "ANIKOTO · HD-1 · Dub"]);
  assert.deepEqual(links.map(link => link.audio), ["jpn", "jpn", "eng"]);
  assert.equal(new Set(links.map(link => link.variant)).size, 3);
  assert.equal(reads.filter(read => read.operation === "play").length, 1);
  assert.equal(links.some(link => link.id.includes("https:")), false, "coordinates only, never signed media");
});

test("Miruro v1 resolves fresh playback for the selected track/server and preserves headers, captions and skips", async () => {
  const { adapter, reads, prepared } = provider();
  const [soft] = await adapter.getStreamLinks("ep:1", "1");
  const stream = await adapter.resolveStream(soft.id);
  await adapter.resolveStream(soft.id);
  assert.equal(reads.filter(read => read.operation === "play").length, 3, "listing and each resolution read fresh /play");
  assert.equal(stream.url, "https://media.example.net/show/episode.m3u8");
  assert.equal(stream.authorizationScope, "directory");
  assert.deepEqual(stream.requestHeaders, { Referer: "https://player.example.net/", Origin: "https://player.example.net" });
  assert.deepEqual(stream.intro, { start: 10, end: 50 });
  assert.deepEqual(stream.subtitles.map(sub => sub.label), ["English"]);
  assert.deepEqual(prepared[0], { url: stream.url, referer: "https://player.example.net/", headers: stream.requestHeaders });
  const links = await adapter.getStreamLinks("ep:1", "1");
  const dub = await adapter.resolveStream(links[2].id);
  assert.equal(dub.url, "https://media.example.net/show/dub.m3u8");
  const mp4 = await adapter.resolveStream(links[1].id);
  assert.equal(mp4.authorizationScope, "exact");
});

test("Miruro v1 never substitutes another server for an unavailable selection", async () => {
  const { adapter, prepared } = provider();
  const [link] = await adapter.getStreamLinks("ep:1", "1");
  const token = JSON.parse(link.id);
  token.s = "Removed";
  await assert.rejects(adapter.resolveStream(JSON.stringify(token)), /no longer available/);
  assert.equal(prepared.length, 0);
});

test("Miruro v1 rejects wrong show identities, incomplete catalogues, duplicate numbers and wrong playback episodes", () => {
  const wrong = structuredClone(fixture.lookup);
  wrong.data[0].external_ids.anilist = ["5"];
  assert.throws(() => miruroV1Show(wrong, 1), /identity/);
  const ambiguous = structuredClone(fixture.lookup);
  ambiguous.data.push(structuredClone(ambiguous.data[0]));
  assert.throws(() => miruroV1Show(ambiguous, 1), /unambiguously/);
  assert.throws(() => miruroV1Episodes({ ...fixture.episodes, has_more: true }), /incomplete/);
  assert.throws(() => miruroV1Episodes({ data: [fixture.episodes.data[0], fixture.episodes.data[0]] }), /conflicting/);
  assert.throws(() => miruroV1Choices(fixture.play, 2), /another episode/);
});

test("Miruro v1 never emits duplicate occurrence coordinates its resolver cannot accept", () => {
  const play = structuredClone(fixture.play);
  const provider = play.tracks[0].providers[0];
  provider.servers = Array.from({ length: 32 }, () => structuredClone(provider.servers[0]));
  play.tracks[0].providers.push(structuredClone(provider));
  assert.throws(() => miruroV1Choices(play, 1), /duplicate server identities/);
});

test("Miruro v1 rejects unsupported required headers, embeds and private media", () => {
  const data = structuredClone(fixture.play);
  const servers = data.tracks[0].providers[0].servers;
  for (const header of [{ Cookie: "must-not-export" }, { Referer: "javascript:alert(1)" }, { Origin: "https://player.example.net/page" }]) {
    servers[0].headers = header;
    assert.equal(miruroV1Choices(data, 1).filter(choice => choice.track === "ssub").length, 0);
  }
  servers[0].headers = {};
  servers[0].streams[0].embed = true;
  assert.equal(miruroV1Choices(data, 1).filter(choice => choice.track === "ssub").length, 0);
  delete servers[0].streams[0].embed;
  servers[0].streams[0].url = "https://127.0.0.1/a.m3u8";
  assert.equal(miruroV1Choices(data, 1).filter(choice => choice.track === "ssub").length, 0);
});

test("Miruro v1 malformed show, episode and link references never start a request", async () => {
  const { adapter, reads } = provider();
  for (const bad of ["0", "-1", "abc", "1e3", "12345678901"]) await assert.rejects(adapter.getEpisodes(bad), /Invalid Miruro show/);
  const token = { v: 2, a: 1, n: 1, p: "anikoto", s: "HD-1", c: "ssub", o: 0 };
  for (const bad of ["not json", "{}", JSON.stringify({ ...token, p: "../x" }), JSON.stringify({ ...token, c: "raw" }), JSON.stringify({ ...token, n: -1 }), JSON.stringify({ ...token, o: 32 })]) {
    await assert.rejects(adapter.resolveStream(bad), /Invalid Miruro server/);
  }
  await assert.rejects(adapter.getStreamLinks("1", "1"), /Invalid Miruro episode/);
  assert.equal(reads.length, 0);
});

test("Miruro search uses AniList metadata only, so matching never opens its page", async () => {
  const { adapter, reads } = provider();
  const results = await adapter.search("Cowboy Bebop");
  assert.deepEqual(results.map(item => [item.id, item.providerId, item.year, item.externalLookupId]), [["1", "miruro", 1998, 1]]);
  assert.deepEqual(await adapter.getExternalIds("1"), { anilistId: 1 });
  assert.equal(reads.length, 0);
});

test("Miruro v1 catalogue expires and is invalidated by configuration changes", async () => {
  let now = 0;
  const { adapter, reads } = provider({ now: () => now });
  await Promise.all([adapter.getEpisodes("1"), adapter.getEpisodes("1")]);
  assert.equal(reads.length, 2, "concurrent catalogue reads join one task");
  now = 300_001;
  await adapter.getEpisodes("1");
  assert.equal(reads.length, 4);
  adapter.onConfigChanged();
  await adapter.getEpisodes("1");
  assert.equal(reads.length, 6);
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
