import test from "node:test";
import assert from "node:assert/strict";
import { ProviderRegistry } from "../electron/services/providers/registry.ts";

function connector(id, overrides = {}) {
  return {
    id,
    name: overrides.name ?? id.toUpperCase(),
    capabilities: overrides.capabilities ?? { downloads: true },
    async search(query) {
      return [{ id: `${id}-show`, providerId: id, title: `${query} on ${id}`, poster: "" }];
    },
    async getEpisodes() {
      return { data: [{ id: `${id}-episode`, episodeNumber: 1, title: "Episode 1" }], total: 1, lastPage: 1 };
    },
    async getStreamLinks() {
      return [{ id: `${id}-link`, quality: "1080p", audio: "jpn" }];
    },
    async resolveStream(linkId) {
      return { url: `https://media.invalid/${linkId}.m3u8` };
    },
    ...overrides,
  };
}

test("a third connector works through the registry without registry changes", async () => {
  const third = connector("mockstream", {
    name: "Mock Stream",
    capabilities: { downloads: true, externalIds: true, latest: true },
    async getExternalIds() { return { anilistId: 42, malId: 24 }; },
    async getFeed(feed, page = 1) {
      return {
        providerId: "mockstream",
        feed,
        page,
        total: 1,
        lastPage: 1,
        groups: [{
          id: "latest",
          title: "Latest",
          items: [{ id: "new", providerId: "mockstream", animeId: "show", title: "New episode" }],
        }],
      };
    },
  });
  const registry = new ProviderRegistry(
    [connector("first"), third],
    { order: () => ["mockstream", "first"] },
  );

  assert.deepEqual(registry.descriptors().map((item) => item.id), ["mockstream", "first"]);
  assert.deepEqual((await registry.searchAll("Example")).map((item) => item.providerId), ["mockstream", "first"]);
  assert.equal((await registry.getEpisodes("mockstream", "show", 1)).data[0].episodeNumber, 1);
  assert.equal((await registry.getStreamLinks("mockstream", "episode", "show"))[0].quality, "1080p");
  assert.match((await registry.resolveStream("mockstream", "link")).url, /link\.m3u8$/);
  assert.deepEqual(await registry.getExternalIds("mockstream", "show"), { anilistId: 42, malId: 24 });
  assert.equal((await registry.getPreferredFeed("latest")).groups[0].items[0].title, "New episode");
});

test("duplicate, invalid, unknown and disabled connectors fail clearly", () => {
  const enabled = new Set(["working"]);
  const registry = new ProviderRegistry(
    [connector("working"), connector("disabled")],
    { isEnabled: (provider) => enabled.has(provider.id) },
  );

  assert.throws(() => registry.register(connector("working")), /already registered/);
  assert.throws(() => registry.register(connector("Bad ID")), /Invalid provider id/);
  assert.throws(() => registry.get("missing"), /not found/);
  assert.throws(() => registry.get("disabled"), /temporarily disabled/);
});

test("prefetch falls back to background resolve when a connector has no hook", async () => {
  let resolved = 0;
  let customPrefetched = 0;
  const fallback = connector("fallback", {
    async resolveStream(linkId) {
      resolved++;
      return { url: `https://media.invalid/${linkId}.m3u8` };
    },
  });
  const custom = connector("custom", {
    prefetch() { customPrefetched++; },
  });
  const registry = new ProviderRegistry([fallback, custom]);

  registry.prefetch("fallback", "fallback-link");
  registry.prefetch("custom", "custom-link");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(resolved, 1);
  assert.equal(customPrefetched, 1);
});

test("base URL management works while streaming is disabled", () => {
  let baseUrl = "https://provider.invalid";
  const configurable = connector("configurable", {
    capabilities: { configurableBaseUrl: true },
    getBaseUrl() { return baseUrl; },
    setBaseUrl(value) { baseUrl = value; },
  });
  const registry = new ProviderRegistry(
    [configurable, connector("fixed")],
    { isEnabled: () => false },
  );

  assert.throws(() => registry.get("configurable"), /temporarily disabled/);
  assert.equal(registry.getBaseUrl("configurable"), "https://provider.invalid");
  registry.setBaseUrl("configurable", "https://mirror.invalid");
  assert.equal(registry.getBaseUrl("configurable"), "https://mirror.invalid");
  assert.throws(() => registry.getBaseUrl("fixed"), /does not expose/);
  assert.throws(() => registry.getBaseUrl("missing"), /not found/);
});
