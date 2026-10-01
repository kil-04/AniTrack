import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
} from "node:crypto";

export interface MkissaBuildInfo {
  buildId: string;
  seeds: [string, string, string, string];
  cryptoScheme?: MkissaCryptoScheme;
}

export interface MkissaCryptoScheme {
  saltMultiplier: number;
  saltOffset: number;
  fragmentMultiplier: number;
  fragmentOffset: number;
  bootPrefix: string;
  separator: string;
  fields: readonly ("buildId" | "group" | "host" | "epoch" | "lane")[];
  omitEmptyLane: boolean;
}

export interface MkissaKeyMaterial {
  key: Buffer;
  epoch: number;
  buildId: string;
  expiresAt: number;
}

const KEY_BYTES = 32;
const SEED_BYTES = 8;
const TOKEN_WINDOW_MS = 5 * 60 * 1000;
const EPOCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const EPOCH_GRACE_MS = 24 * 60 * 60 * 1000;
const LEGACY_RESPONSE_SECRET = "Xot36i3lK3";

interface MaskParameters {
  saltMultiplier: number;
  saltOffset: number;
  fragmentMultiplier: number;
  fragmentOffset: number;
}

// MKissa keeps recently retired schemes alive around a build rollover. Trying
// this short, bounded list is safer than evaluating configuration code from a
// downloaded JavaScript bundle.
const MASK_PARAMETER_CANDIDATES: readonly MaskParameters[] = [
  // Current public web-client scheme. Retired schemes remain bounded fallbacks
  // for the provider's short build-rollover overlap window.
  { saltMultiplier: 180, saltOffset: 34, fragmentMultiplier: 228, fragmentOffset: 118 },
  { saltMultiplier: 105, saltOffset: 199, fragmentMultiplier: 68, fragmentOffset: 109 },
  { saltMultiplier: 250, saltOffset: 54, fragmentMultiplier: 16, fragmentOffset: 217 },
  { saltMultiplier: 211, saltOffset: 222, fragmentMultiplier: 200, fragmentOffset: 176 },
  { saltMultiplier: 17, saltOffset: 31, fragmentMultiplier: 41, fragmentOffset: 7 },
];

interface BootScheme {
  prefix: string;
  fields: readonly ("buildId" | "group" | "host" | "epoch" | "lane")[];
  separator: string;
  omitEmptyLane?: boolean;
}

const BOOT_SCHEMES: readonly BootScheme[] = [
  {
    prefix: "nQoBmFr:",
    fields: ["host", "epoch", "group", "lane", "buildId"],
    separator: "~",
  },
  {
    prefix: "3CPUb1AFbS:",
    fields: ["host", "epoch", "group", "lane", "buildId"],
    separator: "|",
  },
  {
    prefix: "4X2PsZc2r:",
    fields: ["group", "host", "lane", "buildId", "epoch"],
    separator: ".",
  },
  {
    prefix: "kNk1YgwkSI:",
    fields: ["epoch", "group", "host", "buildId", "lane"],
    separator: ".",
  },
  {
    prefix: "aa-boot:",
    fields: ["buildId", "group", "host", "epoch", "lane"],
    separator: ":",
    omitEmptyLane: true,
  },
];

const SOURCE_PREFIXES: ReadonlyArray<readonly [string, number]> = [
  ["--", 3],
  ["#-", 2],
  ["##", 1],
  ["-#", 4],
  ["#", 0],
];

const SOURCE_XOR_KEYS = [
  "allanimenews",
  "1234567890123456789",
  "1234567890123456789012345",
  "s5feqxw21",
  "feqx1",
] as const;

const SOURCE_XOR_MASKS = SOURCE_XOR_KEYS.map((value) =>
  [...value].reduce((mask, character) => mask ^ character.charCodeAt(0), 0),
);

function isCanonicalBase64(value: string): boolean {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    return Buffer.from(value, "base64").toString("base64") === value;
  } catch {
    return false;
  }
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

export function deriveMaskCandidates(build: MkissaBuildInfo): Buffer[] {
  if (!/^\d{2,10}$/.test(build.buildId) || build.seeds.length !== 4) return [];
  const decoded = build.seeds.map((seed) => {
    if (!isCanonicalBase64(seed)) return null;
    const bytes = Buffer.from(seed, "base64");
    return bytes.length >= SEED_BYTES ? bytes : null;
  });
  if (decoded.some((seed) => seed === null)) return [];

  const parameters = [
    ...(build.cryptoScheme ? [{
      saltMultiplier: build.cryptoScheme.saltMultiplier,
      saltOffset: build.cryptoScheme.saltOffset,
      fragmentMultiplier: build.cryptoScheme.fragmentMultiplier,
      fragmentOffset: build.cryptoScheme.fragmentOffset,
    }] : []),
    ...MASK_PARAMETER_CANDIDATES,
  ].filter((candidate, index, values) => values.findIndex((value) =>
    value.saltMultiplier === candidate.saltMultiplier
      && value.saltOffset === candidate.saltOffset
      && value.fragmentMultiplier === candidate.fragmentMultiplier
      && value.fragmentOffset === candidate.fragmentOffset,
  ) === index);

  return parameters.map((parameters) => {
    const stream = Buffer.alloc(KEY_BYTES);
    for (let index = 0; index < stream.length; index++) {
      stream[index] = build.buildId.charCodeAt(index % build.buildId.length)
        ^ ((index * parameters.saltMultiplier + parameters.saltOffset) & 0xff);
    }

    const mask = Buffer.alloc(KEY_BYTES);
    decoded.forEach((seed, fragmentIndex) => {
      const offset = fragmentIndex * SEED_BYTES;
      for (let byteIndex = 0; byteIndex < SEED_BYTES; byteIndex++) {
        mask[offset + byteIndex] = seed![byteIndex]
          ^ stream[offset + byteIndex]
          ^ ((fragmentIndex * parameters.fragmentMultiplier
            + byteIndex * parameters.fragmentOffset) & 0xff);
      }
    });
    return mask;
  }).filter((mask) => mask.some((byte) => byte !== 0));
}

export function epochCandidates(now = Date.now()): number[] {
  const current = Math.floor(now / EPOCH_WINDOW_MS);
  const elapsed = now - current * EPOCH_WINDOW_MS;
  return elapsed < EPOCH_GRACE_MS && current > 0 ? [current - 1, current] : [current];
}

export function bootTokenCandidates(
  mask: Buffer,
  buildId: string,
  epoch: number,
  group: string,
  host: string,
  lane: string,
  liveScheme?: MkissaCryptoScheme,
): string[] {
  const fields = {
    buildId,
    group,
    host,
    epoch: String(epoch),
    lane,
  };
  const schemes: readonly BootScheme[] = [
    ...(liveScheme ? [{
      prefix: liveScheme.bootPrefix,
      fields: liveScheme.fields,
      separator: liveScheme.separator,
      omitEmptyLane: liveScheme.omitEmptyLane,
    }] : []),
    ...BOOT_SCHEMES,
  ];
  return [...new Set(schemes.map((scheme) => {
    const bootKey = hmac(mask, `${scheme.prefix}${buildId}`);
    const selected = scheme.omitEmptyLane && !lane
      ? scheme.fields.filter((field) => field !== "lane")
      : scheme.fields;
    return hmac(bootKey, selected.map((field) => fields[field]).join(scheme.separator)).toString("hex");
  }))];
}

export function deriveMaterialKey(mask: Buffer, partB: Buffer): Buffer {
  if (mask.length !== KEY_BYTES || partB.length < KEY_BYTES) {
    throw new Error("Invalid MKissa key material");
  }
  const key = Buffer.allocUnsafe(KEY_BYTES);
  for (let index = 0; index < KEY_BYTES; index++) {
    key[index] = partB[index] ^ mask[index];
  }
  return key;
}

export function buildAaRequest(
  key: Buffer,
  epoch: number,
  buildId: string,
  queryHash: string,
  lane: string,
  now = Date.now(),
): string {
  if (key.length !== KEY_BYTES || !/^\d{2,10}$/.test(buildId) || !/^[a-f0-9]{64}$/.test(queryHash)) {
    throw new Error("Invalid MKissa request material");
  }
  const timestamp = Math.floor(now / TOKEN_WINDOW_MS) * TOKEN_WINDOW_MS;
  const iv = createHash("sha256")
    .update(`${epoch}:${buildId}:${queryHash}:${timestamp}:${lane}`, "utf8")
    .digest()
    .subarray(0, 12);
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    ts: timestamp,
    epoch,
    buildId,
    qh: queryHash,
    k: lane,
  }), "utf8");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([
    Buffer.from([1]),
    iv,
    ciphertext,
    cipher.getAuthTag(),
  ]).toString("base64");
}

function decryptPayloadWithKey(blob: Buffer, key: Buffer): string {
  const iv = blob.subarray(1, 13);
  const encrypted = blob.subarray(13, -16);
  const tag = blob.subarray(-16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function decryptProtectedPayload(payload: string, key: Buffer): string {
  if (!isCanonicalBase64(payload) || key.length !== KEY_BYTES) {
    throw new Error("Invalid MKissa protected payload");
  }
  const blob = Buffer.from(payload, "base64");
  if (blob.length < 1 + 12 + 16 || blob[0] !== 1) {
    throw new Error("Unsupported MKissa protected payload");
  }
  try {
    return decryptPayloadWithKey(blob, key);
  } catch {
    // Some old episodes are still encrypted with the retired version key.
    const legacyKey = createHash("sha256")
      .update(`${LEGACY_RESPONSE_SECRET}:v${blob[0]}`, "utf8")
      .digest();
    try {
      return decryptPayloadWithKey(blob, legacyKey);
    } catch {
      throw new Error("MKissa protected payload authentication failed");
    }
  }
}

function decodeHexWithMask(hex: string, mask: number): string | null {
  if (!hex || hex.length % 2 !== 0 || hex.length > 32_768 || !/^[a-f0-9]+$/i.test(hex)) return null;
  const bytes = Buffer.from(hex, "hex");
  return Buffer.from(bytes.map((byte) => byte ^ mask)).toString("utf8");
}

function resemblesSourceUrl(value: string): boolean {
  return value.startsWith("/apivtwo/") || value.startsWith("https://") || value.startsWith("//");
}

/** Decode only the five known XOR forms. Unknown or malformed values are left untouched. */
export function decodeMkissaSourceUrl(value: string): string {
  if (typeof value !== "string" || value.length > 32_768) return value;
  for (const [prefix, maskIndex] of SOURCE_PREFIXES) {
    if (!value.startsWith(prefix)) continue;
    const decoded = decodeHexWithMask(value.slice(prefix.length), SOURCE_XOR_MASKS[maskIndex]);
    return decoded && resemblesSourceUrl(decoded) ? decoded : value;
  }
  if (/^[a-f0-9]+$/i.test(value)) {
    for (const mask of SOURCE_XOR_MASKS) {
      const decoded = decodeHexWithMask(value, mask);
      if (decoded && resemblesSourceUrl(decoded)) return decoded;
    }
  }
  return value;
}

/** Test helper: encode a source using one of the provider's known prefix forms. */
export function encodeMkissaSourceUrlForFixture(value: string, prefix: string): string {
  const entry = SOURCE_PREFIXES.find(([candidate]) => candidate === prefix);
  if (!entry) throw new Error("Unknown MKissa fixture prefix");
  const input = Buffer.from(value, "utf8");
  const mask = SOURCE_XOR_MASKS[entry[1]];
  return prefix + Buffer.from(input.map((byte) => byte ^ mask)).toString("hex");
}
