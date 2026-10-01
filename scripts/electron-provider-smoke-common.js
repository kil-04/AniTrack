const { isIP } = require("node:net");

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MEDIA_SNIFF_BYTES = 1024;

function publicHttpsUrl(raw, base) {
  let url;
  try { url = new URL(raw, base); } catch { throw new Error("Media URI was invalid"); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
      || !host.includes(".") || isIP(host) || host.endsWith(".localhost")
      || host.endsWith(".local") || host.endsWith(".internal") || url.toString().length > 16_384) {
    throw new Error("Media URI must be a public HTTPS URL");
  }
  url.hash = "";
  return url.toString();
}

function safeMessage(error) {
  return String(error?.message ?? error ?? "Unknown failure")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL omitted]")
    .replace(/\r?\n/g, " ").slice(0, 500);
}

async function readManifest(response) {
  if (Number(response.headers.get("content-length")) > MAX_MANIFEST_BYTES) {
    await response.body?.cancel();
    throw new Error("Manifest response was unexpectedly large");
  }
  if (!response.body) throw new Error("Manifest response was empty");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_MANIFEST_BYTES) {
        await reader.cancel();
        throw new Error("Manifest response was unexpectedly large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

/** Read at most `limit` bytes, then cancel so whole segments are never downloaded. */
async function readPrefix(response, limit) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (bytes < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      bytes += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes).subarray(0, limit);
}

const FMP4_BOX_TYPES = new Set(["ftyp", "styp", "moof", "moov", "sidx", "emsg", "prft"]);

/** Classify a body prefix: a media format name, "page", "empty", or "" if unknown. */
function mediaFormat(bytes) {
  if (!bytes.length) return "empty";
  const packets = Math.min(8, Math.floor(bytes.length / 188));
  if (packets >= 2 && Array.from({ length: packets }, (_, i) => bytes[i * 188]).every((sync) => sync === 0x47)) return "MPEG-TS";
  if (bytes.length >= 8 && bytes.readUInt32BE(0) >= 8 && FMP4_BOX_TYPES.has(bytes.toString("latin1", 4, 8))) return "fMP4";
  if (bytes.length >= 10 && bytes.toString("latin1", 0, 3) === "ID3" && bytes[3] >= 2 && bytes[3] <= 4) return "packed audio";
  const text = bytes.subarray(0, 128).toString("utf8").replace(/^﻿/, "").trimStart();
  return /^(?:<!doctype\s+html\b|<\?xml\b|<(?:html|head|body)\b|\{\s*"|\[\s*[{"])/i.test(text) ? "page" : "";
}

function playlistSelection(manifest, base) {
  const lines = manifest.split(/\r?\n/).map((line) => line.trim());
  if (!lines.some((line) => line === "#EXTM3U")) throw new Error("Response was not an HLS manifest");
  let variant = null;
  let bandwidth = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const candidate = lines.slice(i + 1).find((line) => line && !line.startsWith("#"));
    const score = Number(/(?:^|,)BANDWIDTH=(\d+)/.exec(lines[i].slice(lines[i].indexOf(":") + 1))?.[1] ?? 0);
    if (candidate && score > bandwidth) {
      variant = publicHttpsUrl(candidate, base);
      bandwidth = score;
    }
  }
  if (variant) return { variant };
  const media = lines.filter((line) => line && !line.startsWith("#"));
  if (!media.length) throw new Error("HLS playlist contained no media URI");
  return { first: publicHttpsUrl(media[0], base), last: publicHttpsUrl(media.at(-1), base), count: media.length };
}

/** Validate every redirect/playlist URI and look up credentials for that URL. */
function createMediaProbe({ fetch, authorization, report = () => {}, timeoutMs = 15_000 }) {
  async function request(raw, extraHeaders = {}) {
    let url = publicHttpsUrl(raw);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const credentials = authorization(url);
      const response = await fetch(url, {
        headers: { ...(credentials?.headers ?? {}), ...extraHeaders },
        // CDN responses commonly allow '*', which rejects fetch's ambient
        // credential mode. Use only explicitly scoped headers returned above.
        credentials: "omit",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects === 3) throw new Error("Media redirect limit reached");
        url = publicHttpsUrl(location, url);
        continue;
      }
      if (response.status === 403 || response.status === 429) {
        await response.body?.cancel();
        throw new Error(`Media request rejected with HTTP ${response.status}; no retry was sent`);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Media request returned HTTP ${response.status}`);
      }
      return { response, url };
    }
    throw new Error("Media redirect limit reached");
  }

  async function verifyMedia(url, label, headers = {}) {
    const result = await request(url, headers);
    const contentType = result.response.headers.get("content-type") ?? "";
    // Some CDNs serve MPEG-TS behind randomized .png/.html names with a matching
    // Content-Type, so classify the first bytes instead of trusting the header.
    const format = mediaFormat(await readPrefix(result.response, MEDIA_SNIFF_BYTES));
    if (format === "page" || (!format && /text\/html|application\/json/i.test(contentType))) {
      throw new Error(`${label} returned a page instead of media`);
    }
    if (format === "empty") throw new Error(`${label} returned an empty body`);
    report(label, `HTTP ${result.response.status}, ${format || "unrecognized payload"}${headers.Range && result.response.status === 200 ? " (byte range ignored)" : ""}`);
    return { status: result.response.status, host: new URL(result.url).hostname, format };
  }

  async function verifyHls(streamUrl) {
    let url = publicHttpsUrl(streamUrl);
    const visited = new Set();
    for (let depth = 0; depth <= 4; depth++) {
      if (visited.has(url)) throw new Error("HLS manifest loop detected");
      visited.add(url);
      const result = await request(url);
      const selection = playlistSelection(await readManifest(result.response), result.url);
      report(`manifest ${depth + 1}`, `HTTP ${result.response.status}`);
      if (selection.variant) {
        if (depth === 4) throw new Error("HLS playlist nesting exceeded four transitions");
        url = selection.variant;
        continue;
      }
      const first = await verifyMedia(selection.first, "first media");
      const last = await verifyMedia(selection.last, "last media");
      const range = await verifyMedia(selection.first, "byte range", { Range: "bytes=0-1023" });
      return { manifestDepth: depth + 1, mediaCount: selection.count, firstHost: first.host, lastHost: last.host, rangeStatus: range.status };
    }
    throw new Error("HLS master playlist did not lead to media");
  }

  return { verifyHls };
}

module.exports = { createMediaProbe, mediaFormat, playlistSelection, publicHttpsUrl, safeMessage };
