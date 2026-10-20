/* Locally reviewed AniChan session reader, shared by Electron and Android.
 * Runs only in the isolated website profile. The normal website creates its
 * session; this reader never creates a challenge token or solves a check.
 * Public protocol constants are parsed as bounded data, never evaluated.
 */
(function (global) {
  "use strict";
  if (global.AniTrackAniChan) return;
  const ORIGIN = "https://anichan.to";
  const LIMIT = 512 * 1024;
  const EXPIRY = "anichan_ws_exp", NONCE = "anichan_ws_n", FAILURE = "anichan_ws_fail";
  let protocol = null;
  let activeTask = null;

  function pauseWebsiteVideo() {
    for (const video of document.querySelectorAll("video")) {
      video.muted = true;
      video.pause();
    }
  }

  function ready() {
    const nonce = localStorage.getItem(NONCE);
    return Number(localStorage.getItem(EXPIRY)) > Date.now() + 1000 &&
      typeof nonce === "string" && nonce.length > 0 && nonce.length <= 512 && protocolPaths().length === 1;
  }

  async function boundedFetch(path, headers, task) {
    if (task.cancelled) throw new Error("cancelled");
    const url = new URL(path, ORIGIN);
    if (url.origin !== ORIGIN || url.username || url.password) throw new Error("origin");
    const controller = new AbortController();
    task.controller = controller;
    const timer = setTimeout(() => controller.abort(), 10000);
    let reader;
    try {
      const response = await fetch(url.href, { credentials: "same-origin", redirect: "error", cache: "no-store", headers, signal: controller.signal });
      if ([401, 403, 429].includes(response.status)) {
        await response.body?.cancel();
        return { status: response.status, text: "", retryAfter: response.headers.get("retry-after") };
      }
      if (Number(response.headers.get("content-length")) > LIMIT) throw new Error("size");
      reader = response.body?.getReader();
      const chunks = [];
      let size = 0;
      while (reader) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > LIMIT) { await reader.cancel(); throw new Error("size"); }
        chunks.push(part.value);
      }
      return { status: response.status, text: await new Blob(chunks).text(), retryAfter: null };
    } finally {
      clearTimeout(timer);
      if (task.controller === controller) task.controller = null;
      reader?.releaseLock();
    }
  }

  function bytes(value, maxBytes) {
    if (typeof value !== "string" || value.length > Math.ceil(maxBytes / 3) * 4 ||
      value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("encoding");
    const binary = atob(value);
    if (binary.length > maxBytes || btoa(binary) !== value) throw new Error("encoding");
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }

  function protocolPaths() {
    // This is the public API chunk referenced by the current normal document.
    // A changed module identity fails explicitly, rather than searching arbitrary
    // downloaded code or executing it in AniTrack's native runtime.
    return [...document.scripts].map(script => {
      try { const url = new URL(script.src); return url.origin === ORIGIN ? url.pathname : ""; }
      catch (_) { return ""; }
    }).filter(path => /^\/_next\/static\/chunks\/7621-[a-f0-9]+\.js$/.test(path));
  }

  async function currentProtocol(task) {
    if (protocol) return protocol;
    const paths = protocolPaths();
    if (paths.length !== 1) throw new Error("protocol");
    const response = await boundedFetch(paths[0], { Accept: "text/javascript" }, task);
    if (response.status !== 200) throw new Error("protocol");
    const match = /["']anichan_ws_exp["'][\s\S]{0,240}?["']([a-f0-9]{8})["']\s*,\s*[$A-Z_a-z][$\w]*\s*=\s*["']([A-Za-z0-9+/]{43}=)["']\s*,\s*[$A-Z_a-z][$\w]*\s*=\s*["']([A-Za-z0-9+/]{43}=)["']/.exec(response.text);
    if (!match) throw new Error("protocol");
    const left = bytes(match[2], 32), right = bytes(match[3], 32);
    if (left.length !== 32 || right.length !== 32) throw new Error("protocol");
    protocol = { version: match[1], mask: left.map((value, index) => value ^ right[index]) };
    return protocol;
  }

  async function decode(payload, config) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("response");
    if (payload.v !== 1) return payload;
    const nonce = localStorage.getItem(NONCE);
    if (!nonce || nonce.length > 512) throw new Error("session");
    const iv = bytes(payload.i, 12), data = bytes(payload.d, LIMIT);
    if (iv.length !== 12 || data.length < 16) throw new Error("response");
    const hmac = await crypto.subtle.importKey("raw", config.mask, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const derived = await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(nonce));
    const key = await crypto.subtle.importKey("raw", derived, { name: "AES-GCM" }, false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
  }

  async function read(request) {
    let task;
    try {
      if (location.origin !== ORIGIN) return { status: "error", message: "AniChan connection left its website." };
      pauseWebsiteVideo();
      if (request?.operation === "state") return { status: "ok", ready: ready(), pageUrl: location.href };
      if (request?.operation === "cancel") {
        if (typeof request.requestId === "string" && request.requestId && activeTask?.id === request.requestId) {
          activeTask.cancelled = true;
          activeTask.controller?.abort();
        }
        return { status: "ok" };
      }
      if (request?.operation === "reset") {
        for (const key of [EXPIRY, NONCE, FAILURE]) localStorage.removeItem(key);
        protocol = null;
        return { status: "ok", ready: false };
      }
      if (request?.operation !== "servers" || !Number.isSafeInteger(request.animeId) || request.animeId < 1 || request.animeId > 2147483647 ||
        !Number.isSafeInteger(request.episode) || request.episode < 1 || request.episode > 5000 ||
        !["sub", "dub"].includes(request.category) || !["fast", "rest"].includes(request.tier)) {
        return { status: "error", message: "Invalid AniChan episode request." };
      }
      if (!ready()) return { status: "connect", message: "Connect AniChan to verify its website session." };
      if (request.requestId !== undefined && (typeof request.requestId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(request.requestId))) throw new Error("request");
      if (activeTask) throw new Error("busy");
      task = { id: request.requestId || "", cancelled: false, controller: null };
      activeTask = task;
      const config = await currentProtocol(task);
      const query = new URLSearchParams({ anilistId: String(request.animeId), ep: String(request.episode), category: request.category, tier: request.tier });
      const response = await boundedFetch("/api/watch/servers?" + query, { Accept: "application/json", "X-Wk": config.version }, task);
      if (response.status === 401 || response.status === 403) return { status: "connect", message: "AniChan's session expired. Connect again, then retry." };
      if (response.status === 429) return { status: "rate-limit", message: "AniChan asked to wait. Try again shortly.", retryAfter: Math.min(300, Math.max(1, Number(response.retryAfter) || 60)) };
      if (response.status !== 200) return { status: "error", message: "AniChan did not return this episode. Retry or choose another source." };
      const result = await decode(JSON.parse(response.text), config);
      if (task.cancelled) throw new Error("cancelled");
      if (!result || typeof result !== "object" || !Array.isArray(result.servers) || result.servers.length > 64 || JSON.stringify(result).length > LIMIT) throw new Error("response");
      return { status: "ok", data: result };
    } catch (_) {
      // Never expose nonces, protocol material, signed URLs or arbitrary page errors.
      return { status: "error", message: "AniChan's page response could not be read. Reconnect or choose another source." };
    } finally {
      if (task && activeTask === task) activeTask = null;
      pauseWebsiteVideo();
    }
  }

  global.AniTrackAniChan = Object.freeze({ read });
})(globalThis);
