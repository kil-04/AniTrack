import { createDecipheriv } from "node:crypto";

export interface AnikotoSourceCipher { key: Buffer; iv: Buffer }

/** Read literal public-player cipher parameters as data; never execute site JS. */
export function parseAnikotoSourceCipher(script: string): AnikotoSourceCipher {
  if (!script || script.length > 2_000_000) throw new Error("Anikoto player metadata is invalid");
  // The segment decoder is the first, non-obfuscated module. Restrict matching
  // to it so unrelated watch-time/account modules cannot supply parameters.
  const module = script.slice(0, 12_000).split("resolveUrlSync:")[0];
  const literals = [...module.matchAll(/(?:new\s+TextEncoder\s*\(\s*\)|\(new\s+TextEncoder\s*\)).encode\(\s*("(?:[^"\\]|\\.)*")\s*\)/g)]
    .map((match) => { try { return JSON.parse(match[1]) as string; } catch { return ""; } });
  if (!module.includes("AES-CBC") || literals.length !== 2) {
    throw new Error("Anikoto player format changed; its connector needs an update");
  }
  const keyBytes = Buffer.from(literals[0], "utf8");
  const iv = Buffer.from(literals[1], "utf8");
  if (keyBytes.length < 16 || keyBytes.length > 32 || iv.length !== 16) {
    throw new Error("Anikoto player cipher parameters are invalid");
  }
  const key = Buffer.alloc(32);
  keyBytes.copy(key);
  return { key, iv };
}

export function decodeAnikotoCiphertext(value: string, cipher: AnikotoSourceCipher): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128_000
    || !/^[A-Za-z0-9_+\/-]+={0,2}$/.test(value)) throw new Error("Anikoto encrypted source is invalid");
  try {
    const input = Buffer.from(value, "base64url");
    if (input.length === 0 || input.length % 16 !== 0) throw new Error("Invalid ciphertext");
    const decipher = createDecipheriv("aes-256-cbc", cipher.key, cipher.iv);
    return Buffer.concat([decipher.update(input), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Anikoto source could not be decoded; its player format may have changed");
  }
}

export function assertAnikotoMediaUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 16_384) throw new Error("Anikoto returned an invalid media URL");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Anikoto returned an invalid media URL"); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  // Provider data must never direct the main process to local network services.
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || !host.includes(".") || host.endsWith(".local") || host.endsWith(".localhost")
    || host.endsWith(".internal") || /^[\d.]+$/.test(host) || host.includes(":")) {
    throw new Error("Anikoto returned an unsafe media URL");
  }
  url.hash = "";
  return url.toString();
}

export function parseAnikotoSourceUrl(json: unknown, cipher?: AnikotoSourceCipher): string {
  const data = json as { sources?: { file?: unknown } | Array<{ file?: unknown }>; enc?: unknown } | null;
  let file = Array.isArray(data?.sources) ? data.sources[0]?.file : data?.sources?.file;
  if (!file && typeof data?.enc === "string") {
    if (!cipher) throw new Error("Anikoto encrypted sources require player metadata");
    try { file = JSON.parse(decodeAnikotoCiphertext(data.enc, cipher))?.file; }
    catch { throw new Error("Anikoto encrypted source response could not be decoded"); }
  }
  return assertAnikotoMediaUrl(file);
}
