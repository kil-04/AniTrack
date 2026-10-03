import { assertAnikotoMediaUrl } from "./anikoto-source";
import { authorizeResolvedStream } from "./stream-authorization";
import type { StreamData } from "./types";

interface HlsOptions {
  /** Provider name shown in error messages. */
  label?: string;
  deadlineMillis?: number;
  authorize?: (stream: StreamData) => void;
}

interface VerifiedPlaylist {
  url: string | null;
  complete: boolean;
}

interface PlaylistChild {
  video: boolean;
  bandwidth: number;
}

const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const MAX_PLAYLISTS = 8;
const MAX_VARIANTS = 4;
const MAX_REFERENCES = 10_000;
const MAX_DIRECTORIES = 256;

/** Authorize observed media directories and return a verified playable playlist. */
export async function prepareAnikotoHlsAuthorization(
  initialUrl: string,
  referer: string,
  fetcher: (url: string, options?: RequestInit) => Promise<Response>,
  options: HlsOptions = {},
): Promise<string> {
  const label = options.label ?? "Anikoto";
  const rootUrl = assertAnikotoMediaUrl(initialUrl);
  const safeReferer = assertAnikotoMediaUrl(referer);
  const controller = new AbortController();
  const timeoutError = new Error(`${label} playlist verification timed out. Try again or choose another server.`);
  let rejectDeadline: (error: Error) => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(() => {
    controller.abort(timeoutError);
    rejectDeadline(timeoutError);
  }, options.deadlineMillis ?? 30_000);
  const authorizations = new Map<string, StreamData>();
  const visited = new Set<string>();
  const verifiedPlaylists = new Map<string, VerifiedPlaylist>();
  let references = 0;

  function remember(raw: string): string {
    const url = assertAnikotoMediaUrl(raw);
    const parsed = new URL(url);
    if (/\/segment\/[A-Za-z0-9_+-]{32,}={0,2}\/?$/.test(parsed.pathname)) {
      throw new Error(`${label} returned encrypted playlist links. Choose another server while support for this stream format is updated.`);
    }
    const directory = `${parsed.origin}${parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1)}`;
    if (!authorizations.has(directory)) {
      if (authorizations.size >= MAX_DIRECTORIES) throw new Error(`${label} playlist references too many media directories`);
      authorizations.set(directory, {
        url, referer: safeReferer, authorizationScope: "directory", cors: true,
      });
    }
    return url;
  }

  function reference(raw: string, base: string): string {
    if (++references > MAX_REFERENCES) throw new Error(`${label} playlist has too many media references`);
    let absolute: string;
    try { absolute = new URL(raw, base).toString(); }
    catch { throw new Error(`${label} playlist contains an invalid media reference`); }
    return remember(absolute);
  }

  async function readPlaylist(response: Response): Promise<string> {
    if (Number(response.headers.get("content-length")) > MAX_PLAYLIST_BYTES) {
      void response.body?.cancel().catch(() => {});
      throw new Error(`${label} playlist exceeds the supported size`);
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (reader) {
        const part = await Promise.race([reader.read(), deadline]);
        controller.signal.throwIfAborted();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > MAX_PLAYLIST_BYTES) throw new Error(`${label} playlist exceeds the supported size`);
        chunks.push(part.value);
      }
    } catch (error) {
      void reader?.cancel().catch(() => {});
      throw error;
    } finally {
      reader?.releaseLock();
    }
    return Buffer.concat(chunks, length).toString("utf8");
  }

  async function inspect(raw: string, depth: number, ancestors = new Set<string>()): Promise<VerifiedPlaylist> {
    controller.signal.throwIfAborted();
    const url = remember(raw);
    if (ancestors.has(url)) throw new Error(`${label} playlist contains a circular rendition link`);
    if (verifiedPlaylists.has(url)) return verifiedPlaylists.get(url)!;
    if (depth > 4 || visited.size >= MAX_PLAYLISTS) throw new Error(`${label} playlist nesting exceeds the supported limit`);
    visited.add(url);
    const childAncestors = new Set(ancestors).add(url);
    const response = await Promise.race([fetcher(url, {
      headers: { Referer: safeReferer, Origin: new URL(safeReferer).origin }, signal: controller.signal,
    }), deadline]);
    controller.signal.throwIfAborted();
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      // An absent optional rendition must not make every other one unavailable.
      if (response.status === 404 && depth > 0) {
        const missing = { url: null, complete: false };
        verifiedPlaylists.set(url, missing);
        return missing;
      }
      throw new Error(`${label} playlist request failed (HTTP ${response.status})`);
    }
    const base = remember(response.url || url);
    const playlist = await readPlaylist(response);
    const lines = playlist.replace(/^\uFEFF/, "").split(/\r?\n/).map(line => line.trim());
    if (lines[0] !== "#EXTM3U") throw new Error(`${label} returned an invalid HLS playlist`);
    const children = new Map<string, PlaylistChild>();
    let nextVariant: number | null = null;
    let mediaReferences = 0;
    let externalAudio = false;
    for (const line of lines.slice(1)) {
      if (!line) continue;
      if (line.startsWith("#")) {
        if (line.startsWith("#EXT-X-STREAM-INF:")) {
          const bandwidth = Number(line.slice(line.indexOf(":") + 1).match(/(?:^|,)BANDWIDTH=(\d+)/)?.[1] ?? 0);
          nextVariant = Number.isSafeInteger(bandwidth) ? bandwidth : 0;
        }
        const uriAttributes = [...line.matchAll(/\bURI\s*=\s*"([^"]+)"/g)];
        if (/\bURI\s*=/.test(line) && uriAttributes.length === 0) throw new Error(`${label} playlist contains an invalid URI attribute`);
        if (line.startsWith("#EXT-X-MEDIA:") && /\bTYPE=AUDIO(?:,|$)/.test(line) && uriAttributes.length > 0) externalAudio = true;
        for (const match of uriAttributes) {
          const child = reference(match[1], base);
          if (/\.m3u8$/i.test(new URL(child).pathname)
            || line.startsWith("#EXT-X-I-FRAME-STREAM-INF:")) {
            if (!children.has(child)) children.set(child, { video: false, bandwidth: 0 });
          }
          else if (line.startsWith("#EXT-X-PART:")) mediaReferences++;
        }
        continue;
      }
      const child = reference(line, base);
      if (nextVariant !== null || /\.m3u8$/i.test(new URL(child).pathname)) {
        children.set(child, { video: true, bandwidth: Math.max(nextVariant ?? 0, children.get(child)?.bandwidth ?? 0) });
      }
      else mediaReferences++;
      nextVariant = null;
    }
    if (nextVariant !== null) throw new Error(`${label} playlist is missing a rendition URL`);
    if (children.size > MAX_VARIANTS) throw new Error(`${label} playlist has too many renditions to verify`);
    let complete = true;
    let best: { url: string; bandwidth: number } | null = null;
    for (const [child, metadata] of children) {
      const result = await inspect(child, depth + 1, childAncestors);
      complete = complete && result.complete;
      if (metadata.video && result.url && (!best || metadata.bandwidth > best.bandwidth)) {
        best = { url: result.url, bandwidth: metadata.bandwidth };
      }
    }
    const available = mediaReferences > 0 || best !== null;
    if (available && !complete && externalAudio) {
      throw new Error(`${label} has a missing quality in a stream with separate audio. Choose another server so video and sound stay together.`);
    }
    // Returning a master that still advertises a missing quality lets HLS or
    // the downloader select the broken URL again. Keep ABR only when complete.
    const result: VerifiedPlaylist = {
      url: available ? (complete || mediaReferences > 0 ? base : best!.url) : null,
      complete: available && complete,
    };
    verifiedPlaylists.set(url, result);
    return result;
  }

  try {
    const result = await Promise.race([inspect(rootUrl, 0), deadline]);
    controller.signal.throwIfAborted();
    if (!result.url) throw new Error(`${label} playlist has no accessible media rendition`);
    const authorize = options.authorize ?? authorizeResolvedStream;
    for (const stream of authorizations.values()) authorize(stream);
    return result.url;
  } finally {
    clearTimeout(timer);
  }
}
