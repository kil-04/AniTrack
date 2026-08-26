const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const TRUST_PATH = path.join(ROOT, "shared", "automation-trust.json");
const CONFIG_PATH = path.join(ROOT, "automation", "remote-config.json");
const CONFIG_SIG_PATH = path.join(ROOT, "automation", "remote-config.sig");
const UPDATE_PATH = path.join(ROOT, "automation", "android-update.json");
const UPDATE_SIG_PATH = path.join(ROOT, "automation", "android-update.sig");

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at < 1) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadLocalEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const values = parseEnv(fs.readFileSync(ENV_PATH, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function setEnvValue(key, value) {
  const original = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const lines = original ? original.split(/\r?\n/) : [];
  const index = lines.findIndex((line) => line.trimStart().startsWith(`${key}=`));
  const replacement = `${key}=${value}`;
  if (index >= 0) lines[index] = replacement;
  else {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(replacement);
  }
  fs.writeFileSync(ENV_PATH, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
}

function privateKey() {
  loadLocalEnv();
  const encoded = process.env.ANITRACK_AUTOMATION_PRIVATE_KEY_B64;
  if (!encoded) {
    throw new Error("ANITRACK_AUTOMATION_PRIVATE_KEY_B64 is missing. Run npm run automation:keygen.");
  }
  return crypto.createPrivateKey({
    key: Buffer.from(encoded, "base64"),
    format: "der",
    type: "pkcs8",
  });
}

function publicKey() {
  if (!fs.existsSync(TRUST_PATH)) {
    throw new Error("shared/automation-trust.json is missing. Run npm run automation:keygen.");
  }
  const trust = JSON.parse(fs.readFileSync(TRUST_PATH, "utf8"));
  return crypto.createPublicKey({
    key: Buffer.from(trust.publicKeySpkiBase64, "base64"),
    format: "der",
    type: "spki",
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, expected, label) {
  assert(isPlainObject(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(
    actual.length === wanted.length && actual.every((key, index) => key === wanted[index]),
    `${label} must contain exactly: ${wanted.join(", ")}`,
  );
}

function assertIsoDate(value, label) {
  assert(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value),
    `${label} must be an ISO-8601 UTC timestamp`);
  assert(Number.isFinite(Date.parse(value)), `${label} is not a valid date`);
}

function assertPositiveInteger(value, label) {
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer`);
}

function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return octets[0] === 10 || octets[0] === 127 || octets[0] === 0 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function assertHttpsUrl(value, label, { originOnly = false, apk = false } = {}) {
  assert(typeof value === "string" && value.length <= 2048, `${label} must be a string no longer than 2048 characters`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a valid URL`); }
  assert(url.protocol === "https:", `${label} must use HTTPS`);
  assert(!url.username && !url.password, `${label} must not contain credentials`);
  assert(!isPrivateHostname(url.hostname), `${label} must not target a private or local host`);
  if (originOnly) {
    assert((url.pathname === "/" || url.pathname === "") && !url.search && !url.hash,
      `${label} must be an HTTPS origin without a path, query, or fragment`);
  }
  if (apk) {
    assert(url.pathname.toLowerCase().endsWith(".apk"), `${label} must point to an APK`);
    assert(url.hostname.toLowerCase() === "github.com" || url.hostname.toLowerCase() === "objects.githubusercontent.com",
      `${label} must use a trusted GitHub download host`);
  }
  return url;
}

function validateProviderRules(value, providerLabel) {
  assert(isPlainObject(value.routes),
    `${providerLabel}.routes must be an object`);
  const routeEntries = Object.entries(value.routes);
  assert(routeEntries.length >= 1 && routeEntries.length <= 32,
    `${providerLabel}.routes must contain 1-32 entries`);
  for (const [name, route] of routeEntries) {
    assert(/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name),
      `${providerLabel}.routes contains an invalid name`);
    assert(typeof route === "string" && route.length >= 1 && route.length <= 240 && route.startsWith("/") &&
      !route.includes("\\") && !route.includes("://") && !/[\r\n\0]/.test(route),
    `${providerLabel}.routes.${name} must be a bounded origin-relative route`);
    const placeholders = [...route.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]);
    const remainder = route.replace(/\{[A-Za-z][A-Za-z0-9]*\}/g, "");
    assert(placeholders.length <= 16 && new Set(placeholders).size === placeholders.length &&
      !remainder.includes("{") && !remainder.includes("}"),
    `${providerLabel}.routes.${name} contains invalid placeholders`);
  }
  assert(isPlainObject(value.selectors),
    `${providerLabel}.selectors must be an object`);
  const selectorEntries = Object.entries(value.selectors);
  assert(selectorEntries.length <= 32,
    `${providerLabel}.selectors must contain at most 32 entries`);
  for (const [name, selector] of selectorEntries) {
    assert(/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) &&
      typeof selector === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(selector),
      `${providerLabel}.selectors.${name} must be a safe HTML identifier`);
  }
}

function validateRemoteConfig(config, label = "remote config") {
  assertExactKeys(config,
    ["schemaVersion", "revision", "issuedAt", "providerOrder", "providers", "features", "notice"], label);
  assert(config.schemaVersion === 1, `${label}.schemaVersion must be 1`);
  assertPositiveInteger(config.revision, `${label}.revision`);
  assertIsoDate(config.issuedAt, `${label}.issuedAt`);

  assert(Array.isArray(config.providerOrder) && config.providerOrder.length >= 1 &&
    config.providerOrder.length <= 16 && new Set(config.providerOrder).size === config.providerOrder.length &&
    config.providerOrder.every((provider) =>
      typeof provider === "string" && /^[a-z][a-z0-9-]{1,31}$/.test(provider)),
  `${label}.providerOrder must contain 1-16 unique provider ids`);
  const providerNames = config.providerOrder;
  assertExactKeys(config.providers, providerNames, `${label}.providers`);
  for (const provider of providerNames) {
    const value = config.providers[provider];
    const providerLabel = `${label}.providers.${provider}`;
    assertExactKeys(value, ["enabled", "baseUrls", "streamHostFragments", "mediaExtensions", "routes", "selectors"], providerLabel);
    assert(typeof value.enabled === "boolean", `${providerLabel}.enabled must be boolean`);
    assert(Array.isArray(value.baseUrls) && value.baseUrls.length > 0 && value.baseUrls.length <= 8,
      `${providerLabel}.baseUrls must contain 1-8 URLs`);
    value.baseUrls.forEach((url, index) => assertHttpsUrl(url, `${providerLabel}.baseUrls[${index}]`, { originOnly: true }));
    assert(new Set(value.baseUrls).size === value.baseUrls.length, `${providerLabel}.baseUrls must not contain duplicates`);
    assert(Array.isArray(value.streamHostFragments) && value.streamHostFragments.length >= 1 && value.streamHostFragments.length <= 32,
      `${providerLabel}.streamHostFragments must contain 1-32 entries`);
    const domain = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
    const hostPrefix = /^[a-z0-9][a-z0-9-]{4,61}\.$/i;
    const rotatingHostFamily = /^[a-z0-9][a-z0-9-]{4,61}$/i;
    value.streamHostFragments.forEach((fragment, index) => assert(
      typeof fragment === "string" && fragment.length <= 120 &&
        (domain.test(fragment) || hostPrefix.test(fragment) || rotatingHostFamily.test(fragment)),
      `${providerLabel}.streamHostFragments[${index}] is invalid`,
    ));
    assert(new Set(value.streamHostFragments.map((value) => value.toLowerCase())).size === value.streamHostFragments.length,
      `${providerLabel}.streamHostFragments must not contain duplicates`);
    assert(Array.isArray(value.mediaExtensions) && value.mediaExtensions.length >= 1 && value.mediaExtensions.length <= 32,
      `${providerLabel}.mediaExtensions must contain 1-32 entries`);
    value.mediaExtensions.forEach((extension, index) => assert(
      typeof extension === "string" && extension.length <= 120 && /^\.[a-z0-9]{1,8}$/i.test(extension),
      `${providerLabel}.mediaExtensions[${index}] is invalid`,
    ));
    assert(new Set(value.mediaExtensions.map((value) => value.toLowerCase())).size === value.mediaExtensions.length,
      `${providerLabel}.mediaExtensions must not contain duplicates`);
    validateProviderRules(value, providerLabel);
  }

  const featureNames = ["anikotoStreaming", "animepaheStreaming", "downloads", "malSync", "gistSync"];
  assertExactKeys(config.features, featureNames, `${label}.features`);
  for (const feature of featureNames) {
    assert(typeof config.features[feature] === "boolean", `${label}.features.${feature} must be boolean`);
  }
  assert(config.notice === null || (typeof config.notice === "string" && config.notice.length <= 500),
    `${label}.notice must be null or a string no longer than 500 characters`);
  return config;
}

function validateAndroidUpdate(update, label = "Android update manifest") {
  assertExactKeys(update,
    ["schemaVersion", "sequence", "issuedAt", "applicationId", "versionCode", "versionName", "apkUrl", "sha256", "sizeBytes", "mandatory", "notes"],
    label);
  assert(update.schemaVersion === 1, `${label}.schemaVersion must be 1`);
  assertPositiveInteger(update.sequence, `${label}.sequence`);
  assertPositiveInteger(update.versionCode, `${label}.versionCode`);
  assert(update.sequence === update.versionCode, `${label}.sequence must equal versionCode`);
  assertIsoDate(update.issuedAt, `${label}.issuedAt`);
  assert(update.applicationId === "com.sanjay.anitrack.next",
    `${label}.applicationId must be com.sanjay.anitrack.next`);
  assert(typeof update.versionName === "string" && update.versionName.length <= 40 &&
    /^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(update.versionName),
    `${label}.versionName is invalid`);
  assertHttpsUrl(update.apkUrl, `${label}.apkUrl`, { apk: true });
  assert(typeof update.sha256 === "string" && /^[a-f0-9]{64}$/.test(update.sha256),
    `${label}.sha256 must be a lowercase SHA-256 digest`);
  assert(Number.isSafeInteger(update.sizeBytes) && update.sizeBytes >= 1_000_000 && update.sizeBytes <= 250 * 1024 * 1024,
    `${label}.sizeBytes must be between 1 MB and 250 MB`);
  assert(typeof update.mandatory === "boolean", `${label}.mandatory must be boolean`);
  assert(typeof update.notes === "string" && update.notes.length <= 2000,
    `${label}.notes must be a string no longer than 2000 characters`);
  return update;
}

function readJsonFile(file, validator, label = file) {
  const raw = fs.readFileSync(file, "utf8");
  const maxBytes = validator === validateRemoteConfig ? 128 * 1024 :
    validator === validateAndroidUpdate ? 64 * 1024 : null;
  if (maxBytes !== null && Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new Error(`${label} exceeds the client limit of ${maxBytes} bytes`);
  }
  let value;
  try { value = JSON.parse(raw); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
  return validator(value, label);
}

function signBytes(bytes) {
  return crypto.sign("sha256", bytes, privateKey()).toString("base64");
}

function verifyBytes(bytes, signatureBase64) {
  return crypto.verify("sha256", bytes, publicKey(), Buffer.from(signatureBase64.trim(), "base64"));
}

function signFile(input, output) {
  const bytes = fs.readFileSync(input);
  fs.writeFileSync(output, signBytes(bytes) + "\n");
}

function verifyFile(input, signature) {
  return verifyBytes(fs.readFileSync(input), fs.readFileSync(signature, "utf8"));
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

module.exports = {
  ROOT,
  ENV_PATH,
  TRUST_PATH,
  CONFIG_PATH,
  CONFIG_SIG_PATH,
  UPDATE_PATH,
  UPDATE_SIG_PATH,
  loadLocalEnv,
  setEnvValue,
  signFile,
  signBytes,
  verifyFile,
  verifyBytes,
  sha256File,
  validateRemoteConfig,
  validateAndroidUpdate,
  readJsonFile,
};
