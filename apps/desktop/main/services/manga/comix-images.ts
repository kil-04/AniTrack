import { BrowserWindow, nativeImage, session } from "electron";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import {
  assertComixImageDimensions, COMIX_IMAGE_MAX_BYTES, COMIX_IMAGE_MAX_PIXELS,
  comixImageDimensions, comixTileSources, decodeComixImageBytes, restoreComixBitmap,
  type ComixImageDimensions,
} from "./comix-image-codec";

const DEADLINE_MS = 25_000;
export const COMIX_IMAGE_MAX_PENDING = 32;
let imageTail: Promise<void> = Promise.resolve();
let pendingImages = 0;

export function assertComixImageUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length < 1 || raw.length > 4096 || /[\x00-\x20\x7f]/.test(raw)) {
    throw new Error("Invalid Comix image URL.");
  }
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid Comix image URL."); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || raw.includes("#") || (url.port && url.port !== "443") ||
    !host.includes(".") || isIP(host) || /^[\d.]+$/.test(host) || host.includes(":") ||
    [".local", ".localhost", ".internal"].some(suffix => host.endsWith(suffix))) {
    throw new Error("Unsafe Comix image URL.");
  }
  return url.toString();
}

/** Only public routable DNS results may reach the TLS connection. */
export function privateComixAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [first, second, third] = address.split(".").map(Number);
    return first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) || (first === 100 && second >= 64 && second <= 127) ||
      (first === 198 && second >= 18 && second <= 19) ||
      (first === 192 && second === 0 && (third === 0 || third === 2)) ||
      (first === 198 && second === 51 && third === 100) || (first === 203 && second === 0 && third === 113);
  }
  if (family === 6) {
    // Reject local/mapped/transition ranges instead of coercing IPv6 into IPv4.
    const first = Number.parseInt(address.split(":")[0], 16);
    return !Number.isInteger(first) || first < 0x2000 || first > 0x3fff ||
      /^2001:(?:0{0,3}[012]|0{0,2}1[0-9a-f]|db8):/i.test(address) || first === 0x2002;
  }
  return true;
}

export const comixImageLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { family: options.family, hints: options.hints, all: true }, (error, addresses) => {
    if (error) return callback(new Error("Comix image DNS lookup failed."), "", 0);
    if (!addresses.length || addresses.some(entry => privateComixAddress(entry.address))) {
      return callback(new Error("Unsafe Comix image destination."), "", 0);
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};

function aborted(signal: AbortSignal): never {
  throw signal.reason instanceof Error ? signal.reason : new Error("Comix image load cancelled.");
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Comix image load cancelled."));
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new Error("Comix image load cancelled."));
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}

interface ImageResponse { status: number; bytes: Buffer; headers: Record<string, string | string[] | undefined> }

function download(url: string, signal: AbortSignal): Promise<ImageResponse> {
  if (signal.aborted) aborted(signal);
  return new Promise((resolve, reject) => {
    let finished = false;
    const done = (error?: Error, result?: ImageResponse) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", cancel);
      if (error) reject(error); else resolve(result!);
    };
    const req = request(url, {
      method: "GET", agent: false, lookup: comixImageLookup,
      // There is no cookie jar, redirect client, provider session, or hotlink header.
      headers: { Accept: "image/png,image/jpeg,image/webp", "Accept-Encoding": "identity" },
    }, response => {
      const status = response.statusCode ?? 502;
      if (status < 200 || status >= 300) {
        response.destroy();
        done(undefined, { status: status >= 200 && status <= 599 ? status : 502, bytes: Buffer.alloc(0), headers: {} });
        return;
      }
      const length = response.headers["content-length"];
      const encoding = response.headers["content-encoding"];
      if ((length !== undefined && (typeof length !== "string" || !/^\d+$/.test(length) || Number(length) > COMIX_IMAGE_MAX_BYTES)) ||
        (encoding !== undefined && encoding !== "identity")) {
        response.destroy();
        done(new Error("Comix image response is oversized or has unsupported encoding."));
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > COMIX_IMAGE_MAX_BYTES) {
          response.destroy();
          done(new Error("Comix image is too large."));
        } else chunks.push(chunk);
      });
      response.once("end", () => done(undefined, { status, bytes: Buffer.concat(chunks, size), headers: response.headers }));
      response.once("error", () => done(new Error("Comix image response failed.")));
      response.once("aborted", () => done(new Error("Comix image response was interrupted.")));
    });
    const cancel = () => {
      req.destroy();
      done(new Error("Comix image load cancelled."));
    };
    signal.addEventListener("abort", cancel, { once: true });
    req.once("error", () => done(new Error("Comix image request failed. Retry this page manually.")));
    req.end();
    if (signal.aborted) cancel();
  });
}

function header(headers: ImageResponse["headers"], name: string): string | null {
  const value = headers[name];
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > 40) throw new Error("Invalid Comix image format header.");
  return value;
}

function integerHeader(headers: ImageResponse["headers"], name: string): number | null {
  const value = header(headers, name);
  if (value === null) return null;
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid Comix image format header.");
  return Number(value);
}

function encodedResponse(bytes: Buffer, type: string): Response {
  if (bytes.length < 1 || bytes.length > COMIX_IMAGE_MAX_BYTES) throw new Error("Comix decoded image is too large.");
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": type, "content-length": String(bytes.length), "cache-control": "no-store" },
  });
}

function pngResult(bytes: Buffer, expected: ComixImageDimensions): Response {
  const actual = assertComixImageDimensions(comixImageDimensions(bytes));
  if (actual.type !== "image/png" || actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error("Comix decoded image dimensions changed.");
  }
  return encodedResponse(bytes, "image/png");
}

/** App-owned, offline WebP decoder. No provider page, website JavaScript or app bridge. */
async function compositeWebp(bytes: Buffer, dimensions: ComixImageDimensions, order: readonly number[] | null, signal: AbortSignal): Promise<Buffer> {
  if (signal.aborted) aborted(signal);
  const isolated = session.fromPartition(`comix-image-${randomUUID()}`);
  isolated.setPermissionCheckHandler(() => false);
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => callback({ cancel: !details.url.startsWith("data:") }));
  isolated.on("will-download", event => event.preventDefault());
  const win = new BrowserWindow({
    show: false, width: 32, height: 32,
    webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webSecurity: true,
      allowRunningInsecureContent: false, webviewTag: false, devTools: false, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", event => event.preventDefault());
  win.webContents.on("will-attach-webview", event => event.preventDefault());
  const cancel = () => { if (!win.isDestroyed()) win.destroy(); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"></head><body></body></html>`;
    await withAbort(win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`), signal);
    const args = { data: `data:image/webp;base64,${bytes.toString("base64")}`, width: dimensions.width, height: dimensions.height,
      order, maxPixels: COMIX_IMAGE_MAX_PIXELS, maxBytes: COMIX_IMAGE_MAX_BYTES };
    const code = `(async () => {
      const args = ${JSON.stringify(args)};
      const image = new Image();
      image.src = args.data;
      await image.decode();
      if (image.naturalWidth !== args.width || image.naturalHeight !== args.height ||
          image.naturalWidth * image.naturalHeight > args.maxPixels) throw Error('Invalid image dimensions');
      const canvas = document.createElement('canvas');
      canvas.width = args.width; canvas.height = args.height;
      const context = canvas.getContext('2d');
      if (!context) throw Error('Image canvas unavailable');
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0);
      if (args.order) {
        const width = Math.floor(args.width / 5), height = Math.floor(args.height / 5);
        if (!width || !height) throw Error('Invalid image grid');
        for (let destination = 0; destination < 25; destination++) {
          const source = args.order[destination];
          context.clearRect(destination % 5 * width, Math.floor(destination / 5) * height, width, height);
          context.drawImage(image, source % 5 * width, Math.floor(source / 5) * height, width, height,
            destination % 5 * width, Math.floor(destination / 5) * height, width, height);
        }
      }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob || !blob.size || blob.size > args.maxBytes) throw Error('Image output too large');
      return await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(Error('Image output unavailable')); reader.readAsDataURL(blob);
      });
    })()`;
    const result: unknown = await withAbort(win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code }]), signal);
    const prefix = "data:image/png;base64,";
    if (typeof result !== "string" || !result.startsWith(prefix) || result.length > prefix.length + Math.ceil(COMIX_IMAGE_MAX_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(result.slice(prefix.length))) throw new Error("Comix image decode failed.");
    return Buffer.from(result.slice(prefix.length), "base64");
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    // This ephemeral partition has no credentials and can be released after each page.
    void isolated.clearStorageData().catch(() => {});
  }
}

async function loadImage(url: string, signal: AbortSignal): Promise<Response> {
  const response = await download(url, signal);
  if (signal.aborted) aborted(signal);
  if (response.status < 200 || response.status >= 300) return new Response(null, { status: response.status });
  const bytes = decodeComixImageBytes(response.bytes, integerHeader(response.headers, "x-enc-seed"),
    integerHeader(response.headers, "x-enc-len"), header(response.headers, "x-enc-algo"));
  const dimensions = assertComixImageDimensions(comixImageDimensions(bytes));
  const seed = integerHeader(response.headers, "x-scramble-seed");
  let order: number[] | null = null;
  if (seed !== null && seed !== 0) {
    if (header(response.headers, "x-scramble-grid") !== "5x5") throw new Error("Unsupported Comix image grid.");
    order = comixTileSources(seed, header(response.headers, "x-scramble-algo"), header(response.headers, "x-scramble-hash"));
  }
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) {
    if (dimensions.type !== "image/webp") throw new Error("Comix image could not be decoded.");
    return pngResult(await compositeWebp(bytes, dimensions, order, signal), dimensions);
  }
  const size = image.getSize(1);
  if (size.width !== dimensions.width || size.height !== dimensions.height) throw new Error("Comix decoded image dimensions changed.");
  if (!order) return encodedResponse(bytes, dimensions.type);
  const bitmap = restoreComixBitmap(image.toBitmap({ scaleFactor: 1 }), size.width, size.height, order);
  const restored = nativeImage.createFromBitmap(bitmap, { width: size.width, height: size.height, scaleFactor: 1 });
  if (restored.isEmpty()) throw new Error("Comix image grid could not be restored.");
  return pngResult(restored.toPNG({ scaleFactor: 1 }), dimensions);
}

/** One exact public image, one request, one bounded decode at a time. Never retries. */
export async function fetchComixImage(raw: string, signal?: AbortSignal): Promise<Response> {
  const url = assertComixImageUrl(raw);
  if (pendingImages >= COMIX_IMAGE_MAX_PENDING) throw new Error("Too many Comix pages are pending. Retry this page manually.");
  pendingImages++;
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Comix image load cancelled."));
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const task = imageTail.then(() => {
      if (controller.signal.aborted) aborted(controller.signal);
      // Prefetch wait is not a failed network request. Start the bounded fetch/
      // decode deadline only after this operation acquires the image slot.
      timer = setTimeout(cancel, DEADLINE_MS);
      return loadImage(url, controller.signal);
    });
    // Cancelled reservations remain in the bounded chain until the predecessor
    // finishes; they cannot release its slot or enable an unbounded abort loop.
    imageTail = task.then(() => { pendingImages--; }, () => { pendingImages--; });
    return await withAbort(task, controller.signal);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
