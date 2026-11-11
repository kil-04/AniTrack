/**
 * A request budget shared by everything that talks to one source: a few requests
 * may go at once ([burst]), after which one more is let through every [refillMs].
 * When several are waiting, the lowest [priority] number goes first (what's on
 * screen before background work), oldest first among equals.
 *
 * Novel Phoenix refuses bursts (HTTP 429 at roughly a dozen requests in as many
 * seconds), while one request every two seconds ran for a minute without a refusal;
 * its reader, chapter-list fill and downloads all draw on one budget so that
 * together they stay under that. Mirrored by NovelPace in the Android app.
 */
export class RequestPace {
  private tokens: number;
  /** When the budget last gained a token (or was last full). */
  private since: number;
  private readonly waiting: { priority: number; go: () => void }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly burst: number;
  private readonly refillMs: number;
  private readonly now: () => number;

  constructor(burst: number, refillMs: number, now: () => number = Date.now) {
    this.burst = burst;
    this.refillMs = refillMs;
    this.now = now;
    this.tokens = burst;
    this.since = now();
  }

  /** Resolves when a request may be sent. */
  take(priority = 0): Promise<void> {
    return new Promise((go) => {
      this.waiting.push({ priority, go });
      this.pump();
    });
  }

  private pump() {
    const now = this.now();
    if (this.tokens >= this.burst) {
      this.since = now;
    } else {
      const gained = Math.floor((now - this.since) / this.refillMs);
      if (gained > 0) {
        this.tokens = Math.min(this.burst, this.tokens + gained);
        this.since = this.tokens >= this.burst ? now : this.since + gained * this.refillMs;
      }
    }
    while (this.tokens > 0 && this.waiting.length) {
      let next = 0;
      for (let i = 1; i < this.waiting.length; i++) if (this.waiting[i].priority < this.waiting[next].priority) next = i;
      this.tokens--;
      this.waiting.splice(next, 1)[0].go();
    }
    if (this.waiting.length && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, Math.max(1, this.refillMs - (this.now() - this.since)));
    }
  }
}
