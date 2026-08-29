export interface StreamAuthorization {
  host: string;
  referer: string;
  cookie: string;
}

interface StoredAuthorization extends StreamAuthorization {
  origin: string;
  pathPrefix: string;
  authorizedAt: number;
}

/**
 * Keeps hotlink credentials scoped to the stream directory that produced them.
 * CDN hosts are commonly shared by many episodes, so host-only storage lets a
 * prefetch or download replace the cookie of the video that is still playing.
 */
export class StreamAuthorizationRegistry {
  private readonly entries = new Map<string, StoredAuthorization>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs: number, maxEntries = 500) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  remember(raw: string, referer: string, cookie: string, now = Date.now()): void {
    const url = new URL(raw);
    const pathPrefix = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
    const key = `${url.origin}${pathPrefix}`;
    this.entries.delete(key);
    this.entries.set(key, {
      host: url.hostname.toLowerCase(),
      origin: url.origin,
      pathPrefix,
      referer,
      cookie,
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
      if (entry.origin !== url.origin || !url.pathname.startsWith(entry.pathPrefix)) continue;
      if (!best || entry.pathPrefix.length > best.pathPrefix.length) best = entry;
    }
    return best ? { host: best.host, referer: best.referer, cookie: best.cookie } : null;
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
