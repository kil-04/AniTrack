import { createDecipheriv } from "node:crypto";
import type { ProviderSkipRange, ProviderSubtitle } from "./types";
import { classifyMkissaFailure, MkissaProviderError, publicHttpsUrl, safeText } from "./mkissa-utils";

type Json = Record<string, unknown>;
const MAX_PAYLOAD_BYTES = 1024 * 1024;

export interface ByseMedia {
  url: URL;
  hls: boolean;
  subtitles: ProviderSubtitle[];
  intro?: ProviderSkipRange;
}

function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}

function invalid(message: string): never {
  throw new MkissaProviderError(message, "UNSUPPORTED_SOURCE");
}

/** The public Byse frontend's normal same-origin GET routes, not its CAPTCHA API. */
export function byseApiUrl(embed: URL, operation: "settings" | "playback"): URL {
  const match = /^\/e\/([A-Za-z0-9_-]{1,200})\/?$/.exec(embed.pathname);
  if (!match || (embed.port && embed.port !== "443")) invalid("MKissa HLS server embed route changed");
  return publicHttpsUrl(`/api/videos/${match[1]}/embed/${operation}`, embed.origin);
}

/** Never synthesize fingerprint/CAPTCHA tokens or call verification endpoints. */
export function assertByseAccess(payload: Json): void {
  const messages = [payload.error, payload.message].filter((value): value is string => typeof value === "string");
  // `code` in successful settings is the file identifier, not an error.
  const failure = classifyMkissaFailure([...messages, ...(typeof payload.code === "string" ? [payload.code] : [])]);
  if (failure) throw failure;
  if (payload.captcha_required || payload.fingerprint_required
    || messages.some(value => /fingerprint|attestation|proof.of.work|verification.required/i.test(value))
    || payload.pow_nonce != null || payload.pow_token != null) {
    throw new MkissaProviderError("This MKissa HLS server requires a website check. No automatic verification was attempted.", "CAPTCHA_REQUIRED");
  }
  if (payload.premium_only) invalid("This MKissa HLS server requires an upstream account");
  if (object(payload.processing)?.locked) invalid("This MKissa HLS server's video is still processing");
  if (messages.length) invalid(safeText(messages[0], 200) || "MKissa HLS server rejected playback");
}

function base64(value: unknown, maximumBytes: number): Buffer {
  if (typeof value !== "string" || !value || value.length > Math.ceil(maximumBytes * 4 / 3) + 4
    || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value) || value.replace(/=+$/, "").length % 4 === 1) {
    invalid("MKissa HLS server returned invalid encrypted data");
  }
  const normalized = value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length > maximumBytes || decoded.toString("base64url") !== normalized) {
    invalid("MKissa HLS server returned invalid encrypted data");
  }
  return decoded;
}

/** Locally reviewed port of readable AES-GCM codec in Byse's public video module. */
export function decodeBysePlayback(value: unknown): Json {
  const encrypted = object(value);
  if (!encrypted || !Array.isArray(encrypted.key_parts) || !encrypted.key_parts.length
    || encrypted.key_parts.length > 64
    || (encrypted.algorithm != null && encrypted.algorithm !== "AES-GCM")) {
    invalid("MKissa HLS server returned unsupported playback data");
  }
  const parts = encrypted.key_parts;
  let selected: unknown[] = parts;
  // The public version map is n -> [n, 31-n], with 1-based part indexes.
  // Unknown versions use all parts, exactly as the site's readable decoder does.
  const version = typeof encrypted.version === "string" ? encrypted.version.trim() : "";
  if (/^(?:[1-9]|1[0-9]|20)$/.test(version)) {
    const indexes = [Number(version), 31 - Number(version)];
    if (indexes.every(index => index <= parts.length)) selected = indexes.map(index => parts[index - 1]);
  }
  const key = Buffer.concat(selected.map(part => base64(part, 64)));
  if (![16, 24, 32].includes(key.length)) invalid("MKissa HLS server returned an unsupported key length");
  const iv = base64(encrypted.iv, 32);
  const payload = base64(encrypted.payload, MAX_PAYLOAD_BYTES + 16);
  if (iv.length !== 12 || payload.length < 16) invalid("MKissa HLS server returned invalid encrypted data");
  try {
    const algorithm = key.length === 16 ? "aes-128-gcm" : key.length === 24 ? "aes-192-gcm" : "aes-256-gcm";
    const decipher = createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(payload.subarray(-16));
    const decoded = Buffer.concat([decipher.update(payload.subarray(0, -16)), decipher.final()]);
    if (decoded.length > MAX_PAYLOAD_BYTES) invalid("MKissa HLS server playback data is too large");
    const result = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded)));
    if (!result) invalid("MKissa HLS server returned invalid playback JSON");
    return result;
  } catch (error) {
    if (error instanceof MkissaProviderError) throw error;
    invalid("MKissa HLS server playback data could not be decoded");
  }
}

export function byseMedia(payload: Json): ByseMedia {
  assertByseAccess(payload);
  const playback = decodeBysePlayback(payload.playback);
  assertByseAccess(playback);
  if (!Array.isArray(playback.sources) || playback.sources.length > 32) invalid("MKissa HLS server returned no supported media");
  const candidates = playback.sources.flatMap((raw, index) => {
    const source = object(raw);
    if (!source || typeof source.url !== "string" || source.url.length > 8192) return [];
    const url = publicHttpsUrl(source.url);
    const mime = typeof source.mime_type === "string" ? source.mime_type.toLowerCase().split(";", 1)[0].trim() : "";
    const hls = /\.m3u8$/i.test(url.pathname);
    const mp4 = /\.mp4$/i.test(url.pathname) || mime === "video/mp4";
    if ((!hls && !mp4) || (mime && !["video/mp4", "application/vnd.apple.mpegurl", "application/x-mpegurl"].includes(mime))) return [];
    if (hls && mime === "video/mp4" || !hls && /mpegurl/.test(mime)) return [];
    const height = Number(source.height ?? source.quality);
    return [{ url, hls, height: Number.isFinite(height) && height > 0 ? height : 0, index }];
  }).sort((a, b) => Number(b.hls) - Number(a.hls) || b.height - a.height || a.index - b.index);
  if (!candidates.length) invalid("MKissa HLS server returned no supported direct media");
  const subtitles: ProviderSubtitle[] = [];
  if (Array.isArray(playback.tracks)) {
    if (playback.tracks.length > 32) invalid("MKissa HLS server returned too many captions");
    for (const raw of playback.tracks) {
      const track = object(raw);
      if (!track || typeof track.url !== "string" || track.url.length > 8192) continue;
      const kind = typeof track.kind === "string" ? track.kind.toLowerCase() : "captions";
      if (!["captions", "subtitles"].includes(kind)) continue;
      const file = publicHttpsUrl(track.url).toString();
      const mime = typeof track.mime_type === "string" ? track.mime_type.toLowerCase() : "";
      if (!/\.vtt$/i.test(new URL(file).pathname) && mime !== "text/vtt") continue;
      if (!subtitles.some(entry => entry.file === file)) subtitles.push({ file,
        label: safeText(track.title, 100) || safeText(track.language, 30) || "Subtitles", kind: "captions", default: track.default === true });
    }
  }
  const skip = object(payload.skip_intro);
  const start = Number(skip?.from_seconds), end = Number(skip?.to_seconds);
  const intro = skip && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= 3600
    ? { start, end } : undefined;
  return { url: candidates[0].url, hls: candidates[0].hls, subtitles, ...(intro ? { intro } : {}) };
}
