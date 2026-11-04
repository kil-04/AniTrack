/**
 * Resuming interrupted downloads: which saved pieces (HLS segments, keys, init
 * segments, manga pages) can be kept, where to continue, how to wait after a
 * failure and when to resolve the stream again.
 *
 * Kotlin twin: apps/android/.../data/DownloadResume.kt. Both are run against the
 * same cases in tests/fixtures/download-resume.json, so keep them in step.
 */

export const LEDGER_FILE = "download.ledger";
export const LEDGER_VERSION = 1;
/** Bytes read from the start of a saved piece to check it (eight TS packets). */
export const HEAD_BYTES = 1504;

export type PieceKind = "segment" | "init" | "key" | "page";

/** One file of a download, in playlist (or reading) order. */
export interface PlanPiece {
  kind: PieceKind;
  url: string;
  /** Local file name; empty when it is only known after the fetch (manga pages). */
  file?: string;
  /** The segment's #EXTINF duration exactly as the playlist wrote it. */
  duration?: string | null;
  /** Encrypted with an EXT-X-KEY (METHOD other than NONE). */
  encrypted?: boolean;
}

// ── Identity ────────────────────────────────────────────────────────────────

/** FNV-1a 64 over the UTF-8 bytes of [text], as 16 lowercase hex digits. */
export function fnv64(text: string | Uint8Array): string {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Query parameters that sign or time-limit a URL and change each time it is resolved. */
const SIGNING = new Set([
  "token", "tok", "sig", "signature", "sign", "expires", "expiry", "expire", "exp", "e", "st",
  "hash", "h", "auth", "authkey", "auth_key", "md5", "hmac", "policy", "key-pair-id", "hdnts",
  "hdnea", "validfrom", "validto", "wmsauthsign", "nva", "acl", "ts", "t", "ttl", "s", "verify",
  "session", "sid", "ip", "nonce",
]);

function signingParam(rawName: string): boolean {
  let name = rawName;
  try { name = decodeURIComponent(rawName); } catch { /* keep it raw */ }
  name = name.toLowerCase();
  return SIGNING.has(name) || name.startsWith("x-amz-") || name.startsWith("x-goog-");
}

/**
 * [url] without its scheme, host, fragment or signing parameters, so a stream
 * resolved again (new token, other edge host) still names the same file.
 */
export function stableUrl(url: string): string {
  const rest = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "").split("#")[0];
  const at = rest.indexOf("?");
  const path = at < 0 ? rest : rest.slice(0, at);
  if (at < 0) return path;
  const kept = rest.slice(at + 1).split("&")
    .filter((part) => part.length > 0 && !signingParam(part.split("=")[0]))
    .sort();
  return kept.length ? `${path}?${kept.join("&")}` : path;
}

/**
 * The rendition a plan downloads: the variant's attributes plus every piece's
 * kind, stable URL, duration and encryption. A re-signed playlist keeps it; a
 * different quality, server or encode changes it.
 */
export function renditionId(variant: string, pieces: PlanPiece[]): string {
  let text = `v${LEDGER_VERSION}\n${variant}\n`;
  for (const piece of pieces) {
    text += `${piece.kind}|${stableUrl(piece.url)}|${piece.duration ?? ""}|${piece.encrypted ? 1 : 0}\n`;
  }
  return fnv64(text);
}

/** The attributes of an #EXT-X-STREAM-INF line that pick a rendition, in a fixed order. */
export function variantAttributes(streamInf: string): string {
  const read = (name: string) => streamInf.match(new RegExp(`(?:^|[:,])${name}=("[^"]*"|[^,]*)`))?.[1] ?? "";
  return ["BANDWIDTH", "RESOLUTION", "CODECS"].map((name) => `${name}=${read(name)}`).join(",");
}

// ── Checking saved bytes ────────────────────────────────────────────────────

const FMP4_BOXES = new Set(["ftyp", "styp", "moof", "moov", "sidx", "emsg", "prft"]);
const latin1 = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

/** "ts", "fmp4" or "id3" for bytes that verifiably start as HLS media, else null. */
export function mediaTag(bytes: Uint8Array): "ts" | "fmp4" | "id3" | null {
  if (bytes.length >= 376) {
    const packets = Math.min(8, Math.floor(bytes.length / 188));
    let sync = true;
    for (let i = 0; i < packets; i++) if (bytes[i * 188] !== 0x47) sync = false;
    if (sync) return "ts";
  }
  if (bytes.length >= 8) {
    const size = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
    if (size >= 8 && FMP4_BOXES.has(latin1(bytes, 4, 8))) return "fmp4";
  }
  if (bytes.length >= 10 && latin1(bytes, 0, 3) === "ID3" && bytes[3] >= 2 && bytes[3] <= 4) return "id3";
  return null;
}

/** The image format of bytes that start as an image, else null. */
export function imageTag(bytes: Uint8Array): "jpeg" | "png" | "gif" | "webp" | "avif" | "bmp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && latin1(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(latin1(bytes, 0, 6))) return "gif";
  if (bytes.length >= 12 && latin1(bytes, 0, 4) === "RIFF" && latin1(bytes, 8, 12) === "WEBP") return "webp";
  if (bytes.length >= 12 && latin1(bytes, 4, 8) === "ftyp" && /^avi[fs]$/.test(latin1(bytes, 8, 12))) return "avif";
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  return null;
}

/** An HTML/JSON/XML page or a plain-text error where media or an image was expected. */
export function looksLikeErrorPage(bytes: Uint8Array): boolean {
  const prefix = new TextDecoder("utf-8").decode(bytes.subarray(0, 128)).replace(/^﻿/, "").trimStart();
  return /^(?:<!doctype\s+html\b|<!--|<\?xml\b|<(?:html|head|body|title|meta|script|div|h[1-6]|p)\b|\{\s*"|\[\s*[{"])/i.test(prefix)
    || /^(?:access\s+denied|forbidden\b|unauthorized\b|not\s+found\b|rate\s+limit(?:ed)?\b|internal\s+server\s+error|service\s+unavailable|error\b)/i.test(prefix);
}

/**
 * What the ledger records about a finished piece, so a later run can check the
 * file still looks the same: a key's byte hash, "enc" for an encrypted segment,
 * the media or image format, or "raw" for bytes no signature describes.
 */
export function pieceTag(piece: PlanPiece, bytes: Uint8Array): string {
  if (piece.kind === "key") return fnv64(bytes);
  if (piece.kind === "page") return imageTag(bytes) ?? "raw";
  if (piece.kind === "segment" && piece.encrypted) return "enc";
  return mediaTag(bytes) ?? "raw";
}

/** Whether a saved piece of [size] bytes, starting with [head], is still the one the ledger recorded. */
export function pieceStillValid(kind: PieceKind, tag: string, head: Uint8Array, size: number, recordedSize: number): boolean {
  if (kind === "key" || size <= 0 || size !== recordedSize) return false;
  switch (tag) {
    case "ts": case "fmp4": case "id3": return mediaTag(head) === tag;
    case "jpeg": case "png": case "gif": case "webp": case "avif": case "bmp": return imageTag(head) === tag;
    case "enc": return size % 16 === 0 && !looksLikeErrorPage(head);
    case "raw": return !looksLikeErrorPage(head);
    default: return false;
  }
}

// ── Ledger ──────────────────────────────────────────────────────────────────

export interface LedgerEntry { file: string; size: number; tag: string }
export interface Ledger { version: number; rendition: string; total: number; pieces: Map<number, LedgerEntry> }

export const ledgerHeader = (rendition: string, total: number) => `anitrack-ledger v${LEDGER_VERSION} ${rendition} ${total}\n`;
export const ledgerLine = (index: number, file: string, size: number, tag: string) => `${index} ${file} ${size} ${tag}\n`;

const HEADER_RE = /^anitrack-ledger v(\d+) ([0-9a-f]{16}) (\d+)$/;
const LINE_RE = /^(\d+) ([A-Za-z0-9_-][A-Za-z0-9._-]{0,127}) (\d+) ([A-Za-z0-9]{1,32})$/;

/**
 * Reads a ledger. Only lines ending in a newline count, so a line cut off when
 * the app was killed is ignored; a later line for the same piece wins.
 */
export function parseLedger(text: string): Ledger | null {
  const lines = text.split("\n");
  lines.pop(); // the unterminated remainder (empty when the file ends in a newline)
  const header = HEADER_RE.exec(lines[0] ?? "");
  if (!header) return null;
  const ledger: Ledger = { version: Number(header[1]), rendition: header[2], total: Number(header[3]), pieces: new Map() };
  for (const line of lines.slice(1)) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const index = Number(m[1]);
    if (index >= ledger.total) continue;
    ledger.pieces.set(index, { file: m[2], size: Number(m[3]), tag: m[4] });
  }
  return ledger;
}

// ── Resume plan ─────────────────────────────────────────────────────────────

export interface DiskPiece { size: number; head: Uint8Array }

export interface ResumePlan {
  /** The saved pieces belong to another rendition (or none are recorded): delete them all. */
  restart: boolean;
  /** Piece indices whose saved file is kept, ascending. */
  keep: number[];
  /** Piece indices to fetch, in plan order. Keys are always fetched again. */
  fetch: number[];
  /** The first non-key piece that has to be fetched (pieces.length when none). */
  firstMissing: number;
}

/**
 * What to keep and what to fetch for [pieces] (rendition [rendition]), given the
 * ledger left by an earlier run and a way to read a saved file's size and head.
 */
export function resumePlan(
  pieces: PlanPiece[],
  rendition: string,
  ledger: Ledger | null,
  disk: (file: string) => DiskPiece | null,
): ResumePlan {
  const all = pieces.map((_, i) => i);
  const firstNonKey = (indices: number[]) => indices.find((i) => pieces[i].kind !== "key") ?? pieces.length;
  if (!ledger || ledger.version !== LEDGER_VERSION || ledger.rendition !== rendition || ledger.total !== pieces.length) {
    return { restart: true, keep: [], fetch: all, firstMissing: firstNonKey(all) };
  }
  const keep: number[] = [];
  const fetch: number[] = [];
  pieces.forEach((piece, i) => {
    const entry = ledger.pieces.get(i);
    const named = entry && (!piece.file || piece.file === entry.file);
    const saved = named ? disk(entry.file) : null;
    if (entry && saved && pieceStillValid(piece.kind, entry.tag, saved.head, saved.size, entry.size)) keep.push(i);
    else fetch.push(i);
  });
  return { restart: false, keep, fetch, firstMissing: firstNonKey(fetch) };
}

/**
 * A key fetched again has to match the one recorded with the kept segments:
 * different bytes mean the segments were encrypted for another rendition.
 */
export function keyStillMatches(ledger: Ledger | null, index: number, tag: string): boolean {
  const entry = ledger?.pieces.get(index);
  return !entry || entry.tag === tag;
}

// ── Failures, waiting and re-resolving ─────────────────────────────────────

export const NETWORK_RETRIES = 4;
export const RATE_LIMIT_RETRIES = 8;
export const SERVER_RETRIES = 6;
export const MAX_RE_RESOLVES = 2;
export const MAX_RETRY_AFTER_MS = 10 * 60_000;
export const PAUSE_MS = 5 * 60_000;
export const MAX_PAUSE_MS = 6 * 60 * 60_000;
export const EXPIRY_MARGIN_MS = 60_000;
/** A resolved stream older than this is resolved again before a resumed run. */
export const MAX_RESOLVED_AGE_MS = 6 * 60 * 60_000;

export type Failure = { status: number; retryAfter?: string | null } | { network: true };

export type Step =
  | { action: "retry"; delayMs: number }
  | { action: "re-resolve" }
  | { action: "pause"; reason: "network" | "rate-limit" | "server"; resumeAt: number | null }
  | { action: "fail" };

/** Exponential backoff: 1 s, 2 s, 4 s… capped at a minute. */
export function backoffMs(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, Math.min(attempt, 16)));
}

/** Retry-After as milliseconds from [now] (delta seconds or an HTTP date), or null. */
export function retryAfterMs(header: string | null | undefined, now: number): number | null {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  if (!/[a-z]/i.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/**
 * What to do after a request failed: [attempt] failures of this request so far
 * (0 for the first), [reResolves] fresh streams already fetched in this run.
 */
export function nextStep(failure: Failure, attempt: number, reResolves: number, now: number): Step {
  if ("network" in failure) {
    return attempt < NETWORK_RETRIES ? { action: "retry", delayMs: backoffMs(attempt) } : { action: "pause", reason: "network", resumeAt: null };
  }
  const { status } = failure;
  if (status === 429 || status === 503) {
    const asked = retryAfterMs(failure.retryAfter, now);
    const delay = asked ?? backoffMs(attempt);
    if (asked != null && asked > MAX_RETRY_AFTER_MS) return { action: "pause", reason: "rate-limit", resumeAt: now + Math.min(asked, MAX_PAUSE_MS) };
    if (attempt < RATE_LIMIT_RETRIES) return { action: "retry", delayMs: delay };
    return { action: "pause", reason: "rate-limit", resumeAt: now + Math.max(delay, PAUSE_MS) };
  }
  if (status === 408 || status === 425 || (status >= 500 && status <= 599)) {
    return attempt < SERVER_RETRIES ? { action: "retry", delayMs: backoffMs(attempt) } : { action: "pause", reason: "server", resumeAt: now + PAUSE_MS };
  }
  if (status === 401 || status === 403 || status === 410) return reResolves < MAX_RE_RESOLVES ? { action: "re-resolve" } : { action: "fail" };
  if (status === 404) return reResolves < 1 ? { action: "re-resolve" } : { action: "fail" };
  return { action: "fail" };
}

const EXPIRY_PARAMS = new Set(["expires", "expiry", "expire", "exp", "e", "validto"]);

function epochMs(value: string): number | null {
  if (!/^\d{9,13}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1e12 ? n : n * 1000;
}

/** When a signed URL says it stops working (epoch ms), or null when it doesn't say. */
export function urlExpiresAt(url: string): number | null {
  const query = url.split("#")[0].split("?")[1];
  if (!query) return null;
  const params = new Map<string, string>();
  for (const part of query.split("&")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    let name = part.slice(0, at), value = part.slice(at + 1);
    try { name = decodeURIComponent(name); value = decodeURIComponent(value); } catch { /* keep raw */ }
    params.set(name.toLowerCase(), value);
  }
  for (const name of EXPIRY_PARAMS) {
    const at = params.has(name) ? epochMs(params.get(name)!) : null;
    if (at != null) return at;
  }
  const amzDate = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(params.get("x-amz-date") ?? "");
  const amzExpires = params.get("x-amz-expires");
  if (amzDate && amzExpires && /^\d+$/.test(amzExpires)) {
    const [, y, mo, d, h, mi, s] = amzDate.map(Number);
    return Date.UTC(y, mo - 1, d, h, mi, s) + Number(amzExpires) * 1000;
  }
  const akamai = /(?:^|~)exp=(\d{9,13})(?:~|$)/.exec(params.get("hdnts") ?? params.get("hdnea") ?? "");
  return akamai ? epochMs(akamai[1]) : null;
}

/**
 * Whether to resolve the stream again before fetching more of it: [url] expires
 * within a minute, or it was resolved ([resolvedAt]) longer ago than signed
 * streams last.
 */
export function reResolveBeforeFetch(url: string, resolvedAt: number, now: number): boolean {
  const expires = urlExpiresAt(url);
  if (expires != null && now >= expires - EXPIRY_MARGIN_MS) return true;
  return now - resolvedAt > MAX_RESOLVED_AGE_MS;
}
