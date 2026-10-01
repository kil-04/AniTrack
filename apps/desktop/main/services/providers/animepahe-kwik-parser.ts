const MAX_HTML_BYTES = 2 * 1024 * 1024;
const VIDEO_RE = /https:\/\/[^"'\s<>\\]+\.(?:m3u8|mp4)(?:\?[^"'\s<>\\]*)?/gi;

/** Bound a stage even if a transport or cookie API ignores cancellation. */
export function awaitKwikStage<T>(stage: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (value: T | undefined, error?: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      if (error !== undefined) reject(error);
      else resolve(value as T);
    };
    const abort = () => finish(undefined, new Error("Kwik request timed out. Retry or choose another provider."));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(stage).then((value) => finish(value), (error) => finish(undefined, error));
    if (signal.aborted) abort();
  });
}

export async function readKwikHtml(response: Response, signal = AbortSignal.timeout(20_000)): Promise<string> {
  if (Number(response.headers.get("content-length")) > MAX_HTML_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Kwik response was unexpectedly large.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  let total = 0;
  const chunks: Buffer[] = [];
  try {
    while (true) {
      const { done, value } = await awaitKwikStage(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) {
        throw new Error("Kwik response was unexpectedly large.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    // A stalled transport can also stall cancel(); it must not postpone the
    // failure returned to the player or leave the pending-resolution map stuck.
    try { void reader.cancel().catch(() => {}); } catch { /* reader already closed */ }
    try { reader.releaseLock(); } catch { /* pending native reader cleanup */ }
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function packedBlocks(html: string): string[] {
  const results: string[] = [];
  let searchFrom = 0;
  while (results.length < 32) {
    const rel = html.slice(searchFrom).search(/eval\s*\(\s*function\s*\(p,a,c,k,e[,{]/);
    if (rel === -1) break;
    const start = searchFrom + rel;
    const open = html.indexOf("(", start);
    let depth = 0, quoted: string | null = null, escaped = false, found = false;
    for (let i = open; i < html.length; i++) {
      const ch = html[i];
      if (escaped) { escaped = false; continue; }
      if (quoted) {
        if (ch === "\\") escaped = true;
        else if (ch === quoted) quoted = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") { quoted = ch; continue; }
      if (ch === "(") depth++;
      else if (ch === ")" && --depth === 0) {
        results.push(html.slice(start, i + 1));
        searchFrom = i + 1;
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  return results;
}

function stringLiteral(raw: string): string {
  if (raw.startsWith('"')) return JSON.parse(raw) as string;
  return raw.slice(1, -1).replace(/\\(x[\da-f]{2}|u[\da-f]{4}|[\s\S])/gi, (_escape, value: string) => {
    if (/^[xu]/i.test(value) && value.length > 1) return String.fromCharCode(parseInt(value.slice(1), 16));
    const known: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
    return known[value] ?? value;
  });
}

/** Decode only the packer's quoted data literals; never evaluate site scripts. */
export function unpackKwikJs(packed: string): string | null {
  if (packed.length > MAX_HTML_BYTES) return null;
  const match = packed.match(/}\s*\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\.split\(\s*['"]\|['"]\s*\)/);
  if (!match) return null;
  try {
    const encoded = stringLiteral(match[1]);
    const radix = Number(match[2]);
    const count = Number(match[3]);
    const keys = stringLiteral(match[4]).split("|");
    if (!Number.isInteger(radix) || radix < 2 || radix > 62 || !Number.isInteger(count)
      || count < 0 || count > 20_000 || keys.length > 20_000) return null;
    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lookup: Record<string, string> = {};
    for (let i = 0; i < keys.length; i++) {
      if (!keys[i]) continue;
      let n = i, word = "";
      do { word = alphabet[n % radix] + word; n = Math.floor(n / radix); } while (n > 0);
      lookup[word] = keys[i];
    }
    return encoded.replace(/\b\w+\b/g, (word) => lookup[word] ?? word);
  } catch { return null; }
}

/** Return bounded media literals for the connector to validate against signed hosts. */
export function extractKwikStreamUrls(html: string): string[] {
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) throw new Error("Kwik response was unexpectedly large.");
  const candidates = new Set<string>();
  const scan = (data: string) => {
    const normalized = data.replace(/\\\//g, "/").replace(/&amp;/g, "&");
    for (const match of normalized.matchAll(VIDEO_RE)) {
      candidates.add(match[0]);
      if (candidates.size >= 64) return;
    }
  };
  for (const packed of packedBlocks(html)) {
    const data = unpackKwikJs(packed);
    if (data) scan(data);
    if (candidates.size >= 64) break;
  }
  if (candidates.size < 64) scan(html);
  return [...candidates];
}
