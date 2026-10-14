import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
function moduleAt(name, overrides = {}, globals = {}) {
  const url = new URL(`../apps/desktop/main/services/manga/${name}.ts`, import.meta.url);
  const code = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, require: id => overrides[id] ?? require(id),
    Buffer, URL, Response, AbortController, setTimeout, clearTimeout, ...globals,
  }, { filename: url.pathname, timeout: 2000 });
  return module.exports;
}
const codec = moduleAt("comix-image-codec");

function png(width = 6, height = 6) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  bytes[24] = 8; bytes[25] = 6;
  return bytes;
}
function webp(width = 6, height = 6) {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WEBPVP8X", 8);
  bytes.writeUInt32LE(10, 16); bytes.writeUIntLE(width - 1, 24, 3); bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}

function setup(responses, { addresses = [{ address: "8.8.8.8", family: 4 }], brokenWebp = false, clock = {} } = {}) {
  const state = { requests: [], windows: [], sessions: [], draws: [], clears: [], nativeDecodes: 0, restored: null };
  const nativeImage = {
    createFromBuffer(bytes) {
      state.nativeDecodes++;
      const dimensions = codec.comixImageDimensions(bytes);
      if (dimensions.type === "image/webp") return { isEmpty: () => true };
      return { isEmpty: () => false, getSize: () => dimensions,
        toBitmap: () => Buffer.alloc(dimensions.width * dimensions.height * 4, 7) };
    },
    createFromBitmap(bytes, dimensions) {
      state.restored = bytes;
      return { isEmpty: () => false, toPNG: () => png(dimensions.width, dimensions.height) };
    },
  };
  class Image {
    async decode() {
      if (brokenWebp) throw Error("invalid fixture");
      const dimensions = codec.comixImageDimensions(Buffer.from(this.src.split(",")[1], "base64"));
      this.naturalWidth = dimensions.width; this.naturalHeight = dimensions.height;
    }
  }
  class FileReader {
    readAsDataURL(blob) { this.result = `data:image/png;base64,${blob.bytes.toString("base64")}`; queueMicrotask(() => this.onload()); }
  }
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = handler => { this.popup = handler; };
      this.webContents.executeJavaScriptInIsolatedWorld = async (world, scripts) => {
        assert.equal(world, 1001);
        return vm.runInNewContext(scripts[0].code, {
          Image, FileReader, document: { createElement(name) {
            assert.equal(name, "canvas");
            return { getContext: () => ({ drawImage: (...args) => state.draws.push(args.slice(1)),
              clearRect: (...args) => state.clears.push(args) }),
              toBlob(callback) { const bytes = png(this.width, this.height); callback({ size: bytes.length, bytes }); } };
          } },
        }, { timeout: 2000 });
      };
      state.windows.push(this);
    }
    async loadURL(url) { this.url = url; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const session = { fromPartition(partition) {
    const value = { partition, setPermissionCheckHandler(handler) { this.permissionCheck = handler; },
      setPermissionRequestHandler(handler) { this.permissionRequest = handler; },
      webRequest: { onBeforeRequest(filter, handler) { value.filter = filter; value.intercept = handler; } },
      on(event, handler) { this[event] = handler; }, async clearStorageData() { this.cleared = true; } };
    state.sessions.push(value); return value;
  } };
  const https = { request(url, options, callback) {
    const responseSpec = responses[state.requests.length] ?? { status: 500 };
    const req = new EventEmitter(); req.destroyed = false;
    req.destroy = () => { req.destroyed = true; };
    const record = { url, options, req, delivered: false };
    state.requests.push(record);
    req.end = () => queueMicrotask(() => options.lookup(new URL(url).hostname, { family: 0, hints: 0, all: false }, (error) => {
      if (error) { req.emit("error", error); return; }
      if (req.destroyed) return;
      const response = new EventEmitter(); response.headers = responseSpec.headers ?? {};
      response.statusCode = responseSpec.status ?? 200; response.destroyed = false;
      response.destroy = () => { response.destroyed = true; };
      record.response = response;
      callback(response);
      record.delivered = true;
      record.finish = () => {
        for (const chunk of responseSpec.chunks ?? [responseSpec.bytes ?? png()]) {
          if (response.destroyed || req.destroyed) return;
          response.emit("data", chunk);
        }
        if (!response.destroyed && !req.destroyed) response.emit("end");
      };
      if (!responseSpec.stall) queueMicrotask(record.finish);
    }));
    return req;
  } };
  const api = moduleAt("comix-images", {
    "./comix-image-codec": codec, "electron": { nativeImage, BrowserWindow, session },
    "node:https": https, "node:dns": { lookup(_host, options, callback) { assert.equal(options.all, true); callback(null, addresses); } },
  }, clock);
  return { api, state };
}

test("Comix decoder matches Android's published prefix and known tile fixtures", () => {
  const plain = Buffer.from("89504e470d0a1a0a0000000d4948445200000005000000050806000000000000", "hex");
  for (const hex of [
    "f3ffeeadde688232784cbed20b2f4fae5d724a87ef41cc680806000000000000",
    "d2fe2be20fb898805d3875e58181ba1f557adb9edcf827270806000000000000",
    "4f35e93327c9e5d18c822c100540ef1f06c11ec816a66f670806000000000000",
    "a07a16733b61c79b79f18522445c92d636bde4011dd6f5750806000000000000",
  ]) assert.deepEqual(codec.decodeComixImageBytes(Buffer.from(hex, "hex"), 12344, 24, "2"), plain);
  assert.deepEqual(Array.from(codec.comixTileSources(12345, "3", "03632")), [13,3,17,19,22,23,8,20,10,15,21,14,16,4,12,24,1,9,7,18,6,11,5,0,2]);
  assert.deepEqual(Array.from(codec.comixTileSources(12345, "3", "02900")), [10,18,4,22,3,9,23,11,12,24,20,6,15,7,5,16,21,8,0,17,19,13,1,14,2]);
  for (const args of [[1, 100, "1"], [1, -1, "1"], [1, 1, "unknown"]]) assert.throws(() => codec.decodeComixImageBytes(plain, ...args));
  assert.throws(() => codec.comixTileSources(1, "unknown", null));
  assert.throws(() => codec.comixTileSources(1, "3", "unknown"));
});

test("Comix bitmap restoration preserves opaque pixels and trailing grid borders", () => {
  const input = Buffer.alloc(6 * 6 * 4);
  for (let pixel = 0; pixel < 36; pixel++) input.writeUInt32LE(pixel + 0x01020300, pixel * 4);
  const order = codec.comixTileSources(12345, "3", "03632");
  const output = codec.restoreComixBitmap(input, 6, 6, order);
  for (let destination = 0; destination < 25; destination++) {
    const source = order[destination];
    assert.equal(output.readUInt32LE((Math.floor(destination / 5) * 6 + destination % 5) * 4),
      input.readUInt32LE((Math.floor(source / 5) * 6 + source % 5) * 4));
  }
  for (let pixel = 0; pixel < 36; pixel++) if (pixel % 6 === 5 || pixel >= 30) {
    assert.equal(output.readUInt32LE(pixel * 4), input.readUInt32LE(pixel * 4));
  }
  assert.throws(() => codec.restoreComixBitmap(input, 6, 6, Array(25).fill(0)));
});

test("image dimensions are parsed before allocation, including WebP and JPEG Exif", () => {
  assert.deepEqual({ ...codec.comixImageDimensions(png(800, 1200)) }, { width: 800, height: 1200, type: "image/png" });
  assert.deepEqual({ ...codec.comixImageDimensions(webp(800, 1200)) }, { width: 800, height: 1200, type: "image/webp" });
  const jpeg = Buffer.from([255,216,255,225,0,8,69,120,105,102,0,0,255,192,0,11,8,4,176,3,32,1,1,17,0,255,217]);
  assert.deepEqual({ ...codec.comixImageDimensions(jpeg) }, { width: 800, height: 1200, type: "image/jpeg" });
  assert.equal(codec.comixImageDimensions(Buffer.from("<html>challenge</html>")), null);
  assert.equal(codec.comixImageDimensions(webp().subarray(0, 29)), null);
  assert.throws(() => codec.assertComixImageDimensions(codec.comixImageDimensions(png(5000, 5000))));
});

test("exact image GET has no cookies/hotlink headers, keeps TLS and follows no redirects", async () => {
  const { api, state } = setup([{ bytes: png() }]);
  const result = await api.fetchComixImage("https://images.example.org/page.png?v3");
  assert.equal(result.status, 200); assert.equal(result.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), png());
  assert.equal(state.requests.length, 1);
  const { options } = state.requests[0];
  assert.equal(options.agent, false);
  assert.equal(options.rejectUnauthorized, undefined);
  assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "Accept-Encoding"]);
  const redirect = setup([{ status: 302, headers: { location: "https://localhost/private" } }]);
  assert.equal((await redirect.api.fetchComixImage("https://images.example.org/page.png")).status, 302);
  assert.equal(redirect.state.requests.length, 1); assert.equal(redirect.state.requests[0].response.destroyed, true);
});

test("URL and actual socket DNS checks reject private and disguised destinations", async () => {
  const { api, state } = setup([]);
  for (const value of ["http://images.example.org/1", "file:///1", "https://user:pw@images.example.org/1", "https://localhost/1",
    "https://127.0.0.1/1", "https://2130706433/1", "https://[::1]/1", "https://box.local/1", "https://cdn.example.org:8443/1", "https://cdn.example.org/1#x", "https://cdn.example.org/1#"]) {
    assert.throws(() => api.assertComixImageUrl(value), undefined, value);
  }
  assert.equal(state.requests.length, 0);
  for (const address of ["127.0.0.1", "192.168.0.1", "10.0.0.1", "169.254.0.1", "100.64.0.1", "198.18.0.1", "::1", "fc00::1", "::ffff:127.0.0.1", "2001:db8::1"]) {
    assert.equal(api.privateComixAddress(address), true, address);
  }
  assert.equal(api.privateComixAddress("8.8.8.8"), false);
  assert.equal(api.privateComixAddress("2606:4700:4700::1111"), false);
  const mixed = setup([{ bytes: png() }], { addresses: [{ address: "8.8.8.8", family: 4 }, { address: "192.168.0.1", family: 4 }] });
  await assert.rejects(mixed.api.fetchComixImage("https://images.example.org/page.png"));
  assert.equal(mixed.state.requests[0].delivered, false);
});

test("access rejections stop before reading challenge data and never retry", async () => {
  for (const status of [403, 429]) {
    const { api, state } = setup([{ status, bytes: Buffer.from("must not read") }]);
    const result = await api.fetchComixImage("https://images.example.org/page.png");
    assert.equal(result.status, status); assert.equal(await result.text(), "");
    assert.equal(state.requests.length, 1); assert.equal(state.nativeDecodes, 0);
  }
});

test("response/decode bounds and malformed headers fail before native allocation", async () => {
  for (const response of [
    { bytes: png(), headers: { "content-length": String(codec.COMIX_IMAGE_MAX_BYTES + 1) } },
    { bytes: png(), headers: { "content-encoding": "gzip" } },
    { bytes: png(5000, 5000) }, { bytes: Buffer.from("<html>challenge</html>") },
    { bytes: png(), headers: { "x-enc-seed": "not-a-number" } },
    { bytes: png(), headers: { "x-scramble-seed": "12345", "x-scramble-grid": "5x5", "x-scramble-algo": "unknown" } },
  ]) {
    const { api, state } = setup([response]);
    await assert.rejects(api.fetchComixImage("https://images.example.org/page.png"));
    assert.equal(state.requests.length, 1); assert.equal(state.nativeDecodes, 0);
  }
  const large = setup([{ chunks: [Buffer.alloc(codec.COMIX_IMAGE_MAX_BYTES), Buffer.alloc(1)] }]);
  await assert.rejects(large.api.fetchComixImage("https://images.example.org/page.png"));
  assert.equal(large.state.nativeDecodes, 0);
});

test("grid-scrambled WebP uses an offline sandboxed compositor and releases its window", async () => {
  const { api, state } = setup([{ bytes: webp(), headers: { "x-scramble-seed": "12345", "x-scramble-grid": "5x5", "x-scramble-algo": "3", "x-scramble-hash": "03632" } }]);
  const result = await api.fetchComixImage("https://images.example.org/page.webp?v3");
  assert.equal(result.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), png());
  assert.equal(state.draws.length, 26); assert.deepEqual(state.draws[0], [0, 0]);
  assert.equal(state.clears.length, 25); assert.deepEqual(state.clears[24], [4, 4, 1, 1]);
  const win = state.windows[0];
  assert.equal(win.options.show, false); assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false); assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.preload, undefined); assert.equal(win.destroyed, true);
  assert.ok(win.url.startsWith("data:text/html;")); assert.ok(decodeURIComponent(win.url).includes("default-src 'none'"));
  assert.equal(win.popup().action, "deny");
  const isolated = state.sessions[0]; assert.ok(!isolated.partition.startsWith("persist:"));
  assert.equal(isolated.permissionCheck(), false);
  isolated.intercept({ url: "https://images.example.org/anything" }, ({ cancel }) => assert.equal(cancel, true));
  isolated.intercept({ url: "data:image/webp;base64,AAAA" }, ({ cancel }) => assert.equal(cancel, false));
  assert.equal(isolated.cleared, true);
});

test("local WebP decode failure still destroys the compositor", async () => {
  const { api, state } = setup([{ bytes: webp() }], { brokenWebp: true });
  await assert.rejects(api.fetchComixImage("https://images.example.org/page.webp"));
  assert.equal(state.windows[0].destroyed, true); assert.equal(state.requests.length, 1);
});

test("serialized fetch/decode and queued cancellation make no extra request", async () => {
  const { api, state } = setup([{ bytes: png(), stall: true }, { bytes: png() }]);
  const first = api.fetchComixImage("https://images.example.org/1.png");
  await new Promise(setImmediate);
  const controller = new AbortController();
  const second = api.fetchComixImage("https://images.example.org/2.png", controller.signal);
  controller.abort(); await assert.rejects(second);
  assert.equal(state.requests.length, 1);
  state.requests[0].finish(); assert.equal((await first).status, 200);
  await new Promise(setImmediate); assert.equal(state.requests.length, 1);
});

test("25-second deadline starts at the active slot, not during queued prefetch", async () => {
  const timers = [];
  const { api, state } = setup([{ bytes: png(), stall: true }, { bytes: png(), stall: true }], {
    clock: { setTimeout(callback, milliseconds) { const timer = { callback, milliseconds, cleared: false }; timers.push(timer); return timer; },
      clearTimeout(timer) { timer.cleared = true; } },
  });
  const first = api.fetchComixImage("https://images.example.org/1.png");
  const second = api.fetchComixImage("https://images.example.org/2.png");
  await new Promise(setImmediate);
  assert.equal(timers.length, 1); assert.equal(timers[0].milliseconds, 25_000);
  state.requests[0].finish(); await first; await new Promise(setImmediate);
  assert.equal(timers.length, 2); assert.equal(timers[0].cleared, true);
  timers[1].callback(); await assert.rejects(second);
  assert.equal(state.requests[1].req.destroyed, true); assert.equal(state.requests.length, 2);
});

test("pending image reservations are bounded even while cancelled waiters drain", async () => {
  const { api, state } = setup([{ bytes: png(), stall: true }, { bytes: png() }]);
  const controllers = Array.from({ length: api.COMIX_IMAGE_MAX_PENDING }, () => new AbortController());
  const jobs = controllers.map((controller, index) => api.fetchComixImage(`https://images.example.org/${index}.png`, controller.signal));
  const settled = Promise.allSettled(jobs);
  await new Promise(setImmediate); assert.equal(state.requests.length, 1);
  await assert.rejects(api.fetchComixImage("https://images.example.org/overflow.png"), /Too many/);
  controllers.forEach(controller => controller.abort());
  await settled; await new Promise(setImmediate);
  assert.equal(state.requests.length, 1);
  assert.equal((await api.fetchComixImage("https://images.example.org/fresh.png")).status, 200);
  assert.equal(state.requests.length, 2);
});
