/**
 * AniList allows 30 requests a minute (live X-RateLimit-Limit: 30). The serial
 * queue keeps request starts under that budget in any 60 s window, so a cold
 * Home load still bursts while the budget lasts. A 429, or a reply that says
 * the budget is spent, pauses every queued request until the server's reset
 * instead of failing them. Android's AniList.kt (AniListPacer) is the twin.
 */
export const ANILIST_RATE_LIMIT = 30;
export const ANILIST_RATE_WINDOW_MS = 60_000;
/** A per-minute window resets within a minute; no header may pause us for longer. */
export const ANILIST_MAX_COOLDOWN_MS = 65_000;
const MIN_COOLDOWN_MS = 1_000;

export interface AniListRateHeaders {
  retryAfter?: string | null;
  remaining?: string | null;
  reset?: string | null;
  limit?: string | null;
}

/** Reads the rate-limit headers off a fetch reply. */
export function rateHeaders(headers: Pick<Headers, "get"> | null | undefined): AniListRateHeaders {
  return {
    retryAfter: headers?.get("retry-after") ?? null,
    remaining: headers?.get("x-ratelimit-remaining") ?? null,
    reset: headers?.get("x-ratelimit-reset") ?? null,
    limit: headers?.get("x-ratelimit-limit") ?? null,
  };
}

const headerInt = (value: string | null | undefined) => {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export class AniListPacer {
  private starts: number[] = [];
  private cooldownUntil = 0;
  private limit = ANILIST_RATE_LIMIT;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Milliseconds until the next request may start; 0 means now. */
  waitMs(): number {
    const now = this.now();
    this.starts = this.starts.filter((t) => now - t < ANILIST_RATE_WINDOW_MS);
    let wait = Math.max(0, this.cooldownUntil - now);
    if (this.starts.length >= this.limit) {
      wait = Math.max(wait, this.starts[this.starts.length - this.limit] + ANILIST_RATE_WINDOW_MS - now);
    }
    return wait;
  }

  noteStart(): void {
    this.starts.push(this.now());
  }

  /** Learns from a reply: the server's limit, and when to pause the whole queue. */
  noteReply(status: number, headers: AniListRateHeaders): void {
    const now = this.now();
    const limit = headerInt(headers.limit);
    if (limit != null && limit > 0) this.limit = Math.floor(limit);
    // X-RateLimit-Reset is a unix time in seconds.
    const reset = headerInt(headers.reset);
    const resetIn = reset != null && reset > 0 ? reset * 1000 - now : null;
    if (status === 429) {
      const retryAfter = headerInt(headers.retryAfter);
      this.pauseFor(now, retryAfter != null && retryAfter > 0 ? retryAfter * 1000 : resetIn ?? ANILIST_RATE_WINDOW_MS);
      return;
    }
    const remaining = headerInt(headers.remaining);
    if (remaining != null && remaining <= 0) {
      // Without a reset time, a slot frees when our oldest request in the window ages out.
      const oldest = this.starts.find((t) => now - t < ANILIST_RATE_WINDOW_MS);
      this.pauseFor(now, resetIn ?? (oldest != null ? oldest + ANILIST_RATE_WINDOW_MS - now : ANILIST_RATE_WINDOW_MS));
    }
  }

  private pauseFor(now: number, ms: number): void {
    const bounded = Math.min(ANILIST_MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, ms));
    this.cooldownUntil = Math.max(this.cooldownUntil, now + bounded);
  }
}
