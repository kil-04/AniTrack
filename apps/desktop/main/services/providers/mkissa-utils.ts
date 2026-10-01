export type MkissaFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type MkissaErrorCode =
  | "CAPTCHA_REQUIRED"
  | "RATE_LIMITED"
  | "CRYPTO_STALE"
  | "INVALID_RESPONSE"
  | "UNSAFE_URL"
  | "UNSUPPORTED_SOURCE";

export class MkissaProviderError extends Error {
  readonly code: MkissaErrorCode;
  readonly status?: number;

  constructor(
    message: string,
    code: MkissaErrorCode,
    status?: number,
  ) {
    super(message);
    this.name = "MkissaProviderError";
    this.code = code;
    this.status = status;
  }
}

const NON_PUBLIC_IPV4 = [
  /^0\./,
  /^10\./,
  /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./,
  /^192\.0\.0\./,
  /^192\.0\.2\./,
  /^192\.88\.99\./,
  /^192\.168\./,
  /^198\.(?:18|19)\./,
  /^198\.51\.100\./,
  /^203\.0\.113\./,
  /^(?:22[4-9]|23\d|24\d|25\d)\./,
];

function isUnsafeHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")
    || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (NON_PUBLIC_IPV4.some((pattern) => pattern.test(host))) return true;
  if (host.includes(":")) {
    if (host === "::" || host === "::1" || /^f[cd]/.test(host)
      || /^fe[89ab]/.test(host) || /^ff/.test(host) || /^2001:db8(?::|$)/.test(host)) return true;
    const mapped = /^::(?:ffff:)?([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(host);
    if (mapped) {
      const value = Number.parseInt(mapped[1], 16) * 0x1_0000 + Number.parseInt(mapped[2], 16);
      const ipv4 = [value >>> 24, value >>> 16 & 0xff, value >>> 8 & 0xff, value & 0xff].join(".");
      return NON_PUBLIC_IPV4.some((pattern) => pattern.test(ipv4));
    }
  }
  return false;
}

export function publicHttpsUrl(value: string, base?: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch {
    throw new MkissaProviderError("MKissa returned a malformed URL", "UNSAFE_URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || isUnsafeHostname(parsed.hostname)) {
    throw new MkissaProviderError("MKissa returned an unsafe URL", "UNSAFE_URL");
  }
  return parsed;
}

export function assertAllowedOrigin(url: URL, allowedHosts: ReadonlySet<string>): void {
  if (!allowedHosts.has(url.hostname.toLowerCase()) || (url.port !== "" && url.port !== "443")) {
    throw new MkissaProviderError("MKissa asset changed to an untrusted host", "UNSAFE_URL");
  }
}

export function safeText(value: unknown, maximum = 100): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

export function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export async function responseText(response: Response, maximumBytes: number, label: string): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new MkissaProviderError(`${label} response was unexpectedly large`, "INVALID_RESPONSE");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new MkissaProviderError(`${label} response was unexpectedly large`, "INVALID_RESPONSE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export function errorMessages(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const errors = (payload as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const object = entry as { message?: unknown; extensions?: { code?: unknown } };
    return [object.message, object.extensions?.code]
      .filter((value): value is string => typeof value === "string")
      .map((value) => safeText(value, 160));
  });
}

export function classifyMkissaFailure(messages: string[], status?: number): MkissaProviderError | null {
  if (status === 429 || messages.some((message) => /rate.?limit|too many requests/i.test(message))) {
    return new MkissaProviderError(
      "MKissa is temporarily rate limiting this network. Streaming will retry after cooldown.",
      "RATE_LIMITED",
      status,
    );
  }
  if (messages.some((message) => /NEED_CAPTCHA|captcha/i.test(message))) {
    return new MkissaProviderError(
      "MKissa requires a browser security check. AniTrack will not automate or repeatedly retry it.",
      "CAPTCHA_REQUIRED",
      status,
    );
  }
  if (messages.some((message) => /^AA_CRYPTO_|crypto.*(?:mismatch|stale|invalid)/i.test(message))) {
    return new MkissaProviderError("MKissa client keys are stale", "CRYPTO_STALE", status);
  }
  return null;
}

export function normalizeHeaders(value?: RequestInit["headers"]): Headers {
  const headers = new Headers(value);
  for (const [name, content] of [...headers.entries()]) {
    if (/[\r\n]/.test(name) || /[\r\n]/.test(content)) {
      throw new MkissaProviderError("Invalid MKissa request header", "INVALID_RESPONSE");
    }
  }
  return headers;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_SENSITIVE_HEADERS = [
  "authorization",
  "cookie",
  "origin",
  "proxy-authorization",
  "x-aa-boot",
  "x-build-id",
];

/** Fetch with redirects exposed and validated before the next network request. */
export async function safeRedirectFetch(
  fetcher: MkissaFetch,
  initialUrl: URL,
  init: RequestInit,
  assertAllowed: (url: URL) => void,
  maximumRedirects = 5,
): Promise<Response> {
  let current = publicHttpsUrl(initialUrl.toString());
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  const headers = normalizeHeaders(init.headers);

  for (let redirectCount = 0; ; redirectCount++) {
    assertAllowed(current);
    const response = await fetcher(current, {
      ...init,
      method,
      body,
      headers,
      redirect: "manual",
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (redirectCount >= maximumRedirects) {
      await response.body?.cancel().catch(() => {});
      throw new MkissaProviderError("MKissa request redirected too many times", "UNSAFE_URL");
    }
    const next = publicHttpsUrl(location, current.toString());
    assertAllowed(next);
    await response.body?.cancel().catch(() => {});

    if (next.origin !== current.origin) {
      for (const name of CROSS_ORIGIN_SENSITIVE_HEADERS) headers.delete(name);
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
      headers.delete("content-length");
      headers.delete("content-type");
    }
    current = next;
  }
}
