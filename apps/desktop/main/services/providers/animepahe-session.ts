/** Errors keep a readable code because Electron IPC forwards the message only. */
export class PaheAccessError extends Error {
  readonly code: "PAHE_SECURITY_CHECK" | "PAHE_RATE_LIMITED";

  constructor(code: "PAHE_SECURITY_CHECK" | "PAHE_RATE_LIMITED", message: string) {
    super(`${code}: ${message}`);
    this.name = "PaheAccessError";
    this.code = code;
  }
}

const CHALLENGE_PAGE = /<title[^>]*>\s*(?:just a moment|attention required)|_cf_chl_opt|cf-chl-|verify you are human|checking your browser/i;

export function paheResponseError(status: number, body: string): PaheAccessError | null {
  if (status === 429) {
    return new PaheAccessError("PAHE_RATE_LIMITED", "AnimePahe limited this request. Try another provider or retry in a minute.");
  }
  // Cloudflare injects a /cdn-cgi/challenge-platform/ loader into ordinary
  // pages, so that path alone marks a challenge only on an error response.
  if (status === 403 || CHALLENGE_PAGE.test(body) || (status >= 500 && /challenge-platform/i.test(body))) {
    return new PaheAccessError("PAHE_SECURITY_CHECK", "AnimePahe needs verification. Complete the check in the opened AnimePahe window, then retry in AniTrack.");
  }
  return null;
}

/** A rejected request cannot silently start new requests on another origin. */
export class PaheVerificationState {
  ready = false;
  private verificationRequired = false;
  private rateLimitUntil = 0;
  private generation = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  reset(): number {
    this.ready = false;
    this.verificationRequired = false;
    this.generation++;
    return this.generation;
  }

  markReady(generation: number): boolean {
    if (generation !== this.generation) return false;
    this.ready = true;
    this.verificationRequired = false;
    return true;
  }

  /** [retryAfterMs]: how long AnimePahe asked us to wait (Retry-After), when it said. */
  reject(error: PaheAccessError, retryAfterMs?: number | null): void {
    if (error.code === "PAHE_RATE_LIMITED") {
      const wait = retryAfterMs != null && Number.isFinite(retryAfterMs) ? retryAfterMs : 60_000;
      this.rateLimitUntil = this.now() + Math.min(120_000, Math.max(5_000, wait));
    } else {
      this.ready = false;
      this.verificationRequired = true;
    }
  }

  assertRequestAllowed(): void {
    if (this.now() < this.rateLimitUntil) throw paheResponseError(429, "")!;
    if (this.verificationRequired) throw paheResponseError(403, "")!;
  }
}

/** A Retry-After header (seconds or an HTTP date) in milliseconds, or null. */
export function retryAfterMs(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

export interface PaheResolvedStream {
  url: string;
  cookies: string;
  resolvedAt: number;
  cookiesAt: number;
}

/** Store the credentials captured for a URL, rather than the newest shared jar. */
export class PaheResolvedStreamCache {
  private readonly entries = new Map<string, PaheResolvedStream>();
  private readonly urlTtl: number;
  private readonly cookieTtl: number;
  private readonly maxEntries: number;

  constructor(urlTtl: number, cookieTtl: number, maxEntries = 500) {
    this.urlTtl = urlTtl;
    this.cookieTtl = cookieTtl;
    this.maxEntries = maxEntries;
  }

  get(key: string, now = Date.now()): PaheResolvedStream | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (!entry.cookies || now - entry.resolvedAt >= this.urlTtl || now - entry.cookiesAt >= this.cookieTtl) {
      this.entries.delete(key);
      return null;
    }
    return { ...entry };
  }

  set(key: string, entry: PaheResolvedStream): void {
    this.entries.delete(key);
    this.entries.set(key, { ...entry });
    while (this.entries.size > this.maxEntries) {
      const first = this.entries.keys().next().value;
      if (first === undefined) break;
      this.entries.delete(first);
    }
  }

  clear(): void { this.entries.clear(); }
}
