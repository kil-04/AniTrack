import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { extractZipEntry, readZipEntries } from "../apps/desktop/main/services/zip-entries.ts";

/** A minimal zip writer: stored or deflated entries, optionally zip64 or with data descriptors. */
function buildZip(files, { zip64 = false, descriptor = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const raw = Buffer.from(file.data ?? "");
    const method = file.method ?? 8;
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = (file.crc ?? zlib.crc32(raw)) >>> 0;
    const flags = 0x800 | (descriptor ? 0x8 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(descriptor ? 0 : crc, 14);
    local.writeUInt32LE(descriptor ? 0 : body.length, 18);
    local.writeUInt32LE(descriptor ? 0 : raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const parts = [local, name, body];
    if (descriptor) {
      const trailer = Buffer.alloc(16);
      trailer.writeUInt32LE(0x08074b50, 0);
      trailer.writeUInt32LE(crc, 4);
      trailer.writeUInt32LE(body.length, 8);
      trailer.writeUInt32LE(raw.length, 12);
      parts.push(trailer);
    }
    const extra = Buffer.alloc(zip64 ? 28 : 0);
    if (zip64) {
      extra.writeUInt16LE(1, 0);
      extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(raw.length), 4);
      extra.writeBigUInt64LE(BigInt(body.length), 12);
      extra.writeBigUInt64LE(BigInt(offset), 20);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(zip64 ? 0xffffffff : body.length, 20);
    central.writeUInt32LE(zip64 ? 0xffffffff : raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(zip64 ? 0xffffffff : offset, 42);
    centrals.push(central, name, extra);
    const chunk = Buffer.concat(parts);
    locals.push(chunk);
    offset += chunk.length;
  }
  const directory = Buffer.concat(centrals);
  const records = [];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeBigUInt64LE(BigInt(files.length), 24);
    record.writeBigUInt64LE(BigInt(files.length), 32);
    record.writeBigUInt64LE(BigInt(directory.length), 40);
    record.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + directory.length), 8);
    locator.writeUInt32LE(1, 16);
    records.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip64 ? 0xffff : files.length, 8);
  end.writeUInt16LE(zip64 ? 0xffff : files.length, 10);
  end.writeUInt32LE(zip64 ? 0xffffffff : directory.length, 12);
  end.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  return Buffer.concat([...locals, directory, ...records, end]);
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anitrack-zip-"));
}

const song = "la ".repeat(5000);
const FILES = [
  { name: "OST/", data: "", method: 0 },
  { name: "OST/01 When The Moon's Reaching Out Stars -Reload-.mp3", data: song },
  { name: "OST/02 Want To Be Close.ogg", data: "short stored track", method: 0 },
  { name: "OST/Ünïcode Bösendorfer.flac", data: song.toUpperCase() },
];

async function roundTrip(options) {
  const dir = tempDir();
  try {
    const zip = path.join(dir, "music.zip");
    fs.writeFileSync(zip, buildZip(FILES, options));
    const entries = await readZipEntries(zip);
    assert.deepEqual(entries.map((e) => e.name), FILES.slice(1).map((f) => f.name));
    for (const [i, entry] of entries.entries()) {
      const out = path.join(dir, `out-${i}`);
      await extractZipEntry(zip, entry, out);
      assert.equal(fs.readFileSync(out, "utf8"), FILES[i + 1].data);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("reads and extracts stored and deflated entries, skipping folders", () => roundTrip({}));

test("reads zip64 archives", () => roundTrip({ zip64: true }));

test("uses the directory's sizes when entries end with a data descriptor", () => roundTrip({ descriptor: true }));

test("refuses corrupt entries and files that are not zips", async () => {
  const dir = tempDir();
  try {
    const zip = path.join(dir, "bad.zip");
    fs.writeFileSync(zip, buildZip([{ name: "01 Track.mp3", data: song, crc: 1234 }]));
    const [entry] = await readZipEntries(zip);
    await assert.rejects(extractZipEntry(zip, entry, path.join(dir, "out")), /checksum/);
    // A size that lies short is caught before the file grows past it.
    await assert.rejects(extractZipEntry(zip, { ...entry, size: 10 }, path.join(dir, "out2")), /larger/);
    const notZip = path.join(dir, "song.mp3");
    fs.writeFileSync(notZip, "ID3 not a zip at all");
    await assert.rejects(readZipEntries(notZip), /Not a zip/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
