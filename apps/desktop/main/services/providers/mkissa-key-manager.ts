import {
  bootTokenCandidates,
  deriveMaskCandidates,
  deriveMaterialKey,
  epochCandidates,
  type MkissaBuildInfo,
  type MkissaKeyMaterial,
} from "./mkissa-crypto";
import {
  extractMkissaAssetReferences,
  findMkissaAppEntry,
  parseMkissaBundle,
} from "./mkissa-bundle";
import {
  assertAllowedOrigin,
  classifyMkissaFailure,
  MkissaProviderError,
  normalizeHeaders,
  publicHttpsUrl,
  responseText,
  safeRedirectFetch,
  type MkissaFetch,
} from "./mkissa-utils";

const DEFAULT_SITE_ORIGIN = "https://mkissa.to";
const DEFAULT_API_ORIGIN = "https://api.mkissa.net";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
  + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const CONTENT_LANE = "k7";
const KEY_GROUP = "mkissa";

export interface MkissaKeyManagerOptions {
  fetch?: MkissaFetch;
  siteOrigin?: string;
  apiOrigin?: string;
  userAgent?: string;
  now?: () => number;
  materialTtlMs?: number;
  buildTtlMs?: number;
  requestTimeoutMs?: number;
  maxBuildChunks?: number;
  buildResolver?: () => Promise<MkissaBuildInfo>;
}

interface CachedBuild extends MkissaBuildInfo {
  expiresAt: number;
}

export class MkissaKeyManager {
  private readonly fetcher: MkissaFetch;
  private readonly siteOrigin: string;
  private readonly apiOrigin: string;
  private readonly userAgent: string;
  private readonly now: () => number;
  private readonly materialTtlMs: number;
  private readonly buildTtlMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxBuildChunks: number;
  private readonly buildResolver?: () => Promise<MkissaBuildInfo>;
  private readonly allowedAssetHosts: Set<string>;
  private readonly cookies = new Map<string, Map<string, string>>();

  private cachedMaterial: MkissaKeyMaterial | null = null;
  private materialPending: Promise<MkissaKeyMaterial> | null = null;
  private cachedBuild: CachedBuild | null = null;
  private buildPending: Promise<MkissaBuildInfo> | null = null;

  constructor(options: MkissaKeyManagerOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.siteOrigin = originOnly(options.siteOrigin ?? DEFAULT_SITE_ORIGIN);
    this.apiOrigin = originOnly(options.apiOrigin ?? DEFAULT_API_ORIGIN);
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.now = options.now ?? Date.now;
    this.materialTtlMs = boundedPositive(options.materialTtlMs, 6 * 60 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000);
    this.buildTtlMs = boundedPositive(options.buildTtlMs, 30 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000);
    this.requestTimeoutMs = boundedPositive(options.requestTimeoutMs, 10_000, 1_000, 60_000);
    this.maxBuildChunks = boundedPositive(options.maxBuildChunks, 40, 1, 100);
    this.buildResolver = options.buildResolver;
    this.allowedAssetHosts = new Set([
      new URL(this.siteOrigin).hostname,
      "cdn.mkissa.net",
    ]);
  }

  async material(forceRefresh = false): Promise<MkissaKeyMaterial> {
    if (forceRefresh) this.cachedMaterial = null;
    const cached = this.cachedMaterial;
    if (cached && this.now() < cached.expiresAt) return cached;
    if (this.materialPending) return this.materialPending;
    const pending = this.loadMaterial();
    this.materialPending = pending;
    pending.finally(() => {
      if (this.materialPending === pending) this.materialPending = null;
    }).catch(() => {});
    return pending;
  }

  invalidate(): void {
    this.cachedMaterial = null;
  }

  invalidateBuild(): void {
    this.cachedMaterial = null;
    this.cachedBuild = null;
  }

  private async loadMaterial(): Promise<MkissaKeyMaterial> {
    const build = await this.resolveBuild();
    const masks = deriveMaskCandidates(build);
    if (masks.length === 0) {
      throw new MkissaProviderError("MKissa client mask format changed", "CRYPTO_STALE");
    }

    const host = new URL(this.siteOrigin).hostname;
    let sawStaleResponse = false;
    for (const epoch of epochCandidates(this.now())) {
      for (const mask of masks) {
        const tokens = bootTokenCandidates(
          mask,
          build.buildId,
          epoch,
          KEY_GROUP,
          host,
          CONTENT_LANE,
          build.cryptoScheme,
        );
        for (const token of tokens) {
          const endpoint = new URL("/client-crypto/v1/bootstrap", this.apiOrigin);
          endpoint.searchParams.set("buildId", build.buildId);
          endpoint.searchParams.set("k", CONTENT_LANE);
          const response = await this.request(endpoint, {
            headers: {
              Accept: "application/json",
              Origin: this.siteOrigin,
              Referer: `${this.siteOrigin}/`,
              "x-build-id": build.buildId,
              "x-aa-boot": token,
            },
          });
          if (response.status === 403 || response.status === 404) {
            sawStaleResponse = true;
            continue;
          }
          const classified = classifyMkissaFailure([], response.status);
          if (classified) throw classified;
          if (!response.ok) {
            throw new MkissaProviderError(
              `MKissa key service failed (${response.status})`,
              "INVALID_RESPONSE",
              response.status,
            );
          }
          const body = await responseText(response, 64 * 1024, "MKissa key service");
          const payload = parseObject(body, "MKissa key service");
          if (typeof payload.partB !== "string" || (payload.k != null && payload.k !== CONTENT_LANE)) continue;
          const partB = decodeBase64(payload.partB);
          const returnedEpoch = Number(payload.epoch);
          if (!partB || partB.length < 32 || !Number.isSafeInteger(returnedEpoch) || returnedEpoch <= 0) continue;
          const material: MkissaKeyMaterial = {
            key: deriveMaterialKey(mask, partB),
            epoch: returnedEpoch,
            buildId: build.buildId,
            expiresAt: this.now() + this.materialTtlMs,
          };
          this.cachedMaterial = material;
          return material;
        }
      }
    }
    if (sawStaleResponse) this.invalidateBuild();
    throw new MkissaProviderError("MKissa rejected the current client build", "CRYPTO_STALE");
  }

  private async resolveBuild(): Promise<MkissaBuildInfo> {
    const cached = this.cachedBuild;
    if (cached && this.now() < cached.expiresAt) {
      const { expiresAt: _expiresAt, ...build } = cached;
      return build;
    }
    if (this.buildPending) return this.buildPending;
    const pending = (this.buildResolver ? this.buildResolver() : this.discoverBuild())
      .then((build) => {
        if (!/^\d{2,10}$/.test(build.buildId) || build.seeds.length !== 4) {
          throw new MkissaProviderError("MKissa client build metadata was invalid", "CRYPTO_STALE");
        }
        this.cachedBuild = { ...build, expiresAt: this.now() + this.buildTtlMs };
        return build;
      });
    this.buildPending = pending;
    pending.finally(() => {
      if (this.buildPending === pending) this.buildPending = null;
    }).catch(() => {});
    return pending;
  }

  private async discoverBuild(): Promise<MkissaBuildInfo> {
    const homeResponse = await this.request(new URL("/", this.siteOrigin), {
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!homeResponse.ok) {
      throw new MkissaProviderError(
        `MKissa site bootstrap failed (${homeResponse.status})`,
        "INVALID_RESPONSE",
        homeResponse.status,
      );
    }
    const html = await responseText(homeResponse, 5 * 1024 * 1024, "MKissa home page");
    const entry = findMkissaAppEntry(html, this.siteOrigin);
    if (!entry) throw new MkissaProviderError("MKissa application entry was not found", "CRYPTO_STALE");
    const entryUrl = publicHttpsUrl(entry);
    assertAllowedOrigin(entryUrl, this.allowedAssetHosts);

    const queue = [entryUrl.toString()];
    const visited = new Set<string>();
    while (queue.length > 0 && visited.size < this.maxBuildChunks) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const assetUrl = publicHttpsUrl(current);
      assertAllowedOrigin(assetUrl, this.allowedAssetHosts);
      const response = await this.request(assetUrl, { headers: { Accept: "application/javascript" } });
      if (!response.ok) continue;
      const source = await responseText(response, 25 * 1024 * 1024, "MKissa application asset");
      if (/aaReq|x-aa-boot|client-crypto|partB/.test(source)) {
        const build = parseMkissaBundle(source);
        if (build) return build;
      }
      for (const reference of extractMkissaAssetReferences(source, assetUrl.toString())) {
        try {
          const child = publicHttpsUrl(reference);
          assertAllowedOrigin(child, this.allowedAssetHosts);
          if (!visited.has(child.toString())) queue.push(child.toString());
        } catch {
          // Ignore imported assets outside the explicit MKissa asset allowlist.
        }
      }
    }
    throw new MkissaProviderError("MKissa client key bundle was not found", "CRYPTO_STALE");
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    const parsed = publicHttpsUrl(url.toString());
    const allowed = new Set([new URL(this.siteOrigin).hostname, new URL(this.apiOrigin).hostname, ...this.allowedAssetHosts]);
    assertAllowedOrigin(parsed, allowed);
    const headers = normalizeHeaders(init.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", this.userAgent);
    if (!headers.has("Accept-Language")) headers.set("Accept-Language", "en-US,en;q=0.9");
    const cookie = [...(this.cookies.get(parsed.hostname) ?? [])]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    if (cookie) headers.set("Cookie", cookie);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await safeRedirectFetch(
        this.fetcher,
        parsed,
        { ...init, headers, signal: controller.signal },
        (candidate) => assertAllowedOrigin(candidate, allowed),
      );
      const finalUrl = response.url ? publicHttpsUrl(response.url) : parsed;
      assertAllowedOrigin(finalUrl, allowed);
      this.rememberCookies(finalUrl.hostname, response.headers);
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private rememberCookies(hostname: string, headers: Headers): void {
    const hostCookies = this.cookies.get(hostname) ?? new Map<string, string>();
    const extended = headers as Headers & { getSetCookie?: () => string[] };
    const raw = extended.getSetCookie?.() ?? [headers.get("set-cookie")].filter((value): value is string => !!value);
    for (const header of raw) {
      for (const part of header.split(/,(?=[^;,]+=)/)) {
        const pair = part.split(";", 1)[0]?.trim();
        const separator = pair?.indexOf("=") ?? -1;
        if (separator <= 0) continue;
        const name = pair!.slice(0, separator);
        const value = pair!.slice(separator + 1);
        if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) && !/[;\r\n]/.test(value)) {
          if (value) hostCookies.set(name, value);
          else hostCookies.delete(name);
        }
      }
    }
    if (hostCookies.size > 0) this.cookies.set(hostname, hostCookies);
    else this.cookies.delete(hostname);
  }
}

function originOnly(value: string): string {
  const parsed = publicHttpsUrl(value);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new MkissaProviderError("MKissa origin must not contain a path", "UNSAFE_URL");
  }
  return parsed.origin;
}

function boundedPositive(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.floor(value!))) : fallback;
}

function parseObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* handled below */ }
  throw new MkissaProviderError(`${label} returned invalid JSON`, "INVALID_RESPONSE");
}

function decodeBase64(value: string): Buffer | null {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : null;
}
