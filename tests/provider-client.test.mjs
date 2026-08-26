import test from "node:test";
import assert from "node:assert/strict";
import { preferredStreamLinkIndex, streamVariant } from "../apps/desktop/renderer/lib/provider-api.ts";

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
