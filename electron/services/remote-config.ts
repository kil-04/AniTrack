import { app, net } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import trust from "../../shared/automation-trust.json";
import {
  BUILTIN_RUNTIME_CONFIG,
  RuntimeConfig,
  RuntimeConfigStatus,
  RuntimeProviderConfig,
} from "../../shared/runtime-config";

type ConfigSource = RuntimeConfigStatus["source"];
type CacheFile = { json: string; signature: string; etag?: string };

const REFRESH_MS = 6 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];
const FETCH_TIMEOUT_MS = 12_000;
const MAX_CONFIG_BYTES = 128 * 1024;
const MAX_SIGNATURE_BYTES = 4 * 1024;
const MAX_LIST_ITEMS = 32;

let active: RuntimeConfig = BUILTIN_RUNTIME_CONFIG;
let source: ConfigSource = "built-in";
let lastCheckedAt: number | null = null;
let lastUpdatedAt: number | null = null;
let lastError: string | null = null;
let etag: string | undefined;
let refreshTimer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let retryAttempt = 0;
let refreshInFlight: Promise<RuntimeConfigStatus> | null = null;
const listeners = new Set<(status: RuntimeConfigStatus) => void>();

function resetRetry() {
  retryAttempt = 0;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry() {
  if (retryTimer) return;
  const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
  retryAttempt++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void refreshRuntimeConfig();
  }, delay);
  retryTimer.unref();
}

function cachePath(): string {
  return path.join(app.getPath("userData"), "runtime-config-cache.json");
}

function status(): RuntimeConfigStatus {
  return {
    revision: active.revision,
    source,
    lastCheckedAt,
    lastUpdatedAt,
    error: lastError,
    config: active,
  };
}

function publish(): RuntimeConfigStatus {
  const snapshot = status();
  for (const listener of listeners) {
    try { listener(snapshot); } catch {}
  }
  return snapshot;
}

function safeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host === "::1" || host.endsWith(".local")) return false;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
    const match = /^172\.(\d+)\./.exec(host);
    if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return false;
    return true;
  } catch {
    return false;
  }
}

function safeHttpsOrigin(value: unknown): value is string {
  if (!safeHttpsUrl(value)) return false;
  try {
    const url = new URL(value);
    return (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function assertKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) throw new Error(`${label} contains unsupported fields: ${extras.join(", ")}`);
}

function validateStringList(value: unknown, label: string, pattern: RegExp): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_LIST_ITEMS) {
    throw new Error(`${label} must contain 1-${MAX_LIST_ITEMS} items`);
  }
  const items = value.map((item) => {
    if (typeof item !== "string" || item.length > 120 || !pattern.test(item)) {
      throw new Error(`${label} contains an invalid value`);
    }
    return item.toLowerCase();
  });
  return [...new Set(items)];
}

function validateProviderRules(
  raw: Record<string, unknown>,
  label: string,
): Pick<RuntimeProviderConfig, "routes" | "selectors"> {
  if (!raw.routes || typeof raw.routes !== "object" || Array.isArray(raw.routes)) {
    throw new Error(`${label}.routes must be an object`);
  }
  const routes = raw.routes as Record<string, unknown>;
  const routeEntries = Object.entries(routes);
  if (routeEntries.length < 1 || routeEntries.length > MAX_LIST_ITEMS) {
    throw new Error(`${label}.routes must contain 1-${MAX_LIST_ITEMS} entries`);
  }
  const checkedRoutes: Record<string, string> = {};
  for (const [name, route] of routeEntries) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name)) {
      throw new Error(`${label}.routes contains an invalid name`);
    }
    if (typeof route !== "string" || route.length < 1 || route.length > 240 || !route.startsWith("/") ||
        route.includes("\\") || route.includes("://") || /[\r\n\0]/.test(route)) {
      throw new Error(`${label}.routes.${name} must be a bounded origin-relative route`);
    }
    const placeholders = [...route.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]);
    const remainder = route.replace(/\{[A-Za-z][A-Za-z0-9]*\}/g, "");
    if (placeholders.length > 16 || new Set(placeholders).size !== placeholders.length ||
        remainder.includes("{") || remainder.includes("}")) {
      throw new Error(`${label}.routes.${name} contains invalid placeholders`);
    }
    checkedRoutes[name] = route;
  }
  if (!raw.selectors || typeof raw.selectors !== "object" || Array.isArray(raw.selectors)) {
    throw new Error(`${label}.selectors must be an object`);
  }
  const selectors = raw.selectors as Record<string, unknown>;
  const selectorEntries = Object.entries(selectors);
  if (selectorEntries.length > MAX_LIST_ITEMS) {
    throw new Error(`${label}.selectors must contain at most ${MAX_LIST_ITEMS} entries`);
  }
  const checkedSelectors: Record<string, string> = {};
  for (const [name, selector] of selectorEntries) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ||
        typeof selector !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(selector)) {
      throw new Error(`${label}.selectors.${name} must be a safe HTML identifier`);
    }
    checkedSelectors[name] = selector;
  }
  return { routes: checkedRoutes, selectors: checkedSelectors };
}

function validateProvider(
  value: unknown,
  label: string,
): RuntimeProviderConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  const raw = value as Record<string, unknown>;
  assertKeys(raw, ["enabled", "baseUrls", "streamHostFragments", "mediaExtensions", "routes", "selectors"], label);
  if (typeof raw.enabled !== "boolean") throw new Error(`${label}.enabled must be boolean`);
  if (!Array.isArray(raw.baseUrls) || raw.baseUrls.length < 1 || raw.baseUrls.length > 8 ||
      raw.baseUrls.some((url) => !safeHttpsOrigin(url))) {
    throw new Error(`${label}.baseUrls must contain only public HTTPS URLs`);
  }
  const rules = validateProviderRules(raw, label);
  return {
    enabled: raw.enabled,
    baseUrls: [...new Set(raw.baseUrls as string[])].map((url) => url.replace(/\/+$/, "")),
    streamHostFragments: validateStringList(
      raw.streamHostFragments,
      `${label}.streamHostFragments`,
      /^(?:[a-z0-9][a-z0-9-]{4,61}|[a-z0-9][a-z0-9-]{4,61}\.|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/,
    ),
    mediaExtensions: validateStringList(
      raw.mediaExtensions,
      `${label}.mediaExtensions`,
      /^\.[a-z0-9]{1,8}$/,
    ),
    routes: rules.routes,
    selectors: rules.selectors,
  };
}

function validateConfig(json: string): RuntimeConfig {
  if (Buffer.byteLength(json, "utf8") > MAX_CONFIG_BYTES) throw new Error("configuration is too large");
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("configuration is invalid");
  const raw = parsed as Record<string, unknown>;
  assertKeys(raw, ["schemaVersion", "revision", "issuedAt", "providerOrder", "providers", "features", "notice"], "config");
  if (raw.schemaVersion !== 1) throw new Error("unsupported configuration schema");
  if (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1) throw new Error("invalid configuration revision");
  if (typeof raw.issuedAt !== "string" || !Number.isFinite(Date.parse(raw.issuedAt))) {
    throw new Error("invalid configuration timestamp");
  }
  if (!Array.isArray(raw.providerOrder) || raw.providerOrder.length < 1 ||
      raw.providerOrder.length > 16 || new Set(raw.providerOrder).size !== raw.providerOrder.length ||
      raw.providerOrder.some((item) => typeof item !== "string" || !/^[a-z][a-z0-9-]{1,31}$/.test(item))) {
    throw new Error("providerOrder must contain 1-16 unique provider ids");
  }
  if (!raw.providers || typeof raw.providers !== "object" || Array.isArray(raw.providers)) {
    throw new Error("providers are invalid");
  }
  const providers = raw.providers as Record<string, unknown>;
  const providerOrder = raw.providerOrder as string[];
  const providerNames = Object.keys(providers);
  if (providerNames.length !== providerOrder.length ||
      providerNames.some((provider) => !providerOrder.includes(provider))) {
    throw new Error("providers must contain exactly the ids in providerOrder");
  }
  const checkedProviders = Object.fromEntries(providerOrder.map((provider) => [
    provider,
    validateProvider(providers[provider], `providers.${provider}`),
  ]));
  if (!raw.features || typeof raw.features !== "object" || Array.isArray(raw.features)) {
    throw new Error("features are invalid");
  }
  const features = raw.features as Record<string, unknown>;
  const featureNames = ["anikotoStreaming", "animepaheStreaming", "downloads", "malSync", "gistSync"];
  assertKeys(features, featureNames, "features");
  for (const name of featureNames) {
    if (typeof features[name] !== "boolean") throw new Error(`features.${name} must be boolean`);
  }
  if (raw.notice !== null && (typeof raw.notice !== "string" || raw.notice.length > 500)) {
    throw new Error("notice is invalid");
  }
  return {
    schemaVersion: 1,
    revision: Number(raw.revision),
    issuedAt: raw.issuedAt,
    providerOrder,
    providers: checkedProviders,
    features: {
      anikotoStreaming: features.anikotoStreaming as boolean,
      animepaheStreaming: features.animepaheStreaming as boolean,
      downloads: features.downloads as boolean,
      malSync: features.malSync as boolean,
      gistSync: features.gistSync as boolean,
    },
    notice: raw.notice as string | null,
  };
}

function verify(json: string, signatureBase64: string): RuntimeConfig {
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(trust.publicKeySpkiBase64, "base64"),
    format: "der",
    type: "spki",
  });
  const valid = crypto.verify(
    "sha256",
    Buffer.from(json, "utf8"),
    publicKey,
    Buffer.from(signatureBase64.trim(), "base64"),
  );
  if (!valid) throw new Error("configuration signature is invalid");
  return validateConfig(json);
}

async function writeCache(file: CacheFile) {
  const target = cachePath();
  const temp = `${target}.tmp`;
  await fs.promises.writeFile(temp, JSON.stringify(file), { encoding: "utf8", mode: 0o600 });
  await fs.promises.rename(temp, target);
}

function loadCache() {
  try {
    const file = JSON.parse(fs.readFileSync(cachePath(), "utf8")) as CacheFile;
    const config = verify(file.json, file.signature);
    active = config;
    source = "cache";
    etag = file.etag;
    lastUpdatedAt = Date.now();
  } catch (error) {
    if (fs.existsSync(cachePath())) lastError = `Cached automation config ignored: ${(error as Error).message}`;
  }
}

async function readTextBounded(response: Response, maxBytes: number, label: string): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new Error(`${label} is too large`);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} is too large`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

async function fetchTextBounded(
  url: string,
  maxBytes: number,
  label: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; ok: boolean; text: string; etag?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await net.fetch(url, {
      headers: { Accept: "text/plain, application/json", "Cache-Control": "no-cache", ...headers },
      signal: controller.signal,
    });
    // Keep the same deadline active until the response body is fully consumed.
    // A server that sends headers and then stalls must not wedge refreshes forever.
    const text = response.status === 304 ? "" : await readTextBounded(response, maxBytes, label);
    return {
      status: response.status,
      ok: response.ok,
      text,
      etag: response.headers.get("etag") ?? undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function doRefresh(): Promise<RuntimeConfigStatus> {
  lastCheckedAt = Date.now();
  try {
    const response = await fetchTextBounded(
      trust.configUrl,
      MAX_CONFIG_BYTES,
      "configuration",
      etag ? { "If-None-Match": etag } : {},
    );
    if (response.status === 304) {
      lastError = null;
      resetRetry();
      return publish();
    }
    if (!response.ok) throw new Error(`configuration server returned HTTP ${response.status}`);
    const json = response.text;
    const signatureResponse = await fetchTextBounded(
      trust.configSignatureUrl,
      MAX_SIGNATURE_BYTES,
      "configuration signature",
    );
    if (!signatureResponse.ok) throw new Error(`signature server returned HTTP ${signatureResponse.status}`);
    const signature = signatureResponse.text;
    const next = verify(json, signature);
    if (next.revision < active.revision) throw new Error("configuration rollback was rejected");
    if (next.revision === active.revision && JSON.stringify(next) !== JSON.stringify(active)) {
      throw new Error("configuration changed without incrementing its revision");
    }
    const nextEtag = response.etag;
    if (next.revision > active.revision || source === "built-in") {
      await writeCache({ json, signature: signature.trim(), etag: nextEtag });
      active = next;
      source = "remote";
      etag = nextEtag;
      lastUpdatedAt = Date.now();
    }
    lastError = null;
    resetRetry();
  } catch (error) {
    lastError = (error as Error).message || "configuration refresh failed";
    scheduleRetry();
  }
  return publish();
}

export async function initRuntimeConfig(): Promise<RuntimeConfigStatus> {
  loadCache();
  if (!refreshTimer) {
    refreshTimer = setInterval(() => { void refreshRuntimeConfig(); }, REFRESH_MS);
    refreshTimer.unref();
  }
  // The cache is usable immediately. Refresh in the background so a slow or
  // unavailable control endpoint never delays the app window.
  void refreshRuntimeConfig();
  return status();
}

export function getRuntimeConfig(): RuntimeConfig {
  return active;
}

export function getRuntimeConfigStatus(): RuntimeConfigStatus {
  return status();
}

export function refreshRuntimeConfig(): Promise<RuntimeConfigStatus> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export function subscribeRuntimeConfig(listener: (status: RuntimeConfigStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
