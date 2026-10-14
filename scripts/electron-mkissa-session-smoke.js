#!/usr/bin/env node
/**
 * Opt-in observation of MKissa's ordinary website in its own empty session.
 *
 * Run only after the human has approved this specific live session:
 *   electron scripts/electron-mkissa-session-smoke.js --live
 *
 * This is not a connector, CAPTCHA solver or player. The human performs all
 * website interactions. No downloaded module is invoked by this script, no
 * provider/account cookies or source URLs leave the session, and a rejected API
 * attempt stops subsequent API traffic rather than rotating tokens or servers.
 * A loaded homepage does not establish protected-API or native-player access.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");

const SITE = "https://mkissa.to";
const API = "https://api.mkissa.net";
const ASSET = "https://cdn.mkissa.net";
const HUMAN_CHECK = "https://challenges.cloudflare.com";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_API_REQUESTS = 12;
const MAX_REQUESTS = 240;
const MAX_SECONDS = 360;
const MAX_OBSERVATIONS = 64;
const MAX_REPORT_BYTES = 65_535;
const MAX_RECORDED_COUNT = 1_000_000;
const REQUEST_KINDS = new Set(["site", "asset", "human-check", "preflight", "catalogue", "protected", "bootstrap", "api-read"]);
const SHAPE_FORMATS = new Set(["security-page", "json-object", "json-array", "json-value", "invalid-json", "html", "other"]);
const OBSERVATION_STAGES = new Set(["session-opening", "site-page-loaded", "site-page-failed", "ordinary-website-api-response",
  "ordinary-website-api-shape", "api-stopped", "startup-stopped", "observation-unavailable", "session-ended"]);
const FINISH_REASONS = new Set(["user-closed", "timeout", "startup-stopped", "startup-error"]);
const BLOCK_REASONS = Object.freeze(["invalid-url", "unsafe-url", "invalid-path", "media", "api-surface", "api-method",
  "api-security-route", "api-query", "api-route", "human-check-surface", "account-route", "site-method", "frame", "origin",
  "request-limit", "api-frozen", "api-limit", "bootstrap-limit", "protected-limit", "navigation", "redirect"]);
const QUERY_REJECTIONS = Object.freeze(["body-missing", "body-parts", "body-file", "body-blob", "body-bytes", "body-size",
  "body-json", "body-array", "body-object", "url-body-mismatch", "query-missing", "query-type", "query-size",
  "persisted-query-only", "persisted-query-mismatch", "query-block-string", "query-string", "query-token", "query-tokens", "query-operation", "query-syntax", "root-alias",
  "unreviewed-root", "root-selection", "trailing-document", "query-unclassified"]);
const COUNT_NAMES = Object.freeze(["requests", "api", "bootstrap", "protected", "denied", "blocked", "apiSuccess", "apiShapes",
  "navigationBlocked", "redirectBlocked"]);
const STOP_MESSAGES = Object.freeze({
  "http-403": "HTTP 403", "http-429": "HTTP 429", "response-limit": "API response exceeded diagnostic limit",
  "invalid-utf8": "API response was not valid UTF-8", "security-check": "Website API requested a security check",
  "unexpected-format": "API response did not have the reviewed object format",
  "inspection-unavailable": "An API response could not be safely inspected",
});
const ACCESS_GATE = /NEED_CAPTCHA|captcha|required.{0,20}fingerprint|fingerprint.{0,30}(?:required|attest)|attestation|proof[-_\s]?of[-_\s]?work|pow_required|SECURITY[_\s]?CHECK|verify.{0,20}human|RATE[_\s-]?LIMIT|TOO[_\s-]MANY[_\s-]REQUESTS/i;
const FORBIDDEN_API = /(?:fingerprint|attest|proof[-_]?of[-_]?work|(?:^|\/)pow(?:\/|$)|captcha|solver|solve|verify|token)/i;
const ACCOUNT_PATH = /(?:^|\/)(?:account|login|logout|signin|signup|register|oauth|profile|settings|billing|payment)(?:\/|$)/i;
const MEDIA_PATH = /\.(?:m3u8|mpd|mp4|m4v|m4a|ts|m4s|aac|mp3|webm|mkv|mov|flv|avi|ogg|ogv|vtt|srt)(?:$|\/)/i;
const READ_ROOTS = new Set(["shows", "show", "episode"]);

/** Electron's main-script loader does not always assign Node's require.main. */
function isDiagnosticEntry(argv, filename, nodeMain, electronRuntime) {
  if (nodeMain) return true;
  if (!electronRuntime || !Array.isArray(argv) || typeof argv[1] !== "string") return false;
  const canonical = raw => {
    const absolute = path.resolve(raw);
    return process.platform === "win32" ? absolute.toLowerCase() : absolute;
  };
  return canonical(argv[1]) === canonical(filename);
}

/** Minimal validation of the three reviewed, single-root catalogue queries. */
function readOperationDecision(query) {
  const rejected = rejectionDetail => ({ kind: null, rejectionDetail });
  if (query == null || query === "") return rejected("query-missing");
  if (typeof query !== "string") return rejected("query-type");
  if (query.length > 16_384) return rejected("query-size");
  if (query.includes('"""')) return rejected("query-block-string");
  const tokens = [];
  for (let at = 0; at < query.length;) {
    const char = query[at];
    if (/\s|,/.test(char)) { at++; continue; }
    if (char === "#") { while (at < query.length && query[at] !== "\n") at++; continue; }
    if (char === '"') {
      let ended = false;
      for (at++; at < query.length; at++) {
        if (query[at] === "\\") { at++; continue; }
        if (query[at] === '"') { at++; ended = true; break; }
      }
      if (!ended) return rejected("query-string");
      tokens.push('"string"');
    } else {
      const identifier = /^[A-Za-z_][A-Za-z_0-9]*/.exec(query.slice(at));
      if (identifier) { tokens.push(identifier[0]); at += identifier[0].length; }
      else if (/[$!():{}\[\].=@\-0-9]/.test(char)) { tokens.push(char); at++; }
      else return rejected("query-token");
    }
    if (tokens.length > 4096) return rejected("query-tokens");
  }
  if (tokens.some(token => ["mutation", "subscription"].includes(token))) return rejected("query-operation");
  let at = 0;
  function skip(open, close) {
    if (tokens[at] !== open) return false;
    let depth = 0;
    do { if (tokens[at] === open) depth++; if (tokens[at] === close) depth--; at++; }
    while (at < tokens.length && depth > 0);
    return depth === 0;
  }
  if (tokens[at] === "query") {
    at++;
    if (/^[A-Za-z_]/.test(tokens[at] ?? "")) at++; // Optional operation name.
    if (tokens[at] === "(" && !skip("(", ")")) return rejected("query-syntax");
  }
  if (tokens[at++] !== "{") return rejected("query-syntax");
  const root = tokens[at++];
  if (tokens[at] === ":") return rejected("root-alias"); // Still forbidden, regardless of the alias/root name.
  if (!READ_ROOTS.has(root)) return rejected("unreviewed-root");
  if (tokens[at] === "(" && !skip("(", ")")) return rejected("query-syntax");
  if (!skip("{", "}")) return rejected("root-selection");
  if (tokens[at++] !== "}") return rejected("root-selection");
  if (at !== tokens.length) return rejected("trailing-document"); // Exactly one root read.
  return { kind: root === "episode" ? "protected" : "catalogue", rejectionDetail: null };
}

function readOperation(query) {
  return readOperationDecision(query).kind;
}

function reviewedQueryHashes(documents) {
  const hashes = new Map();
  if (!Array.isArray(documents)) return hashes;
  for (const document of documents.slice(0, 128)) {
    const kind = readOperation(document);
    if (kind) hashes.set(createHash("sha256").update(document, "utf8").digest("hex"), kind);
  }
  return hashes;
}

function operationDecision(url, method, uploadData, reviewedHashes) {
  const rejected = rejectionDetail => ({ kind: null, rejectionDetail });
  if (["query", "extensions", "variables", "operationName"].some(name => url.searchParams.getAll(name).length > 1)) return rejected("url-body-mismatch");
  let query = url.searchParams.get("query");
  let extensions = url.searchParams.get("extensions");
  if (method === "POST") {
    if (!Array.isArray(uploadData) || !uploadData.length) return rejected("body-missing");
    if (uploadData.length > 4) return rejected("body-parts");
    let bytes = 0;
    const chunks = [];
    for (const part of uploadData) {
      if (part?.file) return rejected("body-file");
      if (part?.blobUUID) return rejected("body-blob");
      if (!Buffer.isBuffer(part?.bytes)) return rejected("body-bytes");
      bytes += part.bytes.length;
      if (bytes > 65_536) return rejected("body-size");
      chunks.push(part.bytes);
    }
    try {
      const payload = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
      if (Array.isArray(payload)) return rejected("body-array");
      if (!payload || typeof payload !== "object") return rejected("body-object");
      if (query != null && query !== payload.query) return rejected("url-body-mismatch");
      if (extensions != null && JSON.stringify(JSON.parse(extensions)) !== JSON.stringify(payload.extensions)) return rejected("url-body-mismatch");
      query = payload.query;
      extensions = payload.extensions;
    } catch { return rejected("body-json"); }
  }
  {
    // Exact content-addressed read documents only. No inference from variable
    // names, operation names, or an opaque website-provided hash.
    let shape = extensions;
    if (typeof shape === "string") {
      if (shape.length > 16_384) return rejected("persisted-query-mismatch");
      try { shape = JSON.parse(shape); } catch { return rejected("persisted-query-mismatch"); }
    }
    const persisted = shape && typeof shape === "object" && !Array.isArray(shape) ? shape.persistedQuery : null;
    if (persisted && typeof persisted === "object" && !Array.isArray(persisted)
      && persisted.version === 1 && typeof persisted.sha256Hash === "string" && /^[a-f0-9]{64}$/i.test(persisted.sha256Hash)) {
      const hash = persisted.sha256Hash.toLowerCase();
      if (query == null || query === "") {
        const kind = reviewedHashes?.get(hash);
        return kind === "catalogue" || kind === "protected" ? { kind, rejectionDetail: null } : rejected("persisted-query-only");
      }
      if (typeof query !== "string" || query.length > 16_384
        || createHash("sha256").update(query, "utf8").digest("hex") !== hash) return rejected("persisted-query-mismatch");
    } else if (persisted != null && query != null && query !== "") return rejected("persisted-query-mismatch");
  }
  return readOperationDecision(query);
}

/** Fixed reason enums only: no URL, query, method or website property is returned. */
function requestDecision(raw, method, resourceType, uploadData, reviewedHashes) {
  const allowed = kind => ({ kind, blockedReason: null });
  const blocked = blockedReason => ({ kind: "blocked", blockedReason });
  let url;
  if (typeof raw !== "string" || raw.length > 16_384) return blocked("invalid-url");
  try { url = new URL(raw); } catch { return blocked("invalid-url"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return blocked("unsafe-url");
  let decodedPath;
  try { decodedPath = decodeURIComponent(url.pathname); } catch { return blocked("invalid-path"); }
  if (["webSocket", "media", "object"].includes(resourceType) || MEDIA_PATH.test(decodedPath)) return blocked("media");
  if (url.origin === API) {
    if (["mainFrame", "subFrame", "script", "image"].includes(resourceType)) return blocked("api-surface");
    if (!["GET", "POST", "OPTIONS"].includes(method)) return blocked("api-method");
    if (FORBIDDEN_API.test(url.pathname)) return blocked("api-security-route");
    if (url.pathname === "/api") {
      if (method === "OPTIONS") return allowed("preflight");
      const operation = operationDecision(url, method, uploadData, reviewedHashes);
      return operation.kind ? allowed(operation.kind) : { ...blocked("api-query"), rejectionDetail: operation.rejectionDetail };
    }
    if (url.pathname === "/client-crypto/v1/bootstrap") return method === "OPTIONS" ? allowed("preflight")
      : method === "GET" ? allowed("bootstrap") : blocked("api-method");
    return blocked("api-route");
  }
  if (url.origin === HUMAN_CHECK) {
    return ["GET", "POST", "OPTIONS"].includes(method) && resourceType !== "mainFrame"
      ? allowed("human-check") : blocked("human-check-surface");
  }
  if (url.origin === SITE || url.origin === ASSET) {
    // Only the normal website's own Cloudflare surface may submit a human
    // verification result. The diagnostic never invokes/clicks that surface.
    if (url.origin === SITE && url.pathname.startsWith("/cdn-cgi/") && ["GET", "POST", "OPTIONS"].includes(method)) return allowed("human-check");
    if (ACCOUNT_PATH.test(url.pathname)) return blocked("account-route");
    if (method !== "GET") return blocked("site-method");
    if (resourceType === "subFrame") return blocked("frame");
    return allowed(url.origin === SITE ? "site" : "asset");
  }
  return blocked("origin");
}

function classifyRequest(raw, method, resourceType, uploadData) {
  return requestDecision(raw, method, resourceType, uploadData).kind;
}

function navigationAllowed(raw) {
  const kind = classifyRequest(raw, "GET", "mainFrame");
  if (kind === "site") return true;
  try { return kind === "human-check" && new URL(raw).origin === SITE && new URL(raw).pathname.startsWith("/cdn-cgi/"); }
  catch { return false; }
}

function apiReadStopReason(kind, counts, frozen) {
  if (kind === "preflight") return frozen ? "api-frozen" : null;
  if (!["catalogue", "protected", "bootstrap"].includes(kind)) return null;
  if (frozen) return "api-frozen";
  if (counts.api >= MAX_API_REQUESTS) return "api-limit";
  if (kind === "bootstrap" && counts.bootstrap >= 1) return "bootstrap-limit";
  if (kind === "protected" && counts.protected >= 1) return "protected-limit";
  return null;
}

function apiReadStopped(kind, counts, frozen) {
  return apiReadStopReason(kind, counts, frozen) !== null;
}

function recordedCount(value, maximum = MAX_RECORDED_COUNT) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(0, Math.floor(value))) : 0;
}

/** Count only fixed local reasons; never use website data as a report key. */
function countQueryRejection(counters, decision) {
  if (decision.blockedReason !== "api-query") return;
  const reason = QUERY_REJECTIONS.includes(decision.rejectionDetail)
    ? decision.rejectionDetail : "query-unclassified";
  counters[reason] = recordedCount(recordedCount(counters[reason]) + 1);
}

/** Project untrusted observations into a closed schema before retaining any data. */
function safeObservation(stage, seconds, detail = {}) {
  if (!OBSERVATION_STAGES.has(stage)) return null;
  const value = { stage, seconds: recordedCount(seconds, 86_400) };
  if (REQUEST_KINDS.has(detail.kind)) value.kind = detail.kind;
  if (Number.isInteger(detail.status) && detail.status >= 100 && detail.status <= 599) value.status = detail.status;
  if (Object.hasOwn(STOP_MESSAGES, detail.stopReason)) value.stopReason = detail.stopReason;
  if (Number.isInteger(detail.code) && detail.code >= -10_000 && detail.code <= 10_000) value.code = detail.code;
  if (SHAPE_FORMATS.has(detail.format) && typeof detail.gate === "boolean") {
    value.shape = { gate: detail.gate, format: detail.format };
    for (const name of ["data", "errors", "encrypted"]) if (typeof detail[name] === "boolean") value.shape[name] = detail[name];
  }
  return value;
}

function finalObservation({ seconds, finishReason, frozen, stopReason, counts, blockedReasons, apiQueryRejections, observations, observationsDropped }) {
  return {
    schemaVersion: 1,
    provider: "mkissa",
    seconds: recordedCount(seconds, 86_400),
    finishReason: FINISH_REASONS.has(finishReason) ? finishReason : "startup-error",
    frozen: frozen === true,
    stopReason: Object.hasOwn(STOP_MESSAGES, stopReason) ? stopReason : null,
    counts: Object.fromEntries(COUNT_NAMES.map(name => [name, recordedCount(counts?.[name])])),
    blockedReasons: Object.fromEntries(BLOCK_REASONS.map(name => [name, recordedCount(blockedReasons?.[name])])),
    apiQueryRejections: Object.fromEntries(QUERY_REJECTIONS.map(name => [name, recordedCount(apiQueryRejections?.[name])])),
    observations: (Array.isArray(observations) ? observations : []).slice(0, MAX_OBSERVATIONS).map(value =>
      safeObservation(value?.stage, value?.seconds, value && { ...value, ...value.shape })).filter(Boolean),
    observationsDropped: recordedCount(observationsDropped),
    protectedApiVerified: false,
    nativePlaybackVerified: false,
  };
}

/** Directory is created locally by this diagnostic, never supplied by the website. */
function saveObservation(directory, snapshot, fileSystem = fs) {
  const bytes = Buffer.from(JSON.stringify(finalObservation(snapshot), null, 2) + "\n", "utf8");
  if (bytes.length > MAX_REPORT_BYTES) throw new Error("Diagnostic report exceeded its fixed limit");
  // Exclusive creation prevents a close/watchdog race from replacing any file.
  const descriptor = fileSystem.openSync(path.join(directory, "observation.json"), "wx", 0o600);
  try {
    fileSystem.writeFileSync(descriptor, bytes);
    fileSystem.fsyncSync(descriptor);
  } finally { fileSystem.closeSync(descriptor); }
}

function responseShape(text, contentType) {
  if (text.trimStart().startsWith("<") && /cf-chl-|<title[^>]*>[^<]*(?:just a moment|attention required|verify.{0,20}human)|<form[^>]*(?:challenge|captcha)/i.test(text.slice(0, 65_536))) {
    return { gate: true, format: "security-page" };
  }
  if (/json/i.test(contentType) || /^[\[{]/.test(text.trimStart())) {
    try {
      const value = JSON.parse(text);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const messages = [];
        let gate = false;
        const inspectError = object => {
          if (!object || typeof object !== "object" || Array.isArray(object)) return;
          for (const name of ["message", "code", "status", "error", "error_code"]) {
            if (typeof object[name] === "string") messages.push(object[name].slice(0, 256));
            if (name !== "message" && [403, 429].includes(object[name])) gate = true;
          }
          for (const name of ["captcha_required", "fingerprint_required", "attestation_required", "pow_required", "rate_limited"]) {
            if ([true, 1, "1", "true"].includes(object[name])) gate = true;
          }
          if (typeof object.pow_token === "string" && object.pow_token) gate = true;
          if (object.extensions && typeof object.extensions === "object") {
            if (typeof object.extensions.code === "string") messages.push(object.extensions.code.slice(0, 256));
          }
        };
        inspectError(value);
        inspectError(value.error);
        for (const error of Array.isArray(value.errors) ? value.errors.slice(0, 16) : []) {
          if (typeof error === "string") messages.push(error.slice(0, 256));
          else inspectError(error);
        }
        gate ||= messages.some(message => ACCESS_GATE.test(message));
        // Fixed shape indicators only. Even arbitrary JSON property names can
        // contain sensitive upstream values, so never emit unreviewed names.
        return { gate, format: "json-object", data: Object.hasOwn(value, "data"),
          errors: Object.hasOwn(value, "errors"), encrypted: Object.hasOwn(value, "payload")
            || Object.hasOwn(value, "iv") || Object.hasOwn(value, "ciphertext")
            || (value.data && typeof value.data === "object" && Object.hasOwn(value.data, "tobeparsed")) || false };
      }
      return { gate: false, format: Array.isArray(value) ? "json-array" : "json-value" };
    } catch { return { gate: false, format: "invalid-json" }; }
  }
  return { gate: false, format: /html/i.test(contentType) ? "html" : "other" };
}

/** Response metadata has no request body: the before-request gate validated it. */
function apiResponseKind(raw, resourceType) {
  if (resourceType === "Preflight") return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.origin !== API || url.username || url.password) return null;
  if (url.pathname === "/client-crypto/v1/bootstrap") return "bootstrap";
  // Normal POST /api carries its reviewed query in uploadData rather than its
  // URL. Its body was already guard-reviewed, but this response-only observer
  // cannot infer which operation it was. Preserve a generic fixed kind rather
  // than mislabelling a protected POST response as catalogue or missing its gate.
  if (url.pathname === "/api") return readOperation(url.searchParams.get("query")) ?? "api-read";
  return null;
}

function observeApiBody(bytes, contentType, freeze) {
  if (bytes.length > MAX_BODY_BYTES) {
    freeze("response-limit");
    return null;
  }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { freeze("invalid-utf8"); return null; }
  const shape = responseShape(text, contentType);
  if (shape.gate) freeze("security-check");
  else if (["invalid-json", "html", "other", "json-array", "json-value"].includes(shape.format)) {
    freeze("unexpected-format");
  }
  return shape;
}

function selfTest() {
  const assert = require("node:assert/strict");
  assert.equal(isDiagnosticEntry(["electron", __filename, "--live"], __filename, false, true), true,
    "Electron main entry remains runnable when require.main is unset");
  assert.equal(isDiagnosticEntry(["node", __filename, "--self-test"], __filename, true, false), true);
  assert.equal(isDiagnosticEntry(["electron", path.join(__dirname, "another-main.js"), "--live"], __filename, false, true), false,
    "Importing this module from another Electron main must not launch it");
  assert.equal(isDiagnosticEntry(["node", __filename, "--live"], __filename, false, false), false,
    "A non-main Node import must never launch merely because argv resembles this script");
  assert.equal(isDiagnosticEntry(["electron"], __filename, false, true), false);
  const catalogue = "query ($search: SearchInput) { shows(search: $search) { edges { _id name } } }";
  const episode = "query ($showId: String!) { episode(showId: $showId) { sourceUrls show { _id } } }";
  const graphql = query => `${API}/api?query=${encodeURIComponent(query)}`;
  const upload = query => [{ bytes: Buffer.from(JSON.stringify({ query, variables: {} })) }];
  assert.equal(classifyRequest(`${SITE}/`, "GET", "mainFrame"), "site");
  assert.equal(classifyRequest(`${SITE}/assets/app.js`, "GET", "script"), "site");
  assert.equal(classifyRequest(graphql(catalogue), "GET", "xhr"), "catalogue");
  assert.equal(classifyRequest(`${API}/api`, "POST", "xhr", upload(catalogue)), "catalogue");
  assert.equal(classifyRequest(graphql(episode), "GET", "xhr"), "protected");
  assert.equal(classifyRequest(`${API}/client-crypto/v1/bootstrap`, "GET", "xhr"), "bootstrap");
  assert.equal(classifyRequest(`${API}/api`, "OPTIONS", "xhr"), "preflight");
  for (const query of ["mutation { verify(token: \"not permitted\") { ok } }", "subscription { shows { _id } }",
    "{ account { email } }", "{ verify { ok } }", "{ aliased: shows { _id } }", "{ shows { _id } account { email } }",
    "{ unknown { _id } }", "query { shows { _id }", "{ shows { _id } } mutation { verify { ok } }"]) {
    assert.equal(classifyRequest(graphql(query), "GET", "xhr"), "blocked");
    assert.equal(classifyRequest(`${API}/api`, "POST", "xhr", upload(query)), "blocked");
  }
  assert.equal(classifyRequest(`${API}/api`, "POST", "xhr"), "blocked");
  assert.equal(classifyRequest(`${API}/api`, "POST", "xhr", [{ file: "C:/private" }]), "blocked");
  assert.equal(classifyRequest(`${API}/api`, "POST", "xhr", [{ bytes: Buffer.alloc(65_537) }]), "blocked");
  const rejectionCases = [
    [undefined, "body-missing"],
    [Array.from({ length: 5 }, () => ({ bytes: Buffer.alloc(0) })), "body-parts"],
    [[{ file: "private-fixture" }], "body-file"],
    [[{ blobUUID: "private-fixture" }], "body-blob"],
    [[{ bytes: "private-fixture" }], "body-bytes"],
    [[{ bytes: Buffer.alloc(65_537) }], "body-size"],
    [[{ bytes: Buffer.from("not json") }], "body-json"],
    [[{ bytes: Buffer.from("[]") }], "body-array"],
    [[{ bytes: Buffer.from("null") }], "body-object"],
    [[{ bytes: Buffer.from("{}") }], "query-missing"],
    [[{ bytes: Buffer.from('{"query":false}') }], "query-type"],
    [[{ bytes: Buffer.from(JSON.stringify({ extensions: { persistedQuery: { version: 1, sha256Hash: "a".repeat(64) } } })) }],
      "persisted-query-only"],
    [upload(" ".repeat(16_385)), "query-size"],
    [upload('query { shows(filter: """private-fixture""") { _id } }'), "query-block-string"],
    [upload('{ shows(filter: "unfinished) { _id } }'), "query-string"],
    [upload("{ shows % { _id } }"), "query-token"],
    [upload("{ shows {" + " x".repeat(4100) + "} }"), "query-tokens"],
    [upload("mutation { verify { ok } }"), "query-operation"],
    [upload("query ($id: String! { shows { _id } }"), "query-syntax"],
    [upload("{ privateFixture: shows { _id } }"), "root-alias"],
    [upload("{ privateFixture { _id } }"), "unreviewed-root"],
    [upload("{ shows { _id }"), "root-selection"],
    [upload("{ shows { _id } } fragment privateFixture on Show { _id }"), "trailing-document"],
  ];
  const queryCounters = Object.fromEntries(QUERY_REJECTIONS.map(name => [name, 0]));
  for (const [body, reason] of rejectionCases) {
    const decision = requestDecision(`${API}/api`, "POST", "xhr", body);
    assert.deepEqual(decision, { kind: "blocked", blockedReason: "api-query", rejectionDetail: reason });
    countQueryRejection(queryCounters, decision);
    assert.equal(queryCounters[reason], 1);
  }
  const mismatch = requestDecision(graphql(catalogue), "POST", "xhr", upload(episode));
  assert.equal(mismatch.rejectionDetail, "url-body-mismatch");
  countQueryRejection(queryCounters, mismatch);
  const persistedUrl = `${API}/api?extensions=${encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: "a".repeat(64) } }))}`;
  assert.deepEqual(requestDecision(persistedUrl, "GET", "xhr"),
    { kind: "blocked", blockedReason: "api-query", rejectionDetail: "persisted-query-only" });
  for (const persistedQuery of [{ version: 2, sha256Hash: "a".repeat(64) }, { version: 1, sha256Hash: "private-fixture" }, []]) {
    const body = [{ bytes: Buffer.from(JSON.stringify({ extensions: { persistedQuery } })) }];
    assert.equal(requestDecision(`${API}/api`, "POST", "xhr", body).rejectionDetail, "query-missing");
  }
  countQueryRejection(queryCounters, { blockedReason: "api-query", rejectionDetail: "private-fixture" });
  assert.equal(queryCounters["query-unclassified"], 1);
  const beforeUnrelated = { ...queryCounters };
  countQueryRejection(queryCounters, { blockedReason: "origin", rejectionDetail: "body-missing" });
  assert.deepEqual(queryCounters, beforeUnrelated);
  queryCounters["body-missing"] = MAX_RECORDED_COUNT;
  countQueryRejection(queryCounters, { blockedReason: "api-query", rejectionDetail: "body-missing" });
  assert.equal(queryCounters["body-missing"], MAX_RECORDED_COUNT);
  assert.equal(classifyRequest(`${SITE}/cdn-cgi/challenge-platform/fixture`, "POST", "xhr"), "human-check");
  assert.equal(navigationAllowed(`${SITE}/cdn-cgi/challenge-platform/fixture`), true);
  assert.equal(navigationAllowed(`${HUMAN_CHECK}/`), false);
  assert.equal(navigationAllowed(`${SITE}/account`), false);
  for (const raw of ["file:///C:/private", "http://mkissa.to/", "https://mkissa.to:444/",
    "https://user:secret@mkissa.to/", `${SITE}/login`, `${API}/fingerprint`, `${API}/captcha/verify`,
    "https://other.example/embed/video", "https://127.0.0.1/private", `${ASSET}/profile`]) {
    assert.equal(classifyRequest(raw, "GET", "xhr"), "blocked");
  }
  assert.equal(classifyRequest(`${SITE}/video.mp4`, "GET", "media"), "blocked");
  assert.equal(classifyRequest(`${SITE}/embedded-player`, "GET", "subFrame"), "blocked");
  for (const suffix of ["m3u8", "mpd", "mp4", "ts", "m4s", "m4a", "webm", "vtt"]) {
    assert.equal(classifyRequest(`${SITE}/asset.${suffix}?signed=not-logged`, "GET", "xhr"), "blocked");
    assert.equal(classifyRequest(`${ASSET}/asset.${suffix}`, "GET", "script"), "blocked");
  }
  assert.equal(classifyRequest(`${SITE}/asset%2Emp4`, "GET", "xhr"), "blocked");
  assert.equal(classifyRequest(graphql(catalogue), "GET", "subFrame"), "blocked");
  assert.equal(classifyRequest(`${HUMAN_CHECK}/turnstile/script.js`, "GET", "script"), "human-check");
  assert.equal(classifyRequest(`${HUMAN_CHECK}/`, "GET", "mainFrame"), "blocked");
  assert.equal(responseShape('{"error":"CAPTCHA_REQUIRED","cookie":"private"}', "application/json").gate, true);
  for (const payload of [{ code: "NEED_CAPTCHA" }, { errors: [{ message: "NEED_CAPTCHA" }] },
    { captcha_required: true }, { captcha_required: 1 }, { error: { captcha_required: true } },
    { code: "TOO_MANY_REQUESTS" }, { errors: [{ extensions: { code: "TOO_MANY_REQUESTS" } }] },
    { error: "Rate limited" }, { message: "Too many requests" }, { status: 429 }, { error: { code: 403 } },
    { fingerprint_required: true }, { pow_required: 1 }]) {
    assert.equal(responseShape(JSON.stringify(payload), "application/json").gate, true);
  }
  for (const payload of [{ data: { title: "Captcha", description: "Just a moment; security check" } },
    { data: { error: "NEED_CAPTCHA", code: "TOO_MANY_REQUESTS" } }, { captcha_required: false },
    { data: { title: "Just a moment" } }]) {
    assert.equal(responseShape(JSON.stringify(payload), "application/json").gate, false);
  }
  assert.equal(responseShape("<html><title>Just a moment</title></html>", "text/html").gate, true);
  // Exercise the response route used by a real POST /api (no query in URL).
  // Its guard-approved read receives HTTP 200 with a structured denial; the
  // same body observer used below must freeze all future API traffic.
  assert.equal(apiResponseKind(`${API}/api`, "XHR"), "api-read");
  assert.equal(apiResponseKind(graphql(catalogue), "XHR"), "catalogue");
  assert.equal(apiResponseKind(graphql(episode), "XHR"), "protected");
  assert.equal(apiResponseKind(`${API}/api`, "Preflight"), null);
  let frozen = false;
  const postShape = observeApiBody(Buffer.from('{"errors":[{"message":"NEED_CAPTCHA"}]}'),
    "application/json", () => { frozen = true; });
  assert.equal(postShape.gate, true);
  assert.equal(frozen, true);
  const postKind = classifyRequest(`${API}/api`, "POST", "xhr", upload(catalogue));
  assert.equal(postKind, "catalogue");
  assert.equal(apiReadStopped(postKind, { api: 1, bootstrap: 0, protected: 0 }, frozen), true,
    "The live guard denies an otherwise-approved POST read after its 200 structured security gate");
  assert.equal(apiReadStopped("preflight", { api: 1, bootstrap: 0, protected: 0 }, frozen), true);
  assert.deepEqual(responseShape('{"data":{},"private-token":"not emitted"}', "application/json"),
    { gate: false, format: "json-object", data: true, errors: false, encrypted: false });
  assert.equal(JSON.stringify(responseShape('{"private-token":"never emitted"}', "application/json")).includes("private"), false);
  for (const [raw, method, type, reason] of [
    ["not a URL", "GET", "xhr", "invalid-url"],
    ["http://mkissa.to/", "GET", "xhr", "unsafe-url"],
    [`${SITE}/%XX`, "GET", "xhr", "invalid-path"],
    [`${SITE}/video.mp4`, "GET", "xhr", "media"],
    [graphql(catalogue), "GET", "script", "api-surface"],
    [`${API}/api`, "DELETE", "xhr", "api-method"],
    [`${API}/captcha/verify`, "GET", "xhr", "api-security-route"],
    [`${API}/api`, "POST", "xhr", "api-query"],
    [`${API}/unknown`, "GET", "xhr", "api-route"],
    [`${HUMAN_CHECK}/`, "GET", "mainFrame", "human-check-surface"],
    [`${SITE}/account`, "GET", "xhr", "account-route"],
    [`${SITE}/`, "POST", "xhr", "site-method"],
    [`${SITE}/player`, "GET", "subFrame", "frame"],
    ["https://other.example/", "GET", "xhr", "origin"],
  ]) {
    assert.deepEqual(requestDecision(raw, method, type), { kind: "blocked", blockedReason: reason,
      ...(reason === "api-query" ? { rejectionDetail: "body-missing" } : {}) });
  }
  assert.deepEqual(requestDecision(graphql(episode), "GET", "xhr"), { kind: "protected", blockedReason: null });
  assert.equal(apiReadStopReason("protected", { api: 1, bootstrap: 1, protected: 1 }, false), "protected-limit");
  assert.equal(apiReadStopReason("bootstrap", { api: 1, bootstrap: 1, protected: 0 }, false), "bootstrap-limit");
  assert.equal(apiReadStopReason("catalogue", { api: MAX_API_REQUESTS, bootstrap: 0, protected: 0 }, false), "api-limit");
  assert.equal(apiReadStopReason("preflight", { api: 0 }, true), "api-frozen");
  assert.equal(apiReadStopReason("site", { api: MAX_API_REQUESTS }, true), null);

  // Persistence accepts only locally specified fields/enums. These synthetic
  // secrets never become keys, strings, paths or booleans in the stored report.
  const secret = "fixture-cookie-token-secret";
  const snapshot = {
    seconds: Infinity, finishReason: secret, frozen: true, stopReason: secret,
    counts: { requests: -4, api: 1.8, bootstrap: Number.NaN, protected: 1, denied: 1, blocked: MAX_RECORDED_COUNT + 4,
      apiSuccess: 2, apiShapes: 1, [secret]: secret },
    blockedReasons: { "api-query": 2, "api-frozen": 3, [secret]: secret },
    apiQueryRejections: { "body-missing": -1, "root-alias": 2.8, "body-size": Infinity,
      "query-unclassified": MAX_RECORDED_COUNT + 1, [secret]: secret },
    observations: [
      { stage: "ordinary-website-api-shape", seconds: 2, kind: "protected", status: 200,
        shape: { gate: false, format: "json-object", data: true, errors: false, encrypted: true, [secret]: secret },
        url: `https://fixture.example/${secret}`, cookie: secret, headers: { Authorization: secret }, message: secret },
      { stage: "api-stopped", seconds: 3, stopReason: "security-check", reason: secret },
      { stage: "site-page-failed", seconds: 4, code: -105, error: secret },
      { stage: "site-page-loaded", seconds: -1, kind: secret, status: 60_000, stopReason: secret, code: Infinity },
      { stage: secret, seconds: 1, kind: "site" },
    ],
    observationsDropped: -1,
    protectedApiVerified: true, nativePlaybackVerified: true, [secret]: secret,
  };
  const final = finalObservation(snapshot);
  assert.equal(final.schemaVersion, 1);
  assert.equal(final.provider, "mkissa");
  assert.equal(final.finishReason, "startup-error");
  assert.equal(final.seconds, 0);
  assert.equal(final.stopReason, null);
  assert.equal(finalObservation({ ...snapshot, stopReason: "http-403" }).stopReason, "http-403");
  assert.deepEqual(safeObservation("ordinary-website-api-shape", 1, { kind: "api-read", status: 403 }),
    { stage: "ordinary-website-api-shape", seconds: 1, kind: "api-read", status: 403 });
  assert.equal(final.counts.api, 1);
  assert.equal(final.counts.requests, 0);
  assert.equal(final.counts.bootstrap, 0);
  assert.equal(final.counts.blocked, MAX_RECORDED_COUNT);
  assert.equal(final.blockedReasons["api-query"], 2);
  assert.deepEqual(final.observations[0], { stage: "ordinary-website-api-shape", seconds: 2, kind: "protected", status: 200,
    shape: { gate: false, format: "json-object", data: true, errors: false, encrypted: true } });
  assert.deepEqual(final.observations[1], { stage: "api-stopped", seconds: 3, stopReason: "security-check" });
  assert.deepEqual(final.observations[2], { stage: "site-page-failed", seconds: 4, code: -105 });
  assert.deepEqual(final.observations[3], { stage: "site-page-loaded", seconds: 0 });
  assert.equal(final.observations.length, 4);
  assert.equal(final.protectedApiVerified, false);
  assert.equal(final.nativePlaybackVerified, false);
  assert.equal(JSON.stringify(final).includes(secret), false);
  assert.deepEqual(Object.keys(final.counts), COUNT_NAMES);
  assert.deepEqual(Object.keys(final.blockedReasons), BLOCK_REASONS);
  assert.deepEqual(Object.keys(final.apiQueryRejections), QUERY_REJECTIONS);
  assert.equal(final.apiQueryRejections["body-missing"], 0);
  assert.equal(final.apiQueryRejections["root-alias"], 2);
  assert.equal(final.apiQueryRejections["body-size"], 0);
  assert.equal(final.apiQueryRejections["query-unclassified"], MAX_RECORDED_COUNT);
  assert.equal(safeObservation(secret, 0, snapshot), null);

  const maximumSnapshot = { ...snapshot, finishReason: "timeout", observationsDropped: MAX_RECORDED_COUNT,
    observations: Array.from({ length: MAX_OBSERVATIONS + 100 }, () => final.observations[0]) };
  assert.equal(finalObservation(maximumSnapshot).observations.length, MAX_OBSERVATIONS);
  const ioCalls = [];
  let stored;
  const fixtureFs = {
    openSync(filename, flags, mode) {
      ioCalls.push(["open", filename, flags, mode]);
      if (stored) { const collision = new Error(secret); collision.code = "EEXIST"; throw collision; }
      return 17;
    },
    writeFileSync(descriptor, bytes) { ioCalls.push(["write", descriptor]); stored = Buffer.from(bytes); },
    fsyncSync(descriptor) { ioCalls.push(["sync", descriptor]); },
    closeSync(descriptor) { ioCalls.push(["close", descriptor]); },
  };
  // Injected filesystem only: self-test neither creates a profile/file nor
  // launches Electron, accesses a browser, or sends website requests.
  const fixtureDirectory = path.join(os.tmpdir(), "anitrack-mkissa-self-test-placeholder");
  saveObservation(fixtureDirectory, maximumSnapshot, fixtureFs);
  assert.deepEqual(ioCalls, [["open", path.join(fixtureDirectory, "observation.json"), "wx", 0o600],
    ["write", 17], ["sync", 17], ["close", 17]]);
  assert.ok(stored.length < 64 * 1024);
  assert.equal(stored.toString("utf8").includes(secret), false);
  assert.equal(JSON.parse(stored.toString("utf8")).observations.length, MAX_OBSERVATIONS);
  const firstBytes = Buffer.from(stored);
  assert.throws(() => saveObservation(fixtureDirectory, snapshot, fixtureFs), { code: "EEXIST" });
  assert.deepEqual(stored, firstBytes, "Exclusive creation must leave an existing report unchanged");
  const failureCalls = [];
  assert.throws(() => saveObservation(fixtureDirectory, snapshot, {
    openSync: () => 18,
    writeFileSync: () => { throw new Error(secret); },
    fsyncSync: () => failureCalls.push("sync"),
    closeSync: descriptor => failureCalls.push(descriptor),
  }));
  assert.deepEqual(failureCalls, [18], "Close the report descriptor after an I/O failure");
  console.log("[mkissa-session] Offline guard, redaction and bounded exclusive-report checks passed; no website request or file was created.");
}

async function liveSession() {
  console.log('[mkissa-session] {"stage":"startup","message":"Explicit isolated-session diagnostic entered; no website request sent yet."}');
  let app, BrowserWindow, diagnosticDirectory;
  const counts = Object.fromEntries(COUNT_NAMES.map(name => [name, 0]));
  const blockedReasons = Object.fromEntries(BLOCK_REASONS.map(name => [name, 0]));
  const apiQueryRejections = Object.fromEntries(QUERY_REJECTIONS.map(name => [name, 0]));
  const observations = [];
  let observationsDropped = 0, reportSaved = false;
  let frozen = false, closed = false, firstStopReason = null;
  const started = Date.now();
  function saveFinal(finishReason) {
    if (reportSaved || !diagnosticDirectory) return;
    reportSaved = true;
    try {
      saveObservation(diagnosticDirectory, { seconds: Math.round((Date.now() - started) / 1000), finishReason,
        frozen, stopReason: firstStopReason, counts, blockedReasons, apiQueryRejections, observations, observationsDropped });
      console.log('[mkissa-session] {"stage":"report-saved","file":"observation.json"}');
    } catch {
      // Never export an I/O exception's potentially sensitive path or message.
      console.error('[mkissa-session] {"stage":"report-save-failed","reason":"local-io"}');
    }
  }
  const startupWatchdog = setTimeout(() => {
    console.error('[mkissa-session] {"stage":"startup-failed","message":"Electron did not become ready within 30 seconds; no website request was sent."}');
    saveFinal("startup-error");
    try { app?.exit(1); } finally { process.exit(1); }
  }, 30_000);
  try {
  try {
    ({ app, BrowserWindow } = require("electron"));
    if (!app) throw new Error("Run --live with the locally installed Electron executable, not Node.");
    diagnosticDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "anitrack-mkissa-session-"));
    app.setPath("userData", diagnosticDirectory);
    console.log('[mkissa-session] {"stage":"isolated-profile-ready","message":"Fresh diagnostic profile selected; awaiting Electron readiness."}');
    // Match the normal app browser identity. Never switch identities after denial.
    app.userAgentFallback = app.userAgentFallback.replace(/\s?Electron\/[\d.]+/i, "").replace(/\s?anitrack\/[\d.]+/i, "");
    await app.whenReady();
  } finally { clearTimeout(startupWatchdog); }
  console.log('[mkissa-session] {"stage":"electron-ready","message":"Preparing isolated window and request guards."}');
  // Bounded public text parsing only; no site code, API read, account session,
  // or player runs during this operation review. Any public access denial stops startup.
  const publicReview = await require("./mkissa-request-format-audit.cjs").loadPublicDocuments();
  const reviewedHashes = reviewedQueryHashes(publicReview.documents);
  console.log('[mkissa-session] ' + JSON.stringify({ stage: "read-operations-reviewed", count: reviewedHashes.size }));

  const window = new BrowserWindow({ width: 1000, height: 760, show: true,
    title: "MKissa isolated website check — interact with the website yourself",
    webPreferences: { partition: "mkissa-session-observation", nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false } });
  const contents = window.webContents;
  const isolated = contents.session;
  const requests = new Map();
  const responses = new Map();
  function report(stage, detail = {}) {
    const seconds = Math.round((Date.now() - started) / 1000);
    const observation = safeObservation(stage, seconds, detail);
    if (observation) {
      if (observations.length < MAX_OBSERVATIONS) observations.push(observation);
      else observationsDropped = recordedCount(observationsDropped + 1);
    }
    console.log("[mkissa-session] " + JSON.stringify({ stage, seconds, ...detail }));
  }
  function freeze(stopReason) {
    if (frozen) return;
    frozen = true;
    counts.denied++;
    const reason = Object.hasOwn(STOP_MESSAGES, stopReason) ? stopReason : "inspection-unavailable";
    firstStopReason = reason;
    report("api-stopped", { stopReason: reason, reason: STOP_MESSAGES[reason],
      message: "No protected API retry, token rotation or server fallback will be sent. Any website check is manual." });
  }
  function countBlock(reason) {
    if (Object.hasOwn(blockedReasons, reason)) blockedReasons[reason] = recordedCount(blockedReasons[reason] + 1);
  }
  function finish(finishReason = "user-closed") {
    if (closed) return;
    closed = true;
    clearTimeout(watchdog);
    report("session-ended", { counts, protectedApiVerified: false, nativePlaybackVerified: false,
      message: "Homepage/API HTTP observations only; no cookies, private tokens, account data or source URLs were exported." });
    saveFinal(finishReason);
    try { contents.debugger.detach(); } catch {}
    if (!window.isDestroyed()) window.destroy();
    app.quit();
  }
  const watchdog = setTimeout(() => finish("timeout"), MAX_SECONDS * 1000);
  contents.setAudioMuted(true);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.on("will-download", event => event.preventDefault());
  contents.on("will-navigate", (event, raw) => {
    if (!navigationAllowed(raw)) {
      counts.navigationBlocked++;
      countBlock("navigation");
      event.preventDefault();
    }
  });
  contents.on("will-redirect", (event, raw, _inPlace, oldMainFrame) => {
    const target = event.url ?? raw;
    const mainFrame = event.isMainFrame ?? oldMainFrame ?? true;
    if (mainFrame ? !navigationAllowed(target) : classifyRequest(target, "GET", "subFrame") !== "human-check") {
      counts.redirectBlocked++;
      countBlock("redirect");
      event.preventDefault();
    }
  });
  window.on("closed", () => finish("user-closed"));

  isolated.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    const decision = requestDecision(details.url, details.method, details.resourceType, details.uploadData, reviewedHashes);
    const kind = decision.kind;
    let blockedReason = decision.blockedReason;
    // Preserve the existing cap semantics: structurally blocked requests do
    // not increment `requests`; it counts guard-eligible attempts, not traffic.
    if (!blockedReason && ++counts.requests > MAX_REQUESTS) blockedReason = "request-limit";
    const apiStop = apiReadStopReason(kind, counts, frozen);
    if (apiStop) blockedReason = apiStop;
    const cancel = blockedReason !== null;
    if (["catalogue", "protected", "bootstrap"].includes(kind)) {
      if (!cancel) { counts.api++; if (kind === "bootstrap") counts.bootstrap++; if (kind === "protected") counts.protected++; }
    }
    if (cancel) { counts.blocked++; countBlock(blockedReason); countQueryRejection(apiQueryRejections, decision); }
    else requests.set(details.id, kind);
    callback({ cancel });
  });
  isolated.webRequest.onHeadersReceived({ urls: [`${SITE}/*`, `${API}/*`] }, (details, callback) => {
    const kind = requests.get(details.id);
    if ([403, 429].includes(details.statusCode) && ["catalogue", "protected", "bootstrap", "preflight"].includes(kind)) {
      freeze(details.statusCode === 403 ? "http-403" : "http-429");
    }
    callback({ cancel: false });
  });
  isolated.webRequest.onCompleted({ urls: [`${SITE}/*`, `${API}/*`] }, details => {
    const kind = requests.get(details.id);
    requests.delete(details.id);
    if (["catalogue", "protected", "bootstrap"].includes(kind)) {
      if (details.statusCode >= 200 && details.statusCode < 300) counts.apiSuccess++;
      report("ordinary-website-api-response", { kind, status: details.statusCode });
    }
  });

  // DevTools reads only bounded API response data to identify access gates and
  // shape. The before-request guard above validates bounded exposed query data;
  // no request payload, cookie, localStorage or private header is logged/exported.
  // Electron may not create a renderer until its first navigation. Initialise
  // an empty local page before attaching the observer, with all guards in place.
  // No website request is made before this bounded preparation succeeds.
  const observerWatchdog = setTimeout(() => {
    report("startup-stopped", { message: "The isolated browser observer did not initialise; no website request was sent." });
    finish("startup-stopped");
  }, 15_000);
  try {
    await window.loadURL("about:blank");
    contents.debugger.attach("1.3");
    await contents.debugger.sendCommand("Network.enable", { maxResourceBufferSize: MAX_BODY_BYTES,
      maxTotalBufferSize: MAX_BODY_BYTES * 4 });
  } finally { clearTimeout(observerWatchdog); }
  if (closed) return;
  contents.debugger.on("message", async (_event, method, params) => {
    if (closed) return;
    try {
      if (method === "Network.responseReceived") {
        const kind = apiResponseKind(params.response.url, params.type);
        if (!kind) return;
        const size = Number(params.response.headers?.["content-length"] ?? params.response.headers?.["Content-Length"] ?? 0);
        if (size > MAX_BODY_BYTES) { freeze("response-limit"); return; }
        responses.set(params.requestId, { kind, status: params.response.status, type: params.response.mimeType });
      } else if (method === "Network.loadingFinished") {
        const response = responses.get(params.requestId);
        responses.delete(params.requestId);
        if (!response || [403, 429].includes(response.status)) return;
        if (Number(params.encodedDataLength) > MAX_BODY_BYTES) { freeze("response-limit"); return; }
        const result = await contents.debugger.sendCommand("Network.getResponseBody", { requestId: params.requestId });
        if (closed) return;
        const bytes = result.base64Encoded ? Buffer.from(result.body, "base64") : Buffer.from(result.body, "utf8");
        const shape = observeApiBody(bytes, response.type, freeze);
        if (!shape) return;
        counts.apiShapes++;
        report("ordinary-website-api-shape", { kind: response.kind, status: response.status, ...shape });
      } else if (method === "Network.loadingFailed") responses.delete(params.requestId);
    } catch {
      if (closed) return;
      freeze("inspection-unavailable");
      report("observation-unavailable", { message: "A response could not be inspected; no retry was sent." });
    }
  });
  contents.on("did-finish-load", () => report("site-page-loaded", { homepageAccessOnly: true }));
  contents.on("did-fail-load", (_event, code, _description, _url, mainFrame) => {
    if (mainFrame && code !== -3) report("site-page-failed", { code });
  });
  report("session-opening", { message: "Complete any website check yourself. Do not sign in. Third-party player/ad frames, permissions and account routes are blocked. Close this window when finished." });
  await window.loadURL(`${SITE}/`, { extraHeaders: "Cache-Control: no-cache\n" }).catch(() => {});
  } catch (error) {
    saveFinal("startup-error");
    try { app?.quit(); } catch {}
    throw error;
  }
}

if (isDiagnosticEntry(process.argv, __filename, require.main === module, Boolean(process.versions.electron))) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-test") selfTest();
  else if (args.length === 1 && args[0] === "--live") liveSession().catch(() => {
    console.error('[mkissa-session] {"stage":"session-failed","reason":"local-startup"}');
    try { require("electron").app?.exit(1); } catch {}
    process.exitCode = 1;
  });
  else {
    console.log("Explicit opt-in required: --self-test is offline; --live opens one human-approved isolated MKissa website session.");
    process.exitCode = args.length ? 1 : 0;
  }
}

module.exports = { apiReadStopped, apiReadStopReason, apiResponseKind, classifyRequest, finalObservation, isDiagnosticEntry,
  navigationAllowed, observeApiBody, readOperation, requestDecision, reviewedQueryHashes, responseShape, safeObservation, saveObservation };
