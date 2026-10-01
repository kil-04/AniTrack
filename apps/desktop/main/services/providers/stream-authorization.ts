import type { StreamData } from "./types";

export type StreamAuthorizationScope = "exact" | "directory";

export interface StreamAuthorizationOptions {
  headers?: Record<string, string>;
  referer?: string;
  cookie?: string;
  scope?: StreamAuthorizationScope;
  cors?: boolean;
}

export interface StreamAuthorization {
  host: string;
  referer: string;
  cookie: string;
  headers: Record<string, string>;
  cors: boolean;
}

interface StoredAuthorization extends StreamAuthorization {
  origin: string;
  exactUrl: string | null;
  pathPrefix: string;
  authorizedAt: number;
}

const BLOCKED_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "proxy-authorization",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);

function safeHeaders(input: Record<string, string> | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(input ?? {})) {
    const normalized = name.trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/.test(normalized)) continue;
    if (BLOCKED_HEADERS.has(normalized.toLowerCase())) continue;
    if (typeof value !== "string" || value.length > 8192 || /[\r\n\0]/.test(value)) continue;
    output[normalized] = value;
  }
  return output;
}

function assertStreamUrl(raw: string): URL {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || !hostname || isPrivateHostname(hostname)) {
    throw new Error("Stream authorization requires a trusted HTTPS URL");
  }
  url.hash = "";
  return url;
}

function isPrivateHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")
    || hostname.endsWith(".local") || hostname.endsWith(".internal")) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((value) => value > 255)) return true;
    const [first, second] = octets;
    return first === 0 || first === 10 || first === 127 || first >= 224
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && (second === 0 || second === 168))
      || (first === 198 && (second === 18 || second === 19));
  }
  if (!hostname.includes(":")) return false;
  const compact = hostname.replace(/^0+(?=:)/, "");
  return compact === "::" || compact === "::1" || compact.startsWith("fc")
    || compact.startsWith("fd") || compact.startsWith("fe8") || compact.startsWith("fe9")
    || compact.startsWith("fea") || compact.startsWith("feb") || compact.startsWith("::ffff:");
}

/**
 * Keeps hotlink credentials scoped to one resolved stream. Directory-scoped
 * entries cover an HLS manifest and its relative variants/segments, while an
 * exact entry is useful for a single MP4 or embed URL. Credentials are never
 * authorized merely because another stream used the same shared CDN host.
 */
export class StreamAuthorizationRegistry {
  private readonly entries = new Map<string, StoredAuthorization>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs: number, maxEntries = 500) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  remember(raw: string, referer: string, cookie: string, now?: number): void;
  remember(raw: string, options: StreamAuthorizationOptions, now?: number): void;
  remember(
    raw: string,
    refererOrOptions: string | StreamAuthorizationOptions,
    cookieOrNow: string | number = "",
    legacyNow = Date.now(),
  ): void {
    const url = assertStreamUrl(raw);
    const legacy = typeof refererOrOptions === "string";
    const options: StreamAuthorizationOptions = legacy
      ? { referer: refererOrOptions, cookie: typeof cookieOrNow === "string" ? cookieOrNow : "" }
      : refererOrOptions;
    const now = legacy
      ? legacyNow
      : typeof cookieOrNow === "number" ? cookieOrNow : Date.now();
    const scope = options.scope ?? "directory";
    const pathPrefix = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
    const exactUrl = scope === "exact" ? url.toString() : null;
    const key = exactUrl ? `exact:${exactUrl}` : `directory:${url.origin}${pathPrefix}`;
    const referer = options.referer?.trim().replace(/\/$/, "") ?? "";
    const cookie = options.cookie?.trim() ?? "";
    const headers = safeHeaders(options.headers);
    if (referer) {
      headers.Referer ??= `${referer}/`;
      try { headers.Origin ??= new URL(referer).origin; } catch { /* invalid referer is ignored */ }
    }
    if (cookie) headers.Cookie ??= cookie;

    this.entries.delete(key);
    this.entries.set(key, {
      host: url.hostname.toLowerCase(),
      origin: url.origin,
      exactUrl,
      pathPrefix,
      referer,
      cookie,
      headers,
      cors: options.cors ?? true,
      authorizedAt: now,
    });
    this.prune(now);
  }

  get(raw: string, now = Date.now()): StreamAuthorization | null {
    let url: URL;
    try { url = new URL(raw); } catch { return null; }
    let best: StoredAuthorization | null = null;
    for (const [key, entry] of this.entries) {
      if (now - entry.authorizedAt > this.ttlMs) {
        this.entries.delete(key);
        continue;
      }
      if (entry.origin !== url.origin) continue;
      const matches = entry.exactUrl
        ? entry.exactUrl === url.toString()
        : url.pathname.startsWith(entry.pathPrefix);
      if (!matches) continue;
      if (!best || entry.exactUrl || entry.pathPrefix.length > best.pathPrefix.length) best = entry;
    }
    return best ? {
      host: best.host,
      referer: best.referer,
      cookie: best.cookie,
      headers: { ...best.headers },
      cors: best.cors,
    } : null;
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.authorizedAt > this.ttlMs) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

const RESOLVED_STREAM_TTL_MS = 2 * 60 * 60_000;
const resolvedStreamAuthorizations = new StreamAuthorizationRegistry(RESOLVED_STREAM_TTL_MS);

/** Register the exact credentials returned by a compiled provider resolver. */
export function authorizeResolvedStream(stream: StreamData): void {
  resolvedStreamAuthorizations.remember(stream.url, {
    headers: { ...(stream.requestHeaders ?? {}) },
    referer: stream.referer,
    cookie: stream.cookies,
    scope: stream.authorizationScope ?? "exact",
    cors: stream.cors ?? true,
  });
}

export function getResolvedStreamAuthorization(raw: string): StreamAuthorization | null {
  return resolvedStreamAuthorizations.get(raw);
}

export function clearResolvedStreamAuthorizations(): void {
  resolvedStreamAuthorizations.clear();
}
