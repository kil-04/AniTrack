import { gunzipSync } from "node:zlib";

// Read-only protocol observed in Miruro's public frontend. This is deliberately
// not registered as a playable provider until real catalogue/source fixtures pass.
// User-confirmed official working address; no automatic mirror rotation.
export const MIRURO_ORIGIN = "https://www.miruro.ru";
export const MIRURO_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MIRURO_MAX_ENV_BYTES = 64 * 1024;

export type MiruroRequest =
  | { operation: "config" }
  | { operation: "info" | "episodes"; anilistId: number }
  | { operation: "sources"; anilistId: number; episodeId: string; provider: string; category: "sub" | "ssub" | "dub" | "" };

export class MiruroProtocolError extends Error {
  readonly code: "INVALID_RESPONSE" | "SECURITY_CHECK" | "RATE_LIMITED" | "COOLDOWN";
  constructor(message: string, code: MiruroProtocolError["code"] = "INVALID_RESPONSE") {
    super(message);
    this.name = "MiruroProtocolError";
    this.code = code;
  }
}

function invalid(): never {
  throw new MiruroProtocolError("Miruro returned an unsupported or malformed response");
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const result: unknown = JSON.parse(text);
    if (result && typeof result === "object" && !Array.isArray(result)) return result as Record<string, unknown>;
  } catch {}
  return invalid();
}

/** Encode only the observed read operations; never accept arbitrary API paths. */
export function miruroRequestUrl(request: MiruroRequest): string {
  let path: string;
  let query: Record<string, string | number> = {};
  if (request.operation !== "config") {
    if (!Number.isSafeInteger(request.anilistId) || request.anilistId <= 0 || request.anilistId > 2_147_483_647) invalid();
  }
  switch (request.operation) {
    case "config": path = "config"; break;
    case "info": path = `info/${request.anilistId}`; break;
    case "episodes": path = "episodes"; query = { anilistId: request.anilistId }; break;
    case "sources":
      if (typeof request.episodeId !== "string" || !request.episodeId.trim() || request.episodeId.length > 512
        || /[\u0000-\u001f\u007f]/.test(request.episodeId)
        || typeof request.provider !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.provider)
        || !["", "sub", "ssub", "dub"].includes(request.category)) invalid();
      path = "sources";
      query = { episodeId: request.episodeId, provider: request.provider, category: request.category, anilistId: request.anilistId };
      break;
    default: return invalid();
  }
  const envelope = { path, method: "GET", query, body: null };
  return `${MIRURO_ORIGIN}/api/secure/pipe?e=${Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url")}`;
}

/** Parse the JSON literal, not the downloaded JavaScript. No evaluation. */
export function parseMiruroEnvironment(script: string): string {
  if (Buffer.byteLength(script, "utf8") > MIRURO_MAX_ENV_BYTES) invalid();
  const match = /^\s*window\.env\s*=\s*JSON\.parse\(\s*("(?:[^"\\]|\\.)*")\s*\)\s*;?\s*$/.exec(script);
  if (!match) invalid();
  let literal: unknown;
  try { literal = JSON.parse(match[1]); } catch { return invalid(); }
  if (typeof literal !== "string") invalid();
  const key = parseObject(literal).VITE_PIPE_OBF_KEY;
  if (typeof key !== "string" || !/^(?:[a-fA-F0-9]{2}){1,128}$/.test(key)) invalid();
  return key;
}

/** Decode a bounded API envelope. The public XOR key is never persisted/logged. */
export function decodeMiruroResponse(text: string, obfuscated: string | null, key?: string): Record<string, unknown> {
  if (Buffer.byteLength(text, "utf8") > MIRURO_MAX_RESPONSE_BYTES) invalid();
  if (obfuscated === null || obfuscated === "") return parseObject(text);
  if (obfuscated !== "1" && obfuscated !== "2") invalid();
  const encoded = text.trim();
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(encoded)) invalid();
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.toString("base64url") !== encoded.replace(/=+$/, "")) invalid();
  if (obfuscated === "2") {
    if (typeof key !== "string" || !/^(?:[a-fA-F0-9]{2}){1,128}$/.test(key)) invalid();
    const mask = Buffer.from(key, "hex");
    for (let index = 0; index < bytes.length; index++) bytes[index] ^= mask[index % mask.length];
  }
  try {
    const decoded = gunzipSync(bytes, { maxOutputLength: MIRURO_MAX_RESPONSE_BYTES });
    return parseObject(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
  } catch { return invalid(); }
}

export function miruroResponseFailure(status: number, text: string): MiruroProtocolError | null {
  if (status === 429) return new MiruroProtocolError("Miruro is rate limiting requests. Try another provider for now.", "RATE_LIMITED");
  if (status === 403 || /cf-chl-|captcha|attention required!.*cloudflare|just a moment|security check/i.test(text.slice(0, 32_768))) {
    return new MiruroProtocolError("Miruro requires a browser security check. AniTrack will not bypass or repeatedly retry it.", "SECURITY_CHECK");
  }
  return null;
}
