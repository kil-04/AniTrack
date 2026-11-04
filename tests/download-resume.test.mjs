import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as R from "../packages/shared/download-resume.ts";

// The same cases run in DownloadResumeTest.kt against the Kotlin twin.
const cases = JSON.parse(readFileSync(new URL("./fixtures/download-resume.json", import.meta.url), "utf8"));

function head(spec) {
  const [kind, ...rest] = spec.split(":");
  const value = rest.join(":");
  if (kind === "hex") return Uint8Array.from(value.match(/../g) ?? [], (h) => parseInt(h, 16));
  if (kind === "text") return new TextEncoder().encode(value);
  const bytes = new Uint8Array(Number(value));
  if (kind === "ts") for (let i = 0; i < bytes.length; i += 188) bytes[i] = 0x47;
  return bytes;
}
const ledgerOf = (text) => (text == null ? null : R.parseLedger(text));
const plain = (ledger) => ledger && ({
  version: ledger.version, rendition: ledger.rendition, total: ledger.total,
  pieces: Object.fromEntries([...ledger.pieces].map(([i, e]) => [String(i), [e.file, e.size, e.tag]])),
});

test("resume: FNV-1a 64 matches the Kotlin twin", () => {
  for (const c of cases.fnv64) assert.equal(R.fnv64(c.text), c.hash, c.text);
});

test("resume: stable URLs drop host, fragment and signing parameters", () => {
  for (const c of cases.stableUrl) assert.equal(R.stableUrl(c.url), c.stable, c.url);
  for (const c of cases.variantAttributes) assert.equal(R.variantAttributes(c.line), c.attributes, c.line);
});

test("resume: a re-signed rendition keeps its identity, another rendition doesn't", () => {
  const r = cases.rendition;
  assert.equal(R.renditionId(r.variant, r.pieces), r.id);
  for (const c of r.same) assert.equal(R.renditionId(c.variant, c.pieces), r.id, c.why);
  for (const c of r.different) assert.notEqual(R.renditionId(c.variant, c.pieces), r.id, c.why);
});

test("resume: media, image and error-page signatures", () => {
  for (const c of cases.tags) {
    const bytes = head(c.head);
    assert.equal(R.mediaTag(bytes), c.media, `media ${c.head}`);
    assert.equal(R.imageTag(bytes), c.image, `image ${c.head}`);
    assert.equal(R.looksLikeErrorPage(bytes), c.errorPage, `error page ${c.head}`);
  }
  for (const c of cases.pieceTag) assert.equal(R.pieceTag(c.piece, head(c.head)), c.tag, JSON.stringify(c.piece));
});

test("resume: which saved pieces are kept", () => {
  for (const c of cases.stillValid) {
    assert.equal(R.pieceStillValid(c.kind, c.tag, head(c.head), c.size, c.recorded), c.valid, c.why);
  }
});

test("resume: the ledger survives a kill mid-write", () => {
  for (const c of cases.ledgers) assert.deepEqual(plain(R.parseLedger(c.text)), c.ledger, c.why);
  assert.equal(R.ledgerHeader("a71a4acc3692a01e", 3), cases.headerAndLine.header);
  assert.equal(R.ledgerLine(1, "seg00000.ts", 1503232, "enc"), cases.headerAndLine.line);
});

test("resume: the plan continues from the first missing piece and never mixes renditions", () => {
  for (const c of cases.resumePlans) {
    const disk = (file) => (c.disk[file] ? { size: c.disk[file].size, head: head(c.disk[file].head) } : null);
    assert.deepEqual(R.resumePlan(c.pieces, c.rendition, ledgerOf(c.ledger), disk), c.plan, c.why);
  }
  for (const c of cases.keyStillMatches) assert.equal(R.keyStillMatches(ledgerOf(c.ledger), c.index, c.tag), c.matches);
});

test("resume: backoff, Retry-After and the step after a failure", () => {
  for (const [attempt, ms] of cases.backoff) assert.equal(R.backoffMs(attempt), ms);
  for (const c of cases.retryAfter) assert.equal(R.retryAfterMs(c.header, c.now), c.ms, c.why ?? String(c.header));
  for (const c of cases.steps) assert.deepEqual(R.nextStep(c.failure, c.attempt, c.reResolves, c.now), c.step, c.why);
  for (const c of cases.conservativeSteps) assert.deepEqual(R.conservativeStep(c.step, c.failure, c.reResolves, c.now), c.result, c.why);
});

test("resume: every stop has a final state (stalls, rate limits, offline waits)", () => {
  for (const c of cases.afterStop) {
    assert.deepEqual(R.afterStop(c.reason, c.reResolves, c.stalledSince, c.progressed, c.now), c.verdict, c.why);
  }
  for (const c of cases.stalledMessages) assert.equal(R.stalledMessage(c.reason, c.item), c.message, `${c.reason} ${c.item}`);
});

test("resume: captions are best-effort", () => {
  for (const c of cases.captionSteps) assert.deepEqual(R.captionStep(c.failure, c.attempt, c.conservative, c.now), c.step, c.why);
});

test("resume: when to resolve the stream again", () => {
  for (const c of cases.expiry) assert.equal(R.urlExpiresAt(c.url), c.at, c.url);
  for (const c of cases.reResolveBeforeFetch) assert.equal(R.reResolveBeforeFetch(c.url, c.resolvedAt, c.now), c.reResolve, c.why);
});
