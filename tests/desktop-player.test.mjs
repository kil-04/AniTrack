import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hlsAccessRejectionStatus, protectedHlsLoadPolicies } from "../apps/desktop/renderer/components/player/hlsRequestPolicy.ts";
import {
  capturePlaybackPosition,
  currentMediaAccessRejection,
  chooseResumePosition,
  HlsRecoveryBudget,
  PlaybackRequestGate,
  providerPlaybackErrorMessage,
  requiresManualProviderRetry,
} from "../apps/desktop/renderer/components/player/playbackRequests.ts";

const streamPlayerSource = readFileSync(new URL("../apps/desktop/renderer/pages/StreamPlayer.tsx", import.meta.url), "utf8");

// Execute the actual app-owned callback, not a second implementation of its
// fallback policy. The extracted callback contains no JSX or TypeScript types.
function nativeVideoErrorFixture(statusLookup) {
  const marker = "const onError = ";
  const start = streamPlayerSource.indexOf(marker);
  const end = streamPlayerSource.indexOf("\n    video.addEventListener", start);
  assert.ok(start > 0 && end > start, "native video error callback found");
  const calls = [];
  const gate = new PlaybackRequestGate();
  const context = "show:1|mkissa|session";
  gate.begin(context);
  const refs = {
    video: { src: "https://cdn.example/episode.mp4?signature=fixture", currentTime: 120.5, error: { code: 2, message: "network failure" } },
    window: { location: { href: "file:///app/index.html#/stream-player" }, api: { providers: { mediaAccessStatus: statusLookup } } },
    selectedLinkRef: { current: 0 },
    linksRef: { current: [{ id: "first", quality: "First" }, { id: "next", quality: "Next" }] },
    failedLinkIdsRef: { current: new Set() },
    nextAvailableLinkIndex: () => 1,
    setFallbackNotice: value => calls.push(["notice", value]),
    changeQualityRef: { current: (...args) => calls.push(["switch", ...args]) },
    fallbackRef: { current: () => { calls.push(["provider-switch"]); return false; } },
    currentEpRef: { current: { episodeNumber: 1 } },
    setStreamError: value => calls.push(["error", value]),
    setLoadingStream: value => calls.push(["loading", value]),
    streamLinkKey: link => link.id,
    currentMediaAccessIdRef: { current: "access-current" },
    playbackRequestsRef: { current: gate },
    playbackContextRef: { current: context },
    stopForMediaAccess: status => { calls.push(["denied", status]); refs.currentMediaAccessIdRef.current = null; },
    streamErrorRef: { current: null },
  };
  const callback = new Function(...Object.keys(refs), `${streamPlayerSource.slice(start, end)}; return onError;`)(...Object.values(refs));
  return { callback, calls, gate, refs };
}

function nativeAccessEventFixture(fixture) {
  const start = streamPlayerSource.indexOf("const onAccessRejected = ");
  const end = streamPlayerSource.indexOf("\n    return window.api.providers", start);
  assert.ok(start > 0 && end > start);
  const code = streamPlayerSource.slice(start, end).replace("(rejection: unknown)", "(rejection)");
  const refs = { ...fixture.refs, currentMediaAccessRejection };
  return new Function(...Object.keys(refs), `${code}; return onAccessRejected;`)(...Object.values(refs));
}

test("the real immediate native denial handler ignores stale IDs and closes only the selected receipt", () => {
  const fixture = nativeVideoErrorFixture(async () => null);
  const receive = nativeAccessEventFixture(fixture);
  for (const value of [null, "invalid", { mediaAccessId: "old", status: 403 }, { mediaAccessId: "access-current", status: 500 }]) receive(value);
  assert.deepEqual(fixture.calls, []);
  receive({ mediaAccessId: "access-current", status: 403 });
  receive({ mediaAccessId: "access-current", status: 403 });
  assert.deepEqual(fixture.calls, [["denied", 403]]);
  fixture.refs.currentMediaAccessIdRef.current = "later";
  fixture.gate.invalidate();
  receive({ mediaAccessId: "later", status: 429 });
  assert.deepEqual(fixture.calls, [["denied", 403]]);
});

test("an immediate native denial wins a pending status lookup without duplicate fallback", async () => {
  const pending = deferred();
  const fixture = nativeVideoErrorFixture(() => pending.promise);
  const running = fixture.callback();
  nativeAccessEventFixture(fixture)({ mediaAccessId: "access-current", status: 429 });
  pending.resolve(null);
  await running;
  assert.deepEqual(fixture.calls, [["denied", 429]]);
});

test("the native source-reset error following a denial cannot begin another fallback", async () => {
  const fixture = nativeVideoErrorFixture(async () => null);
  nativeAccessEventFixture(fixture)({ mediaAccessId: "access-current", status: 403 });
  fixture.refs.video.src = "";
  await fixture.callback();
  assert.deepEqual(fixture.calls, [["denied", 403]]);
});

test("the actual native denial stop cancels media and retains fractional position and play intent", () => {
  const resetStart = streamPlayerSource.indexOf("function resetPlayer() {");
  const resetEnd = streamPlayerSource.indexOf("\n  async function fetchSkipTimes", resetStart);
  const stopStart = streamPlayerSource.indexOf("function stopForMediaAccess(");
  const stopEnd = streamPlayerSource.indexOf("\n  useEffect(() => {", stopStart);
  const code = streamPlayerSource.slice(resetStart, resetEnd) + streamPlayerSource.slice(stopStart, stopEnd).replace("(status: 403 | 429)", "(status)");
  for (const paused of [false, true]) {
    const calls = [];
    const video = { currentTime: 142.75, paused, src: "https://cdn.example/main.mp4", pause() { this.paused = true; calls.push("pause"); }, load() { calls.push("load"); } };
    const refs = {
      currentMediaAccessIdRef: { current: "selected" },
      seekingRef: { current: true }, videoRef: { current: video }, hlsRef: { current: { destroy() { calls.push("destroy"); } } },
      pendingSeekRef: { current: 307.5 }, rejectedPlaybackIntentRef: { current: null },
      playbackContextRef: { current: "show:1|mkissa|session" }, currentEpRef: { current: { id: "episode-1" } },
      loadingStreamRef: { current: true }, streamErrorRef: { current: null }, capturePlaybackPosition,
      setStreamError: () => {}, setLoadingStream: () => {}, setBuffering: () => {}, setFallbackNotice: value => calls.push(["fallback", value]),
    };
    const stop = new Function(...Object.keys(refs), `${code}; return stopForMediaAccess;`)(...Object.values(refs));
    stop(403);
    assert.equal(video.src, "", "source clear cancels native ranges rather than only pausing");
    assert.equal(refs.currentMediaAccessIdRef.current, null);
    assert.equal(refs.pendingSeekRef.current, 307.5);
    assert.deepEqual(refs.rejectedPlaybackIntentRef.current, { context: "show:1|mkissa|session", episodeId: "episode-1", play: !paused });
    assert.equal(refs.loadingStreamRef.current, false);
    assert.deepEqual(calls, ["pause", "load", "destroy", ["fallback", null]]);
  }
});

test("the actual attach decision restores rejected play intent only for the same episode and context", () => {
  const expression = /const playOnReady = ([\s\S]+?);/.exec(streamPlayerSource)?.[1];
  assert.ok(expression);
  const choose = new Function("retryIntent", "playbackContextRef", "episodeId", "autoPlay", `return ${expression};`);
  const current = { current: "show:1|mkissa|session" };
  assert.equal(choose({ context: current.current, episodeId: "ep-1", play: true }, current, "ep-1", false), true);
  assert.equal(choose({ context: current.current, episodeId: "ep-1", play: false }, current, "ep-1", true), false);
  assert.equal(choose({ context: "old-show", episodeId: "ep-1", play: false }, current, "ep-1", true), true);
  assert.equal(choose({ context: current.current, episodeId: "ep-1", play: false }, current, "ep-2", true), true);
  assert.equal(choose(null, current, "ep-1", true), true);
});

test("the real native video callback stops 403/429 rather than probing another server", async () => {
  for (const status of [403, 429]) {
    const fixture = nativeVideoErrorFixture(async () => status);
    await fixture.callback();
    assert.deepEqual(fixture.calls, [["denied", status]]);
  }
});

test("the real native video callback retains ordinary fallback when access was not rejected", async () => {
  const fixture = nativeVideoErrorFixture(async () => null);
  await fixture.callback();
  assert.equal(fixture.calls.filter(([kind]) => kind === "switch").length, 1);
});

test("the real native video callback ignores an access result after another selection or close", async () => {
  for (const action of ["selection", "close"]) {
    const pending = deferred();
    const fixture = nativeVideoErrorFixture(() => pending.promise);
    const running = fixture.callback();
    action === "close" ? fixture.gate.invalidate() : fixture.gate.begin(fixture.refs.playbackContextRef.current);
    pending.resolve(403);
    await running;
    assert.deepEqual(fixture.calls, []);
  }
});

test("the real native video callback fails closed when its status lookup is unavailable", async () => {
  for (const lookup of [undefined, async () => { throw Error("IPC unavailable"); }, async () => 200]) {
    const fixture = nativeVideoErrorFixture(lookup);
    await fixture.callback();
    assert.equal(fixture.calls.filter(([kind]) => kind === "switch" || kind === "provider-switch").length, 0);
    assert.equal(fixture.calls.filter(([kind]) => kind === "error").length, 1);
  }
});

test("the real native video callback does not rotate again after an HLS denial stopped the stream", async () => {
  const fixture = nativeVideoErrorFixture(async () => null);
  fixture.refs.streamErrorRef.current = "Streaming server rejected this request (HTTP 403).";
  await fixture.callback();
  assert.deepEqual(fixture.calls, []);
});

test("the real next-episode prefetch guard requires an explicit loaded capability", () => {
  const expression = /if \(nextEp && ([^\n]+)\) \{/.exec(streamPlayerSource)?.[1];
  assert.ok(expression, "next-episode prefetch guard found");
  const allows = new Function("descriptor", `return ${expression};`);
  assert.equal(allows(undefined), false);
  assert.equal(allows({ capabilities: {} }), false);
  assert.equal(allows({ capabilities: { prefetch: false } }), false);
  assert.equal(allows({ capabilities: { prefetch: true } }), true);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("HLS access rejections stop even before the SDK calls an error fatal", () => {
  assert.equal(hlsAccessRejectionStatus({ fatal: false, response: { code: 403 } }), 403);
  assert.equal(hlsAccessRejectionStatus({ networkDetails: { status: 429 } }), 429);
  assert.equal(hlsAccessRejectionStatus({ response: { code: 0 }, networkDetails: { status: 403 } }), 403);
  assert.equal(hlsAccessRejectionStatus({ response: { code: 503 } }), null);
  assert.equal(hlsAccessRejectionStatus({ details: "fragLoadTimeOut" }), null);
});

test("all HLS media load policies reject 403/429 retries without changing ordinary recovery limits", () => {
  const retry = { maxNumRetry: 3, retryDelayMs: 1000, maxRetryDelayMs: 8000 };
  const defaults = Object.fromEntries(["fragLoadPolicy", "keyLoadPolicy", "playlistLoadPolicy", "manifestLoadPolicy"].map(name =>
    [name, { default: { maxTimeToFirstByteMs: 10000, maxLoadTimeMs: 20000, errorRetry: retry, timeoutRetry: retry } }]));
  const policies = protectedHlsLoadPolicies(defaults);
  for (const name of Object.keys(defaults)) {
    const policy = policies[name].default;
    assert.equal(policy.maxTimeToFirstByteMs, 10000);
    assert.equal(policy.errorRetry.maxNumRetry, 3);
    for (const kind of ["errorRetry", "timeoutRetry"]) {
      assert.equal(policy[kind].shouldRetry(retry, 0, false, { code: 403 }, true), false);
      assert.equal(policy[kind].shouldRetry(retry, 0, false, { code: 429 }, true), false);
      assert.equal(policy[kind].shouldRetry(retry, 0, true, undefined, true), true);
      assert.equal(policy[kind].shouldRetry(retry, 3, true, undefined, false), false);
      assert.equal(policy[kind].shouldRetry(retry, 0, false, { code: 503 }, true), true);
    }
    assert.equal(defaults[name].default.errorRetry, retry, "default library configuration remains unmodified");
  }
});

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

test("Miruro, MKissa and manifest access rejections also survive IPC and stop automatic server rotation", () => {
  for (const code of ["MIRURO_SECURITY_CHECK", "MIRURO_RATE_LIMITED", "MIRURO_COOLDOWN", "MKISSA_CAPTCHA_REQUIRED", "MKISSA_RATE_LIMITED", "PROVIDER_SECURITY_CHECK", "PROVIDER_ACCESS_DENIED"]) {
    const error = new Error(`Error invoking remote method 'pahe:resolve': Error: ${code}: Stop this attempt.`);
    assert.equal(requiresManualProviderRetry(error), true);
    assert.equal(providerPlaybackErrorMessage(error), "Stop this attempt.");
  }
});
