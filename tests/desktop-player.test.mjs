import test from "node:test";
import assert from "node:assert/strict";
import {
  capturePlaybackPosition,
  chooseResumePosition,
  HlsRecoveryBudget,
  PlaybackRequestGate,
  providerPlaybackErrorMessage,
  requiresManualProviderRetry,
} from "../apps/desktop/renderer/components/player/playbackRequests.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("a superseded episode cannot attach media or clear the new episode's loading state", async () => {
  const gate = new PlaybackRequestGate();
  const first = deferred();
  const second = deferred();
  const attached = [];
  let loading = false;
  const context = "show:1|provider-a|session-a";

  async function load(source) {
    const request = gate.begin(context);
    loading = true;
    try {
      const url = await source.promise;
      if (gate.isCurrent(request, context)) attached.push(url);
    } finally {
      if (gate.isCurrent(request, context)) loading = false;
    }
  }

  const firstLoad = load(first);
  const secondLoad = load(second);
  first.resolve("old-episode");
  await firstLoad;
  assert.deepEqual(attached, []);
  assert.equal(loading, true);
  second.resolve("selected-episode");
  await secondLoad;
  assert.deepEqual(attached, ["selected-episode"]);
  assert.equal(loading, false);
});

test("changing provider or closing the player invalidates pending playback and retries", () => {
  const gate = new PlaybackRequestGate();
  const request = gate.begin("show:1|provider-a|session-a");
  assert.equal(gate.isCurrent(request, "show:1|provider-b|session-b"), false);
  gate.invalidate();
  assert.equal(gate.isCurrent(request, "show:1|provider-a|session-a"), false);
  assert.equal(gate.current(), null);
});

test("a late failure from an old server cannot replace the new stream with an error", async () => {
  const gate = new PlaybackRequestGate();
  const oldServer = deferred();
  const newServer = deferred();
  const context = "show:1|provider-a|session-a";
  let error = null;
  let attached = null;

  async function load(source) {
    const request = gate.begin(context);
    try {
      const url = await source.promise;
      if (gate.isCurrent(request, context)) attached = url;
    } catch (failure) {
      if (gate.isCurrent(request, context)) error = failure.message;
    }
  }

  const oldLoad = load(oldServer);
  const newLoad = load(newServer);
  newServer.resolve("working-server");
  await newLoad;
  oldServer.reject(new Error("old server unavailable"));
  await oldLoad;
  assert.equal(attached, "working-server");
  assert.equal(error, null);
});

test("server changes retain fractional live positions and pending seeks through another resolve", () => {
  const firstSwitch = capturePlaybackPosition(142.75, null);
  assert.equal(firstSwitch, 142.75);
  const nextSwitch = capturePlaybackPosition(0, firstSwitch);
  assert.equal(nextSwitch, 142.75);
  // Observed live: the next source had attached and begun at ~0 s before its
  // pending seek ran; a third quick switch must not capture that position.
  assert.equal(capturePlaybackPosition(0.04, 307.5), 307.5);
  assert.equal(capturePlaybackPosition(310.2, null), 310.2);
  assert.equal(chooseResumePosition(nextSwitch, 130), 142.75);
  assert.equal(chooseResumePosition(1.25, 130), 1.25);
  assert.equal(chooseResumePosition(0, 130), 0);
  assert.equal(chooseResumePosition(undefined, 130), 130);
  assert.equal(capturePlaybackPosition(NaN, NaN), 0);
});

test("unrecoverable HLS media and network errors exhaust recovery and reach fallback", () => {
  const recovery = new HlsRecoveryBudget();
  assert.deepEqual(Array.from({ length: 5 }, () => recovery.nextMediaRetry()), [1, 2, null, null, null]);
  assert.deepEqual(Array.from({ length: 5 }, () => recovery.nextNetworkRetry()), [1, 2, 3, null, null]);
  // A genuinely new stream gets a fresh, bounded recovery opportunity.
  assert.equal(new HlsRecoveryBudget().nextMediaRetry(), 1);
});

test("verification and rate-limit markers survive Electron IPC wrapping and require manual retry", () => {
  const blocked = new Error("Error invoking remote method 'pahe:resolve': Error: PAHE_SECURITY_CHECK: Kwik requires site verification. Choose another provider.");
  const limited = new Error("Error invoking remote method 'pahe:links': Error: PAHE_RATE_LIMITED: AnimePahe limited this request. Retry in a minute.");
  assert.equal(requiresManualProviderRetry(blocked), true);
  assert.equal(requiresManualProviderRetry(limited), true);
  assert.equal(requiresManualProviderRetry(new Error("HTTP 503 from stream server")), false);
  assert.equal(providerPlaybackErrorMessage(blocked), "Kwik requires site verification. Choose another provider.");
  assert.equal(providerPlaybackErrorMessage(limited), "AnimePahe limited this request. Retry in a minute.");
});

test("Anikoto security, rate-limit and cooldown errors stop automatic playback fallback", () => {
  for (const [code, message] of [
    ["ANIKOTO_SECURITY_CHECK", "Anikoto needs site verification. Choose another provider."],
    ["ANIKOTO_RATE_LIMITED", "Anikoto limited this request. Retry later."],
    ["ANIKOTO_COOLDOWN", "Anikoto is temporarily unavailable after a rejected request."],
  ]) {
    const error = new Error(`Error invoking remote method 'pahe:resolve': Error: ${code}: ${message}`);
    assert.equal(requiresManualProviderRetry(error), true);
    assert.equal(providerPlaybackErrorMessage(error), message);
  }
});
