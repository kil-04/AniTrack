const test = require("node:test");
const assert = require("node:assert/strict");
const current = require("../automation/remote-config.json");
const { validateRemoteConfig } = require("../scripts/automation-common.js");

const clone = (value) => JSON.parse(JSON.stringify(value));

function withThirdProvider() {
  const config = clone(current);
  config.providerOrder = ["mockstream", ...config.providerOrder];
  config.providers = {
    mockstream: {
      enabled: true,
      baseUrls: ["https://mockstream.example"],
      streamHostFragments: ["media.mockstream.example"],
      mediaExtensions: [".m3u8", ".ts"],
      routes: {
        search: "/search?q={query}",
        episodes: "/shows/{animeId}/episodes?page={page}",
      },
      selectors: { streamUrlAttribute: "data-stream" },
    },
    ...config.providers,
  };
  return config;
}

test("signed runtime config accepts a generic third provider", () => {
  assert.doesNotThrow(() => validateRemoteConfig(withThirdProvider(), "test config"));
});

test("provider order and provider map must match exactly", () => {
  const config = withThirdProvider();
  delete config.providers.mockstream;
  assert.throws(
    () => validateRemoteConfig(config, "test config"),
    /must contain exactly/,
  );
});

test("generic provider ids and route placeholders remain constrained", () => {
  const unsafeId = withThirdProvider();
  unsafeId.providerOrder[0] = "../mockstream";
  assert.throws(() => validateRemoteConfig(unsafeId, "test config"), /providerOrder/);

  const duplicatePlaceholder = withThirdProvider();
  duplicatePlaceholder.providers.mockstream.routes.search = "/search/{query}/{query}";
  assert.throws(
    () => validateRemoteConfig(duplicatePlaceholder, "test config"),
    /invalid placeholders/,
  );

  const unmatchedBrace = withThirdProvider();
  unmatchedBrace.providers.mockstream.routes.search = "/search/{query}}";
  assert.throws(
    () => validateRemoteConfig(unmatchedBrace, "test config"),
    /invalid placeholders/,
  );
});
