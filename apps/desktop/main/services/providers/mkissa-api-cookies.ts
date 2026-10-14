import { normalizeHeaders, publicHttpsUrl, type MkissaFetch } from "./mkissa-utils";

interface ApiCookie {
  name: string;
  value: string;
  path: string;
  secure: boolean;
  expiresAt: number;
  sequence: number;
}

const MAX_COOKIES = 32;
const MAX_COOKIE_BYTES = 4096;
const MAX_HEADER_BYTES = 8192;
const MAX_RESPONSE_HEADER_BYTES = 32 * 1024;
const MAX_LIFETIME_MS = 24 * 60 * 60_000;
const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const COOKIE_VALUE = /^(?:[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*|"[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*")$/;

/**
 * Ordinary HTTP cookies acquired by this connector, scoped to its exact API
 * origin. This is not a browser-cookie importer or a verification transport.
 */
export class MkissaApiCookies {
  private readonly origin: string;
  private readonly host: string;
  private readonly now: () => number;
  private readonly cookies = new Map<string, ApiCookie>();
  private nextSequence = 0;

  constructor(apiOrigin: string, now: () => number = Date.now) {
    const url = publicHttpsUrl(apiOrigin);
    if (url.pathname !== "/" || url.search || url.hash) throw new Error("MKissa API cookie origin is invalid");
    this.origin = url.origin;
    this.host = url.hostname;
    this.now = now;
  }

  assertOrigin(apiOrigin: string): void {
    if (publicHttpsUrl(apiOrigin).origin !== this.origin) throw new Error("MKissa API cookie origin does not match the connector");
  }

  /** Apply cookies separately on every validated redirect hop; never inherit Cookie. */
  fetch(fetcher: MkissaFetch): MkissaFetch {
    return async (input, init) => {
      const url = publicHttpsUrl(input.toString());
      const headers = normalizeHeaders(init?.headers);
      headers.delete("Cookie");
      const cookie = this.header(url);
      if (cookie) headers.set("Cookie", cookie);
      const response = await fetcher(url, { ...init, credentials: "omit", headers });
      this.remember(url, response.headers);
      return response;
    };
  }

  header(url: URL): string {
    this.prune();
    if (url.origin !== this.origin || url.hostname !== this.host || url.username || url.password) return "";
    const matching = [...this.cookies.values()].filter(cookie =>
      (!cookie.secure || url.protocol === "https:") && pathMatches(url.pathname, cookie.path))
      .sort((a, b) => b.path.length - a.path.length || a.sequence - b.sequence);
    const pairs: string[] = [];
    let length = 0;
    for (const cookie of matching) {
      const pair = `${cookie.name}=${cookie.value}`;
      if (length + pair.length + (pairs.length ? 2 : 0) > MAX_HEADER_BYTES) continue;
      length += pair.length + (pairs.length ? 2 : 0);
      pairs.push(pair);
    }
    return pairs.join("; ");
  }

  remember(url: URL, headers: Headers): void {
    this.prune();
    if (url.origin !== this.origin || url.hostname !== this.host || url.username || url.password) return;
    const extended = headers as Headers & { getSetCookie?: () => string[] };
    const rows = extended.getSetCookie?.()
      ?? [headers.get("set-cookie")].filter((value): value is string => value !== null);
    let inspected = 0;
    for (const row of rows.slice(0, MAX_COOKIES)) {
      if (row.length > MAX_RESPONSE_HEADER_BYTES || (inspected += row.length) > MAX_RESPONSE_HEADER_BYTES) break;
      // The fallback Headers form may combine fields. Expires' comma is not a separator.
      for (const raw of row.split(/,(?=\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+\s*=)/).slice(0, MAX_COOKIES)) {
        this.parse(url, raw);
      }
    }
  }

  private parse(url: URL, raw: string): void {
    if (raw.length > MAX_COOKIE_BYTES || /[\r\n\0]/.test(raw)) return;
    const [pair, ...attributes] = raw.split(";");
    const separator = pair.indexOf("=");
    if (separator < 1) return;
    const name = pair.slice(0, separator).trim(), value = pair.slice(separator + 1).trim();
    if (!COOKIE_NAME.test(name) || !COOKIE_VALUE.test(value)) return;
    const attrs = new Map<string, string>();
    for (const attribute of attributes) {
      const equal = attribute.indexOf("=");
      attrs.set((equal < 0 ? attribute : attribute.slice(0, equal)).trim().toLowerCase(),
        equal < 0 ? "" : attribute.slice(equal + 1).trim());
    }
    const domain = attrs.get("domain")?.toLowerCase().replace(/^\./, "");
    // Parent-domain attributes may be valid for this host, but never widen the
    // jar's transmission scope beyond the configured exact HTTPS API origin.
    if (domain != null && (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain)
      || domain.split(".").some(label => !label) || domain.split(".").length < 2
      || (this.host !== domain && !this.host.endsWith(`.${domain}`)))) return;
    const secure = attrs.has("secure");
    const offeredPath = attrs.get("path");
    const path = offeredPath?.startsWith("/") ? offeredPath : defaultPath(url.pathname);
    if (path.length > 2048 || /[\u0000-\u0020\u007f]/.test(path)) return;
    if (name.startsWith("__Secure-") && !secure) return;
    if (name.startsWith("__Host-") && (!secure || attrs.has("domain") || attrs.get("path") !== "/")) return;
    const now = this.now();
    let expiresAt = now + MAX_LIFETIME_MS;
    const age = attrs.get("max-age");
    if (age != null && /^-?\d+$/.test(age)) {
      expiresAt = Number(age) <= 0 ? 0 : now + Math.min(MAX_LIFETIME_MS, Number(age) * 1000);
    } else {
      const expires = attrs.get("expires");
      if (expires != null) {
        const parsed = Date.parse(expires);
        if (Number.isFinite(parsed)) expiresAt = Math.min(expiresAt, parsed);
      }
    }
    const key = `${name}\0${domain ?? this.host}\0${path}`;
    if (expiresAt <= now) { this.cookies.delete(key); return; }
    const sequence = this.cookies.get(key)?.sequence ?? this.nextSequence++;
    this.cookies.delete(key);
    if (this.cookies.size >= MAX_COOKIES) this.cookies.delete(this.cookies.keys().next().value!);
    this.cookies.set(key, { name, value, path, secure, expiresAt, sequence });
  }

  private prune(): void {
    const now = this.now();
    for (const [key, cookie] of this.cookies) if (cookie.expiresAt <= now) this.cookies.delete(key);
  }
}

function defaultPath(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return !path.startsWith("/") || lastSlash <= 0 ? "/" : path.slice(0, lastSlash);
}

function pathMatches(request: string, cookie: string): boolean {
  return request === cookie || request.startsWith(cookie) && (cookie.endsWith("/") || request[cookie.length] === "/");
}
