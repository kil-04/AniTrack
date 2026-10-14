/** Public Comix image-format interoperability, not website request signing.
 * Format reference: Keiyoushi extensions-source Comix/Descrambler.kt (Apache-2.0).
 * Reimplemented with bounded input, known algorithms/hashes and strict failures.
 */
export const COMIX_IMAGE_MAX_BYTES = 24 * 1024 * 1024;
export const COMIX_IMAGE_MAX_PIXELS = 12_000_000;

export interface ComixImageDimensions {
  width: number;
  height: number;
  type: "image/png" | "image/jpeg" | "image/webp";
}

function xorshift(value: number): number {
  let state = value ^ (value << 13);
  state ^= state >>> 17;
  return (state ^ (state << 5)) | 0;
}

function xor(input: Uint8Array, seed: number, length: number, shift: boolean, high: boolean): Buffer {
  const output = Buffer.from(input);
  let state = seed | 0;
  for (let index = 0; index < length; index++) {
    state = shift ? xorshift(state) : (Math.imul(state, 1_000_005) + 1_234_567_891) | 0;
    output[index] ^= (!shift || high) ? state >>> 24 : state & 255;
  }
  return output;
}

function seed32(value: number): number {
  if (!Number.isInteger(value) || value < -2_147_483_648 || value > 4_294_967_295) {
    throw new Error("Invalid Comix image seed.");
  }
  return value | 0;
}

export function comixImageSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && (
    (bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (bytes[0] === 0x89 && Buffer.from(bytes.subarray(1, 4)).toString("ascii") === "PNG") ||
    (Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
      Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP")
  );
}

/** Decode only the declared byte prefix. Algorithm 2 has four published conventions. */
export function decodeComixImageBytes(
  input: Uint8Array, seed: number | null, length: number | null, algorithm: string | null,
): Buffer {
  if (input.length < 1 || input.length > COMIX_IMAGE_MAX_BYTES) throw new Error("Invalid Comix image size.");
  if (seed == null || seed === 0) return Buffer.isBuffer(input) ? input : Buffer.from(input);
  const initial = seed32(seed);
  if (length == null || !Number.isInteger(length) || length < 0 || length > input.length) {
    throw new Error("Invalid Comix image encoding length.");
  }
  if (algorithm !== null && algorithm !== "1" && algorithm !== "2") throw new Error("Unsupported Comix image encoding.");
  if (algorithm !== "2") return xor(input, initial, length, false, false);
  for (const [state, high] of [[initial | 1, false], [initial, false], [initial | 1, true]] as const) {
    const decoded = xor(input, state, length, true, high);
    if (comixImageSignature(decoded)) return decoded;
  }
  const legacy = xor(input, initial, length, false, false);
  if (!comixImageSignature(legacy)) throw new Error("Comix image encoding changed.");
  return legacy;
}

/** Destination tile -> source tile, including the known version-3 hash masks. */
export function comixTileSources(seed: number, algorithm: string | null, hash: string | null): number[] {
  if (algorithm !== null && !["1", "2", "3"].includes(algorithm)) throw new Error("Unsupported Comix tile encoding.");
  let mask: number;
  switch (hash?.trim()) {
    case undefined: case "": case "0": mask = 0; break;
    case "03632": mask = 58414; break;
    case "02900": mask = 117532; break;
    default: throw new Error("Unsupported Comix tile hash.");
  }
  let state = seed32(seed) ^ mask;
  if (algorithm === "3") state |= 1;
  const shuffled = Array.from({ length: 25 }, (_, index) => index);
  for (let last = 24; last > 0; last--) {
    state = algorithm === "3" ? xorshift(state) : (Math.imul(state, 1_664_525) + 1_013_904_223) | 0;
    const swap = (state >>> 0) % (last + 1);
    [shuffled[last], shuffled[swap]] = [shuffled[swap], shuffled[last]];
  }
  const inverse = Array<number>(25);
  shuffled.forEach((value, index) => { inverse[value] = index; });
  return inverse;
}

export function assertComixImageDimensions(value: ComixImageDimensions | null): ComixImageDimensions {
  if (!value || !Number.isInteger(value.width) || !Number.isInteger(value.height) ||
    value.width <= 0 || value.height <= 0 || value.width > 20_000 || value.height > 20_000 ||
    value.width * value.height > COMIX_IMAGE_MAX_PIXELS) {
    throw new Error("Comix image dimensions are unsupported or too large.");
  }
  return value;
}

/** Header-only dimensions before a native bitmap can allocate memory. */
export function comixImageDimensions(input: Uint8Array): ComixImageDimensions | null {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const ascii = (start: number, length: number) => bytes.toString("ascii", start, start + length);
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.readUInt32BE(8) === 13 && ascii(12, 4) === "IHDR") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), type: "image/png" };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 1 < bytes.length) {
      if (bytes[offset++] !== 0xff) return null;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda || marker === undefined || marker === 0) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return null;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 8) return null;
        return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3), type: "image/jpeg" };
      }
      offset += length;
    }
    return null;
  }
  if (bytes.length >= 20 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const end = bytes.readUInt32LE(4) + 8;
    if (end !== bytes.length) return null;
    for (let offset = 12; offset + 8 <= end;) {
      const chunk = ascii(offset, 4);
      const length = bytes.readUInt32LE(offset + 4);
      const data = offset + 8;
      if (data + length > end) return null;
      if (chunk === "VP8X" && length >= 10) {
        return { width: bytes.readUIntLE(data + 4, 3) + 1, height: bytes.readUIntLE(data + 7, 3) + 1, type: "image/webp" };
      }
      if (chunk === "VP8L" && length >= 5 && bytes[data] === 0x2f) {
        const packed = bytes.readUInt32LE(data + 1);
        if (packed >>> 29 !== 0) return null;
        return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1, type: "image/webp" };
      }
      if (chunk === "VP8 " && length >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 1 && bytes[data + 5] === 0x2a) {
        return { width: bytes.readUInt16LE(data + 6) & 0x3fff, height: bytes.readUInt16LE(data + 8) & 0x3fff, type: "image/webp" };
      }
      offset = data + length + (length & 1);
    }
  }
  return null;
}

/** Operates on opaque nativeImage four-byte pixels; never assumes RGBA/BGRA order. */
export function restoreComixBitmap(input: Buffer, width: number, height: number, order: readonly number[]): Buffer {
  assertComixImageDimensions({ width, height, type: "image/png" });
  if (input.length !== width * height * 4 || order.length !== 25 || new Set(order).size !== 25 ||
    order.some(value => !Number.isInteger(value) || value < 0 || value >= 25)) throw new Error("Invalid Comix image grid.");
  const tileWidth = Math.floor(width / 5);
  const tileHeight = Math.floor(height / 5);
  if (!tileWidth || !tileHeight) throw new Error("Invalid Comix image grid.");
  const output = Buffer.from(input); // Preserve trailing pixels outside the 5x5 grid.
  for (let destination = 0; destination < 25; destination++) {
    const source = order[destination];
    for (let row = 0; row < tileHeight; row++) {
      const sourceStart = ((Math.floor(source / 5) * tileHeight + row) * width + (source % 5) * tileWidth) * 4;
      const destinationStart = ((Math.floor(destination / 5) * tileHeight + row) * width + (destination % 5) * tileWidth) * 4;
      input.copy(output, destinationStart, sourceStart, sourceStart + tileWidth * 4);
    }
  }
  return output;
}
