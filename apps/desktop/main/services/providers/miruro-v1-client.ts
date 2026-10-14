import { gunzipSync } from "node:zlib";
import { MIRURO_MAX_RESPONSE_BYTES, MIRURO_ORIGIN, miruroResponseFailure, MiruroProtocolError } from "./miruro-protocol";

export type MiruroV1Request =
  | { operation: "lookup"; anilistId: number }
  | { operation: "episodes"; showId: string }
  | { operation: "play"; showId: string; episode: number };

export type MiruroV1Reader = (request: MiruroV1Request) => Promise<Record<string, unknown>>;

interface MiruroV1Options {
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  securityCooldownMs?: number;
  rateLimitCooldownMs?: number;
}

export function miruroV1Url(request: MiruroV1Request): string {
  if (request.operation === "lookup") {
    if (!Number.isSafeInteger(request.anilistId) || request.anilistId <= 0 || request.anilistId > 2_147_483_647) {
      throw new MiruroProtocolError("Invalid Miruro AniList reference");
    }
    // The public client uses this exact allow-listed lookup page size.
    return `${MIRURO_ORIGIN}/api/v1/anime?anilist_id_in=${request.anilistId}&limit=100`;
  }
  if (typeof request.showId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(request.showId)) {
    throw new MiruroProtocolError("Invalid Miruro catalogue reference");
  }
  const root = `${MIRURO_ORIGIN}/api/v1/anime/${encodeURIComponent(request.showId)}/episodes`;
  if (request.operation === "episodes") return `${root}?limit=10000`;
  if (request.operation !== "play" || !Number.isFinite(request.episode) || request.episode < 0 || request.episode > 100_000) {
    throw new MiruroProtocolError("Invalid Miruro episode reference");
  }
  return `${root}/${request.episode}/play`;
}

/** Current public wire codec, reimplemented locally; no website code execution. */
export function decodeMiruroV1(bytes: Uint8Array, contentType: string): Record<string, unknown> {
  if (bytes.byteLength > MIRURO_MAX_RESPONSE_BYTES) throw new MiruroProtocolError("Miruro response exceeded its size limit");
  let decoded: Uint8Array = bytes;
  try {
    if (contentType.split(";", 1)[0].trim().toLowerCase() === "application/octet-stream") {
      const data = Buffer.from(bytes);
      const publicMask = Buffer.from("miruro/catalog", "utf8");
      for (let index = 0; index < data.length; index++) data[index] ^= publicMask[index % publicMask.length];
      decoded = gunzipSync(data, { maxOutputLength: MIRURO_MAX_RESPONSE_BYTES });
    }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* Fail closed for a changed codec, bad UTF-8 or decompression bomb. */ }
  throw new MiruroProtocolError("Miruro returned an unsupported catalogue response");
}

export class MiruroV1Client {
  private queue: Promise<unknown> = Promise.resolve();
  private sequence = 0;
  private blockedThrough = 0;
  private cooldownUntil = 0;
  private readonly options: MiruroV1Options;
  constructor(options: MiruroV1Options = {}) { this.options = options; }

  readonly read: MiruroV1Reader = (request) => {
    const url = miruroV1Url(request);
    const sequence = ++this.sequence;
    const task = this.queue.then(async () => {
      const now = this.options.now ?? Date.now;
      if (sequence <= this.blockedThrough || now() < this.cooldownUntil) {
        throw new MiruroProtocolError("Miruro is cooling down after an access rejection. Try another provider.", "COOLDOWN");
      }
      const rejectAccess = (status: number, body: string) => {
        const failure = miruroResponseFailure(status, body);
        if (!failure) return;
        this.blockedThrough = this.sequence;
        this.cooldownUntil = now() + (failure.code === "RATE_LIMITED"
          ? this.options.rateLimitCooldownMs ?? 60_000 : this.options.securityCooldownMs ?? 5 * 60_000);
        throw failure;
      };
      const response = await (this.options.fetcher ?? fetch)(url, {
        method: "GET", redirect: "manual", credentials: "omit",
        headers: { Accept: "application/json, application/octet-stream" }, signal: AbortSignal.timeout(15_000),
      });
      try {
        rejectAccess(response.status, "");
        if (response.url && new URL(response.url).origin !== MIRURO_ORIGIN) throw new MiruroProtocolError("Miruro request left its approved origin");
        if (response.status >= 300 && response.status < 400) throw new MiruroProtocolError("Miruro redirected its API; connector review is required");
        if (Number(response.headers.get("content-length")) > MIRURO_MAX_RESPONSE_BYTES) {
          throw new MiruroProtocolError("Miruro response exceeded its size limit");
        }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (reader) {
            const item = await reader.read();
            if (item.done) break;
            size += item.value.byteLength;
            if (size > MIRURO_MAX_RESPONSE_BYTES) throw new MiruroProtocolError("Miruro response exceeded its size limit");
            chunks.push(item.value);
          }
        } finally { reader?.releaseLock(); }
        const bytes = Buffer.concat(chunks, size);
        if (!response.ok) {
          // Some website checks use 503 instead of 403. Inspect the bounded
          // error body before permitting ordinary server-failure handling.
          rejectAccess(response.status, bytes.subarray(0, 32_768).toString("utf8"));
          throw new MiruroProtocolError(`Miruro catalogue request failed (HTTP ${response.status})`);
        }
        if (bytes.subarray(0, 32_768).toString("utf8").trimStart().startsWith("<")) rejectAccess(200, bytes.toString("utf8"));
        const payload = decodeMiruroV1(bytes, response.headers.get("content-type") ?? "");
        rejectAccess(200, [payload.error, payload.code, payload.message].filter(value => typeof value === "string").join(" "));
        return payload;
      } finally { await response.body?.cancel().catch(() => {}); }
    });
    this.queue = task.catch(() => {});
    return task;
  };
}
