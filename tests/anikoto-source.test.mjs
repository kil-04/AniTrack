import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { parseAnikotoSourceCipher, parseAnikotoSourceUrl, decodeAnikotoCiphertext, assertAnikotoMediaUrl } from "../apps/desktop/main/services/providers/anikoto-source.ts";

// Synthetic public-player fixture. Never store live decoding keys or signed URLs.
const metadata = 'function decoder(){var k=(new TextEncoder).encode("abcdefghijklmnop");var v=(new TextEncoder).encode("0123456789abcdef"); return crypto.subtle.decrypt({name:"AES-CBC",iv:v},k,input)};resolveUrlSync:decode;';
const cipher = parseAnikotoSourceCipher(metadata);
function encrypt(text) {
  const c = createCipheriv("aes-256-cbc", cipher.key, cipher.iv);
  return Buffer.concat([c.update(text,"utf8"),c.final()]).toString("base64url");
}

test("current encrypted sources and both legacy source shapes decode as data", () => {
  const file = "https://cdn.example.test/show/master.m3u8";
  assert.equal(parseAnikotoSourceUrl({enc:encrypt(JSON.stringify({file}))},cipher),file);
  assert.equal(parseAnikotoSourceUrl({sources:{file}}),file);
  assert.equal(parseAnikotoSourceUrl({sources:[{file}]}),file);
  assert.equal(decodeAnikotoCiphertext(encrypt(file),cipher),file);
  assert.equal(cipher.key.length,32);
  assert.deepEqual(cipher.key.subarray(16),Buffer.alloc(16));
});

test("remote player metadata is parsed without executing arbitrary statements", () => {
  globalThis.anikotoDecoderExecuted = false;
  const malicious = metadata + "globalThis.anikotoDecoderExecuted=true;throw new Error('executed');";
  parseAnikotoSourceCipher(malicious);
  assert.equal(globalThis.anikotoDecoderExecuted,false);
  delete globalThis.anikotoDecoderExecuted;
  assert.throws(()=>parseAnikotoSourceCipher('eval("cipher")'),/format changed/);
  assert.throws(()=>parseAnikotoSourceCipher("x".repeat(2_000_001)),/invalid/);
});

test("malformed blobs and unsupported formats fail cleanly", () => {
  assert.throws(()=>parseAnikotoSourceUrl({enc:encrypt('{not json}')},cipher),/could not be decoded/);
  assert.throws(()=>parseAnikotoSourceUrl({enc:"not*base64"},cipher),/could not be decoded/);
  assert.throws(()=>parseAnikotoSourceUrl({enc:"abc"}),/require player metadata/);
  assert.throws(()=>decodeAnikotoCiphertext("x".repeat(128_001),cipher),/invalid/);
  assert.throws(()=>parseAnikotoSourceUrl({}),/invalid media URL/);
});

test("decoded source cannot target credentials, private networks or non-HTTPS protocols", () => {
  for(const value of ["file:///C:/private","http://public.example.test/x","https://127.0.0.1/x","https://10.1.2.3/x","https://[::1]/x","https://localhost/x","https://localhost./x","https://secret.internal./x","https://secret.internal/x","https://u:p@cdn.example.test/x","https://cdn.example.test:1234/x"]){
    assert.throws(()=>assertAnikotoMediaUrl(value),/unsafe|invalid/);
    assert.throws(()=>parseAnikotoSourceUrl({enc:encrypt(JSON.stringify({file:value}))},cipher),/unsafe|invalid/);
  }
});
