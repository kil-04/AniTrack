import test from "node:test";
import assert from "node:assert/strict";
import { matchProviderSession, preferredStreamLinkIndex, streamVariant } from "../apps/desktop/renderer/lib/provider-api.ts";

test("AniList-keyed connectors retain the requested provider when their title IDs collide", () => {
  const shonen = { id: "212888", providerId: "shonen" };
  const anichan = { id: "212888", providerId: "anichan" };
  assert.equal(matchProviderSession([shonen, anichan], "212888", "anichan"), anichan);
  assert.equal(matchProviderSession([shonen, anichan], "212888", "shonen"), shonen);
  assert.equal(matchProviderSession([shonen, anichan], "212888", "old-provider"), undefined);
  assert.equal(matchProviderSession([anichan], "212888", "old-provider"), anichan, "unambiguous legacy sessions can still be corrected");
});

test("quality connectors prefer the highest original-audio stream", () => {
  const links = [
    { id: "dub", quality: "1080p", audio: "eng" },
    { id: "sub", quality: "1080p", audio: "jpn" },
    { id: "low", quality: "720p", audio: "jpn" },
  ];
  const descriptor = { id: "mockstream", name: "Mock", capabilities: { streamVariants: "quality" } };
  assert.equal(preferredStreamLinkIndex(links, descriptor), 1);
});

test("subtitle connectors use normalized variants without parsing provider payloads", () => {
  const links = [
    { id: "opaque-a", quality: "Auto", audio: "jpn", variant: "hard" },
    { id: "opaque-b", quality: "Auto", audio: "jpn", variant: "soft" },
  ];
  const descriptor = { id: "mockstream", name: "Mock", capabilities: { streamVariants: "subtitle-type" } };
  assert.equal(streamVariant(links[1]), "soft");
  assert.equal(preferredStreamLinkIndex(links, descriptor, "soft"), 1);
});
