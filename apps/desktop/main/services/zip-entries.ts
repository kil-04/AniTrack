import fs from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

/**
 * Just enough of the zip format to import music from an archive: the central
 * directory (zip64 included) and stored or deflated entries, streamed to disk.
 */
export interface ZipEntry {
  /** The path inside the archive, with forward slashes. */
  name: string;
  /** 0 = stored, 8 = deflated; anything else is not supported. */
  method: number;
  compressedSize: number;
  size: number;
  crc: number;
  localOffset: number;
  encrypted: boolean;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_DIRECTORY = 64 * 1024 * 1024;

async function readAt(handle: fs.promises.FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new Error("Unexpected end of zip file");
  return buffer;
}

function decodeName(bytes: Buffer, utf8: boolean): string {
  if (!utf8) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return bytes.toString("latin1"); }
  }
  return bytes.toString("utf8");
}

/** Lists the files in [file]. Throws when it is not a readable zip. */
export async function readZipEntries(file: string): Promise<ZipEntry[]> {
  const handle = await fs.promises.open(file, "r");
  try {
    const { size: fileSize } = await handle.stat();
    const tailLength = Math.min(fileSize, 22 + 0xffff + 20);
    const tail = await readAt(handle, fileSize - tailLength, tailLength);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD) { end = i; break; }
    }
    if (end < 0) throw new Error("Not a zip file");
    let count = tail.readUInt16LE(end + 10);
    let directorySize = tail.readUInt32LE(end + 12);
    let directoryOffset = tail.readUInt32LE(end + 16);
    if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      if (end < 20 || tail.readUInt32LE(end - 20) !== ZIP64_LOCATOR) throw new Error("Zip64 locator missing");
      const record = await readAt(handle, Number(tail.readBigUInt64LE(end - 12)), 56);
      if (record.readUInt32LE(0) !== ZIP64_EOCD) throw new Error("Zip64 directory missing");
      count = Number(record.readBigUInt64LE(32));
      directorySize = Number(record.readBigUInt64LE(40));
      directoryOffset = Number(record.readBigUInt64LE(48));
    }
    if (directorySize > MAX_DIRECTORY || directoryOffset + directorySize > fileSize) throw new Error("Zip directory out of range");
    const directory = await readAt(handle, directoryOffset, directorySize);
    const entries: ZipEntry[] = [];
    let pos = 0;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > directory.length || directory.readUInt32LE(pos) !== CENTRAL) throw new Error("Corrupt zip directory");
      const flags = directory.readUInt16LE(pos + 8);
      const nameLength = directory.readUInt16LE(pos + 28);
      const extraLength = directory.readUInt16LE(pos + 30);
      const commentLength = directory.readUInt16LE(pos + 32);
      let compressedSize = directory.readUInt32LE(pos + 20);
      let size = directory.readUInt32LE(pos + 24);
      let localOffset = directory.readUInt32LE(pos + 42);
      const nameStart = pos + 46;
      const name = decodeName(directory.subarray(nameStart, nameStart + nameLength), (flags & 0x800) !== 0);
      // Zip64 sizes and offsets live in extra field 0x0001, in this order, only when maxed out above.
      let extra = nameStart + nameLength;
      const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const id = directory.readUInt16LE(extra);
        const length = directory.readUInt16LE(extra + 2);
        if (id === 0x0001) {
          let field = extra + 4;
          const take = () => { const value = Number(directory.readBigUInt64LE(field)); field += 8; return value; };
          if (size === 0xffffffff) size = take();
          if (compressedSize === 0xffffffff) compressedSize = take();
          if (localOffset === 0xffffffff) localOffset = take();
        }
        extra += 4 + length;
      }
      if (!name.endsWith("/")) {
        entries.push({
          name: name.replace(/\\/g, "/"),
          method: directory.readUInt16LE(pos + 10),
          compressedSize,
          size,
          crc: directory.readUInt32LE(pos + 16),
          localOffset,
          encrypted: (flags & 0x1) !== 0,
        });
      }
      pos = extraEnd + commentLength;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/** Writes [entry] of [file], decompressed, to a new file [target]; checks its size and checksum. */
export async function extractZipEntry(file: string, entry: ZipEntry, target: string): Promise<void> {
  if (entry.encrypted || (entry.method !== 0 && entry.method !== 8)) throw new Error("Unsupported zip entry");
  if (entry.compressedSize <= 0 || entry.size <= 0) throw new Error("Empty zip entry");
  const handle = await fs.promises.open(file, "r");
  let dataStart: number;
  try {
    const header = await readAt(handle, entry.localOffset, 30);
    if (header.readUInt32LE(0) !== LOCAL) throw new Error("Corrupt zip entry");
    dataStart = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  } finally {
    await handle.close();
  }
  const crc32 = typeof zlib.crc32 === "function" ? zlib.crc32 : null;
  let written = 0;
  let crc = 0;
  const check = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      written += chunk.length;
      if (written > entry.size) return done(new Error("Zip entry is larger than it says"));
      if (crc32) crc = crc32(chunk, crc);
      done(null, chunk);
    },
  });
  const source = fs.createReadStream(file, { start: dataStart, end: dataStart + entry.compressedSize - 1 });
  const out = fs.createWriteStream(target, { flags: "wx" });
  if (entry.method === 8) await pipeline(source, zlib.createInflateRaw(), check, out);
  else await pipeline(source, check, out);
  if (written !== entry.size) throw new Error("Zip entry is truncated");
  if (crc32 && crc >>> 0 !== entry.crc >>> 0) throw new Error("Zip entry checksum mismatch");
}
