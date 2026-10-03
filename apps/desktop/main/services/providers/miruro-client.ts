import {
  decodeMiruroResponse, MIRURO_MAX_ENV_BYTES, MIRURO_MAX_RESPONSE_BYTES, MIRURO_ORIGIN,
  miruroRequestUrl, miruroResponseFailure, MiruroProtocolError, parseMiruroEnvironment,
} from "./miruro-protocol";
import type { MiruroRequest } from "./miruro-protocol";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const COOLDOWN_MS = 5 * 60_000;
const KEY_TTL_MS = 30 * 60_000;

export interface MiruroClientOptions {
  fetcher?: Fetcher;
  now?: () => number;
  /** Wait after a security check before a new request (default five minutes). */
  securityCooldownMs?: number;
  /** Wait after a rate limit before a new request (default five minutes). */
  rateLimitCooldownMs?: number;
}

/** Staged read transport; no automatic probes and no media/source cache. */
export class MiruroClient {
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private readonly securityCooldownMs: number;
  private readonly rateLimitCooldownMs: number;
  private cooldownUntil = 0;
  private sequence = 0;
  /** Requests queued at or before this sequence never reach the network after a block. */
  private blockedThrough = 0;
  private environment: { key: string; expiresAt: number } | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: MiruroClientOptions = {}) {
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? Date.now;
    this.securityCooldownMs = Math.max(0, options.securityCooldownMs ?? COOLDOWN_MS);
    this.rateLimitCooldownMs = Math.max(0, options.rateLimitCooldownMs ?? COOLDOWN_MS);
  }

  read(request: MiruroRequest): Promise<Record<string, unknown>> {
    // Validate and snapshot before queueing so a caller cannot change coordinates.
    const url = miruroRequestUrl(request);
    const sequence = ++this.sequence;
    const task = this.queue.then(async () => {
      this.checkCooldown(sequence);
      const { text, obfuscated } = await this.get(url, MIRURO_MAX_RESPONSE_BYTES, sequence);
      let key: string | undefined;
      if (obfuscated === "2") {
        if (!this.environment || this.environment.expiresAt <= this.now()) {
          const response = await this.get(`${MIRURO_ORIGIN}/env2.js`, MIRURO_MAX_ENV_BYTES, sequence);
          this.environment = { key: parseMiruroEnvironment(response.text), expiresAt: this.now() + KEY_TTL_MS };
        }
        key = this.environment.key;
      }
      const payload = decodeMiruroResponse(text, obfuscated, key);
      // Some APIs return structured challenge errors with status 200.
      const errorText = [payload.error, payload.message, payload.code].filter((value) => typeof value === "string").join(" ");
      this.rejectChallenge(200, errorText);
      return payload;
    });
    // Serial requests prevent queued episodes/servers amplifying a security block.
    this.queue = task.catch(() => {});
    return task;
  }

  private checkCooldown(sequence: number): void {
    if (sequence <= this.blockedThrough || this.now() < this.cooldownUntil) {
      throw new MiruroProtocolError("Miruro is cooling down after a security check or rate limit. Try another provider.", "COOLDOWN");
    }
  }

  private rejectChallenge(status: number, text: string): void {
    const failure = miruroResponseFailure(status, text);
    if (failure) {
      this.blockedThrough = this.sequence;
      this.cooldownUntil = this.now() + (failure.code === "RATE_LIMITED" ? this.rateLimitCooldownMs : this.securityCooldownMs);
      throw failure;
    }
  }

  private async get(url: string, maximumBytes: number, sequence: number): Promise<{ text: string; obfuscated: string | null }> {
    this.checkCooldown(sequence);
    const parsed = new URL(url);
    if (parsed.origin !== MIRURO_ORIGIN || parsed.username || parsed.password) {
      throw new MiruroProtocolError("Miruro request left its approved origin");
    }
    const response = await this.fetcher(url, {
      method: "GET", redirect: "manual", credentials: "omit",
      headers: { Accept: "application/json, text/plain, */*" }, signal: AbortSignal.timeout(15_000),
    });
    try {
      // Stop even for oversized/streaming challenge bodies, before parsing them.
      this.rejectChallenge(response.status, "");
      if (response.status >= 300 && response.status < 400) throw new MiruroProtocolError("Miruro redirected its API; connector review is required");
      if (!response.ok) throw new MiruroProtocolError(`Miruro request failed (HTTP ${response.status})`);
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maximumBytes) throw new MiruroProtocolError("Miruro response exceeded its size limit");
      const chunks: Uint8Array[] = [];
      let received = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > maximumBytes) throw new MiruroProtocolError("Miruro response exceeded its size limit");
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
      // Inspect HTML challenges here, but structured error fields only after
      // decoding. A show title containing "Security Check" is not a challenge.
      if (text.trimStart().startsWith("<")) this.rejectChallenge(response.status, text);
      return { text, obfuscated: response.headers.get("x-obfuscated") };
    } finally { await response.body?.cancel().catch(() => {}); }
  }
}
