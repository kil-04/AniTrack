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

/**
 * Bytes that are all zero. After a power cut, a file whose rename reached the
 * disk before its data can come back at the right size but zero-filled.
 */
export function zeroFilled(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0);
}

/** Whether a saved piece of [size] bytes, starting with [head], is still the one the ledger recorded. */
export function pieceStillValid(kind: PieceKind, tag: string, head: Uint8Array, size: number, recordedSize: number): boolean {
  if (kind === "key" || size <= 0 || size !== recordedSize) return false;
  switch (tag) {
    case "ts": case "fmp4": case "id3": return mediaTag(head) === tag;
    case "jpeg": case "png": case "gif": case "webp": case "avif": case "bmp": return imageTag(head) === tag;
    // No signature to check: a zero-filled head is a file lost to a power cut, not media.
    case "enc": return size % 16 === 0 && !zeroFilled(head) && !looksLikeErrorPage(head);
    case "raw": return !zeroFilled(head) && !looksLikeErrorPage(head);
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
/**
 * Runs in a row that may stop without saving a media piece (stalls) before the
 * next one gives up: a 401/403/410 then fails, and so does any stop but a rate
 * limit or an offline wait ([afterStop]).
 */
export const MAX_RE_RESOLVES = 2;
export const MAX_RETRY_AFTER_MS = 10 * 60_000;
export const PAUSE_MS = 5 * 60_000;
export const MAX_PAUSE_MS = 6 * 60 * 60_000;
export const EXPIRY_MARGIN_MS = 60_000;
/** A resolved stream older than this is resolved again before a resumed run. */
export const MAX_RESOLVED_AGE_MS = 6 * 60 * 60_000;

/** A request that got no answer while the device is online waits this long before the next run. */
export const UNREACHABLE_PAUSE_MS = 60_000;
/** Rate-limit stops keep waiting for at most about this long after the first one without progress. */
export const MAX_RATE_LIMITED_MS = 60 * 60_000;
/** …and for at most this many of them in a row, whatever the clock says. */
export const MAX_RATE_LIMIT_STALLS = 12;
/** The least a rate-sensitive (conservative) stream waits before trying again; it doubles with each stall. */
export const CONSERVATIVE_PAUSE_MS = 30_000;
/** Captions are best-effort: this many quick retries, each at most [MAX_CAPTION_WAIT_MS] away. */
export const CAPTION_RETRIES = 2;
export const MAX_CAPTION_WAIT_MS = 30_000;

/**
 * Why a request failed: an HTTP status, or no answer at all (offline, reset,
 * refused, timed out). [online] is whether the device had a network when it
 * gave up: only then is a missing answer the server's fault rather than the network's.
 */
export type Failure = { status: number; retryAfter?: string | null } | { network: true; online: boolean };

export type PauseReason = "network" | "rate-limit" | "server";

export type Step =
  | { action: "retry"; delayMs: number }
  | { action: "re-resolve" }
  | { action: "pause"; reason: PauseReason; resumeAt: number | null }
  | { action: "fail" };

/** Exponential backoff: 1 s, 2 s, 4 s… capped at a minute. */
export function backoffMs(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, Math.min(attempt, 16)));
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY = "(?:mon|tue|wed|thu|fri|sat|sun)";
const LONG_DAY = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)";
const TIME = "(\\d{2}):(\\d{2}):(\\d{2})";
// Matched against the value with ASCII letters lowercased (names may come in any case).
/** IMF-fixdate: Sun, 06 Nov 1994 08:49:37 GMT */
const IMF_FIXDATE = new RegExp(`^${DAY}, (\\d{2}) ${MONTH} (\\d{4}) ${TIME} gmt$`);
/** RFC 850: Sunday, 06-Nov-94 08:49:37 GMT */
const RFC_850 = new RegExp(`^${LONG_DAY}, (\\d{2})-${MONTH}-(\\d{2}) ${TIME} gmt$`);
/** asctime: Sun Nov  6 08:49:37 1994 (always GMT) */
const ASCTIME = new RegExp(`^${DAY} ${MONTH} ( \\d|\\d{2}) ${TIME} (\\d{4})$`);

/** UTC epoch ms of a calendar date and time, or null when it isn't one (31 Nov, 24:00, a leap second). */
function utc(year: number, month: number, day: number, hour: number, minute: number, second: number): number | null {
  if (month < 0 || month > 11 || hour > 23 || minute > 59 || second > 59) return null;
  // setUTCFullYear, not Date.UTC: that one reads years 0-99 as 1900-1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? date.getTime() : null;
}

/**
 * An HTTP-date (RFC 9110: IMF-fixdate, or the obsolete RFC 850 and asctime
 * forms; GMT only, names in any case) as epoch ms, or null for anything else.
 * RFC 850's two-digit year is the one nearest [now] that isn't over 50 years ahead.
 */
export function httpDateMs(header: string, now: number): number | null {
  const value = header.replace(/[A-Z]/g, (c) => c.toLowerCase());
  let m = IMF_FIXDATE.exec(value);
  if (m) return utc(Number(m[3]), MONTHS.indexOf(m[2]), Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  m = RFC_850.exec(value);
  if (m) {
    const thisYear = new Date(now).getUTCFullYear();
    let year = thisYear - (thisYear % 100) + Number(m[3]);
    if (year > thisYear + 50) year -= 100;
    return utc(year, MONTHS.indexOf(m[2]), Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  }
  m = ASCTIME.exec(value);
  if (m) return utc(Number(m[6]), MONTHS.indexOf(m[1]), Number(m[2].trim()), Number(m[3]), Number(m[4]), Number(m[5]));
  return null;
}

/**
 * Retry-After as milliseconds from [now], or null: delta seconds (more than
 * nine digits count as 999999999 s), or an HTTP-date ([httpDateMs]; one in the past is 0).
 */
export function retryAfterMs(header: string | null | undefined, now: number): number | null {
  const value = header?.replace(/^[ \t]+|[ \t]+$/g, "");
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const digits = value.replace(/^0+(?=\d)/, "");
    return (digits.length > 9 ? 999_999_999 : Number(digits)) * 1000;
  }
  const at = httpDateMs(value, now);
  return at == null ? null : Math.max(0, at - now);
}

/**
 * The stall streak a run is on now, for [nextStep], [conservativeStep] and the
 * check before a fetch ([reResolveBeforeFetch]): the [reResolves] it started
 * with until it saves a media piece ([progressed]), then 0. That run is no
 * stall, so a later refusal, 404 or expiring URL in it resolves the stream
 * again instead of failing on the budget earlier stalls used up.
 */
export function streakNow(reResolves: number, progressed: boolean): number {
  return progressed ? 0 : reResolves;
}

/**
 * What to do after a request failed: [attempt] failures of this request so far
 * (0 for the first), [reResolves] runs in a row that stopped without saving a
 * media piece, this one included while it hasn't saved one ([streakNow]); each
 * starts with a freshly resolved stream.
 */
export function nextStep(failure: Failure, attempt: number, reResolves: number, now: number): Step {
  if ("network" in failure) {
    if (attempt < NETWORK_RETRIES) return { action: "retry", delayMs: backoffMs(attempt) };
    // Offline: wait for the network, however long. Online, the server isn't
    // answering (a dead host, a refused connection, a timeout): that is a stall.
    return failure.online
      ? { action: "pause", reason: "server", resumeAt: now + UNREACHABLE_PAUSE_MS }
      : { action: "pause", reason: "network", resumeAt: null };
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

/**
 * A rate-sensitive (conservative) stream is never retried at once: a step that
 * would retry becomes a pause of at least [CONSERVATIVE_PAUSE_MS], doubling with
 * each run in a row that stalled ([reResolves]), up to [MAX_RETRY_AFTER_MS].
 */
export function conservativeStep(step: Step, failure: Failure, reResolves: number, now: number): Step {
  if (step.action !== "retry") return step;
  if ("network" in failure && !failure.online) return { action: "pause", reason: "network", resumeAt: null };
  const least = Math.min(MAX_RETRY_AFTER_MS, CONSERVATIVE_PAUSE_MS * 2 ** Math.max(0, Math.min(reResolves, 8)));
  const limited = "status" in failure && (failure.status === 429 || failure.status === 503);
  return { action: "pause", reason: limited ? "rate-limit" : "server", resumeAt: now + Math.max(step.delayMs, least) };
}

/** Why a run stopped with its pieces kept: a pause's reason, or "expired" (resolve the stream again). */
export type StopReason = PauseReason | "expired";

export type Verdict =
  | { action: "wait"; reResolves: number; stalledSince: number | null }
  | { action: "fail"; reason: Exclude<StopReason, "network"> };

/**
 * After a run stopped without finishing: wait and try again, or give up.
 *
 * A run that stops without saving a media piece is a stall (keys don't count,
 * nor does a run that discarded what was saved for another rendition).
 * [reResolves] stalls in a row came before this run, the first of them at
 * [stalledSince]; [progressed]: this run saved a piece, which ends the streak.
 *
 * - Waiting for the network while offline never counts, however long it lasts.
 * - A rate limit keeps waiting until about [MAX_RATE_LIMITED_MS] after the
 *   streak began (or [MAX_RATE_LIMIT_STALLS] stalls), so even a six-hour
 *   Retry-After is tried once more before giving up.
 * - Anything else (a server error, no answer while online, a stream that keeps
 *   expiring) gives up at the third stall in a row.
 */
export function afterStop(reason: StopReason, reResolves: number, stalledSince: number | null, progressed: boolean, now: number): Verdict {
  if (progressed) return { action: "wait", reResolves: 0, stalledSince: null };
  if (reason === "network") return { action: "wait", reResolves, stalledSince };
  const since = stalledSince ?? now;
  if (reason === "rate-limit") {
    if ((reResolves > 0 && now - since >= MAX_RATE_LIMITED_MS) || reResolves >= MAX_RATE_LIMIT_STALLS) return { action: "fail", reason };
  } else if (reResolves >= MAX_RE_RESOLVES) {
    return { action: "fail", reason };
  }
  return { action: "wait", reResolves: reResolves + 1, stalledSince: since };
}

/** The message a download that gave up ([afterStop]'s reason) shows, for an episode or a manga/novel chapter. */
export function stalledMessage(reason: Exclude<StopReason, "network">, item: "episode" | "chapter"): string {
  const from = item === "episode" ? "server" : "source";
  if (reason === "rate-limit") return `The ${from} kept asking to wait. Try again later${item === "episode" ? " or choose another server" : ""}.`;
  if (reason === "expired") {
    return item === "episode"
      ? "The stream kept expiring before any of it could be saved. Try another server."
      : "The source's page addresses kept expiring before any page could be saved. Try again later.";
  }
  return `The ${from} kept failing on part of this ${item}. ${item === "episode" ? "Try another server." : "Try again later."}`;
}

/**
 * Captions are best-effort: after a caption request failed ([attempt] failures
 * so far), retry a couple of times when the wait is short, never pause for the
 * server or resolve the stream again. "fail" means finish without captions.
 * Offline, the episode instead waits for the network ("pause"), so a dropped
 * connection doesn't cost it its captions.
 */
export function captionStep(failure: Failure, attempt: number, conservative: boolean, now: number): Step {
  const transient = "network" in failure
    || failure.status === 408 || failure.status === 425 || failure.status === 429 || (failure.status >= 500 && failure.status <= 599);
  if (!transient) return { action: "fail" };
  if (attempt < CAPTION_RETRIES) {
    const asked = "status" in failure ? retryAfterMs(failure.retryAfter, now) : null;
    const delayMs = Math.max(asked ?? backoffMs(attempt), conservative ? CONSERVATIVE_PAUSE_MS : 0);
    if (delayMs <= MAX_CAPTION_WAIT_MS) return { action: "retry", delayMs };
  }
  return "network" in failure && !failure.online ? { action: "pause", reason: "network", resumeAt: null } : { action: "fail" };
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

/**
 * [reResolveBeforeFetch] for a run whose stall streak began at [reResolves]. A
 * stream that still had a minute left when it was resolved ([resolvedAt]) is
 * always resolved again once it runs out: a fresh one helps, and a run that
 * keeps getting fresh streams without saving anything stalls ([afterStop]).
 * One that was already about to expire when it was resolved is resolved again
 * only within the streak's budget, then tried as it is, so a source whose
 * streams always say they expire soon still downloads (and a run that saved a
 * piece of it isn't sent for a fresh one before every request).
 */
export function reResolveFirst(url: string, resolvedAt: number, reResolves: number, now: number): boolean {
  if (!reResolveBeforeFetch(url, resolvedAt, now)) return false;
  const expires = urlExpiresAt(url);
  return expires == null || expires - EXPIRY_MARGIN_MS > resolvedAt || reResolves < MAX_RE_RESOLVES;
}
